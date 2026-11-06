// Pieces every detail sheet uses: the ruled title block, the not-found sheet, the blank-sheet mark.
import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";
import { showDate } from "../format";
import { navigate } from "../router";

export function TitleBlock(props: { name: string; state: string; changed: string | null }): JSX.Element {
  return (
    <dl className="title-block" aria-label="Title block">
      <div>
        <dt>Record</dt>
        <dd className="mono">{props.name}</dd>
      </div>
      <div>
        <dt>State</dt>
        <dd>{props.state}</dd>
      </div>
      <div>
        <dt>Changed</dt>
        <dd className="mono">{props.changed ? showDate(props.changed) : "—"}</dd>
      </div>
    </dl>
  );
}

function BackButton(props: { to: string }): JSX.Element {
  return (
    <button type="button" className="back-button" onClick={() => navigate(props.to, { state: { pane: "list" } })}>
      <ArrowLeft aria-hidden="true" size={18} strokeWidth={1.5} />
      Back
    </button>
  );
}

export function SheetHeader(props: { back: string; children?: ReactNode }): JSX.Element {
  return (
    <div className="sheet-top">
      <BackButton to={props.back} />
      {props.children}
    </div>
  );
}

function BlankMark(): JSX.Element {
  return (
    <svg className="blank-mark" viewBox="0 0 40 40" aria-hidden="true">
      <path d="M6 12V6h6M28 6h6v6M34 28v6h-6M12 34H6v-6" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M12 20h16" stroke="currentColor" strokeWidth="1" strokeDasharray="2 3" />
    </svg>
  );
}

export function EmptyNote(props: { children: ReactNode }): JSX.Element {
  return (
    <div className="empty-note">
      <BlankMark />
      <p>{props.children}</p>
    </div>
  );
}

export function NotFound(props: { back: string }): JSX.Element {
  return (
    <div className="sheet not-found">
      <SheetHeader back={props.back} />
      <h1>Not found</h1>
      <p>That item doesn't exist or isn't shared with you.</p>
    </div>
  );
}
