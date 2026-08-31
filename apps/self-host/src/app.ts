import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { z } from "zod";
import {
  createInMemoryRateLimiter,
  submitForm,
  listAvailableSlots,
  createBooking,
  cancelBookingByToken,
  rescheduleBookingByToken,
  type TurnstileVerifier,
} from "@prefab/runtime";
import { newUlid } from "@prefab/schema";
import type { SelfHostDb } from "./db.js";
import { createSqliteFormManifestStore, createSqliteFormSettingsStore, createSqliteSubmissionStore } from "./runtime-adapters.js";
import { createSqliteWebhookQueue, retryDueWebhookDeliveries } from "./lib/webhooks.js";
import { createTurnstileVerifier } from "./lib/turnstile.js";
import { createEmailSender, type EmailSender } from "./lib/email.js";
import { EmailFormNotifier } from "./lib/form-notifier.js";
import { EmailBookingNotifier } from "./lib/booking-notifier.js";
import { serveBundleFile } from "./static-bundle.js";
import { createNullCalendarSyncPort, createSqliteAvailabilityStore, createSqliteBookingStore, createSqliteBookingWidgetStore } from "./booking-adapters.js";
import { renderManageBookingPage } from "./booking-manage-page.js";

const SubmitFormBodySchema = z.object({
  values: z.record(z.string(), z.unknown()),
  turnstileToken: z.string().optional(),
});

const ListSlotsQuerySchema = z.object({ rangeStart: z.coerce.date(), rangeEnd: z.coerce.date() });
const CreateBookingBodySchema = z.object({
  startsAt: z.coerce.date(),
  visitorName: z.string().min(1).max(200),
  visitorEmail: z.string().email().max(320),
  visitorTimezone: z.string().min(1).max(64),
  notes: z.string().max(2000).optional(),
});
const ManageBookingBodySchema = z.object({ token: z.string().min(1) });
const RescheduleBookingBodySchema = z.object({ token: z.string().min(1), startsAt: z.coerce.date() });

export interface AppDeps {
  /** The already-exported static bundle this instance serves (R10) — a self-hosted instance is one site, not a multi-tenant store. */
  bundleDir: string;
  db: SelfHostDb;
  /** Defaults to createTurnstileVerifier()'s env-based choice (the fake unless TURNSTILE_SECRET_KEY is set) — same discipline as apps/api. */
  turnstile?: TurnstileVerifier;
  emailSender?: EmailSender;
  fetchImpl?: typeof fetch;
  /** Where this instance is reachable at — used to build booking manage-page links in confirmation emails. Defaults to RUNTIME_API_URL, then http://localhost:<port>. */
  runtimeApiUrl?: string;
  /** No accounts/sessions exist in self-host — an owner-notification address is plain operator configuration (Slice 9's booking-side equivalent of form_settings.notify_email). Defaults to BOOKING_OWNER_EMAIL, unset means no owner-side copy is sent. */
  ownerEmail?: string | null;
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

  // Slice 9 (ADR-0009/ADR-0010, R10) — local availability/bookings work
  // completely unaffected by there being no calendar sync or owner
  // account system in self-host at all (createNullCalendarSyncPort).
  const runtimeApiUrl = deps.runtimeApiUrl ?? process.env.RUNTIME_API_URL ?? `http://localhost:${process.env.PORT ?? 8080}`;
  const ownerEmail = deps.ownerEmail !== undefined ? deps.ownerEmail : (process.env.BOOKING_OWNER_EMAIL ?? null);
  const bookingWidgetStore = createSqliteBookingWidgetStore(db);
  const availabilityStore = createSqliteAvailabilityStore(db);
  const bookingStore = createSqliteBookingStore(db);
  const calendarSyncPort = createNullCalendarSyncPort();
  const bookingNotifier = new EmailBookingNotifier(emailSender, runtimeApiUrl);
  const bookingRuntimeDeps = { widgets: bookingWidgetStore, availability: availabilityStore, bookings: bookingStore, calendarSync: calendarSyncPort };
  const bookingRateLimiter = createInMemoryRateLimiter({ limit: 20, windowMs: 60_000 });

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

