import type { ReactNode } from "react";
import { IconButton } from "./IconButton.js";

/**
 * Audit H4: this used to be a *modal* side sheet — `role="dialog"`,
 * `aria-modal="true"`, a dimming scrim, Escape/click-outside-to-close —
 * while Puck's own block-properties panel (internal to `@puckeditor/core`)
 * sits permanently docked at a fixed width beside the canvas. Two
 * different interaction patterns for what is conceptually the same thing
 * ("a panel of settings") read as two different apps stitched together
 * (the audit's words) — worse, the floating version could partially cover
 * the TopAppBar itself while open.
 *
 * M3 actually names both of these "side sheet" — a *standard* (docked,
 * non-modal, persistent) variant and a *modal* (floating, dimmed) variant
 * — so the fix here is switching which variant this component renders,
 * not inventing a new pattern.
 *
 * Direction chosen — dock this component, don't make Puck's properties
 * panel float — because Puck's own public surface doesn't offer anywhere
 * to do the latter without fighting the library. `@puckeditor/core@0.23.0`
 * (apps/editor/package.json; confirmed against
 * node_modules/.../@puckeditor/core/dist/actions-DA1J5F56.d.ts) exposes
 * exactly ten override keys: header, headerActions, fields, fieldLabel,
 * drawer, drawerItem, componentOverlay, outline, puck, preview (see
 * KAN-1205/KAN-1207/docs/adr/0017 for the prior work that already mapped
 * this surface out for the header and drawer). `fields` wraps the
 * *content* already inside Puck's fixed-width sidebar — it doesn't
 * reposition that sidebar or make it float. `puck` is the one override
 * that wraps Puck's *whole* layout, but using it to make just the
 * properties panel float would mean reimplementing Puck's three-pane grid
 * (drawer + canvas + fields) from scratch inside that override, not a
 * small change. Docking this component instead is a change entirely
 * within pre-fab's own code.
 *
 * What actually changed: no more `position: fixed` overlay + scrim — this
 * now renders as a plain flex sibling of the Puck canvas
 * (`.pf-puck-canvas`, SiteEditor.tsx lays the two out side by side), so it
 * can never cover the TopAppBar the way the old floating version could.
 * `role="dialog"` + `aria-modal` are gone: those describe something
 * modal, and a persistently docked panel isn't one — `role="complementary"`
 * (the ARIA landmark for "supporting content related to the main content,
 * meaningful on its own even outside it") is the correct role for a panel
 * that sits beside the canvas rather than blocking interaction with it.
 * Escape-to-close is gone too, for the same reason: that's modal-dismissal
 * behaviour, and a non-modal panel hijacking the *global* Escape key risks
 * fighting whatever else on the page (Puck's own field editing, a text
 * selection, a future dialog) wants Escape to do. The explicit close (✕)
 * button was always visible (never scrim-only) and is now the only way to
 * dismiss the panel, which is a strictly smaller behaviour change than it
 * sounds.
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
  return (
    <div role="complementary" aria-label={ariaLabel} className="pf-side-sheet" style={{ width, maxWidth: "100%" }}>
      <div className="pf-side-sheet-header">
        <h2 className="pf-side-sheet-title">{title}</h2>
        <IconButton aria-label={closeLabel} onClick={onClose}>
          ✕
        </IconButton>
      </div>
      <div className="pf-side-sheet-body">{children}</div>
    </div>
  );
}
