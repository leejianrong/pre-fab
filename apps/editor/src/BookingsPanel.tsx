import { useEffect, useState } from "react";
import { BOOKING_BLOCK_TYPE } from "@prefab/blocks";
import {
  ApiClientError,
  type AvailabilityRule,
  type Booking,
  type BookingStatus,
  type PageSummary,
  type SetAvailabilityInput,
} from "@prefab/api-client";
import { api } from "./api.js";
import { Card, FilledButton, OutlinedButton, SelectField, SideSheet, StatusBadge, TextField, TimeField } from "./ui/index.js";

const DAY_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const BOOKING_STATUS_TONE: Record<BookingStatus, "positive" | "neutral" | "negative"> = {
  confirmed: "positive",
  canceled: "negative",
};

/** "HH:MM" (native `<input type="time">`'s own format) <-> minutes-since-midnight (SetAvailabilityInput's own unit, matching CLI's `availability set` JSON and apps/api/src/schemas.ts's WeeklyWindowSchema). */
function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function timeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

/** One row per day of the week, at most one window per day — see DayRows' own comment for why. */
type DayRow = { start: string; end: string };

function emptyDayRows(): DayRow[] {
  return DAY_LABELS.map(() => ({ start: "", end: "" }));
}

const DEFAULT_INPUT: SetAvailabilityInput = {
  timezone: typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "UTC",
  weeklyWindows: [],
  dateOverrides: [],
  slotDurationMinutes: 30,
  bufferBeforeMinutes: 0,
  bufferAfterMinutes: 0,
  minNoticeMinutes: 60,
  maxHorizonDays: 60,
};

/**
 * KAN-1257: the editor had zero UI for Slice 9's scheduling/bookings
 * (ADR-0009) — availability.set/get and booking.list/cancel were all
 * CLI/API/MCP-only. Same "toolbar button opens a SideSheet" shape as
 * PaymentsPanel/SubmissionsPanel, and the same "settings form at the top,
 * owner-facing read-only(-ish) list below" shape SubmissionsPanel already
 * establishes for a form's notification settings + its submissions — here,
 * a site's one availability rule (Slice 9 only ever supports one rule per
 * site, not per booking widget) plus every booking across every Booking
 * widget on the site.
 *
 * Scope cuts made deliberately (see the PR description for the full
 * reasoning):
 *   - The weekly-hours editor supports at most one window per day. The
 *     underlying schema (WeeklyWindowSchema, apps/api/src/schemas.ts) and
 *     the CLI's raw-JSON `availability set` both allow several windows per
 *     day (e.g. a lunch-break split) — a site already configured that way
 *     via the CLI shows only its first window per day here, and saving
 *     from this panel collapses any others. Flagged in the UI's own
 *     supporting text, not just this comment.
 *   - Date overrides (one-off closed days / special hours) have no editor
 *     UI at all — carried through unchanged on every save (never read from
 *     or written by this form), with a read-only count shown when any
 *     exist. A full calendar-picker for these is real scope; CLI/API/MCP
 *     remain the way to set them for now.
 *   - Bookings are cancelable from this panel (booking.cancel already
 *     existed as a real three-surface mutation, Slice 9 — this just wires
 *     the editor to it) but not reschedulable — there's no
 *     `booking.reschedule` mutation anywhere in the codebase to wire to,
 *     and inventing one is out of scope for a UI-only card.
 */
export function BookingsPanel({ siteId, pages, onClose }: { siteId: string; pages: PageSummary[]; onClose: () => void }) {
  return (
    <SideSheet title="Bookings" ariaLabel="Bookings" closeLabel="Close bookings panel" onClose={onClose} width={560}>
      <div style={{ display: "grid", gap: "1.5rem" }}>
        <AvailabilitySection siteId={siteId} />
        <BookingsListSection siteId={siteId} pages={pages} />
      </div>
    </SideSheet>
  );
}

