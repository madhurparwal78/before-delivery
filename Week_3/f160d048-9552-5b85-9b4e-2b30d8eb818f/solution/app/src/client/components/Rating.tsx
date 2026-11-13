import { Star } from "lucide-react";
import { useId, useRef, type KeyboardEvent, type Ref } from "react";
import { announce } from "../announce";
import { useMotion } from "../motion";
import { FieldError } from "./ui";

type Props = {
  label: string;
  value: number | undefined;
  onChange: (value: number) => void;
  error?: string;
  /** Receives the first radio, so a failed step can move focus to it. */
  firstRef?: Ref<HTMLInputElement>;
};

/** Five star radios: Right and Up choose the next star, Left and Down the previous one (both wrap), Home and End the ends. */
export function RatingGroup({ label, value, onChange, error, firstRef }: Props) {
  const id = useId();
  const group = useRef<HTMLDivElement>(null);
  const motion = useMotion(160);

  function choose(next: number) {
    onChange(next);
    announce(`${label}: ${next} of 5`);
    const stars = Array.from(group.current?.querySelectorAll("svg") ?? []).slice(0, next);
    motion.play(stars, [{ transform: "scale(0.8)" }, { transform: "scale(1)" }]);
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const current = value ?? 0;
    const next =
      event.key === "ArrowRight" || event.key === "ArrowUp" ? (current % 5) + 1
      : event.key === "ArrowLeft" || event.key === "ArrowDown" ? (current <= 1 ? 5 : current - 1)
      : event.key === "Home" ? 1
      : event.key === "End" ? 5
      : undefined;
    if (next === undefined) return;
    event.preventDefault();
    choose(next);
    group.current?.querySelectorAll<HTMLInputElement>("input")[next - 1]?.focus();
  }

  return (
    <div className="field">
      <span className="legend" id={`${id}-label`} aria-hidden="true">
        {label.replace(/ rating$/, "")}
      </span>
      <div
        ref={group}
        className="stars"
        role="radiogroup"
        aria-label={label}
        aria-describedby={error ? `${id}-error` : undefined}
        data-motion="star-fill"
        data-motion-ms={motion.ms}
        data-state={motion.state}
        onKeyDown={onKeyDown}
      >
        {[1, 2, 3, 4, 5].map((n) => (
          <label key={n} className={`star ${value !== undefined && n <= value ? "filled" : ""}`}>
            <input
              type="radio"
              name={id}
              ref={n === 1 ? firstRef : undefined}
              checked={value === n}
              aria-label={n === 1 ? "1 star" : `${n} stars`}
              aria-describedby={n === 1 && error ? `${id}-error` : undefined}
              onChange={() => choose(n)}
            />
            <Star aria-hidden="true" />
          </label>
        ))}
      </div>
      <FieldError id={`${id}-error`}>{error}</FieldError>
    </div>
  );
}
