import { useEffect, useRef, type ReactNode } from "react";

interface MdSelectElement extends HTMLElement {
  value: string;
  label: string;
  required: boolean;
  disabled: boolean;
}

export interface SelectProps {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  disabled?: boolean;
  id?: string;
  children: ReactNode;
}

/** Controlled wrapper over md-outlined-select — same ref+effect pattern as TextField. */
export function Select({ label, value, onChange, required, disabled, id, children }: SelectProps) {
  const ref = useRef<MdSelectElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.label = label ?? "";
    el.required = Boolean(required);
    el.disabled = Boolean(disabled);
    // md-select's `value` setter queries its slotted md-select-option
    // children, so this must run after they've mounted — safe here since
    // `children` renders in the same commit, before this effect fires.
    if (el.value !== value) el.value = value;
  });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const handler = (event: Event) => onChange((event.target as MdSelectElement).value);
    el.addEventListener("change", handler);
    return () => el.removeEventListener("change", handler);
  }, [onChange]);

  return (
    <md-outlined-select ref={ref} id={id}>
      {children}
    </md-outlined-select>
  );
}

export function Option({ value, children }: { value: string; children: string }) {
  return <md-select-option value={value} headline={children} />;
}
