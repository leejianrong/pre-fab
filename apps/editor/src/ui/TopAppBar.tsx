import type { ReactNode } from "react";

/** Small top app bar (components.md) — one line, for SiteEditor's header. */
export function TopAppBar({ leading, title, actions }: { leading?: ReactNode; title: ReactNode; actions?: ReactNode }) {
  return (
    <header className="pf-top-app-bar">
      {leading}
      <span className="pf-top-app-bar-title">{title}</span>
      <div className="pf-top-app-bar-actions">{actions}</div>
    </header>
  );
}