  // ---- Slice 9's runtime API — same shape as apps/api's equivalent
  // routes, calling the exact same @prefab/runtime functions unchanged;
  // only what's behind BookingStore/AvailabilityStore/CalendarSyncPort
  // differs (SQLite, and no calendar sync — see booking-adapters.ts). ----
  app.options("/v1/runtime/booking-widgets/:widgetId/slots", async (_request, reply) => {
    reply.header("access-control-allow-origin", "*").header("access-control-allow-methods", "GET, OPTIONS").status(204).send();
  });
  app.options("/v1/runtime/booking-widgets/:widgetId/bookings", async (_request, reply) => {
    reply.header("access-control-allow-origin", "*").header("access-control-allow-methods", "POST, OPTIONS").header("access-control-allow-headers", "content-type").status(204).send();
  });
  app.options("/v1/runtime/bookings/:siteId/:bookingId/cancel", async (_request, reply) => {
    reply.header("access-control-allow-origin", "*").header("access-control-allow-methods", "POST, OPTIONS").header("access-control-allow-headers", "content-type").status(204).send();
  });
  app.options("/v1/runtime/bookings/:siteId/:bookingId/reschedule", async (_request, reply) => {
    reply.header("access-control-allow-origin", "*").header("access-control-allow-methods", "POST, OPTIONS").header("access-control-allow-headers", "content-type").status(204).send();
  });

