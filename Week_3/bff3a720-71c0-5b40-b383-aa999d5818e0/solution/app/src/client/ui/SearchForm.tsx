import { useRef, type FormEvent, type ReactElement } from "react";
import type { CalendarDay } from "../../shared/time";
import { announce } from "../lib/announce";
import { useMotion } from "../lib/motion";
import { Combobox } from "./Combobox";
import { DateField } from "./DatePicker";
import { Stepper } from "./Stepper";

export interface SearchValues {
  from: string;
  to: string;
  date: CalendarDay;
  seats: number;
}

interface Props {
  values: SearchValues;
  today: CalendarDay;
  onChange: (next: SearchValues) => void;
  onSubmit?: () => void;
  children?: React.ReactNode;
}

export function SearchForm({ values, today, onChange, onSubmit, children }: Props): ReactElement {
  const swap = useMotion("swap-rotate");
  const turns = useRef(0);
  const arrows = useRef<SVGSVGElement | null>(null);

  const swapCities = (): void => {
    const next = { ...values, from: values.to, to: values.from };
    onChange(next);
    announce(`Leaving from ${next.from}, going to ${next.to}`);
    swap.play();
    if (swap.ms > 0) {
      const from = turns.current * 180;
      turns.current += 1;
      arrows.current?.animate(
        { transform: [`rotate(${from}deg)`, `rotate(${from + 180}deg)`] },
        { duration: swap.ms, easing: "cubic-bezier(.2,.8,.2,1)", fill: "forwards" },
      );
    }
  };

  return (
    <form
      role="search"
      aria-label="Find a ride"
      className="search-form"
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        onSubmit?.();
      }}
    >
      <Combobox label="Leaving from" value={values.from} onSelect={(from) => onChange({ ...values, from })} />
      <button type="button" className="swap" aria-label="Swap cities" onClick={swapCities}>
        <svg
          ref={arrows}
          viewBox="0 0 24 24"
          width="24"
          height="24"
          aria-hidden="true"
          data-motion="swap-rotate"
          data-motion-ms={swap.ms}
          data-state={swap.state}
        >
          <path d="M4 8h14m-4-4 4 4-4 4M20 16H6m4-4-4 4 4 4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="square" />
        </svg>
      </button>
      <Combobox label="Going to" value={values.to} onSelect={(to) => onChange({ ...values, to })} />
      <DateField value={values.date} today={today} onChange={(date) => onChange({ ...values, date })} />
      <Stepper
        label="Seats"
        value={values.seats}
        min={1}
        max={4}
        step={1}
        pageStep={2}
        format={String}
        onChange={(seats) => onChange({ ...values, seats })}
        topNote="This is the most."
        bottomNote="This is the fewest."
        decreaseLabel="Fewer seats"
        increaseLabel="More seats"
      />
      {onSubmit ? (
        <button type="submit" className="search-submit">
          Search
        </button>
      ) : null}
      {children}
    </form>
  );
}
