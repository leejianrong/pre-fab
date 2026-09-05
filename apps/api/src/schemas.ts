import { z } from "zod";
import { BlockListSchema, LayoutModeSchema, PostStatusSchema, ThemeTokensSchema } from "@prefab/schema";

export const CreateSiteBodySchema = z.object({
  slug: z.string().min(1).max(64),
  name: z.string().min(1).max(120),
});

export const UpdateThemeBodySchema = z.object({
  tokens: ThemeTokensSchema,
});

export const CreatePageBodySchema = z.object({
  slug: z.string().min(1).max(64),
  title: z.string().min(1).max(200),
});

export const WritePageBodySchema = z.object({
  title: z.string().min(1).max(200),
  slug: z.string().min(1).max(64),
  blocks: BlockListSchema,
  // ADR-0014 / KAN-1129: defaults to "flow" so a caller that predates free
  // positioning (an old CLI, a pushed pre-migration export) writes exactly
  // as it always has — never dropped silently, never forced into "free".
  layoutMode: LayoutModeSchema.default("flow"),
  expectedVersion: z.number().int().nonnegative(),
});

// ---- posts (Slice 5) ----
// `slug` and `date` are optional: an omitted slug is auto-generated from
// `title` (deduped against the site's existing posts), and an omitted date
// defaults to today — the common case of "I'm writing this post now."
export const CreatePostBodySchema = z.object({
  title: z.string().min(1).max(200),
  slug: z.string().min(1).max(96).optional(),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD")
    .optional(),
  author: z.string().max(120).optional(),
  tags: z.array(z.string().max(60)).optional(),
  cover: z.string().max(2048).nullable().optional(),
  body: z.string().max(200_000).optional(),
  locale: z.string().min(1).max(35).optional(),
  status: PostStatusSchema.optional(),
});

export const WritePostBodySchema = z.object({
  title: z.string().min(1).max(200),
  slug: z.string().min(1).max(96),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD"),
  author: z.string().max(120).default(""),
  tags: z.array(z.string().max(60)).default([]),
  cover: z.string().max(2048).nullable().default(null),
  body: z.string().max(200_000).default(""),
  locale: z.string().min(1).max(35).default("en"),
  status: PostStatusSchema.default("draft"),
  expectedVersion: z.number().int().nonnegative(),
});

export const ListPostsQuerySchema = z.object({
  limit: z.coerce.number().int().optional(),
  offset: z.coerce.number().int().optional(),
  status: PostStatusSchema.optional(),
});

export const CreateTokenBodySchema = z.object({
  name: z.string().min(1).max(120),
});

// Base64 grows input by ~4/3 — this coarsely bounds decoded size to 8 MiB
// before the handler decodes anything; the exact byte count is re-checked
// against the same 8 MiB cap after decoding.
const MAX_BASE64_LENGTH = Math.ceil((8 * 1024 * 1024 * 4) / 3);

export const UploadAssetBodySchema = z.object({
  filename: z.string().min(1).max(255),
  contentType: z.string().min(1).max(255),
  dataBase64: z.string().min(1).max(MAX_BASE64_LENGTH),
});

export const DevLoginBodySchema = z.object({
  email: z.string().email(),
});

export const SignupBodySchema = z.object({
  email: z.string().email(),
});

export const VerifyEmailBodySchema = z.object({
  email: z.string().email(),
  code: z.string().length(6),
});

export const CreateSiteFromTemplateBodySchema = z.object({
  slug: z.string().min(1).max(64),
  name: z.string().min(1).max(120),
});

export const AddDomainBodySchema = z.object({
  hostname: z.string().min(1).max(253),
});

/** Dev-only (see `/v1/dev/domains/:providerHostnameId/advance`) — drives the FakeDomainProvider the same way real DNS propagation completing (or failing) would. */
export const AdvanceFakeDomainBodySchema = z.object({
  status: z.enum(["pending", "active", "failed"]),
  verificationErrors: z.array(z.string()).optional(),
});

