import type { MouseEventHandler, ReactNode } from "react";

/**
 * Standard icon button (components.md) for icon-only actions — panel close
 * buttons, back arrows. No Material Symbols font is loaded (same
 * offline-friendliness call as ui/tokens.css), so the icon slot takes
 * whatever glyph/emoji the caller already used (✕, ←) rather than a named
 * icon — visually a little rougher than a real icon set, acceptable for
 * this internal tool's chrome.
 */
export function IconButton({
  children,
  onClick,
  "aria-label": ariaLabel,
  type = "button",
}: {
  children: ReactNode;
  onClick?: MouseEventHandler<HTMLElement>;
  "aria-label": string;
  type?: "button" | "submit" | "reset";
}) {
  return (
    <md-icon-button type={type} onClick={onClick} aria-label={ariaLabel}>
      {children}
    </md-icon-button>
  );
}