  app.get<{ Params: { widgetId: string }; Querystring: { rangeStart?: string; rangeEnd?: string } }>(
    "/v1/runtime/booking-widgets/:widgetId/slots",
    async (request, reply) => {
      reply.header("access-control-allow-origin", "*");
      const parsed = ListSlotsQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        reply.status(400);
        return { error: { code: "validation_error", message: "invalid query parameters", details: parsed.error.issues } };
      }
      const result = await listAvailableSlots(
        { widgetId: request.params.widgetId, rangeStartMs: parsed.data.rangeStart.getTime(), rangeEndMs: parsed.data.rangeEnd.getTime() },
        bookingRuntimeDeps,
      );
      if (result.status !== "ok") {
        reply.status(404);
        return { error: { code: "not_found", message: "booking widget not found" } };
      }
      return { slots: result.slots, slotDurationMinutes: result.rule.slotDurationMinutes, calendarSyncOk: result.calendarSyncOk };
    },
  );

  app.post<{ Params: { widgetId: string } }>("/v1/runtime/booking-widgets/:widgetId/bookings", async (request, reply) => {
    reply.header("access-control-allow-origin", "*");
    const parsed = CreateBookingBodySchema.safeParse(request.body);
    if (!parsed.success) {
      reply.status(400);
      return { error: { code: "validation_error", message: "invalid request body", details: parsed.error.issues } };
    }
    const result = await createBooking(
      {
        id: newUlid(),
        widgetId: request.params.widgetId,
        startsAtMs: parsed.data.startsAt.getTime(),
        visitorName: parsed.data.visitorName,
        visitorEmail: parsed.data.visitorEmail,
        visitorTimezone: parsed.data.visitorTimezone,
        notes: parsed.data.notes,
        manageToken: newUlid(),
        manageBaseUrl: runtimeApiUrl,
        ownerEmail,
      },
      { ...bookingRuntimeDeps, notifier: bookingNotifier, rateLimiter: bookingRateLimiter },
    );
    switch (result.status) {
      case "created":
        reply.status(201);
        return { id: result.booking.id, startsAt: result.booking.startsAt, endsAt: result.booking.endsAt, calendarSyncOk: result.calendarSyncOk };
      case "widget_not_found":
      case "rule_not_found":
        reply.status(404);
        return { error: { code: "not_found", message: "booking widget not found" } };
      case "invalid":
        reply.status(400);
        return { error: { code: "validation_error", message: "booking failed validation", details: result.issues } };
      case "slot_taken":
        reply.status(409);
        return { error: { code: "conflict", message: "that slot is no longer available" } };
      case "rate_limited":
        reply.status(429).header("retry-after", String(Math.ceil(result.retryAfterMs / 1000)));
        return { error: { code: "rate_limited", message: "too many booking requests — try again shortly" } };
    }
  });

  app.get<{ Params: { siteId: string; bookingId: string }; Querystring: { token?: string } }>(
    "/v1/runtime/bookings/:siteId/:bookingId",
    async (request, reply) => {
      reply.header("access-control-allow-origin", "*");
      if (!request.query.token) {
        reply.status(400);
        return { error: { code: "validation_error", message: "a manage token is required" } };
      }
      const booking = await bookingStore.getByManageToken(request.params.siteId, request.params.bookingId, request.query.token);
      if (!booking) {
        reply.status(404);
        return { error: { code: "not_found", message: "booking not found" } };
      }
      return { id: booking.id, startsAt: booking.startsAt, endsAt: booking.endsAt, visitorName: booking.visitorName, visitorTimezone: booking.visitorTimezone };
    },
  );

  app.get<{ Params: { siteId: string; bookingId: string }; Querystring: { token?: string } }>(
    "/v1/runtime/bookings/:siteId/:bookingId/manage",
    async (request, reply) => {
      reply.type("text/html; charset=utf-8");
      return reply.send(renderManageBookingPage({ runtimeApiUrl, siteId: request.params.siteId, bookingId: request.params.bookingId, token: request.query.token ?? "" }));
    },
  );

  app.post<{ Params: { siteId: string; bookingId: string } }>("/v1/runtime/bookings/:siteId/:bookingId/cancel", async (request, reply) => {
    reply.header("access-control-allow-origin", "*");
    const parsed = ManageBookingBodySchema.safeParse(request.body);
    if (!parsed.success) {
      reply.status(400);
      return { error: { code: "validation_error", message: "invalid request body" } };
    }
    const result = await cancelBookingByToken(
      { siteId: request.params.siteId, bookingId: request.params.bookingId, manageToken: parsed.data.token, ownerEmail, ownerTimezone: (await availabilityStore.getRule(request.params.siteId))?.timezone ?? "UTC" },
      { bookings: bookingStore, calendarSync: calendarSyncPort, notifier: bookingNotifier },
    );
    if (result.status === "not_found") {
      reply.status(404);
      return { error: { code: "not_found", message: "booking not found" } };
    }
    return { status: "canceled" };
  });

  app.post<{ Params: { siteId: string; bookingId: string } }>("/v1/runtime/bookings/:siteId/:bookingId/reschedule", async (request, reply) => {
    reply.header("access-control-allow-origin", "*");
    const parsed = RescheduleBookingBodySchema.safeParse(request.body);
    if (!parsed.success) {
      reply.status(400);
      return { error: { code: "validation_error", message: "invalid request body" } };
    }
    const rule = await availabilityStore.getRule(request.params.siteId);
    const result = await rescheduleBookingByToken(
      {
        siteId: request.params.siteId,
        bookingId: request.params.bookingId,
        manageToken: parsed.data.token,
        newStartsAtMs: parsed.data.startsAt.getTime(),
        ownerEmail,
        ownerTimezone: rule?.timezone ?? "UTC",
        manageBaseUrl: runtimeApiUrl,
      },
      { ...bookingRuntimeDeps, notifier: bookingNotifier, rateLimiter: bookingRateLimiter },
    );
    switch (result.status) {
      case "rescheduled":
        return { id: result.booking.id, startsAt: result.booking.startsAt, endsAt: result.booking.endsAt, calendarSyncOk: result.calendarSyncOk };
      case "not_found":
        reply.status(404);
        return { error: { code: "not_found", message: "booking not found" } };
      case "slot_taken":
        reply.status(409);
        return { error: { code: "conflict", message: "that slot is no longer available" } };
      case "invalid":
        reply.status(400);
        return { error: { code: "validation_error", message: "invalid reschedule request", details: result.issues } };
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
