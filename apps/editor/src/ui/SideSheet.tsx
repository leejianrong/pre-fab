import { useEffect, type ReactNode } from "react";
import { IconButton } from "./IconButton.js";

/**
 * The right-anchored slide-in panel shared by ThemeEditor, DomainsPanel,
 * BlogPanel and SubmissionsPanel — same behaviour (scrim, Escape-to-close,
 * click-outside-to-close) each of those hand-rolled independently before
 * this change. Surface-container tiers express the panel-above-app
 * hierarchy as a tonal step plus a modest shadow, not a heavier shadow
 * alone (color-system.md's surface container tiers).
 */
export function SideSheet({
  title,
  ariaLabel,
  closeLabel,
  onClose,
  width = 440,
  children,
}: {
  title: ReactNode;
  ariaLabel: string;
  closeLabel: string;
  onClose: () => void;
  width?: number;
  children: ReactNode;
}) {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div role="presentation" className="pf-scrim" onClick={onClose}>
      <div
        role="dialog"
        aria-label={ariaLabel}
        aria-modal="true"
        className="pf-side-sheet"
        style={{ width, maxWidth: "100%" }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="pf-side-sheet-header">
          <h2 className="pf-side-sheet-title">{title}</h2>
          <IconButton aria-label={closeLabel} onClick={onClose}>
            ✕
          </IconButton>
        </div>
        <div className="pf-side-sheet-body">{children}</div>
      </div>
    </div>
  );
}
