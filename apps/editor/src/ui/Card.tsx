import type { CSSProperties, MouseEventHandler, ReactNode } from "react";

/**
 * Hand-rolled — @material/web ships no card component (components.md's
 * gap: "apply tokens directly to your own elements"). Outlined by default
 * ("no shadow or fill difference," the quietest of the three M3 card
 * variants), matching this app's existing bordered-list convention; filled
 * (surface-container tint, no border) for callouts that sit inside a
 * panel that's already using the outlined convention for its list.
 */
export function Card({
  children,
  variant = "outlined",
  interactive = false,
  onClick,
  style,
  className,
}: {
  children: ReactNode;
  variant?: "outlined" | "filled";
  interactive?: boolean;
  onClick?: MouseEventHandler<HTMLDivElement>;
  style?: CSSProperties;
  className?: string;
}) {
  const base: CSSProperties = {
    borderRadius: "var(--md-sys-shape-corner-medium)",
    padding: "1rem",
    ...(variant === "outlined"
      ? { border: "1px solid var(--md-sys-color-outline-variant)", background: "var(--md-sys-color-surface)" }
      : { border: "none", background: "var(--md-sys-color-surface-container)" }),
    ...style,
  };
  return (
    <div
      className={["pf-card", interactive && variant === "outlined" ? "pf-card-interactive" : "", className].filter(Boolean).join(" ")}
      style={base}
      onClick={onClick}
    >
      {children}
    </div>
  );
}
