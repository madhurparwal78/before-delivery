const WORDS = { pending: "Pending", running: "Running", succeeded: "Succeeded", failed: "Failed", cancelled: "Cancelled" };

// A job status as a coloured dot plus its word (or a sentence naming it); the dot is hidden from assistive technology.
export default function StatusChip({ status, children }) {
  if (!status) return <span className="status-none">No jobs yet</span>;
  return (
    <span className={`status status-${status}`}>
      <span className="status-dot" aria-hidden="true" />
      {children ?? WORDS[status]}
    </span>
  );
}