function AvailabilitySection({ siteId }: { siteId: string }) {
  const [rule, setRule] = useState<AvailabilityRule | null | undefined>(undefined);
  const [timezone, setTimezone] = useState(DEFAULT_INPUT.timezone);
  const [days, setDays] = useState<DayRow[]>(emptyDayRows());
  const [dateOverrides, setDateOverrides] = useState<SetAvailabilityInput["dateOverrides"]>([]);
  const [slotDurationMinutes, setSlotDurationMinutes] = useState(String(DEFAULT_INPUT.slotDurationMinutes));
  const [bufferBeforeMinutes, setBufferBeforeMinutes] = useState(String(DEFAULT_INPUT.bufferBeforeMinutes));
  const [bufferAfterMinutes, setBufferAfterMinutes] = useState(String(DEFAULT_INPUT.bufferAfterMinutes));
  const [minNoticeMinutes, setMinNoticeMinutes] = useState(String(DEFAULT_INPUT.minNoticeMinutes));
  const [maxHorizonDays, setMaxHorizonDays] = useState(String(DEFAULT_INPUT.maxHorizonDays));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api
      .getAvailability(siteId)
      .then((loaded) => {
        setRule(loaded);
        const input: SetAvailabilityInput = loaded ?? DEFAULT_INPUT;
        setTimezone(input.timezone);
        const rows = emptyDayRows();
        // Only the first window per day survives here — see the panel's
        // own "scope cuts" comment above.
        for (const window of input.weeklyWindows) {
          if (rows[window.dayOfWeek]!.start !== "") continue;
          rows[window.dayOfWeek] = { start: minutesToTime(window.startMinute), end: minutesToTime(window.endMinute) };
        }
        setDays(rows);
        setDateOverrides(input.dateOverrides);
        setSlotDurationMinutes(String(input.slotDurationMinutes));
        setBufferBeforeMinutes(String(input.bufferBeforeMinutes));
        setBufferAfterMinutes(String(input.bufferAfterMinutes));
        setMinNoticeMinutes(String(input.minNoticeMinutes));
        setMaxHorizonDays(String(input.maxHorizonDays));
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [siteId]);

  function setDay(index: number, patch: Partial<DayRow>) {
    setDays((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
    setSaved(false);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    const weeklyWindows: SetAvailabilityInput["weeklyWindows"] = [];
    for (let i = 0; i < days.length; i++) {
      const { start, end } = days[i]!;
      if (start === "" && end === "") continue;
      if (start === "" || end === "") {
        setError(`${DAY_LABELS[i]}: set both a start and an end time, or leave both blank to mark it closed.`);
        return;
      }
      const startMinute = timeToMinutes(start);
      const endMinute = timeToMinutes(end);
      if (endMinute <= startMinute) {
        setError(`${DAY_LABELS[i]}: the end time must be after the start time.`);
        return;
      }
      weeklyWindows.push({ dayOfWeek: i, startMinute, endMinute });
    }

    setSaving(true);
    setSaved(false);
    try {
      const saved = await api.setAvailability(siteId, {
        timezone: timezone.trim(),
        weeklyWindows,
        dateOverrides,
        slotDurationMinutes: Number(slotDurationMinutes),
        bufferBeforeMinutes: Number(bufferBeforeMinutes),
        bufferAfterMinutes: Number(bufferAfterMinutes),
        minNoticeMinutes: Number(minNoticeMinutes),
        maxHorizonDays: Number(maxHorizonDays),
      });
      setRule(saved);
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  if (rule === undefined) {
    return <p className="pf-supporting-text">Loading availability…</p>;
  }

  return (
    <Card variant="filled" style={{ display: "grid", gap: "0.75rem" }}>
      <strong>Availability</strong>
      <p className="pf-supporting-text" style={{ margin: 0 }}>
        Weekly hours visitors can book a Booking widget on this site (Slice 9, ADR-0009). One window per day — for a lunch-break
        split or one-off closed days, use the CLI's <code>availability set</code>.
      </p>
      <form onSubmit={submit} style={{ display: "grid", gap: "0.75rem" }}>
        <TextField
          label="Timezone"
          value={timezone}
          onChange={(v) => {
            setTimezone(v);
            setSaved(false);
          }}
          placeholder="e.g. America/New_York"
          required
          supportingText="An IANA timezone name — the same one weeklyWindows' times below are in."
        />

        <div style={{ display: "grid", gap: "0.4rem" }}>
          {DAY_LABELS.map((label, i) => (
            <div key={label} style={{ display: "grid", gridTemplateColumns: "6rem 1fr 1fr", gap: "0.5rem", alignItems: "end" }}>
              <span className="pf-supporting-text" style={{ margin: 0, alignSelf: "center" }}>
                {label}
              </span>
              <TimeField id={`availability-start-${i}`} label="Start" value={days[i]!.start} onChange={(v) => setDay(i, { start: v })} />
              <TimeField id={`availability-end-${i}`} label="End" value={days[i]!.end} onChange={(v) => setDay(i, { end: v })} />
            </div>
          ))}
        </div>

        {dateOverrides.length > 0 ? (
          <p className="pf-supporting-text" style={{ margin: 0 }}>
            {dateOverrides.length} date override{dateOverrides.length === 1 ? "" : "s"} configured (special hours / closed days) —
            unaffected by this form; manage those via the CLI/API for now.
          </p>
        ) : null}

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
          <TextField
            label="Slot length (minutes)"
            type="number"
            value={slotDurationMinutes}
            onChange={(v) => {
              setSlotDurationMinutes(v);
              setSaved(false);
            }}
            required
          />
          <TextField
            label="Max booking horizon (days)"
            type="number"
            value={maxHorizonDays}
            onChange={(v) => {
              setMaxHorizonDays(v);
              setSaved(false);
            }}
            required
            supportingText="How far ahead visitors can book."
          />
          <TextField
            label="Buffer before (minutes)"
            type="number"
            value={bufferBeforeMinutes}
            onChange={(v) => {
              setBufferBeforeMinutes(v);
              setSaved(false);
            }}
            required
          />
          <TextField
            label="Buffer after (minutes)"
            type="number"
            value={bufferAfterMinutes}
            onChange={(v) => {
              setBufferAfterMinutes(v);
              setSaved(false);
            }}
            required
          />
          <TextField
            label="Minimum notice (minutes)"
            type="number"
            value={minNoticeMinutes}
            onChange={(v) => {
              setMinNoticeMinutes(v);
              setSaved(false);
            }}
            required
            supportingText="How soon before a slot a visitor can still book it."
          />
        </div>

        {error ? <p className="pf-error-text">{error}</p> : null}
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <FilledButton type="submit" disabled={saving} style={{ justifySelf: "start" }}>
            {saving ? "Saving…" : "Save availability"}
          </FilledButton>
          {saved ? <StatusBadge tone="positive">Saved</StatusBadge> : null}
        </div>
      </form>
    </Card>
  );
}

function BookingsListSection({ siteId, pages }: { siteId: string; pages: PageSummary[] }) {
  const [bookings, setBookings] = useState<Booking[] | null>(null);
  const [widgetHeadings, setWidgetHeadings] = useState<Record<string, string>>({});
  const [statusFilter, setStatusFilter] = useState<"all" | BookingStatus>("all");
  const [error, setError] = useState<string | null>(null);
  const [busyBookingId, setBusyBookingId] = useState<string | null>(null);

  async function refresh() {
    const query = statusFilter === "all" ? {} : { status: statusFilter };
    const result = await api.listBookings(siteId, { limit: 200, ...query });
    setBookings(result.bookings);
  }

  useEffect(() => {
    refresh().catch((err) => setError(err instanceof Error ? err.message : String(err)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteId, statusFilter]);

  // No "list booking widgets" endpoint (same gap PaymentsPanel's own
  // comment notes for payment/subscription blocks) — walks every page's
  // document to label each booking with the widget's own heading, same
  // pattern PaymentsPanel already establishes.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const found: Record<string, string> = {};
      for (const p of pages) {
        const doc = await api.getPage(siteId, p.id);
        for (const block of doc.blocks) {
          if (block.type !== BOOKING_BLOCK_TYPE) continue;
          found[block.id] = typeof block.props.heading === "string" ? block.props.heading : block.id;
        }
      }
      if (!cancelled) setWidgetHeadings(found);
    })().catch((err) => setError(err instanceof Error ? err.message : String(err)));
    return () => {
      cancelled = true;
    };
  }, [siteId, pages]);

  async function cancel(bookingId: string) {
    setBusyBookingId(bookingId);
    try {
      const canceled = await api.cancelBooking(siteId, bookingId);
      setBookings((prev) => prev?.map((b) => (b.id === bookingId ? canceled : b)) ?? prev);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyBookingId(null);
    }
  }

  return (
    <div style={{ display: "grid", gap: "0.75rem" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.5rem" }}>
        <h3 className="pf-subsection-title">Bookings</h3>
        <SelectField label="Status" id="bookings-status-filter" value={statusFilter} onChange={(v) => setStatusFilter(v as "all" | BookingStatus)}>
          <option value="all">All</option>
          <option value="confirmed">Confirmed</option>
          <option value="canceled">Canceled</option>
        </SelectField>
      </div>

      {error ? <p className="pf-error-text">{error}</p> : null}

      {bookings === null ? (
        <p className="pf-supporting-text">Loading…</p>
      ) : bookings.length === 0 ? (
        <p className="pf-supporting-text">No bookings yet — one shows up here once a visitor books a slot on a Booking widget.</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: "0.4rem" }}>
          {bookings.map((booking) => (
            <li key={booking.id}>
              <Card style={{ padding: "0.6rem", display: "grid", gap: "0.3rem" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <strong style={{ flex: 1 }}>{booking.visitorName}</strong>
                  <StatusBadge tone={BOOKING_STATUS_TONE[booking.status]}>{booking.status}</StatusBadge>
                </div>
                <span className="pf-supporting-text">{booking.visitorEmail}</span>
                <span className="pf-supporting-text">
                  {new Date(booking.startsAt).toLocaleString()} – {new Date(booking.endsAt).toLocaleTimeString()}
                </span>
                <span className="pf-supporting-text">{widgetHeadings[booking.widgetId] ?? booking.widgetId}</span>
                {booking.notes ? <span className="pf-supporting-text">{booking.notes}</span> : null}
                {booking.status === "confirmed" ? (
                  <OutlinedButton
                    className="pf-destructive-button"
                    onClick={() => cancel(booking.id)}
                    disabled={busyBookingId === booking.id}
                    style={{ justifySelf: "start" }}
                  >
                    {busyBookingId === booking.id ? "Canceling…" : "Cancel booking"}
                  </OutlinedButton>
                ) : null}
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
