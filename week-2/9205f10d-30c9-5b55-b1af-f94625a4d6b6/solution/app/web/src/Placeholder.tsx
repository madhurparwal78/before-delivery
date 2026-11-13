/** Static ruled rows holding a list's space while its first read is on the way (no shimmer). */
export function Placeholder({ rows = 3 }: { rows?: number }) {
  return (
    <div className="placeholder-rows" role="status" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <span key={i} />
      ))}
    </div>
  );
}
