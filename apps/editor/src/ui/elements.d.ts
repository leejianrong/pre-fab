import type { DetailedHTMLProps, HTMLAttributes } from "react";

/**
 * JSX typings for the @material/web custom elements this ui/ kit renders
 * directly (a plain `<dialog>` — ui/Dialog.tsx — needs none of this; React
 * already types it). Two-way bound state (TextField's value) is set
 * imperatively via ref + useEffect rather than JSX props (see those
 * components) — sidesteps any ambiguity in whether React sets a given prop
 * as a DOM attribute or property on an unrecognised tag. Buttons are the
 * exception: `disabled`/`type` are plain boolean/string attributes, which
 * the material-design-3 skill notes work fine directly in JSX.
 */
type ButtonAttrs = DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement> & {
  disabled?: boolean;
  type?: "button" | "submit" | "reset";
  value?: string;
  name?: string;
};

type BareElement = DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement>;

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "md-filled-button": ButtonAttrs;
      "md-filled-tonal-button": ButtonAttrs;
      "md-outlined-button": ButtonAttrs;
      "md-text-button": ButtonAttrs;
      "md-icon-button": ButtonAttrs;
      "md-outlined-text-field": BareElement;
      "md-circular-progress": BareElement & { indeterminate?: boolean };
    }
  }
}
