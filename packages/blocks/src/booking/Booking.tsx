import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { cssVar } from "../theme-css.js";
import { ResponsiveStyle, type BlockRenderProps } from "../responsive.js";
import type { BookingProps } from "./schema.js";

/**
 * The second interactive block, after Form (ADR-0007) — `client:load` is
 * applied to this component specifically in @prefab/publish's
 * page-template.ts, the same special-cased branch Form gets and for the
 * same reason (a static import Astro's compiler can point a client
 * directive at). Deliberately still SSR-safe: `Intl`/`fetch` are ordinary
 * globals available during SSR too, but the *visitor's own* timezone only
 * means anything once this runs in their browser, so its detection is
 * still done inside an effect rather than during render.
 */
export interface BookingExtraProps {
  /** Where the widget fetches slots from and posts a booking to — injected by the publish pipeline, absent inside the Puck canvas and in an offline local build (R16), where the widget renders its static shell only. */
  runtimeApiUrl?: string;
}

interface Slot {
  startMs: number;
  endMs: number;
}

type WidgetState = "loading" | "ready" | "error" | "submitting" | "success" | "submit_error";

const RANGE_DAYS = 14;

const sectionStyle: CSSProperties = { display: "flex", flexDirection: "column", gap: cssVar("spacing", "element") };
const headingStyle: CSSProperties = { fontSize: cssVar("fontSize", "lg"), color: cssVar("color", "foreground"), margin: 0 };
const bodyStyle: CSSProperties = { fontSize: cssVar("fontSize", "body"), color: cssVar("color", "foreground") };
const rowStyle: CSSProperties = { display: "flex", flexWrap: "wrap", gap: cssVar("spacing", "xs") };
const chipStyle = (active: boolean): CSSProperties => ({
  padding: `${cssVar("spacing", "xs")} ${cssVar("spacing", "element")}`,
  borderRadius: cssVar("radius", "control"),
  border: `1px solid ${cssVar("color", "border")}`,
  background: active ? cssVar("color", "accent") : cssVar("color", "surface"),
  color: active ? cssVar("color", "accent-foreground") : cssVar("color", "foreground"),
  cursor: "pointer",
  fontSize: cssVar("fontSize", "sm"),
});
const controlStyle: CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: cssVar("spacing", "xs"),
  borderRadius: cssVar("radius", "control"),
  border: `1px solid ${cssVar("color", "border")}`,
  fontSize: cssVar("fontSize", "body"),
  color: cssVar("color", "foreground"),
  background: cssVar("color", "surface"),
};
const submitButtonStyle: CSSProperties = {
  padding: `${cssVar("spacing", "xs")} ${cssVar("spacing", "element")}`,
  borderRadius: cssVar("radius", "control"),
  border: "none",
  background: cssVar("color", "accent"),
  color: cssVar("color", "accent-foreground"),
  fontSize: cssVar("fontSize", "body"),
  cursor: "pointer",
};
const warningStyle: CSSProperties = {
  fontSize: cssVar("fontSize", "sm"),
  color: cssVar("color", "foreground"),
  border: `1px solid ${cssVar("color", "border")}`,
  borderRadius: cssVar("radius", "control"),
  padding: cssVar("spacing", "xs"),
};

/** Groups slots by their calendar date in the visitor's own timezone — the same date a slot's start time appears to fall on in whatever local clock is rendering it. */
function groupByLocalDate(slots: Slot[], timezone: string): Map<string, Slot[]> {
  const formatter = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" });
  const groups = new Map<string, Slot[]>();
  for (const slot of slots) {
    const date = formatter.format(new Date(slot.startMs));
    const existing = groups.get(date) ?? [];
    existing.push(slot);
    groups.set(date, existing);
  }
  return groups;
}

