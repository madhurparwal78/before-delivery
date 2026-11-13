// Empty-state sketch: a one-pixel plan outline with a door swing and one grip, above a single line of copy.
export function EmptySketch() {
  return (
    <svg className="empty-sketch" viewBox="0 0 96 64" width="96" height="64" aria-hidden="true" focusable="false">
      <path d="M8 8h56v22H8zM64 8h24v48H44V30M8 30v26h36" fill="none" stroke="var(--line)" strokeWidth="1" />
      <path d="M26 30a10 10 0 0 1 10 10" fill="none" stroke="var(--line)" strokeWidth="1" />
      <path d="M26 30v10M20 18h24M20 22h14" fill="none" stroke="var(--line-strong)" strokeWidth="1" />
      <rect x="84" y="4" width="8" height="8" fill="var(--vertex)" />
    </svg>
  );
}
