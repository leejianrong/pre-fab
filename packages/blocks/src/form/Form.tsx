import { useState, type CSSProperties, type FormEvent } from "react";
import { cssVar } from "../theme-css.js";
import { ResponsiveStyle, type BlockRenderProps } from "../responsive.js";
import type { FormProps } from "./schema.js";

/**
 * The first interactive block (ADR-0007) — everything else in this
 * package ships zero JS. Deliberately still SSR-safe: no `window` /
 * `document` / `navigator` reference anywhere, even inside the submit
 * handler (tools/checks' ssr-safety scan flags those identifiers
 * unconditionally, not just at render time) — `event.currentTarget` and
 * `FormData` are enough to read the form with no DOM globals at all.
 * `client:load` is applied to this component specifically in
 * @prefab/publish's page-template.ts, the one file allowed to reference
 * Astro syntax.
 */
export interface FormExtraProps {
  /** Where the submit island posts to — injected by the publish pipeline via data.json, absent inside the Puck canvas (SLICES.md: field builder is edited there, not submitted). */
  runtimeApiUrl?: string;
  /** Cloudflare Turnstile's public site key — not a secret, safe to ship in the bundle. Absent when Turnstile isn't configured for this deployment. */
  turnstileSiteKey?: string;
}

type SubmitState = "idle" | "submitting" | "success" | "error";

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

/** The one place a `select` field's newline-separated `options` string becomes a list — the Puck canvas and the published page both go through Form.tsx, so there is exactly one parsing rule. */
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

export function Form(props: FormProps & FormExtraProps & BlockRenderProps) {
  const { heading, fields, submitLabel, successMessage, turnstileEnabled, runtimeApiUrl, turnstileSiteKey, blockId, responsive } = props;
  const [state, setState] = useState<SubmitState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!runtimeApiUrl || !blockId) return;

    const formData = new FormData(event.currentTarget);
    const values: Record<string, string> = {};
    for (const field of fields) {
      values[field.name] = field.type === "checkbox" ? (formData.get(field.name) ? "true" : "") : String(formData.get(field.name) ?? "");
    }
    const turnstileToken = formData.get("cf-turnstile-response");

    setState("submitting");
    setErrorMessage(null);
    try {
      const response = await fetch(`${runtimeApiUrl}/v1/runtime/forms/${blockId}/submissions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ values, turnstileToken: typeof turnstileToken === "string" ? turnstileToken : undefined }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        setErrorMessage(body?.error?.message ?? "Something went wrong — please try again.");
        setState("error");
        return;
      }
      setState("success");
    } catch {
      setErrorMessage("Something went wrong — please try again.");
      setState("error");
    }
  }

  if (state === "success") {
    return (
      <div className="pf-block pf-form" data-pf-block-type="form" data-pf-block-id={blockId}>
        <ResponsiveStyle blockId={blockId ?? ""} responsive={responsive ?? {}} />
        <p style={{ color: cssVar("color", "foreground") }}>{successMessage}</p>
      </div>
    );
  }

  return (
    <div className="pf-block pf-form" data-pf-block-type="form" data-pf-block-id={blockId}>
      <ResponsiveStyle blockId={blockId ?? ""} responsive={responsive ?? {}} />
      {heading ? (
        <h3 style={{ fontSize: cssVar("fontSize", "lg"), color: cssVar("color", "foreground"), margin: `0 0 ${cssVar("spacing", "element")}` }}>
          {heading}
        </h3>
      ) : null}
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
        {turnstileEnabled && turnstileSiteKey ? (
          <>
            <div className="cf-turnstile" data-sitekey={turnstileSiteKey} style={{ marginBottom: cssVar("spacing", "element") }} />
            <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer />
          </>
        ) : null}
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
