// Public page title: each line rises from behind its lower edge (long duration, staggered by short).
// The lines are presentational spans; the h1's accessible name is its full text, once.

export function Heading({ lines, className = "display-xl", id }: { lines: string[]; className?: string; id?: string }) {
  return (
    <h1 id={id} tabIndex={-1} className={`${className} reveal`}>
      {lines.map((line, i) => (
        <span key={i} className="line">
          <span className="line-inner" style={{ animationDelay: `${i * 140}ms` }}>
            {line}
          </span>
          {i < lines.length - 1 ? " " : null}
        </span>
      ))}
    </h1>
  );
}
