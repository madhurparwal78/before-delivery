// The signed-in frame: the left rail (a drawer behind Menu below 1280 pixels), the top bar with the
// page title and the feedback regions, the main field and an optional right column.
import { Menu } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { SessionBody } from "../shared/api";
import { FeedbackRegions } from "./feedback";
import { useMedia } from "./hooks";
import { SideRail } from "./SideRail";

export function Shell({ session, slug, stages, selected, onStage, title, aside, children }: {
  session: SessionBody; slug: string; stages: string[]; selected?: string | null; onStage?: (stage: string) => void; title: string;
  aside?: ReactNode; children: ReactNode;
}) {
  const wide = useMedia("(min-width: 1280px)");
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!menuOpen) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || document.querySelector("dialog[open]")) return;
      event.stopImmediatePropagation();
      setMenuOpen(false);
      menuButton.current?.focus();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [menuOpen]);
  const pick = onStage && ((stage: string) => {
    setMenuOpen(false);
    onStage(stage);
  });
  return (
    <div className={`workspace${aside ? " has-evidence" : ""}`}>
      {wide && <SideRail session={session} slug={slug} stages={stages} selected={selected} onStage={pick} />}
      {!wide && menuOpen && (
        <div className="drawer" onClick={(event) => event.target === event.currentTarget && setMenuOpen(false)}>
          <SideRail session={session} slug={slug} stages={stages} selected={selected} onStage={pick} focusFirst />
        </div>
      )}
      <main className="field-main">
        <header className="topbar">
          {!wide && (
            <button ref={menuButton} type="button" className="button quiet menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)}>
              <Menu aria-hidden="true" size={16} /> Menu
            </button>
          )}
          <h1 className="page-title">{title}</h1>
          <FeedbackRegions />
        </header>
        {children}
      </main>
      {aside}
    </div>
  );
}
