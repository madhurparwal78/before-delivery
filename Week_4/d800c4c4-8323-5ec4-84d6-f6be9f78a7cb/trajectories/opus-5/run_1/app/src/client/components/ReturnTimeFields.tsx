import { readReturnTime, secondHourLabel } from '../lib/return-time';

interface ReturnTimeFieldsProps {
  readonly zone: string;
  readonly text: string;
  readonly secondHour: boolean;
  readonly onText: (text: string) => void;
  readonly onSecondHour: (ticked: boolean) => void;
  readonly fieldRef: (element: HTMLInputElement | null) => void;
}

/**
 * Return time is typed as library-local wall-clock text. While that text names
 * an hour the clocks repeat, the second-hour box appears directly after it, and
 * it is removed, forgetting its tick, as soon as the text names another time.
 */
export function ReturnTimeFields({
  zone,
  text,
  secondHour,
  onText,
  onSecondHour,
  fieldRef,
}: ReturnTimeFieldsProps): JSX.Element {
  const label = secondHourLabel(readReturnTime(text, zone));
  return (
    <>
      <label>
        Return time
        <input
          aria-label="Return time"
          ref={fieldRef}
          value={text}
          placeholder="YYYY-MM-DD HH:MM"
          onChange={(event) => {
            onText(event.target.value);
            if (readReturnTime(event.target.value, zone).kind !== 'repeated') onSecondHour(false);
          }}
        />
      </label>
      {label === null ? null : (
        <label className="second-hour">
          <input
            type="checkbox"
            aria-label={label}
            checked={secondHour}
            onChange={(event) => onSecondHour(event.target.checked)}
          />
          {label}
        </label>
      )}
    </>
  );
}
