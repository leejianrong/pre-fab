import type { FormFieldDef, SubmissionValues } from "./types.js";

/**
 * KAN-1138's own vocabulary (ADR-0007/ADR-0010) — deliberately independent
 * of @prefab/schema and every control-plane package, the same discipline
 * types.ts/booking-types.ts already document. apps/self-host reimplements
 * the storage interfaces below against SQLite; nothing here references a
 * control-plane type even by name.
 */

/** The publish-safe manifest a sign-up request is validated against — see @prefab/db's `event_signup_widgets` table. */
export interface EventSignupWidgetManifest {
  id: string;
  siteId: string;
  heading: string;
  fields: FormFieldDef[];
  /** Null means unlimited — no waitlist is ever reachable for such a widget. */
  capacity: number | null;
  waitlistEnabled: boolean;
  submitLabel: string;
}

export interface EventSignupWidgetStore {
  getWidget(widgetId: string): Promise<EventSignupWidgetManifest | null>;
}

export interface EventSignupRecord {
  id: string;
  widgetId: string;
  siteId: string;
  values: SubmissionValues;
  status: "confirmed" | "waitlisted";
  position: number | null;
  createdAt: string;
}

export interface CreateEventSignupStoreInput {
  id: string;
  widgetId: string;
  siteId: string;
  values: SubmissionValues;
  capacity: number | null;
  waitlistEnabled: boolean;
}

export type CreateEventSignupStoreResult =
  | { status: "confirmed"; signup: EventSignupRecord }
  | { status: "waitlisted"; signup: EventSignupRecord; position: number }
  | { status: "full" };

export interface EventSignupStore {
  create(input: CreateEventSignupStoreInput): Promise<CreateEventSignupStoreResult>;
}

/**
 * Best-effort, mirroring book.ts's notifyBestEffort/notifyConfirmed
 * discipline exactly — a notification failure can never turn an
 * already-stored sign-up back into a failure. Notifies the site owner only
 * (mirrors EmailFormNotifier's shape, not Booking's dual-recipient one):
 * unlike Booking's fixed visitorEmail field, EventSignup's `values` bag is
 * shaped by the owner's own field builder and is not guaranteed to contain
 * an email address at all, so there is no reliable visitor address to
 * notify. `ownerEmail` is resolved by the caller (apps/api's runtime route,
 * from the site's own account — the same resolution createBooking's own
 * `ownerEmail` input already uses) rather than fetched here, since this
 * package never imports account/control-plane concepts.
 */
export interface EventSignupNotifier {
  notify(input: {
    siteId: string;
    widgetId: string;
    signup: EventSignupRecord;
    ownerEmail: string;
  }): Promise<void>;
}
