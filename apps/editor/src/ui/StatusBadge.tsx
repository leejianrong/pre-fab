import type { ReactNode } from "react";

type Tone = "positive" | "neutral" | "negative";

/**
 * Base M3 has no dedicated "success/warning" role family, so this reuses
 * the three families that already exist rather than extending the scheme
 * with a custom color: tertiary for a positive/live state, secondary for
 * neutral/in-progress, error for a failure — applied consistently
 * everywhere a status pill appears (domains, blog posts, publish state,
 * submission delivery).
 */
const TONE_VARS: Record<Tone, { bg: string; fg: string }> = {
  positive: { bg: "var(--md-sys-color-tertiary-container)", fg: "var(--md-sys-color-on-tertiary-container)" },
  neutral: { bg: "var(--md-sys-color-secondary-container)", fg: "var(--md-sys-color-on-secondary-container)" },
  negative: { bg: "var(--md-sys-color-error-container)", fg: "var(--md-sys-color-on-error-container)" },
};

export function StatusBadge({ children, tone }: { children: ReactNode; tone: Tone }) {
  const { bg, fg } = TONE_VARS[tone];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        borderRadius: "var(--md-sys-shape-corner-full)",
        padding: "0.15rem 0.65rem",
        background: bg,
        color: fg,
        fontFamily: "var(--md-ref-typeface-plain)",
        fontSize: "var(--md-sys-typescale-label-medium-size)",
        lineHeight: "var(--md-sys-typescale-label-medium-line-height)",
        fontWeight: "var(--md-sys-typescale-label-medium-weight)",
      }}
    >
      {children}
    </span>
  );
}
