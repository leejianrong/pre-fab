import { useEffect, useRef, type ReactNode } from "react";

interface MdDialogElement extends HTMLElement {
  open: boolean;
}

/**
 * Controlled wrapper over md-dialog (components.md: a true modal, for the
 * publish celebration — as opposed to SideSheet's non-modal side panels).
 * `open` is set imperatively via ref, same reasoning as TextField/Select.
 * Children assign their own `slot="headline"|"content"|"actions"`, per
 * md-dialog's documented contract — this wrapper doesn't presume a shape.
 */
export function Dialog({
  open,
  onClose,
  ariaLabel,
  children,
}: {
  open: boolean;
  onClose: () => void;
  ariaLabel: string;
  children: ReactNode;
}) {
  const ref = useRef<MdDialogElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (el.open !== open) el.open = open;
  }, [open]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Fired on scrim click / Escape — a programmatic close (the `open`
    // effect above) never needs this, since the caller already knows.
    const handler = () => onClose();
    el.addEventListener("cancel", handler);
    return () => el.removeEventListener("cancel", handler);
  }, [onClose]);

  return (
    <md-dialog ref={ref} aria-label={ariaLabel}>
      {children}
    </md-dialog>
  );
}
