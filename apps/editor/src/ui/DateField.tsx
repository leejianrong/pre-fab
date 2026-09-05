/**
 * Plain `<input type="date">`, token-styled to match the outlined text
 * field's shape/color — md-outlined-text-field's TextFieldType doesn't
 * include "date" (see @material/web's textfield/internal/text-field.d.ts),
 * so this is the "tokens only" fallback (material-design-3 skill) for the
 * one gap in the library's coverage.
 *
 * `label`/`input` are siblings joined by `for`/`id`, not a wrapping
 * `<label>` — confirmed against a real Chromium accessibility tree
 * (see ui/SelectField.tsx's comment) that a *wrapping* label's computed
 * accessible name concatenates the control's own rendered text onto the
 * label text. Harmless for a date input (nothing to concatenate) but kept
 * consistent with SelectField, where it isn't harmless.
 */
export function DateField({
  label,
  value,
  onChange,
  id,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  id: string;
}) {
  return (
    <div className="pf-native-field">
      <label htmlFor={id} className="pf-native-field-label">
        {label}
      </label>
      <input id={id} type="date" className="pf-native-control" value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
