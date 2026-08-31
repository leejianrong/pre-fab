import { z } from "zod";
import type { BlockTypeDefinition } from "@prefab/schema";

/**
 * A Booking block's own props are deliberately small (SLICES.md Slice 9,
 * ADR-0009's "small booking core"): heading/description/labels only. The
 * actual scheduling configuration — weekly windows, buffers, notice,
 * horizon — is a platform/dashboard setting (`availability.set`), not page
 * content, so it never lives here (see 0008_slice9.sql's own header
 * comment for why: it is one shared calendar per site, not a per-block
 * one). This mirrors the Form block exactly: portable, no PII, no secrets.
 */
export const BookingPropsSchema = z
  .object({
    heading: z.string().max(120).default("Book a time"),
    description: z.string().max(2000).default(""),
    confirmLabel: z.string().min(1).max(60).default("Confirm booking"),
    successMessage: z.string().max(300).default("You're booked — check your email for details."),
  })
  .strict();

export type BookingProps = z.infer<typeof BookingPropsSchema>;

export const BOOKING_BLOCK_TYPE = "booking";
export const BOOKING_BLOCK_VERSION = 1;

export const bookingDefaultProps: BookingProps = BookingPropsSchema.parse({});

export const bookingBlockDefinition: BlockTypeDefinition<BookingProps> = {
  type: BOOKING_BLOCK_TYPE,
  version: BOOKING_BLOCK_VERSION,
  propsSchema: BookingPropsSchema,
  defaultProps: bookingDefaultProps,
  migrations: {},
};
