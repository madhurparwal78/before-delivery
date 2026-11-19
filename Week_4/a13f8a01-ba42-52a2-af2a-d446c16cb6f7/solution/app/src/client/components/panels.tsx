import type { ReactNode } from "react";
import { formatDate, countLabel } from "../format.js";
import { Link } from "../router.js";
import type { PenSummary } from "../../shared/types.js";
import { CourseDrawing } from "./icons.js";

export function StatePanel({ children, drawing = true, label }: { children: ReactNode; drawing?: boolean; label?: string }): React.JSX.Element {
  return (
    <div className="panel" aria-label={label}>
      {drawing && <CourseDrawing />}
      <p>{children}</p>
    </div>
  );
}

interface RowProps {
  pen: PenSummary;
  showOwner?: boolean;
  onPreview: (id: string) => void;
  extra?: ReactNode;
  linkRef?: (element: HTMLAnchorElement | null) => void;
  onLinkKeyDown?: (event: React.KeyboardEvent<HTMLAnchorElement>) => void;
}

export function PenRowItem({ pen, showOwner = false, onPreview, extra, linkRef, onLinkKeyDown }: RowProps): React.JSX.Element {
  return (
    <li className="row" onMouseEnter={() => onPreview(pen.id)} onFocus={() => onPreview(pen.id)}>
      <Link to={`/pen/${pen.id}`} className="row-title" ref={linkRef} onKeyDown={onLinkKeyDown}>
        {pen.title}
      </Link>
      {showOwner && <span className="row-owner">{pen.owner}</span>}
      {pen.tags.length > 0 && <span className="row-tags">{pen.tags.join(" ")}</span>}
      <span className="row-meta tabular">{pen.head === 0 ? "Not saved yet" : `Version ${pen.head}`}</span>
      <span className="row-meta tabular">Updated {formatDate(pen.updated_at)}</span>
      <span className="row-meta tabular">{countLabel(pen.likes, "like")}</span>
      {extra}
    </li>
  );
}
