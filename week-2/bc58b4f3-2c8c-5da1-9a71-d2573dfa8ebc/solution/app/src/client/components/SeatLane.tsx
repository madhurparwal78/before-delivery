import type { LaneShown } from "../seam";

interface Props {
  seat: number;
  shown: LaneShown;
  fillRef: (element: HTMLElement | null) => void;
}

/** One seat lane: hatched and labelled `open`, or solid covered fill with the holder's initials. */
export function SeatLane({ seat, shown, fillRef }: Props) {
  const sweeping = shown.mode === "sweep-in" || shown.mode === "sweep-out";
  return (
    <span role="group" aria-label={`Seat ${seat}`} className={`lane ${shown.mode === "held" ? "lane-held" : "lane-open"}`}>
      {sweeping ? <span ref={fillRef} className={`lane-fill lane-fill-${shown.mode}`} aria-hidden="true" /> : null}
      <span className={shown.mode === "held" ? "lane-initials" : "lane-chip"}>{shown.label}</span>
    </span>
  );
}
