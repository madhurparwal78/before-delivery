import type { ReactNode } from "react";
import { useWorkspace } from "../lib/workspace.tsx";
import { WorkspaceTabs, WorkspaceTopBar } from "./TopBar.tsx";

/** Top bar, phone tabs, the page and the Network updates live region of every workspace page. */
export function Shell({ children }: { children: ReactNode }) {
  const { id, announcements } = useWorkspace();
  return (
    <>
      <WorkspaceTopBar workspaceId={id} />
      <WorkspaceTabs workspaceId={id} />
      <main className="page">{children}</main>
      <div role="status" aria-label="Network updates" className="sr-only">
        {announcements.map((line, index) => <p key={index}>{line}</p>)}
      </div>
    </>
  );
}
