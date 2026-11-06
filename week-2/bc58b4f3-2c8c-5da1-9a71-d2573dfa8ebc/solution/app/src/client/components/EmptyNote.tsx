import { BlankSlip } from "./Icons";

export function EmptyNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="empty-note">
      <BlankSlip />
      <p>{children}</p>
    </div>
  );
}

/** Ruled placeholder rows shown until a list's first answer arrives. */
export function LoadingRows({ rows = 3 }: { rows?: number }) {
  return (
    <div className="loading-rows" aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <span key={i} className="loading-row" />
      ))}
    </div>
  );
}
