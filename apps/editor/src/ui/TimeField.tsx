/**
 * Plain `<input type="time">`, token-styled to match the outlined text
 * field's shape/color — same "tokens only" fallback as ui/DateField.tsx
 * (md-outlined-text-field's TextFieldType doesn't cover "time" either).
 * Added for BookingsPanel's weekly-availability editor (KAN-1257): each
 * day's open/close time is a wall-clock time-of-day, not an instant, so a
 * plain HTML time input (value/onChange as "HH:MM" 24-hour strings) is the
 * right primitive — the same one <input type="date"> is for DateField.
 *
 * `label`/`input` are siblings joined by `for`/`id`, not a wrapping
 * `<label>` — same reasoning as DateField/SelectField's own comments.
 */
export function TimeField({
  label,
  value,
  onChange,
  id,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  id: string;
  disabled?: boolean;
}) {
  return (
    <div className="pf-native-field">
      <label htmlFor={id} className="pf-native-field-label">
        {label}
      </label>
      <input
        id={id}
        type="time"
        className="pf-native-control"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