// ---- forms and submissions (Slice 6) ----
// A blank string clears the setting (an owner turning notification or
// webhook delivery back off) rather than being rejected — `.nullable()`
// so a caller can also send an explicit `null` for the same effect.
export const ConfigureFormBodySchema = z.object({
  notifyEmail: z.string().email().max(320).nullable().optional(),
  webhookUrl: z.string().url().max(2048).nullable().optional(),
  webhookSecret: z.string().max(200).nullable().optional(),
});

export const ListSubmissionsQuerySchema = z.object({
  limit: z.coerce.number().int().optional(),
  offset: z.coerce.number().int().optional(),
});

export const ExportSubmissionsQuerySchema = z.object({
  format: z.enum(["csv", "json"]).default("csv"),
});

/**
 * The runtime API's own submit body — deliberately loose (`z.record`, not
 * per-field validation): field-shape validation is @prefab/runtime's job
 * (validateSubmissionValues, checked against the form's own manifest,
 * where the field types actually live), not this route's. This schema
 * only guards the wire shape before it ever reaches that logic.
 */
export const SubmitFormBodySchema = z.object({
  values: z.record(z.string(), z.union([z.string(), z.boolean()])).default({}),
  turnstileToken: z.string().max(4096).optional(),
});

// ---- KAN-1138: event sign-ups ----
export const ListEventSignupsQuerySchema = z.object({
  limit: z.coerce.number().int().optional(),
  offset: z.coerce.number().int().optional(),
});

export const ExportEventSignupsQuerySchema = z.object({
  format: z.enum(["csv", "json"]).default("csv"),
});

/**
 * The runtime API's own sign-up body — deliberately loose (`z.record`, not
 * per-field validation), same reasoning as SubmitFormBodySchema: field-shape
 * validation is @prefab/runtime's job (validateSubmissionValues, checked
 * against the widget's own manifest), not this route's.
 */
export const SignUpForEventBodySchema = z.object({
  values: z.record(z.string(), z.union([z.string(), z.boolean()])).default({}),
});

// ---- Slice 8: accounts, plans and billing (ADR-0005, ADR-0012) ----
const SiteRoleSchema = z.enum(["editor", "viewer"]);

export const InviteMemberBodySchema = z.object({
  email: z.string().email(),
  role: SiteRoleSchema,
});

export const UpdateMemberRoleBodySchema = z.object({
  role: SiteRoleSchema,
});

export const UpgradePlanBodySchema = z.object({
  plan: z.literal("pro"),
});

/** Dev-only (see `/v1/dev/stripe/:accountId/advance`) — drives the FakeStripeProvider the same way real Stripe webhook delivery would. */
export const AdvanceFakeStripeBodySchema = z.object({
  event: z.enum(["checkout_completed", "payment_failed", "payment_succeeded", "canceled"]),
});

// ---- Slice 9: scheduling and bookings (ADR-0009) ----
const WeeklyWindowSchema = z.object({
  dayOfWeek: z.number().int().min(0).max(6),
  startMinute: z.number().int().min(0).max(1439),
  endMinute: z.number().int().min(1).max(1440),
});

const DateOverrideSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD"),
  closed: z.boolean(),
  windows: z.array(z.object({ startMinute: z.number().int().min(0).max(1439), endMinute: z.number().int().min(1).max(1440) })),
});

export const SetAvailabilityBodySchema = z.object({
  timezone: z.string().min(1).max(64),
  weeklyWindows: z.array(WeeklyWindowSchema).max(50),
  dateOverrides: z.array(DateOverrideSchema).max(200),
  slotDurationMinutes: z.number().int().min(5).max(24 * 60),
  bufferBeforeMinutes: z.number().int().min(0).max(24 * 60),
  bufferAfterMinutes: z.number().int().min(0).max(24 * 60),
  minNoticeMinutes: z.number().int().min(0).max(365 * 24 * 60),
  maxHorizonDays: z.number().int().min(1).max(730),
});

export const ListBookingsQuerySchema = z.object({
  limit: z.coerce.number().int().optional(),
  offset: z.coerce.number().int().optional(),
  status: z.enum(["confirmed", "canceled"]).optional(),
});

