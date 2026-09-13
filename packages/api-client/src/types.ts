import type {
  BlockNode,
  DocumentDiff,
  FieldDiff,
  FulfillmentType,
  LayoutMode,
  PageDocument,
  PostDocument,
  PostStatus,
  ProductDocument,
  ProductStatus,
  ThemeDocument,
  ThemeTokens,
} from "@prefab/schema";

export interface SiteSummary {
  id: string;
  slug: string;
  name: string;
  ownerId: string;
  schemaVersion: number;
  createdAt: string;
  updatedAt: string;
  /**
   * KAN-1253: the site's free, unauthenticated public address
   * (`https://<slug>.<platformHost>`) — populated by `GET /v1/sites/:id`.
   * Optional because other endpoints returning a `SiteSummary`-shaped
   * object (site.create, site.list) don't compute it.
   */
  publicUrl?: string;
}

export interface PageSummary {
  id: string;
  slug: string;
  title: string;
}

export interface CreateSiteResult {
  site: SiteSummary;
  page: PageDocument;
}

export interface TemplateSummary {
  id: string;
  name: string;
  category: string;
  tagline: string;
  description: string;
  /** KAN-1206: API-relative path to this template's preview thumbnail — see @prefab/templates' TemplateManifestSchema. */
  thumbnailUrl: string;
}

export interface CreateSiteFromTemplateResult {
  site: SiteSummary;
  pages: PageDocument[];
  templateId: string;
}

export interface SignupResult {
  accountId: string;
  status: "pending_verification";
}

export type CustomDomainStatus = "pending_dns" | "active" | "failed";

export interface CustomDomain {
  id: string;
  siteId: string;
  hostname: string;
  isApex: boolean;
  status: CustomDomainStatus;
  providerHostnameId: string | null;
  cnameTarget: string;
  verificationError: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
}

export interface DnsInstruction {
  recordType: "CNAME" | "ALIAS/ANAME";
  name: string;
  value: string;
  note: string;
}

export interface DomainWithInstruction {
  domain: CustomDomain;
  dnsInstruction: DnsInstruction;
}

export interface VerifyEmailResult {
  accountId: string;
}

export interface IssuedApiToken {
  id: string;
  name: string;
  /** Shown once, at mint time — never retrievable again. */
  token: string;
  expiresAt: string;
}

export interface SiteOutline {
  site: { id: string; slug: string; name: string };
  pages: Array<{
    id: string;
    slug: string;
    title: string;
    blocks: Array<{ id: string; type: string; summary: string }>;
  }>;
}

export interface PublishRecord {
  id: string;
  siteId: string;
  bundlePath: string;
  contentHash: string;
  isLive: boolean;
  createdAt: string;
  createdBy: string;
}

export interface PublishResult {
  publish: PublishRecord;
  /**
   * KAN-1253: an *authenticated* preview route, relative to the API's own
   * base URL — requires the owner's own login, so it 401s for anyone else.
   * Kept for the "preview as the owner" use case
   * (packages/commands/test/commands.integration.test.ts exercises this
   * route directly). Not shareable — use `publicUrl` for that.
   */
  liveUrl: string;
  /** The real, unauthenticated public address (`https://<slug>.<platformHost>`) — safe to share. */
  publicUrl: string;
}

export interface PreviewResult {
  contentHash: string;
  previewUrl: string;
}

export interface WritePageInput {
  title: string;
  slug: string;
  blocks: BlockNode[];
  /** ADR-0014 / KAN-1129. Omitted (or "flow") behaves exactly as before this field existed. */
  layoutMode?: LayoutMode;
  expectedVersion: number;
}

/** Mirrors apps/api's 409 conflict payload (R17) exactly. */
export interface ConflictDetails {
  current: PageDocument;
  diff: DocumentDiff;
}

// ---- posts (Slice 5) ----

export interface CreatePostInput {
  title: string;
  slug?: string;
  date?: string;
  author?: string;
  tags?: string[];
  cover?: string | null;
  body?: string;
  locale?: string;
  status?: PostStatus;
}

export interface WritePostInput {
  title: string;
  slug: string;
  date: string;
  author: string;
  tags: string[];
  cover: string | null;
  body: string;
  locale: string;
  status: PostStatus;
  expectedVersion: number;
}

export interface ListPostsQuery {
  limit?: number;
  offset?: number;
  status?: PostStatus;
}

export interface ListPostsResult {
  posts: PostDocument[];
  total: number;
}

/** Mirrors apps/api's post.write 409 conflict payload — a plain field diff, since a post has no block tree to diff (unlike page.write's ConflictDetails). */
export interface PostConflictDetails {
  current: PostDocument;
  diff: FieldDiff[];
}

// ---- products (KAN-1244 / ADR-0018) ----

