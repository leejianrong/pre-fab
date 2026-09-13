/**
 * Classifying a raw `pg` driver error is knowledge that belongs to this
 * package, not to its callers — an SQLSTATE string copied into apps/api is
 * exactly the kind of duplicated detail that drifts. `createBooking`
 * (repositories/bookings.ts) already needed this; KAN-1272 made apps/api's
 * `page.create` need it too, so it moved here rather than being written a
 * second time.
 */

/** Postgres' unique-violation SQLSTATE — how a losing INSERT/UPDATE against any UNIQUE index or constraint actually surfaces through `pg`. */
export const UNIQUE_VIOLATION = "23505";

export function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === UNIQUE_VIOLATION;
}