export const ListSlotsQuerySchema = z.object({
  /** ISO 8601 instants, UTC-ms — the caller (the Booking block's slot picker) already knows the visitor's own timezone and converts locally; this endpoint only ever deals in absolute instants. */
  rangeStart: z.coerce.date(),
  rangeEnd: z.coerce.date(),
});

export const CreateBookingBodySchema = z.object({
  startsAt: z.coerce.date(),
  visitorName: z.string().min(1).max(200),
  visitorEmail: z.string().email().max(320),
  visitorTimezone: z.string().min(1).max(64),
  notes: z.string().max(2000).optional(),
});

export const ManageBookingBodySchema = z.object({
  token: z.string().min(1),
});

export const RescheduleBookingBodySchema = z.object({
  token: z.string().min(1),
  startsAt: z.coerce.date(),
});

export const ConnectCalendarBodySchema = z.object({
  provider: z.enum(["google", "microsoft"]),
  authorizationCode: z.string().optional(),
  redirectUri: z.string().optional(),
});

/** Dev-only (see `/v1/dev/calendar/:siteId/advance`) — drives the FakeCalendarProvider the same way a real sync/outage would. */
export const AdvanceFakeCalendarBodySchema = z.object({
  busy: z.array(z.object({ startMs: z.number(), endMs: z.number() })).optional(),
  unavailable: z.boolean().optional(),
});

// ---- Slice 10 / KAN-1137: one-off payment blocks, bring-your-own Stripe (ADR-0005) ----
export const ConnectStripeBodySchema = z.object({
  authorizationCode: z.string().min(1),
});

/** Dev-only (see `/v1/dev/stripe-connect/:siteId/advance`) — drives the FakeTenantStripeProvider forward the same way a real checkout.session.completed webhook would, keyed by the session id a runtime checkout call already handed back. */
export const AdvanceFakeStripeConnectBodySchema = z.object({
  sessionId: z.string().min(1),
  buyerEmail: z.string().email().optional(),
});

export const ListPaymentsQuerySchema = z.object({
  limit: z.coerce.number().int().optional(),
  offset: z.coerce.number().int().optional(),
});

// ---- KAN-1154 part 2 / ADR-0016: subscription lifecycle webhook
// consumption — dev-only advance route, and the owner-facing read. ----

/**
 * Dev-only (see `/v1/dev/stripe-connect/:siteId/subscriptions/advance`) —
 * one flexible route, not five, keyed by `event` — drives the exact same
 * state machine (apps/api/src/lib/subscription-webhook.ts) a real webhook
 * would, for whichever Stripe event this call simulates. `eventId` is the
 * dedup key `recordStripeWebhookEvent` uses (mirrors a real Stripe
 * `event.id`) — defaults to a fresh ulid per call (so repeated calls with
 * no `eventId` simulate distinct real-world events); a test proving exact
 * redelivery-is-a-no-op passes the SAME `eventId` twice on purpose.
 */
export const AdvanceFakeSubscriptionBodySchema = z.object({
  event: z.enum(["checkout_completed", "invoice_paid", "invoice_payment_failed", "subscription_updated", "subscription_deleted"]),
  eventId: z.string().min(1).optional(),
  /** checkout_completed only — the row's own stripe_checkout_session_id (what part 1's checkout-creation call snapshotted). */
  stripeCheckoutSessionId: z.string().min(1).optional(),
  /** Every event but checkout_completed keys by this instead (the Subscription id checkout_completed itself establishes). */
  stripeSubscriptionId: z.string().min(1).optional(),
  /** checkout_completed only. */
  stripeCustomerId: z.string().min(1).optional(),
  buyerEmail: z.string().email().optional(),
  /** subscription_updated only — Stripe's own status string, stored verbatim (ADR-0016's question 2). */
  status: z.enum(["incomplete", "incomplete_expired", "trialing", "active", "past_due", "canceled", "unpaid", "paused"]).optional(),
  currentPeriodEnd: z.coerce.date().optional(),
  /** subscription_updated only. */
  cancelAtPeriodEnd: z.boolean().optional(),
});

export const ListSubscriptionsQuerySchema = z.object({
  limit: z.coerce.number().int().optional(),
  offset: z.coerce.number().int().optional(),
});