export function Booking(props: BookingProps & BookingExtraProps & BlockRenderProps) {
  const { heading, description, confirmLabel, successMessage, runtimeApiUrl, blockId, responsive } = props;

  const [timezone, setTimezone] = useState<string | null>(null);
  const [state, setState] = useState<WidgetState>("loading");
  const [slots, setSlots] = useState<Slot[]>([]);
  const [calendarSyncOk, setCalendarSyncOk] = useState(true);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null);
  const [visitorName, setVisitorName] = useState("");
  const [visitorEmail, setVisitorEmail] = useState("");
  const [notes, setNotes] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    setTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone);
  }, []);

  useEffect(() => {
    if (!runtimeApiUrl || !blockId || !timezone) return;
    let cancelled = false;

    async function loadSlots() {
      setState("loading");
      try {
        const rangeStart = Date.now();
        const rangeEnd = rangeStart + RANGE_DAYS * 24 * 60 * 60 * 1000;
        const response = await fetch(
          `${runtimeApiUrl}/v1/runtime/booking-widgets/${blockId}/slots?rangeStart=${new Date(rangeStart).toISOString()}&rangeEnd=${new Date(rangeEnd).toISOString()}`,
        );
        if (!response.ok) throw new Error("failed to load availability");
        const body = (await response.json()) as { slots: Slot[]; calendarSyncOk: boolean };
        if (cancelled) return;
        setSlots(body.slots);
        setCalendarSyncOk(body.calendarSyncOk);
        setState("ready");
      } catch {
        if (!cancelled) setState("error");
      }
    }

    void loadSlots();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runtimeApiUrl, blockId, timezone]);

  const grouped = useMemo(() => (timezone ? groupByLocalDate(slots, timezone) : new Map<string, Slot[]>()), [slots, timezone]);
  const dates = useMemo(() => [...grouped.keys()].sort(), [grouped]);
  const activeDate = selectedDate && grouped.has(selectedDate) ? selectedDate : (dates[0] ?? null);

  async function handleConfirm() {
    if (!runtimeApiUrl || !blockId || !selectedSlot || !timezone) return;
    setState("submitting");
    setErrorMessage(null);
    try {
      const response = await fetch(`${runtimeApiUrl}/v1/runtime/booking-widgets/${blockId}/bookings`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          startsAt: new Date(selectedSlot.startMs).toISOString(),
          visitorName,
          visitorEmail,
          visitorTimezone: timezone,
          notes: notes || undefined,
        }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        setErrorMessage(body?.error?.message ?? "That slot is no longer available — please pick another.");
        setState("submit_error");
        return;
      }
      setState("success");
    } catch {
      setErrorMessage("Something went wrong — please try again.");
      setState("submit_error");
    }
  }

  if (state === "success") {
    return (
      <div className="pf-block pf-booking" data-pf-block-type="booking" data-pf-block-id={blockId}>
        <ResponsiveStyle blockId={blockId ?? ""} responsive={responsive ?? {}} />
        <p style={bodyStyle}>{successMessage}</p>
      </div>
    );
  }

  return (
    <div className="pf-block pf-booking" data-pf-block-type="booking" data-pf-block-id={blockId} style={sectionStyle}>
      <ResponsiveStyle blockId={blockId ?? ""} responsive={responsive ?? {}} />
      {heading ? <h3 style={headingStyle}>{heading}</h3> : null}
      {description ? <p style={bodyStyle}>{description}</p> : null}

      {!runtimeApiUrl || !blockId ? (
        <p style={bodyStyle}>Booking is available once this page is published.</p>
      ) : state === "loading" && slots.length === 0 ? (
        <p style={bodyStyle}>Loading availability…</p>
      ) : state === "error" ? (
        <p style={warningStyle} role="alert">
          We couldn't load availability right now — please try again shortly.
        </p>
      ) : dates.length === 0 ? (
        <p style={bodyStyle}>No times are currently available.</p>
      ) : (
        <>
          {!calendarSyncOk ? (
            <p style={warningStyle} role="status">
              Live calendar sync is temporarily unavailable — availability shown may not reflect every busy time.
            </p>
          ) : null}
          <div style={rowStyle} role="tablist" aria-label="Choose a date">
            {dates.map((date) => (
              <button key={date} type="button" style={chipStyle(date === activeDate)} onClick={() => { setSelectedDate(date); setSelectedSlot(null); }}>
                {date}
              </button>
            ))}
          </div>
          <div style={rowStyle} role="tablist" aria-label="Choose a time">
            {(activeDate ? (grouped.get(activeDate) ?? []) : []).map((slot) => (
              <button
                key={slot.startMs}
                type="button"
                style={chipStyle(selectedSlot?.startMs === slot.startMs)}
                onClick={() => setSelectedSlot(slot)}
              >
                {new Date(slot.startMs).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", timeZone: timezone ?? undefined })}
              </button>
            ))}
          </div>

          {selectedSlot ? (
            <div style={sectionStyle}>
              <label style={bodyStyle}>
                Name
                <input style={controlStyle} value={visitorName} onChange={(e) => setVisitorName(e.currentTarget.value)} required />
              </label>
              <label style={bodyStyle}>
                Email
                <input type="email" style={controlStyle} value={visitorEmail} onChange={(e) => setVisitorEmail(e.currentTarget.value)} required />
              </label>
              <label style={bodyStyle}>
                Notes (optional)
                <textarea style={{ ...controlStyle, minHeight: "4rem" }} value={notes} onChange={(e) => setNotes(e.currentTarget.value)} />
              </label>
              <button type="button" style={submitButtonStyle} disabled={state === "submitting" || !visitorName || !visitorEmail} onClick={() => void handleConfirm()}>
                {state === "submitting" ? "Booking…" : confirmLabel}
              </button>
              {state === "submit_error" && errorMessage ? (
                <p style={warningStyle} role="alert">
                  {errorMessage}
                </p>
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
