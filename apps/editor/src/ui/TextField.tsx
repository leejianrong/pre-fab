import { useEffect, useRef, type CSSProperties } from "react";

interface MdTextFieldElement extends HTMLElement {
  value: string;
  label: string;
  type: string;
  required: boolean;
  disabled: boolean;
  placeholder: string;
  rows: number;
  maxLength: number;
  inputMode: string;
  error: boolean;
  errorText: string;
  supportingText: string;
}

export interface TextFieldProps {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  type?: "text" | "email" | "url" | "password" | "tel" | "search" | "number" | "textarea";
  required?: boolean;
  disabled?: boolean;
  placeholder?: string;
  rows?: number;
  maxLength?: number;
  inputMode?: string;
  error?: boolean;
  errorText?: string;
  supportingText?: string;
  id?: string;
  className?: string;
  style?: CSSProperties;
}

/**
 * Controlled wrapper over md-outlined-text-field (components.md: "Pick one
 * [filled or outlined] and use it consistently across a form" — outlined
 * chosen since the editor's panels sit on varied surface tints). Props are
 * applied imperatively via ref, not JSX attributes, per the
 * material-design-3 skill's ref+effect alternative to @lit/react — one
 * source of truth for the live DOM state instead of relying on how React
 * resolves an unrecognised tag's props to attribute vs. property.
 *
 * md-outlined-text-field doesn't support type="date" (@material/web's
 * TextFieldType), so BlogPanel's date field uses ui/DateField instead.
 */
export function TextField({
  label,
  value,
  onChange,
  type = "text",
  required,
  disabled,
  placeholder,
  rows,
  maxLength,
  inputMode,
  error,
  errorText,
  supportingText,
  id,
  className,
  style,
}: TextFieldProps) {
  const ref = useRef<MdTextFieldElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (el.value !== value) el.value = value;
    el.label = label ?? "";
    el.type = type;
    el.required = Boolean(required);
    el.disabled = Boolean(disabled);
    el.placeholder = placeholder ?? "";
    if (rows !== undefined) el.rows = rows;
    if (maxLength !== undefined) el.maxLength = maxLength;
    if (inputMode !== undefined) el.inputMode = inputMode;
    el.error = Boolean(error);
    el.errorText = errorText ?? "";
    el.supportingText = supportingText ?? "";
  });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const handler = (event: Event) => onChange((event.target as MdTextFieldElement).value);
    el.addEventListener("input", handler);
    return () => el.removeEventListener("input", handler);
  }, [onChange]);

  return <md-outlined-text-field ref={ref} id={id} className={className} style={style} />;
}
