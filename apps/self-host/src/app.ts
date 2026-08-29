import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { z } from "zod";
import { createInMemoryRateLimiter, submitForm, type TurnstileVerifier } from "@prefab/runtime";
import { newUlid } from "@prefab/schema";
import type { SelfHostDb } from "./db.js";
import { createSqliteFormManifestStore, createSqliteFormSettingsStore, createSqliteSubmissionStore } from "./runtime-adapters.js";
import { createSqliteWebhookQueue, retryDueWebhookDeliveries } from "./lib/webhooks.js";
import { createTurnstileVerifier } from "./lib/turnstile.js";
import { createEmailSender, type EmailSender } from "./lib/email.js";
import { EmailFormNotifier } from "./lib/form-notifier.js";
import { serveBundleFile } from "./static-bundle.js";

const SubmitFormBodySchema = z.object({
  values: z.record(z.string(), z.unknown()),
  turnstileToken: z.string().optional(),
});

export interface AppDeps {
  /** The already-exported static bundle this instance serves (R10) — a self-hosted instance is one site, not a multi-tenant store. */
  bundleDir: string;
  db: SelfHostDb;
  /** Defaults to createTurnstileVerifier()'s env-based choice (the fake unless TURNSTILE_SECRET_KEY is set) — same discipline as apps/api. */
  turnstile?: TurnstileVerifier;
  emailSender?: EmailSender;
  fetchImpl?: typeof fetch;
}

/**
 * The self-host runtime's whole server (ADR-0010 tier b): serves the
 * static bundle and implements the runtime API against SQLite, both from
 * one process with no other pre-fab infrastructure reachable (R10). Every
 * dependency `submitForm` needs (packages/runtime/src/submit.ts) is wired
 * here to a SQLite-backed implementation — `submitForm` itself is the
 * exact same function apps/api's runtime route calls, unchanged.
 */
export function buildApp(deps: AppDeps): FastifyInstance {
  const { bundleDir, db } = deps;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const turnstile = deps.turnstile ?? createTurnstileVerifier();
  const emailSender = deps.emailSender ?? createEmailSender();
  const formNotifier = new EmailFormNotifier(emailSender);

  const formsStore = createSqliteFormManifestStore(db);
  const formSettingsStore = createSqliteFormSettingsStore(db);
  const submissionStore = createSqliteSubmissionStore(db);
  const webhookQueue = createSqliteWebhookQueue(db, fetchImpl);

  // Same limits as apps/api's own runtime route (app.ts): 20/min per site,
  // 5/min per visitor IP — a self-hosted instance is one site, so "per
  // site" here really means "this instance", which is exactly right.
  const siteRateLimiter = createInMemoryRateLimiter({ limit: 20, windowMs: 60_000 });
  const ipRateLimiter = createInMemoryRateLimiter({ limit: 5, windowMs: 60_000 });
  const submitRateLimiter = {
    consume(key: string) {
      return key.startsWith("site:") ? siteRateLimiter.consume(key) : ipRateLimiter.consume(key);
    },
  };

  const app = Fastify({ logger: false });

  app.get("/health", async () => ({ ok: true }));

  app.setErrorHandler((error, _request, reply) => {
    if (typeof error.statusCode === "number" && error.statusCode >= 400 && error.statusCode < 500) {
      reply.status(error.statusCode).send({ error: { code: "validation_error", message: error.message } });
      return;
    }
    app.log.error(error);
    reply.status(500).send({ error: { code: "internal", message: "internal error" } });
  });

  // ---- The runtime API (ADR-0007/ADR-0010) — same shape as apps/api's
  // equivalent route, down to the CORS headers: a bundle's own origin
  // (wherever an operator serves it from) is never known in advance, so
  // this is set explicitly rather than left to a same-origin default. ----
  app.options("/v1/runtime/forms/:formId/submissions", async (_request, reply) => {
    reply
      .header("access-control-allow-origin", "*")
      .header("access-control-allow-methods", "POST, OPTIONS")
      .header("access-control-allow-headers", "content-type")
      .status(204)
      .send();
  });

  app.post<{ Params: { formId: string } }>("/v1/runtime/forms/:formId/submissions", async (request: FastifyRequest<{ Params: { formId: string } }>, reply: FastifyReply) => {
    reply.header("access-control-allow-origin", "*");
    const parsed = SubmitFormBodySchema.safeParse(request.body);
    if (!parsed.success) {
      reply.status(400);
      return { error: { code: "validation_error", message: "invalid request body", details: parsed.error.issues } };
    }

    const result = await submitForm(
      { id: newUlid(), formId: request.params.formId, values: parsed.data.values, ip: request.ip, turnstileToken: parsed.data.turnstileToken },
      {
        forms: formsStore,
        formSettings: formSettingsStore,
        submissions: submissionStore,
        rateLimiter: submitRateLimiter,
        turnstile,
        notifier: formNotifier,
        webhooks: webhookQueue,
      },
    );

    switch (result.status) {
      case "created":
        await retryDueWebhookDeliveries(db, fetchImpl).catch(() => {});
        reply.status(201);
        return { id: result.submissionId };
      case "not_found":
        reply.status(404);
        return { error: { code: "not_found", message: "form not found" } };
      case "invalid":
        reply.status(400);
        return { error: { code: "validation_error", message: "submission failed validation", details: result.issues } };
      case "rate_limited":
        reply.status(429).header("retry-after", String(Math.ceil(result.retryAfterMs / 1000)));
        return { error: { code: "rate_limited", message: "too many submissions — try again shortly" } };
      case "turnstile_failed":
        reply.status(403);
        return { error: { code: "forbidden", message: "spam verification failed" } };
    }
  });

  // ---- Serving the static bundle: everything else falls through here,
  // the same "one big fallback route" apps/api's host-based routing uses,
  // simplified to one bundle directory rather than a multi-tenant lookup. ----
  app.setNotFoundHandler(async (request, reply) => {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return reply.status(404).send({ error: { code: "not_found", message: "not found" } });
    }
    const wildcardPath = request.url.split("?")[0]?.replace(/^\//, "") ?? "";
    return serveBundleFile(bundleDir, wildcardPath, reply);
  });

  return app;
}