export interface CreateProductInput {
  title: string;
  slug?: string;
  description?: string;
  images?: string[];
  price: number;
  currency?: string;
  fulfillmentType?: FulfillmentType;
  /** Required (non-negative) for a physical product; must be omitted/null for a digital/service one. Omitted entirely defaults to 0 for physical, null for digital/service — see apps/api's product.create route. */
  stockCount?: number | null;
  successMessage?: string;
  status?: ProductStatus;
}

export interface WriteProductInput {
  title: string;
  slug: string;
  description: string;
  images: string[];
  price: number;
  currency: string;
  fulfillmentType: FulfillmentType;
  stockCount: number | null;
  successMessage: string;
  status: ProductStatus;
  expectedVersion: number;
}

export interface ListProductsQuery {
  limit?: number;
  offset?: number;
  status?: ProductStatus;
}

export interface ListProductsResult {
  products: ProductDocument[];
  total: number;
}

/** Mirrors apps/api's product.write 409 conflict payload — a plain field diff, the same shape PostConflictDetails already uses. */
export interface ProductConflictDetails {
  current: ProductDocument;
  diff: FieldDiff[];
}

// ---- orders (KAN-1246 / ADR-0018 part 3 addendum) ----
// An "order" IS a cart_checkout_records row once its status moves to
// 'completed' — see that ADR addendum's point 1 for why there is no
// separate Order type distinct from CartCheckoutRecord below.

export type CartCheckoutRecordStatus = "pending" | "completed" | "failed";

/** One resolved, server-validated line of a completed cart Checkout session — see @prefab/runtime's createCartCheckout for where this is built. */
export interface CartCheckoutRecordItem {
  productId: string;
  quantity: number;
  /** Cents. */
  unitAmount: number;
  currency: string;
  title: string;
  fulfillmentType: FulfillmentType;
}

/** The order header (KAN-1245's own cart_checkout_records row) — visitor PII/payment metadata (R20), platform Postgres only. */
export interface CartCheckoutRecord {
  id: string;
  siteId: string;
  stripeSessionId: string;
  items: CartCheckoutRecordItem[];
  currency: string;
  /** Cents — sum of every line's unitAmount * quantity, excluding shipping. */
  amountSubtotal: number;
  requiresShipping: boolean;
  status: CartCheckoutRecordStatus;
  buyerEmail: string | null;
  createdAt: string;
  updatedAt: string;
}

export type OrderItemStatus = "unfulfilled" | "shipped" | "delivered";

