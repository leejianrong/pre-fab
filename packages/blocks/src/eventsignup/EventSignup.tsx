import { useState, type CSSProperties, type FormEvent } from "react";
import { cssVar } from "../theme-css.js";
import { ResponsiveStyle, type BlockRenderProps } from "../responsive.js";
import type { EventSignupProps } from "./schema.js";

/**
 * The third interactive block, after Form and Booking (ADR-0007) —
 * `client:load` is applied to this component specifically in
 * @prefab/publish's page-template.ts, the same special-cased branch
 * Form/Booking get and for the same reason (a static import Astro's
 * compiler can point a client directive at). Deliberately still SSR-safe:
 * no `window`/`document`/`navigator` reference anywhere, mirrors Form.tsx's
 * own comment on this exactly.
 */
export interface EventSignupExtraProps {
  /** Where the sign-up island posts to — injected by the publish pipeline via data.json, absent inside the Puck canvas. */
  runtimeApiUrl?: string;
}

type SignupState = "idle" | "submitting" | "confirmed" | "waitlisted" | "full" | "error";

const fieldWrapStyle: CSSProperties = { marginBottom: cssVar("spacing", "element") };

const labelStyle: CSSProperties = {
  display: "block",
  marginBottom: cssVar("spacing", "xs"),
  color: cssVar("color", "foreground"),
  fontSize: cssVar("fontSize", "sm"),
};

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

const bodyStyle: CSSProperties = { fontSize: cssVar("fontSize", "body"), color: cssVar("color", "foreground") };

/** Mirrors Form.tsx's parseOptions exactly — one parsing rule for the same newline-separated string, wherever it's read. */
function parseOptions(raw: string): string[] {
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

const submitButtonStyle: CSSProperties = {
  padding: `${cssVar("spacing", "xs")} ${cssVar("spacing", "element")}`,
  borderRadius: cssVar("radius", "control"),
  border: "none",
  background: cssVar("color", "accent"),
  color: cssVar("color", "accent-foreground"),
  fontSize: cssVar("fontSize", "body"),
  cursor: "pointer",
};

export function EventSignup(props: EventSignupProps & EventSignupExtraProps & BlockRenderProps) {
  const {
    heading,
    description,
    fields,
    submitLabel,
    successMessage,
    waitlistMessage,
    fullMessage,
    runtimeApiUrl,
    blockId,
    responsive,
  } = props;
  const [state, setState] = useState<SignupState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!runtimeApiUrl || !blockId) return;

    const formData = new FormData(event.currentTarget);
    const values: Record<string, string> = {};
    for (const field of fields) {
      values[field.name] = field.type === "checkbox" ? (formData.get(field.name) ? "true" : "") : String(formData.get(field.name) ?? "");
    }

    setState("submitting");
    setErrorMessage(null);
    try {
      const response = await fetch(`${runtimeApiUrl}/v1/runtime/event-signups/${blockId}/signups`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ values }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        if (response.status === 409) {
          setState("full");
          return;
        }
        setErrorMessage(body?.error?.message ?? "Something went wrong — please try again.");
        setState("error");
        return;
      }
      setState(body?.status === "waitlisted" ? "waitlisted" : "confirmed");
    } catch {
      setErrorMessage("Something went wrong — please try again.");
      setState("error");
    }
  }

  if (state === "confirmed" || state === "waitlisted" || state === "full") {
    const message = state === "confirmed" ? successMessage : state === "waitlisted" ? waitlistMessage : fullMessage;
    return (
      <div className="pf-block pf-eventsignup" data-pf-block-type="eventsignup" data-pf-block-id={blockId}>
        <ResponsiveStyle blockId={blockId ?? ""} responsive={responsive ?? {}} />
        <p style={bodyStyle}>{message}</p>
      </div>
    );
  }

  return (
    <div className="pf-block pf-eventsignup" data-pf-block-type="eventsignup" data-pf-block-id={blockId}>
      <ResponsiveStyle blockId={blockId ?? ""} responsive={responsive ?? {}} />
      {heading ? (
        <h3 style={{ fontSize: cssVar("fontSize", "lg"), color: cssVar("color", "foreground"), margin: `0 0 ${cssVar("spacing", "element")}` }}>
          {heading}
        </h3>
      ) : null}
      {description ? <p style={{ ...bodyStyle, marginBottom: cssVar("spacing", "element") }}>{description}</p> : null}
      <form onSubmit={handleSubmit} noValidate>
        {fields.map((field) => (
          <div key={field.name} style={fieldWrapStyle}>
            {field.type === "checkbox" ? (
              <label style={{ ...labelStyle, display: "flex", alignItems: "center", gap: cssVar("spacing", "xs") }}>
                <input type="checkbox" name={field.name} required={field.required} />
                {field.label}
              </label>
            ) : (
              <label style={labelStyle} htmlFor={`${blockId}-${field.name}`}>
                {field.label}
                {field.required ? " *" : ""}
              </label>
            )}
            {field.type === "textarea" ? (
              <textarea id={`${blockId}-${field.name}`} name={field.name} required={field.required} style={{ ...controlStyle, minHeight: "6rem" }} />
            ) : field.type === "select" ? (
              <select id={`${blockId}-${field.name}`} name={field.name} required={field.required} style={controlStyle}>
                <option value="" disabled>
                  Choose one
                </option>
                {parseOptions(field.options).map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            ) : field.type === "file" ? (
              <input id={`${blockId}-${field.name}`} type="file" name={field.name} required={field.required} />
            ) : field.type === "checkbox" ? null : (
              <input
                id={`${blockId}-${field.name}`}
                type={field.type === "email" ? "email" : "text"}
                name={field.name}
                required={field.required}
                style={controlStyle}
              />
            )}
          </div>
        ))}
        <button type="submit" style={submitButtonStyle} disabled={state === "submitting"}>
          {state === "submitting" ? "Sending…" : submitLabel}
        </button>
        {state === "error" && errorMessage ? (
          <p style={{ color: cssVar("color", "foreground"), marginTop: cssVar("spacing", "xs") }} role="alert">
            {errorMessage}
          </p>
        ) : null}
      </form>
    </div>
  );
}
