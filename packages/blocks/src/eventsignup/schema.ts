import { z } from "zod";
import type { BlockTypeDefinition } from "@prefab/schema";

/**
 * KAN-1138: an event sign-up (RSVP) block — one fixed-capacity event, not
 * Booking's calendar of bookable slots (see 0008_slice9.sql's own header
 * comment for why a calendar is platform state, not block content). This is
 * much closer to Form: a small field builder whose answers become a
 * visitor record, snapshotted at publish time the same way (R20 / ADR-0010).
 *
 * `FormFieldSchema`/`FORM_FIELD_TYPES` (Form's own field-shape schema) are
 * duplicated here as `EventSignupFieldSchema`/`EVENTSIGNUP_FIELD_TYPES` —
 * renamed, not just copied, because @prefab/blocks re-exports every block
 * module's schema wholesale (`export *` from packages/blocks/src/index.ts),
 * and two modules exporting an identically-named `FormFieldSchema` collide
 * there. There is no precedent in this codebase for one first-party block
 * module importing another's schema (Booking, the other Slice-9-adjacent
 * block, imports nothing from Form either) — each block module is meant to
 * stand alone so it can be deleted or swapped without a ripple effect on a
 * sibling. The duplication is the same small-and-load-bearing trade this
 * repo already makes elsewhere (see theme-css.ts's own comments on
 * resolveThemeTokens, and @prefab/schema's duplication of runtime-facing
 * shapes for packages that must never import each other) — a handful of
 * lines kept in sync by hand beats a new cross-block dependency two modules
 * would otherwise never need.
 */
export const EVENTSIGNUP_FIELD_TYPES = ["text", "email", "textarea", "select", "checkbox", "file"] as const;
export type EventSignupFieldType = (typeof EVENTSIGNUP_FIELD_TYPES)[number];

export const EventSignupFieldSchema = z
  .object({
    type: z.enum(EVENTSIGNUP_FIELD_TYPES),
    label: z.string().min(1).max(200),
    name: z
      .string()
      .min(1)
      .max(120)
      .regex(/^[a-zA-Z][a-zA-Z0-9_-]*$/, "must start with a letter and contain only letters, numbers, - or _"),
    required: z.boolean().default(false),
    /** Only meaningful for `type: "select"` — one option per line, mirrors Form.tsx's parseOptions exactly. */
    options: z.string().max(2000).default(""),
  })
  .strict();

export type EventSignupField = z.infer<typeof EventSignupFieldSchema>;

export const EventSignupPropsSchema = z
  .object({
    heading: z.string().max(120).default("Sign up"),
    /** Event details (date/time/location) as plain text — this block does not model structured date/time fields; that's page content the owner writes in a Heading/RichText block above it. */
    description: z.string().max(2000).default(""),
    fields: z
      .array(EventSignupFieldSchema)
      .max(20)
      .default([
        { type: "text", label: "Name", name: "name", required: true, options: "" },
        { type: "email", label: "Email", name: "email", required: true, options: "" },
      ]),
    /** Null/absent means unlimited — no waitlist is ever possible for an unlimited event. */
    capacity: z.number().int().positive().max(1_000_000).nullable().default(null),
    waitlistEnabled: z.boolean().default(true),
    submitLabel: z.string().min(1).max(60).default("Reserve my spot"),
    successMessage: z.string().max(300).default("You're confirmed — we'll see you there."),
    waitlistMessage: z.string().max(300).default("You're on the waitlist — we'll be in touch if a spot opens up."),
    /** Shown only when capacity is full AND waitlistEnabled is false. */
    fullMessage: z.string().max(300).default("This event is full."),
  })
  .strict();

export type EventSignupProps = z.infer<typeof EventSignupPropsSchema>;

export const EVENTSIGNUP_BLOCK_TYPE = "eventsignup";
export const EVENTSIGNUP_BLOCK_VERSION = 1;

export const eventSignupDefaultProps: EventSignupProps = EventSignupPropsSchema.parse({});

export const eventSignupBlockDefinition: BlockTypeDefinition<EventSignupProps> = {
  type: EVENTSIGNUP_BLOCK_TYPE,
  version: EVENTSIGNUP_BLOCK_VERSION,
  propsSchema: EventSignupPropsSchema,
  defaultProps: eventSignupDefaultProps,
  migrations: {},
};
