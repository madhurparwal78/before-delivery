// Shared frame and data hooks of the records screens (packages, applications, talent editor, roster,
// members, rate cards, offices).

import type { ReactNode } from "react";
import { Shell } from "../../../workspace/shell.js";
import { StatusLine } from "../../../ui/status.js";
import { useMember } from "../../../workspace/data.js";
import { formatOfficeTime } from "../../../../shared/format.js";

/** A records screen: the workspace shell, the level-one heading, the screen's live region, then content. */
export function RecordsPage({ title, lede, statusName, message, actions, children }: {
  title: string;
  lede?: ReactNode;
  statusName: string;
  message: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Shell>
      <header className="workspace-head records-head">
        <div>
          <h1 tabIndex={-1}>{title}</h1>
          {lede ? <p className="muted">{lede}</p> : null}
        </div>
        {actions ? <div className="btn-row">{actions}</div> : null}
      </header>
      <StatusLine name={statusName} message={message} />
      {children}
    </Shell>
  );
}

/** An instant in the signed-in member's office, in the published `<time>` format. */
export function useOfficeTime(): (instant: string) => string {
  const member = useMember();
  return (instant) => formatOfficeTime(instant, member.office);
}

/** Focuses the element matching `selector` once it is rendered and no dialog holds the page inert. */
export function focusSoon(selector: string): void {
  let tries = 0;
  const attempt = () => {
    const element = document.querySelector<HTMLElement>(selector);
    if (element && !element.closest("[inert]")) {
      element.focus();
      if (document.activeElement === element) return;
    }
    if (++tries < 60) setTimeout(attempt, 50);
  };
  setTimeout(attempt, 0);
}

export const LOADING = <p className="muted">Loading…</p>;
