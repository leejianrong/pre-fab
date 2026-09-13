import type { MouseEventHandler, ReactNode } from "react";

/**
 * Audit H1: the TopAppBar's 10 nav pills used to be plain `OutlinedButton`s
 * — all-text, no icon, and "currently open" shown only as a border-color
 * shift (barely visible). This is the shared control for every one of
 * them now: an icon (see ui/nav-icons.tsx) plus a real filled background
 * when the section it opens is open.
 *
 * The filled-vs-outlined swap is deliberately a *tag* swap
 * (`md-filled-tonal-button` vs `md-outlined-button`), not a CSS override on
 * one shared element — tonal-container is M3's own "this is selected, but
 * not the primary action of the screen" role (Save/Publish already own
 * Filled/Outlined for actual primary actions), so reusing it here for
 * "this panel is open" doesn't invent a new color meaning the way a custom
 * background would. Swapping tags never changes the button's accessible
 * name (the visible text, passed as `children`, is identical either way),
 * so e2e locators like `getByRole("button", { name: /^bookings$/i })` keep
 * matching regardless of which tag is live.
 */
export function NavButton({
  icon,
  active,
  onClick,
  children,
}: {
  icon: ReactNode;
  active: boolean;
  onClick: MouseEventHandler<HTMLElement>;
  children: ReactNode;
}) {
  const iconSlot = (
    <span slot="icon" aria-hidden="true">
      {icon}
    </span>
  );
  // Two full branches, not one JSX element with a dynamic tag name — TS
  // widens a ternary-computed tag string to `string`, which isn't
  // assignable to `keyof JSX.IntrinsicElements`.
  if (active) {
    return (
      <md-filled-tonal-button onClick={onClick} type="button">
        {iconSlot}
        {children}
      </md-filled-tonal-button>
    );
  }
  return (
    <md-outlined-button onClick={onClick} type="button">
      {iconSlot}
      {children}
    </md-outlined-button>
  );
}
