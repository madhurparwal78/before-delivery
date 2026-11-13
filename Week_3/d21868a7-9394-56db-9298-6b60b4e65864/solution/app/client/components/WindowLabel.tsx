// A window label as the server wrote it, with each endpoint kept on one line so a narrow column
// breaks it at "to" rather than inside a date.
export function WindowLabel({ label }: { label: string }) {
  const at = label.indexOf(" to ");
  if (at < 0) return <>{label}</>;
  return (
    <>
      <span className="nowrap">{label.slice(0, at)}</span> to <span className="nowrap">{label.slice(at + 4)}</span>
    </>
  );
}
