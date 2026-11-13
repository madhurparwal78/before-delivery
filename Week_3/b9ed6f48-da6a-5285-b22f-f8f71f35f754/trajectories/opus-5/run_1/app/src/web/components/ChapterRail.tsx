import { useState } from 'react';
import { Link } from '../lib/router.js';
import { useIsDesktop, useIsPhone } from '../lib/hooks.js';
import { Dialog } from './Dialog.js';
import type { ChapterSummary } from '../../shared/types.js';

function RailLinks({
  chapters,
  current,
  onNavigate,
}: {
  chapters: ChapterSummary[];
  current: number | null;
  onNavigate?: () => void;
}): JSX.Element {
  return (
    <nav aria-label="Chapters" className="rail">
      <ul>
        {chapters.map((chapter) => (
          <li key={chapter.number}>
            <Link
              to={`/chapters/${chapter.number}`}
              aria-label={`Chapter ${chapter.numeral}`}
              onNavigate={onNavigate}
              data-numeral={chapter.numeral}
              {...(current === chapter.number ? { 'aria-current': 'page' as const } : {})}
            >
              {chapter.numeral}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function ChapterRail({
  chapters,
  current,
}: {
  chapters: ChapterSummary[];
  current: number | null;
}): JSX.Element {
  const isPhone = useIsPhone();
  const isDesktop = useIsDesktop();
  const [sheetOpen, setSheetOpen] = useState(false);

  if (isPhone) {
    return (
      <>
        <button type="button" className="rail-phone-button" onClick={() => setSheetOpen(true)}>
          Chapters
        </button>
        {sheetOpen ? (
          <Dialog title="Chapters" variant="bottom-sheet" onClose={() => setSheetOpen(false)}>
            <RailLinks chapters={chapters} current={current} onNavigate={() => setSheetOpen(false)} />
          </Dialog>
        ) : null}
      </>
    );
  }

  return (
    <div className={isDesktop ? 'rail-desktop' : 'rail-tablet'}>
      <RailLinks chapters={chapters} current={current} />
    </div>
  );
}
