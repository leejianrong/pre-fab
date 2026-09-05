import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { z } from "zod";
import {
  createInMemoryRateLimiter,
  submitForm,
  listAvailableSlots,
  createBooking,
  cancelBookingByToken,
  rescheduleBookingByToken,
  signUpForEvent,
  createPaymentCheckout,
  createSubscriptionCheckout,
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
import { EmailEventSignupNotifier } from "./lib/event-signup-notifier.js";
import { serveBundleFile } from "./static-bundle.js";
import { createNullCalendarSyncPort, createSqliteAvailabilityStore, createSqliteBookingStore, createSqliteBookingWidgetStore } from "./booking-adapters.js";
import { createSqliteEventSignupWidgetStore, createSqliteEventSignupStore } from "./event-signup-adapters.js";
import { renderManageBookingPage } from "./booking-manage-page.js";
import { createSqlitePaymentBlockStore, createSqliteStripeConnectionStore, createSqlitePaymentRecordStore } from "./payment-adapters.js";
import { createSqliteSubscriptionBlockStore, createSqliteSubscriptionRecordStore } from "./subscription-adapters.js";
import { createTenantStripeProvider, FakeTenantStripeProvider, type TenantStripeProvider } from "./lib/tenant-stripe.js";
import { EmailSubscriptionNotifier } from "./lib/subscription-notifier.js";
import {
  applySubscriptionCheckoutCompleted,
  applyInvoicePaid,
  applyInvoicePaymentFailed,
  applySubscriptionUpdated,
  applySubscriptionDeleted,
  extractSubscriptionEventContext,
} from "./subscription-webhook.js";

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
const SignUpForEventBodySchema = z.object({ values: z.record(z.string(), z.union([z.string(), z.boolean()])).default({}) });

// Slice 10 / KAN-1137 (ADR-0005) — a self-hosted instance serves exactly
// one site (R10), so unlike apps/api's own equivalent this takes `siteId`
// explicitly in the body rather than resolving it from an authenticated
// principal (self-host has none at all — see this file's own module
// comment): the operator scripting this already knows their own site's id
// from the bundle they exported.
const ConnectStripeBodySchema = z.object({ siteId: z.string().min(1), authorizationCode: z.string().min(1) });
const AdvanceFakeStripeConnectBodySchema = z.object({ sessionId: z.string().min(1), buyerEmail: z.string().email().optional() });

// KAN-1154 part 2 / ADR-0016 (R10) — mirrors apps/api's own
// AdvanceFakeSubscriptionBodySchema (schemas.ts): one flexible route keyed
// by `event`, not five. `siteId` is explicit in the body (not a path
// segment) for the same reason ConnectStripeBodySchema's own comment
// gives: a self-hosted instance has no authenticated principal to resolve
// it from, so the operator/test scripting this already knows their own
// site's id.
const AdvanceFakeSubscriptionBodySchema = z.object({
  siteId: z.string().min(1),
  event: z.enum(["checkout_completed", "invoice_paid", "invoice_payment_failed", "subscription_updated", "subscription_deleted"]),
  eventId: z.string().min(1).optional(),
  stripeCheckoutSessionId: z.string().min(1).optional(),
  stripeSubscriptionId: z.string().min(1).optional(),
  stripeCustomerId: z.string().min(1).optional(),
  buyerEmail: z.string().email().optional(),
  status: z.enum(["incomplete", "incomplete_expired", "trialing", "active", "past_due", "canceled", "unpaid", "paused"]).optional(),
  currentPeriodEnd: z.coerce.date().optional(),
  cancelAtPeriodEnd: z.boolean().optional(),
});

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
  /** Slice 10 / KAN-1137 (ADR-0005) — injectable so a test can reach the exact same fake instance the routes use. Defaults to createTenantStripeProvider()'s env-based choice. */
  tenantStripeProvider?: TenantStripeProvider;
  /** KAN-1154 part 2 / ADR-0016 (R10) — Stripe Connect's own webhook signing secret, required only when a real TenantStripeProvider is configured. Defaults to STRIPE_CONNECT_WEBHOOK_SECRET. */
  stripeConnectWebhookSecret?: string;
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

  // KAN-1138 (R10) — the same SQLite-backed, no-control-plane wiring as
  // forms/bookings above. `ownerEmail` is the exact same operator-configured
  // address bookings already notify (there is no separate per-widget
  // setting here either, mirroring 0009_slice10_events.sql's own reasoning).
  const eventSignupWidgetStore = createSqliteEventSignupWidgetStore(db);
  const eventSignupStore = createSqliteEventSignupStore(db);
  const eventSignupNotifier = new EmailEventSignupNotifier(emailSender);
  const eventSignupSiteRateLimiter = createInMemoryRateLimiter({ limit: 20, windowMs: 60_000 });
  const eventSignupIpRateLimiter = createInMemoryRateLimiter({ limit: 5, windowMs: 60_000 });
  const eventSignupRateLimiter = {
    consume(key: string) {
      return key.startsWith("site:") ? eventSignupSiteRateLimiter.consume(key) : eventSignupIpRateLimiter.consume(key);
    },
  };

  // Slice 10 / KAN-1137 (ADR-0005, R10) — the tenant's own Stripe, no
  // platform dependency needed beyond the connect step (unlike calendar
  // sync, deliberately unavailable above — see booking-adapters.ts's own
  // comment). Fake by default, same discipline as every other adapter.
  const tenantStripeProvider = deps.tenantStripeProvider ?? createTenantStripeProvider();
  const paymentBlockStore = createSqlitePaymentBlockStore(db);
  const stripeConnectionStore = createSqliteStripeConnectionStore(db);
  const paymentRecordStore = createSqlitePaymentRecordStore(db);
  const paymentCheckoutDeps = { paymentBlocks: paymentBlockStore, stripeConnections: stripeConnectionStore, paymentRecords: paymentRecordStore, tenantStripe: tenantStripeProvider };

  // KAN-1154 part 2 / ADR-0016 (R10) — same `emailSender`/`ownerEmail`
  // every other self-host notifier already uses.
  const subscriptionNotifier = new EmailSubscriptionNotifier(emailSender);
  const stripeConnectWebhookSecret = deps.stripeConnectWebhookSecret ?? process.env.STRIPE_CONNECT_WEBHOOK_SECRET ?? "";

  // KAN-1154 / ADR-0016 (R10) — creation only (see that ADR); `stripeConnectionStore` is the exact same instance the one-off payment path above uses.
  const subscriptionBlockStore = createSqliteSubscriptionBlockStore(db);
  const subscriptionRecordStore = createSqliteSubscriptionRecordStore(db);
  const subscriptionCheckoutDeps = {
    subscriptionBlocks: subscriptionBlockStore,
    stripeConnections: stripeConnectionStore,
    subscriptionRecords: subscriptionRecordStore,
    tenantStripe: tenantStripeProvider,
  };

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

  // KAN-1154 part 2 / ADR-0016 — mirrors apps/api's own identical content-
  // type parser exactly: Stripe webhook signature verification needs the
  // exact raw request bytes (Stripe-Signature is an HMAC over the literal
  // body, not the re-serialized JSON), stashed alongside the ordinarily-
  // parsed body so every other route's `request.body` is unaffected.
  app.addContentTypeParser<Buffer>("application/json", { parseAs: "buffer" }, (request, body, done) => {
    (request as FastifyRequest & { rawBody?: Buffer }).rawBody = body;
    if (body.length === 0) {
      done(null, undefined);
      return;
    }
    try {
      done(null, JSON.parse(body.toString("utf8")));
    } catch (error) {
      done(error as Error, undefined);
    }
  });

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

  // ---- KAN-1138's runtime API — same shape as apps/api's equivalent
  // route, calling the exact same @prefab/runtime function unchanged; only
  // what's behind EventSignupWidgetStore/EventSignupStore differs (SQLite,
  // no concurrency lock needed at all — see event-signup-adapters.ts). ----
  app.options("/v1/runtime/event-signups/:widgetId/signups", async (_request, reply) => {
    reply
      .header("access-control-allow-origin", "*")
      .header("access-control-allow-methods", "POST, OPTIONS")
      .header("access-control-allow-headers", "content-type")
      .status(204)
      .send();
  });

  app.post<{ Params: { widgetId: string } }>("/v1/runtime/event-signups/:widgetId/signups", async (request, reply) => {
    reply.header("access-control-allow-origin", "*");
    const parsed = SignUpForEventBodySchema.safeParse(request.body);
    if (!parsed.success) {
      reply.status(400);
      return { error: { code: "validation_error", message: "invalid request body", details: parsed.error.issues } };
    }

    const result = await signUpForEvent(
      { id: newUlid(), widgetId: request.params.widgetId, values: parsed.data.values, ip: request.ip, ownerEmail },
      { widgets: eventSignupWidgetStore, signups: eventSignupStore, rateLimiter: eventSignupRateLimiter, notifier: eventSignupNotifier },
    );

    switch (result.status) {
      case "confirmed":
        reply.status(201);
        return { status: "confirmed", id: result.signupId };
      case "waitlisted":
        reply.status(201);
        return { status: "waitlisted", id: result.signupId, position: result.position };
      case "full":
        reply.status(409);
        return { error: { code: "conflict", message: "this event is full" } };
      case "not_found":
        reply.status(404);
        return { error: { code: "not_found", message: "event sign-up widget not found" } };
      case "invalid":
        reply.status(400);
        return { error: { code: "validation_error", message: "sign-up failed validation", details: result.issues } };
      case "rate_limited":
        reply.status(429).header("retry-after", String(Math.ceil(result.retryAfterMs / 1000)));
        return { error: { code: "rate_limited", message: "too many sign-up requests — try again shortly" } };
    }
  });

  // ---- Slice 10 / KAN-1137 (ADR-0005, R10): a self-hosted site's own
  // Stripe connection — no accounts/sessions exist in self-host at all
  // (this file's own module comment), so this is unauthenticated on
  // purpose, same as every other route here: an operator's own local
  // instance has no other principal to check against. Unlike calendar
  // sync (deliberately unavailable — booking-adapters.ts's own comment),
  // one-off payments need no ongoing platform dependency beyond this
  // connect step, so this instance DOES get a connect/disconnect/status
  // surface unlike calendar's. ----
  app.post("/v1/stripe/connect", async (request, reply) => {
    const parsed = ConnectStripeBodySchema.safeParse(request.body);
    if (!parsed.success) {
      reply.status(400);
      return { error: { code: "validation_error", message: "invalid request body" } };
    }
    const tokens = await tenantStripeProvider.connect({ authorizationCode: parsed.data.authorizationCode });
    db.prepare(
      `INSERT INTO stripe_connections (site_id, stripe_account_id, access_token, status)
       VALUES (@siteId, @stripeAccountId, @accessToken, 'connected')
       ON CONFLICT (site_id) DO UPDATE SET stripe_account_id = excluded.stripe_account_id, access_token = excluded.access_token, status = 'connected'`,
    ).run({ siteId: parsed.data.siteId, stripeAccountId: tokens.stripeAccountId, accessToken: tokens.accessToken });
    return { siteId: parsed.data.siteId, stripeAccountId: tokens.stripeAccountId, status: "connected" };
  });

  app.delete<{ Querystring: { siteId?: string } }>("/v1/stripe/connect", async (request) => {
    db.prepare("DELETE FROM stripe_connections WHERE site_id = ?").run(request.query.siteId ?? "");
    return { removed: true };
  });

  app.get<{ Querystring: { siteId?: string } }>("/v1/stripe/connect", async (request, reply) => {
    if (!request.query.siteId) {
      reply.status(400);
      return { error: { code: "validation_error", message: "siteId query parameter is required" } };
    }
    const row = db
      .prepare<[string], { stripe_account_id: string; status: string }>("SELECT stripe_account_id, status FROM stripe_connections WHERE site_id = ?")
      .get(request.query.siteId);
    if (!row) return null;
    return { stripeAccountId: row.stripe_account_id, status: row.status };
  });

  // ---- Dev-only: drive the fake tenant-Stripe provider forward, the same
  // "dev-only bootstrap, not a product mutation" pattern as apps/api's own
  // /v1/dev/stripe-connect/:siteId/advance — no siteId path segment needed
  // here (a self-hosted instance is one site, so "this instance" already
  // says which one). ----
  app.post("/v1/dev/stripe-connect/advance", async (request, reply) => {
    if (!(tenantStripeProvider instanceof FakeTenantStripeProvider)) {
      reply.status(404);
      return { error: { code: "not_found", message: "the fake tenant-Stripe provider is not in use — nothing to advance" } };
    }
    const parsed = AdvanceFakeStripeConnectBodySchema.safeParse(request.body);
    if (!parsed.success) {
      reply.status(400);
      return { error: { code: "validation_error", message: "invalid request body" } };
    }
    db.prepare(
      `UPDATE payment_records SET status = 'completed', stripe_payment_intent_id = @paymentIntentId, buyer_email = COALESCE(@buyerEmail, buyer_email)
       WHERE stripe_session_id = @sessionId`,
    ).run({ sessionId: parsed.data.sessionId, paymentIntentId: `fake_pi_${newUlid()}`, buyerEmail: parsed.data.buyerEmail ?? null });
    const record = db.prepare("SELECT * FROM payment_records WHERE stripe_session_id = ?").get(parsed.data.sessionId);
    if (!record) {
      reply.status(404);
      return { error: { code: "not_found", message: "no payment record for that session id" } };
    }
    return { record };
  });

  // ---- Dev-only: drive the subscription lifecycle state machine (KAN-1154
  // part 2 / ADR-0016) the same way advance-stripe-connect above drives
  // one-off payments — one flexible route keyed by `event`, calling exactly
  // the same subscription-webhook.ts functions the real webhook route below
  // calls, so the two can never disagree. ----
  app.post("/v1/dev/stripe-connect/subscriptions/advance", async (request, reply) => {
    if (!(tenantStripeProvider instanceof FakeTenantStripeProvider)) {
      reply.status(404);
      return { error: { code: "not_found", message: "the fake tenant-Stripe provider is not in use — nothing to advance" } };
    }
    const parsed = AdvanceFakeSubscriptionBodySchema.safeParse(request.body);
    if (!parsed.success) {
      reply.status(400);
      return { error: { code: "validation_error", message: "invalid request body", details: parsed.error.issues } };
    }
    const body = parsed.data;
    const eventId = body.eventId ?? newUlid();
    const webhookDeps = { db, notifier: subscriptionNotifier, ownerEmail };

    let outcome;
    switch (body.event) {
      case "checkout_completed":
        if (!body.stripeCheckoutSessionId || !body.stripeSubscriptionId || !body.stripeCustomerId) {
          reply.status(400);
          return { error: { code: "validation_error", message: "checkout_completed needs stripeCheckoutSessionId, stripeSubscriptionId and stripeCustomerId" } };
        }
        outcome = await applySubscriptionCheckoutCompleted(
          eventId,
          {
            siteId: body.siteId,
            stripeCheckoutSessionId: body.stripeCheckoutSessionId,
            stripeSubscriptionId: body.stripeSubscriptionId,
            stripeCustomerId: body.stripeCustomerId,
            buyerEmail: body.buyerEmail ?? null,
            currentPeriodEnd: body.currentPeriodEnd?.toISOString() ?? null,
          },
          webhookDeps,
        );
        break;
      case "invoice_paid":
        if (!body.stripeSubscriptionId) {
          reply.status(400);
          return { error: { code: "validation_error", message: "invoice_paid needs stripeSubscriptionId" } };
        }
        outcome = await applyInvoicePaid(eventId, { siteId: body.siteId, stripeSubscriptionId: body.stripeSubscriptionId }, webhookDeps);
        break;
      case "invoice_payment_failed":
        if (!body.stripeSubscriptionId) {
          reply.status(400);
          return { error: { code: "validation_error", message: "invoice_payment_failed needs stripeSubscriptionId" } };
        }
        outcome = await applyInvoicePaymentFailed(eventId, { siteId: body.siteId, stripeSubscriptionId: body.stripeSubscriptionId }, webhookDeps);
        break;
      case "subscription_updated":
        if (!body.stripeSubscriptionId || !body.status) {
          reply.status(400);
          return { error: { code: "validation_error", message: "subscription_updated needs stripeSubscriptionId and status" } };
        }
        outcome = await applySubscriptionUpdated(
          eventId,
          {
            siteId: body.siteId,
            stripeSubscriptionId: body.stripeSubscriptionId,
            status: body.status,
            currentPeriodEnd: body.currentPeriodEnd?.toISOString() ?? null,
            cancelAtPeriodEnd: body.cancelAtPeriodEnd ?? false,
            canceledAt: body.status === "canceled" ? new Date().toISOString() : null,
          },
          webhookDeps,
        );
        break;
      case "subscription_deleted":
        if (!body.stripeSubscriptionId) {
          reply.status(400);
          return { error: { code: "validation_error", message: "subscription_deleted needs stripeSubscriptionId" } };
        }
        outcome = await applySubscriptionDeleted(eventId, { siteId: body.siteId, stripeSubscriptionId: body.stripeSubscriptionId, canceledAt: new Date().toISOString() }, webhookDeps);
        break;
    }

    if (outcome.status === "no_match") {
      reply.status(404);
      return { error: { code: "not_found", message: "no subscription record in a state this event can apply to" } };
    }
    return outcome;
  });

  // ---- Real Stripe Connect webhooks (KAN-1154 part 2 / ADR-0016):
  // signature-verified, subscription lifecycle only — self-host had NO real
  // webhook consumer of any kind before this card (confirmed: even the
  // one-off payment path, Slice 10 / KAN-1137, only ever had the dev-advance
  // route above; that gap is pre-existing and out of this card's scope, not
  // touched here). UNVERIFIED against a live Stripe account, same as every
  // other real adapter in this repo. ----
  app.post("/v1/webhooks/stripe-connect", async (request, reply) => {
    const rawBody = (request as FastifyRequest & { rawBody?: Buffer }).rawBody ?? Buffer.from("");
    const signature = request.headers["stripe-signature"] as string | undefined;

    let event;
    try {
      event = tenantStripeProvider.constructEvent(rawBody, signature, stripeConnectWebhookSecret);
    } catch (error) {
      reply.status(400);
      return { error: { code: "validation_error", message: error instanceof Error ? error.message : "invalid webhook payload" } };
    }

    const webhookDeps = { db, notifier: subscriptionNotifier, ownerEmail };

    if (event.type === "checkout.session.completed") {
      const object = event.data.object as {
        id?: string;
        mode?: string;
        subscription?: string;
        customer?: string;
        customer_details?: { email?: string };
        metadata?: { siteId?: string };
      };
      // Payment-mode (one-off) sessions are deliberately ignored here — see
      // this route's own comment: that path has no real webhook consumer in
      // self-host at all yet, and adding one is not this card's job.
      if (object.mode === "subscription" && object.metadata?.siteId && object.id && object.subscription && object.customer) {
        await applySubscriptionCheckoutCompleted(
          event.id,
          {
            siteId: object.metadata.siteId,
            stripeCheckoutSessionId: object.id,
            stripeSubscriptionId: object.subscription,
            stripeCustomerId: object.customer,
            buyerEmail: object.customer_details?.email ?? null,
            currentPeriodEnd: null,
          },
          webhookDeps,
        );
      }
      reply.status(200);
      return { ok: true };
    }

    if (event.type === "invoice.paid" || event.type === "invoice.payment_failed") {
      const { siteId, stripeSubscriptionId } = extractSubscriptionEventContext(event.type, event.data.object);
      if (siteId && stripeSubscriptionId) {
        const apply = event.type === "invoice.paid" ? applyInvoicePaid : applyInvoicePaymentFailed;
        await apply(event.id, { siteId, stripeSubscriptionId }, webhookDeps);
      }
      reply.status(200);
      return { ok: true };
    }

    if (event.type === "customer.subscription.updated") {
      const { siteId, stripeSubscriptionId } = extractSubscriptionEventContext(event.type, event.data.object);
      const object = event.data.object as { status?: string; current_period_end?: number; cancel_at_period_end?: boolean; canceled_at?: number };
      if (siteId && stripeSubscriptionId && object.status) {
        await applySubscriptionUpdated(
          event.id,
          {
            siteId,
            stripeSubscriptionId,
            status: object.status,
            currentPeriodEnd: object.current_period_end ? new Date(object.current_period_end * 1000).toISOString() : null,
            cancelAtPeriodEnd: object.cancel_at_period_end ?? false,
            canceledAt: object.canceled_at ? new Date(object.canceled_at * 1000).toISOString() : null,
          },
          webhookDeps,
        );
      }
      reply.status(200);
      return { ok: true };
    }

    if (event.type === "customer.subscription.deleted") {
      const { siteId, stripeSubscriptionId } = extractSubscriptionEventContext(event.type, event.data.object);
      const object = event.data.object as { canceled_at?: number };
      if (siteId && stripeSubscriptionId) {
        await applySubscriptionDeleted(
          event.id,
          { siteId, stripeSubscriptionId, canceledAt: object.canceled_at ? new Date(object.canceled_at * 1000).toISOString() : new Date().toISOString() },
          webhookDeps,
        );
      }
      reply.status(200);
      return { ok: true };
    }

    reply.status(200);
    return { ok: true };
  });

  // ---- The runtime API (Slice 10 / KAN-1137) — same shape as apps/api's
  // equivalent route, calling the exact same @prefab/runtime function
  // unchanged; only what's behind PaymentBlockStore/StripeConnectionStore/
  // PaymentRecordStore/TenantStripeProvider differs (SQLite, and this
  // file's own trimmed tenant-stripe.ts). ----
  app.options("/v1/runtime/payment-blocks/:blockId/checkout", async (_request, reply) => {
    reply.header("access-control-allow-origin", "*").header("access-control-allow-methods", "POST, OPTIONS").status(204).send();
  });

  app.post<{ Params: { blockId: string } }>("/v1/runtime/payment-blocks/:blockId/checkout", async (request, reply) => {
    reply.header("access-control-allow-origin", "*");
    const { blockId } = request.params;
    const referer = (request.headers.referer as string | undefined) ?? runtimeApiUrl;

    function returnUrl(outcome: "success" | "cancel"): string {
      let url: URL;
      try {
        url = new URL(referer);
      } catch {
        url = new URL(runtimeApiUrl);
      }
      url.searchParams.set("pf_payment", outcome);
      url.searchParams.set("pf_payment_block", blockId);
      return url.toString();
    }

    const result = await createPaymentCheckout(
      { id: newUlid(), blockId, successUrl: returnUrl("success"), cancelUrl: returnUrl("cancel") },
      paymentCheckoutDeps,
    );

    switch (result.status) {
      case "created":
        reply.status(201);
        return { url: result.url };
      case "not_found":
        reply.status(404);
        return { error: { code: "not_found", message: "payment block not found" } };
      case "no_connection":
        reply.status(404);
        return { error: { code: "not_found", message: "this site has not connected a Stripe account" } };
      case "provider_error":
        reply.status(500);
        return { error: { code: "internal", message: "the payment provider could not create a checkout session" } };
    }
  });

  // ---- The runtime API (KAN-1154 / ADR-0016, part 1 — creation only) —
  // same shape as apps/api's own equivalent route, calling the exact same
  // @prefab/runtime function unchanged; only what's behind
  // SubscriptionBlockStore/StripeConnectionStore/SubscriptionRecordStore/
  // TenantStripeProvider differs (SQLite, and this file's own trimmed
  // tenant-stripe.ts). ----
  app.options("/v1/runtime/subscription-blocks/:blockId/checkout", async (_request, reply) => {
    reply.header("access-control-allow-origin", "*").header("access-control-allow-methods", "POST, OPTIONS").status(204).send();
  });

  app.post<{ Params: { blockId: string } }>("/v1/runtime/subscription-blocks/:blockId/checkout", async (request, reply) => {
    reply.header("access-control-allow-origin", "*");
    const { blockId } = request.params;
    const referer = (request.headers.referer as string | undefined) ?? runtimeApiUrl;

    function returnUrl(outcome: "success" | "cancel"): string {
      let url: URL;
      try {
        url = new URL(referer);
      } catch {
        url = new URL(runtimeApiUrl);
      }
      url.searchParams.set("pf_subscription", outcome);
      url.searchParams.set("pf_subscription_block", blockId);
      return url.toString();
    }

    const result = await createSubscriptionCheckout(
      { id: newUlid(), blockId, successUrl: returnUrl("success"), cancelUrl: returnUrl("cancel") },
      subscriptionCheckoutDeps,
    );

    switch (result.status) {
      case "created":
        reply.status(201);
        return { url: result.url };
      case "not_found":
        reply.status(404);
        return { error: { code: "not_found", message: "subscription block not found" } };
      case "no_connection":
        reply.status(404);
        return { error: { code: "not_found", message: "this site has not connected a Stripe account" } };
      case "provider_error":
        reply.status(500);
        return { error: { code: "internal", message: "the payment provider could not create a checkout session" } };
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
