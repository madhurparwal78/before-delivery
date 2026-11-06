// A figure that rolls to its new value: the text is the live value at once; only its face moves.

export function RollingNumber({ value }: { value: string }) {
  return (
    <span key={value} className="roll">
      {value}
    </span>
  );
}
