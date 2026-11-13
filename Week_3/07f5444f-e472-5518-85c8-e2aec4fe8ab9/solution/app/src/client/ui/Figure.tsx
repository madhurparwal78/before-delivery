// A labelled copy figure in tabular mono. A nonzero shortfall carries the caution marker beside its word.

export function Figure({ label, value, caution = false }: { label: string; value: number; caution?: boolean }) {
  const flagged = caution && value > 0;
  return (
    <span className={`figure${flagged ? " figure--caution" : ""}`}>
      {flagged && <span className="caution-mark" aria-hidden="true" />}
      <span className="figure__label">{label}</span> <span className="mono">{value}</span>
    </span>
  );
}
