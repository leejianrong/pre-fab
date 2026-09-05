import { useEffect, useRef, type ReactNode } from "react";

/**
 * Native `<dialog>`, token-styled — deliberately NOT @material/web's
 * md-dialog. Confirmed against a real browser: driving md-dialog's `open`
 * property imperatively and repeatedly from React hits a real race in its
 * async show()/close() orchestration (both track a shared internal
 * `isOpening` flag with no in-flight guard against overlapping calls) that
 * left it reporting open while never calling the underlying showModal() —
 * reproduced consistently, not a one-off flake. Native `<dialog>` needs no
 * such state machine: `showModal()`/`close()` are synchronous and the
 * browser owns the modal semantics (focus trap, ::backdrop, Escape) for
 * free. "Tokens only" fallback (material-design-3 skill), same call as
 * ui/DateField and ui/SelectField for the same reason — a library gap (or
 * here, an unreliability) taken as a signal to hand-roll rather than force
 * the component to fit.
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
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Escape fires the native 'cancel' event on a <dialog> shown via
    // showModal() — a programmatic close (the `open` effect above) never
    // needs this, since the caller already knows.
    const handler = () => onClose();
    el.addEventListener("cancel", handler);
    return () => el.removeEventListener("cancel", handler);
  }, [onClose]);

  return (
    <dialog ref={ref} aria-label={ariaLabel} className="pf-dialog">
      {children}
    </dialog>
  );
}
