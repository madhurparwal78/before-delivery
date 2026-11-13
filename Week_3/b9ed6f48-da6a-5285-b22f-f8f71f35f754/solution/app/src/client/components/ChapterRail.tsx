// The chapter rail (brief: Screens and layout › Chapter rail): a right-edge column on desktop, a
// strip under the header on tablet, and on phones a Chapters button that opens a bottom sheet.

import { useState } from "react";
import type { ChapterSummary } from "../api.js";
import { Link } from "../router.js";
import { rememberNumeral } from "../morph.js";
import { Dialog } from "./Dialog.js";

function RailLinks({ chapters, current, onNavigate }: { chapters: ChapterSummary[]; current: number; onNavigate?: () => void }) {
  return (
    <ul>
      {chapters.map((c) => (
        <li key={c.number}>
          <Link
            href={`/chapters/${c.number}`}
            aria-label={`Chapter ${c.numeral}`}
            aria-current={c.number === current ? "page" : undefined}
            onNavigate={(event) => {
              rememberNumeral(c.numeral, event.currentTarget.querySelector(".rail-numeral"));
              onNavigate?.();
            }}
          >
            <span className="rail-numeral">{c.numeral}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function ChapterRail({ chapters, current }: { chapters: ChapterSummary[]; current: number }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <nav aria-label="Chapters" className="chapter-rail">
        <RailLinks chapters={chapters} current={current} />
      </nav>
      <button type="button" className="chapters-button button" onClick={() => setOpen(true)}>
        Chapters
      </button>
      <Dialog open={open} label="Chapters" variant="sheet" onClose={() => setOpen(false)}>
        <p className="sheet-title">The eight rooms</p>
        <div className="sheet-rail">
          <RailLinks chapters={chapters} current={current} onNavigate={() => setOpen(false)} />
        </div>
      </Dialog>
    </>
  );
}
