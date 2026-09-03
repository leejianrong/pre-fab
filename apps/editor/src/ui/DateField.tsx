/**
 * Plain `<input type="date">`, token-styled to match the outlined text
 * field's shape/color — md-outlined-text-field's TextFieldType doesn't
 * include "date" (see @material/web's textfield/internal/text-field.d.ts),
 * so this is the "tokens only" fallback (material-design-3 skill) for the
 * one gap in the library's coverage.
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
  id?: string;
}) {
  return (
    <label htmlFor={id} className="pf-date-field-label">
      {label}
      <input id={id} type="date" className="pf-date-field" value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}
