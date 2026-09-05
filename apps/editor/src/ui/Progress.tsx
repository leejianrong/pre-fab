import type { ReactNode } from "react";

/** Indeterminate circular progress (components.md) + optional message, for a full-panel loading state. */
export function LoadingIndicator({ label }: { label?: ReactNode }) {
  return (
    <div className="pf-loading">
      <md-circular-progress indeterminate />
      {label ? <span>{label}</span> : null}
    </div>
  );
}
