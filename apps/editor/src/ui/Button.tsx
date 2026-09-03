import type { CSSProperties, MouseEventHandler, ReactNode } from "react";

interface ButtonProps {
  children: ReactNode;
  onClick?: MouseEventHandler<HTMLElement>;
  disabled?: boolean;
  type?: "button" | "submit" | "reset";
  className?: string;
  style?: CSSProperties;
}

/**
 * M3 button emphasis ladder (components.md): Filled is the one primary
 * action per screen/section; Tonal an alternative primary action; Outlined
 * medium emphasis; Text the lowest. Native `disabled`/`type` attributes
 * work directly in JSX on these custom elements (material-design-3 skill).
 */
export function FilledButton({ children, ...rest }: ButtonProps) {
  return <md-filled-button {...rest}>{children}</md-filled-button>;
}

export function TonalButton({ children, ...rest }: ButtonProps) {
  return <md-filled-tonal-button {...rest}>{children}</md-filled-tonal-button>;
}

export function OutlinedButton({ children, ...rest }: ButtonProps) {
  return <md-outlined-button {...rest}>{children}</md-outlined-button>;
}

export function TextButton({ children, ...rest }: ButtonProps) {
  return <md-text-button {...rest}>{children}</md-text-button>;
}
