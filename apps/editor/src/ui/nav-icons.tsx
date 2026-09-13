/**
 * Audit H1: one small inline-SVG glyph per TopAppBar nav item, chosen for
 * what each section actually does (a calendar for Bookings, a card for
 * Payments, a receipt for Billing — not the same shape twice) rather than
 * emoji. Emoji is exactly the "chosen for the word, not the meaning" look
 * H2 already flagged and fixed for the block library (packages/blocks) —
 * this repeats that fix's spirit for the editor's own chrome without
 * repeating its mistake. Hand-drawn (not copied from an icon library) to
 * avoid pulling in a whole icon-font/package dependency for ten glyphs;
 * every icon shares one viewBox, stroke width and cap/join style so the
 * set reads as one system rather than ten unrelated pictures.
 *
 * Sizing/color are intentionally left to the caller: @material/web's
 * button internals size and recolor anything slotted as `slot="icon"`
 * automatically (`::slotted([slot='icon'])` in its shared-styles.css sets
 * `inline-size`/`block-size`/`fill: currentColor` off the button's own
 * `--_icon-size` token), so these components only need to describe the
 * shape.
 */
import type { SVGProps } from "react";

function Icon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    />
  );
}

export function PagesIcon() {
  return (
    <Icon>
      <path d="M7 3h7l4 4v14H7z" />
      <path d="M14 3v4h4" />
      <path d="M9.5 12h6M9.5 15.5h6" />
    </Icon>
  );
}

export function ThemeIcon() {
  return (
    <Icon>
      <rect x="4" y="4" width="7" height="7" rx="1.5" />
      <rect x="13" y="4" width="7" height="7" rx="1.5" />
      <rect x="4" y="13" width="7" height="7" rx="1.5" />
      <rect x="13" y="13" width="7" height="7" rx="1.5" />
    </Icon>
  );
}

export function BlogIcon() {
  return (
    <Icon>
      <rect x="4" y="5" width="16" height="4.5" rx="1.2" />
      <rect x="4" y="11" width="16" height="4.5" rx="1.2" />
      <rect x="4" y="17" width="10" height="3" rx="1.2" />
    </Icon>
  );
}

export function ProductsIcon() {
  return (
    <Icon>
      <path d="M12 3 20 7.5v9L12 21 4 16.5v-9Z" />
      <path d="M4 7.5 12 12l8-4.5" />
      <path d="M12 12v9" />
    </Icon>
  );
}

export function OrdersIcon() {
  return (
    <Icon>
      <rect x="5" y="4" width="14" height="17" rx="2" />
      <rect x="9" y="2.5" width="6" height="3" rx="1" />
      <path d="M8.5 12.5l2 2 4.5-5" />
    </Icon>
  );
}

export function PaymentsIcon() {
  return (
    <Icon>
      <rect x="3" y="6" width="18" height="13" rx="2.2" />
      <path d="M3 10.5h18" />
      <path d="M6.5 15h4" />
    </Icon>
  );
}

export function BillingIcon() {
  return (
    <Icon>
      <path d="M6 3h12v18l-2.5-1.5L13 21l-2.5-1.5L8 21l-2-1.5V3Z" />
      <path d="M8.5 8h7M8.5 11.5h7M8.5 15h4.5" />
    </Icon>
  );
}

export function SubmissionsIcon() {
  return (
    <Icon>
      <path d="M4 13V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v7" />
      <path d="M4 13h5l1.5 2.5h3L15 13h5" />
      <path d="M4 13v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" />
    </Icon>
  );
}

export function BookingsIcon() {
  return (
    <Icon>
      <rect x="4" y="5" width="16" height="15" rx="2" />
      <path d="M4 9.5h16" />
      <path d="M8 3v4M16 3v4" />
      <path d="M8.5 13.5h2M8.5 16.5h2M13 13.5h2M13 16.5h2" />
    </Icon>
  );
}

export function DomainsIcon() {
  return (
    <Icon>
      <circle cx="12" cy="12" r="8.5" />
      <ellipse cx="12" cy="12" rx="3.5" ry="8.5" />
      <path d="M3.5 12h17" />
    </Icon>
  );
}
