/** Chapter number inside a ring of twelve ticks; the ring draws itself when the chapter enters. */
export function ChapterDial({ index, eyebrow }: { index: string; eyebrow: string }) {
  return (
    <div className="sh-dial-index">
      <svg className="sh-dial-index__ring" viewBox="0 0 64 64" aria-hidden="true" focusable="false">
        <circle className="sh-dial-index__track" cx="32" cy="32" r="28" pathLength={1} />
        <circle className="sh-dial-index__draw" cx="32" cy="32" r="28" pathLength={1} />
        {Array.from({ length: 12 }, (_, tick) => (
          <line
            key={tick}
            x1="32"
            y1="2"
            x2="32"
            y2="6"
            transform={`rotate(${tick * 30} 32 32)`}
            className="sh-dial-index__tick"
          />
        ))}
      </svg>
      <span className="sh-dial-index__number" aria-hidden="true">
        {index}
      </span>
      <span className="sh-eyebrow">{eyebrow}</span>
    </div>
  );
}