/** One order line's own fulfillment state — see 0015_kan1246_orders.sql's own header comment for why this is a separate table from the header above. */
export interface OrderItem {
  id: string;
  cartCheckoutRecordId: string;
  siteId: string;
  productId: string;
  quantity: number;
  /** Cents. */
  unitAmount: number;
  currency: string;
  title: string;
  fulfillmentType: FulfillmentType;
  status: OrderItemStatus;
  trackingNumber: string | null;
  /** See the ADR addendum's point 3 — set when this line's stock decrement found insufficient stock. Always false for a digital/service line. */
  oversold: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ListOrdersQuery {
  limit?: number;
  offset?: number;
  status?: CartCheckoutRecordStatus;
}

export interface ListOrdersResult {
  records: CartCheckoutRecord[];
  total: number;
}

export interface OrderWithItems {
  order: CartCheckoutRecord;
  items: OrderItem[];
}

/** `order.markShipped` — free-text tracking number, no carrier lookup (deferred). */
export interface MarkOrderItemShippedInput {
  trackingNumber: string;
}

export interface OrderExportRow {
  orderId: string;
  orderItemId: string;
  orderCreatedAt: string;
  buyerEmail: string | null;
  productId: string;
  title: string;
  quantity: number;
  unitAmount: number;
  currency: string;
  fulfillmentType: FulfillmentType;
  status: OrderItemStatus;
  trackingNumber: string | null;
  oversold: boolean;
}

export interface AssetVariant {
  width: number;
  key: string;
}

export interface Asset {
  id: string;
  siteId: string;
  sha256: string;
  contentType: string;
  byteSize: number;
  filename: string;
  width: number | null;
  height: number | null;
  variants: AssetVariant[];
  createdAt: string;
  createdBy: string;
}

export interface UploadAssetInput {
  filename: string;
  contentType: string;
  dataBase64: string;
}

// ---- forms and submissions (Slice 6) ----

export type FormFieldType = "text" | "email" | "textarea" | "select" | "checkbox" | "file";

export interface FormField {
  type: FormFieldType;
  label: string;
  name: string;
  required: boolean;
  /** One option per line — only meaningful for `type: "select"`. */
  options?: string;
}

export interface FormManifest {
  id: string;
  siteId: string;
  heading: string;
  fields: FormField[];
  submitLabel: string;
  turnstileEnabled: boolean;
}

export interface FormSettings {
  formId: string;
  siteId: string;
  notifyEmail: string | null;
  webhookUrl: string | null;
  webhookSecret: string | null;
}

export interface ConfigureFormInput {
  notifyEmail?: string | null;
  webhookUrl?: string | null;
  webhookSecret?: string | null;
}

export interface FormWithSettings {
  form: FormManifest | null;
  settings: FormSettings | null;
}

export interface Submission {
  id: string;
  siteId: string;
  formId: string;
  values: Record<string, unknown>;
  ip: string | null;
  notifyStatus: "skipped" | "sent" | "failed";
  notifyError: string | null;
  createdAt: string;
}

export interface ListSubmissionsQuery {
  limit?: number;
  offset?: number;
}

export interface ListSubmissionsResult {
  submissions: Submission[];
  total: number;
}

// ---- KAN-1138: event sign-ups ----

export interface EventSignupWidget {
  id: string;
  siteId: string;
  heading: string;
  fields: FormField[];
  capacity: number | null;
  waitlistEnabled: boolean;
  submitLabel: string;
}

export interface EventSignup {
  id: string;
  widgetId: string;
  siteId: string;
  values: Record<string, unknown>;
  status: "confirmed" | "waitlisted";
  position: number | null;
  createdAt: string;
}

export interface ListEventSignupsQuery {
  limit?: number;
  offset?: number;
}

export interface ListEventSignupsResult {
  signups: EventSignup[];
  total: number;
}

// ---- Slice 8: accounts, plans and billing (ADR-0005, ADR-0012) ----
export type SiteRole = "owner" | "editor" | "viewer";

export interface SiteMember {
  siteId: string;
  accountId: string;
  role: SiteRole;
  createdAt: string;
}

export type Plan = "free" | "pro";
export type SubscriptionStatus = "active" | "past_due" | "canceled";

export interface Subscription {
  id: string;
  accountId: string;
  plan: Plan;
  status: SubscriptionStatus;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  gracePeriodEndsAt: string | null;
  canceledAt: string | null;
  retentionEndsAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CheckoutSession {
  sessionId: string;
  url: string;
}

export interface UpgradePlanResult {
  subscription: Subscription;
  checkout: CheckoutSession | null;
}

// ---- Slice 9: scheduling and bookings (ADR-0009) ----
export interface WeeklyWindow {
  dayOfWeek: number;
  startMinute: number;
  endMinute: number;
}

export interface DateOverride {
  date: string;
  closed: boolean;
  windows: Array<{ startMinute: number; endMinute: number }>;
}

export interface SetAvailabilityInput {
  timezone: string;
  weeklyWindows: WeeklyWindow[];
  dateOverrides: DateOverride[];
  slotDurationMinutes: number;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  minNoticeMinutes: number;
  maxHorizonDays: number;
}

export interface AvailabilityRule extends SetAvailabilityInput {
  id: string;
  siteId: string;
}

export type BookingStatus = "confirmed" | "canceled";

export interface Booking {
  id: string;
  siteId: string;
  widgetId: string;
  startsAt: string;
  endsAt: string;
  visitorName: string;
  visitorEmail: string;
  visitorTimezone: string;
  notes: string | null;
  status: BookingStatus;
  externalEventId: string | null;
  createdAt: string;
  canceledAt: string | null;
}

export interface ListBookingsQuery {
  limit?: number;
  offset?: number;
  status?: BookingStatus;
}

export interface ListBookingsResult {
  bookings: Booking[];
  total: number;
}

export type CalendarProviderName = "google" | "microsoft";

export interface CalendarConnectionStatus {
  id: string;
  provider: CalendarProviderName;
  status: "connected" | "error";
  externalCalendarId: string | null;
  lastSyncError?: string | null;
}

export interface ConnectCalendarInput {
  provider: CalendarProviderName;
  authorizationCode?: string;
  redirectUri?: string;
}

// ---- Slice 10 / KAN-1137: one-off payment blocks, bring-your-own Stripe (ADR-0005) ----

export interface StripeConnectionStatus {
  id: string;
  stripeAccountId: string;
  status: "connected" | "error";
}

export interface ConnectStripeInput {
  /** A pre-obtained OAuth authorization code — the owner completes Stripe's own Connect consent screen in the browser and hands the resulting code here. Real providers only; the fake (default everywhere, including CI) accepts any string. */
  authorizationCode: string;
}

export interface PaymentRecord {
  id: string;
  siteId: string;
  blockId: string;
  stripeSessionId: string;
  stripePaymentIntentId: string | null;
  amount: number;
  currency: string;
  status: "pending" | "completed" | "failed";
  buyerEmail: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ListPaymentsQuery {
  limit?: number;
  offset?: number;
}

export interface ListPaymentsResult {
  records: PaymentRecord[];
  total: number;
}

export type {
  PageDocument,
  PostDocument,
  PostStatus,
  ProductDocument,
  ProductStatus,
  FulfillmentType,
  ThemeDocument,
  ThemeTokens,
  BlockNode,
  DocumentDiff,
  FieldDiff,
};
