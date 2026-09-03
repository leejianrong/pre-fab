import type { ReactNode } from "react";

/**
 * Plain `<select>`, token-styled to match the outlined text field —
 * deliberately NOT @material/web's md-outlined-select. That component is a
 * combobox built from a button + an overlay menu, not a real `<select>`;
 * automation (Playwright's `.selectOption()`, same contract a real user's
 * OS picker gives them) and native keyboard typeahead both depend on the
 * element actually being one. "Tokens only" fallback (material-design-3
 * skill), same call as ui/DateField for the same reason.
 *
 * `label`/`select` are siblings joined by `for`/`id`, not a wrapping
 * `<label>` — verified against a real Chromium accessibility tree that a
 * *wrapping* label's computed accessible name concatenates every
 * descendant `<option>`'s text onto the label text (e.g. a "Status" label
 * wrapping Draft/Published options computed as "StatusDraftPublished",
 * breaking both `getByLabel` and real screen readers). The sibling
 * for/id form doesn't have this problem since the label's own subtree
 * only ever contains its own text.
 */
export function SelectField({
  label,
  value,
  onChange,
  id,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  id: string;
  children: ReactNode;
}) {
  return (
    <div className="pf-native-field">
      <label htmlFor={id} className="pf-native-field-label">
        {label}
      </label>
      <select id={id} className="pf-native-control" value={value} onChange={(e) => onChange(e.target.value)}>
        {children}
      </select>
    </div>
  );
}
