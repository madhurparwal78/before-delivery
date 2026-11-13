/** A match that burns down from the flame end: its stick is as long as the share of the hold that is left. */

const STICK = 118;
/** Where the stick rests in the drawing: the flame rises from its head up to the drawing's top edge. */
const AXIS = 15;

export const BurningMatch = ({ share }: { share: number }) => {
  const length = Math.max(0, Math.min(1, share)) * STICK;
  const head = length + 4;
  return (
    <svg viewBox="0 0 136 20" className={`match${share < 0.15 ? " match--dying" : ""}`} aria-hidden="true" focusable="false">
      <path d={`M0 ${AXIS - 1} L${length + 1} ${AXIS - 1.7} L${length + 1} ${AXIS + 1.7} L0 ${AXIS + 1} Z`} className="match__stick" />
      <path
        d={`M${head} 1 C${head + 2.2} 5 ${head + 5.2} 7.6 ${head + 5.2} 10.6 C${head + 5.2} 13.2 ${head + 2.8} 15 ${head} 15 C${head - 2.8} 15 ${head - 5.2} 13.2 ${head - 5.2} 10.6 C${head - 5.2} 7.6 ${head - 1.6} 5.4 ${head} 1 Z`}
        className="match__flame"
      />
      <path
        d={`M${head} 6.6 C${head + 1} 8.6 ${head + 2.5} 9.8 ${head + 2.5} 11.4 C${head + 2.5} 12.9 ${head + 1.3} 14 ${head} 14 C${head - 1.3} 14 ${head - 2.5} 12.9 ${head - 2.5} 11.4 C${head - 2.5} 9.8 ${head - 0.8} 8.6 ${head} 6.6 Z`}
        className="match__core"
      />
      <ellipse cx={head} cy={AXIS} rx="4.2" ry="3.4" className="match__head" />
    </svg>
  );
};
