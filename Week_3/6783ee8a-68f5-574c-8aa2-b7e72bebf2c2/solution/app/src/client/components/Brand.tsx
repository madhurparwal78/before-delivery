import type { ReactNode } from "react";
import { Link } from "./Link";

/** The small Brackenpad mark: two thick orange brackets around a grey dot. */
function Mark({ size = 28 }: { size?: number }): ReactNode {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <path d="M11 5H6v22h5M21 5h5v22h-5" fill="none" stroke="#b84a14" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="16" cy="16" r="3" fill="#737373" />
    </svg>
  );
}

/** The header's home link: the mark and the wordmark. */
export function Brand({ markOnly = false }: { markOnly?: boolean }): ReactNode {
  return (
    <Link to="/" className="brand" aria-label="Brackenpad home">
      <Mark />
      {!markOnly && <span className="word">brackenpad</span>}
    </Link>
  );
}
