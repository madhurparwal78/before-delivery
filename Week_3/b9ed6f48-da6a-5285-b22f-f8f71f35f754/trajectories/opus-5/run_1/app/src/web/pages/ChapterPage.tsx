import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { useResource } from '../lib/hooks.js';
import { useStore } from '../lib/store.js';
import { takeNumeralOrigin } from '../lib/morph.js';
import { SightlineScene } from '../components/sightline/SightlineScene.js';
import { Plates, NarrationPlayer, ThresholdBand } from '../components/ChapterMedia.js';
import { SpringExhibit } from '../components/exhibits/Spring.js';
import { RulesExhibit } from '../components/exhibits/Rules.js';
import { ClassifierExhibit } from '../components/exhibits/Classifier.js';
import { NeighboursExhibit } from '../components/exhibits/Neighbours.js';
import { BookmarkButton } from '../components/BookmarkButton.js';
import { NotFound } from './NotFound.js';
import { copy } from '../../shared/copy.js';
import type { ChapterDetail, ChapterSummary } from '../../shared/types.js';
import type {
  ClassifierSeed,
  NeighboursSeed,
  RulesSeed,
  SpringSeed,
} from '../../shared/exhibits.js';

function ExhibitBand({ chapter, onUse }: { chapter: ChapterDetail; onUse: () => void }): JSX.Element | null {
  const spring = useResource<SpringSeed>(chapter.exhibit === 'spring' ? '/api/exhibits/spring' : null);
  const rules = useResource<RulesSeed>(chapter.exhibit === 'rules' ? '/api/exhibits/rules' : null);
  const classifier = useResource<ClassifierSeed>(
    chapter.exhibit === 'classifier' ? '/api/exhibits/classifier' : null,
  );
  const neighbours = useResource<NeighboursSeed>(
    chapter.exhibit === 'neighbours' ? '/api/exhibits/neighbours' : null,
  );
  if (chapter.exhibit === 'spring' && spring.data) return <SpringExhibit seed={spring.data} onUse={onUse} />;
  if (chapter.exhibit === 'rules' && rules.data) return <RulesExhibit seed={rules.data} onUse={onUse} />;
  if (chapter.exhibit === 'classifier' && classifier.data) {
    return <ClassifierExhibit seed={classifier.data} onUse={onUse} />;
  }
  if (chapter.exhibit === 'neighbours' && neighbours.data) {
    return <NeighboursExhibit seed={neighbours.data} onUse={onUse} />;
  }
  return null;
}

export function ChapterPage({
  number,
  chapters,
}: {
  number: number;
  chapters: ChapterSummary[];
}): JSX.Element {
  const { user, reducedMotion } = useStore();
  const loaded = useResource<{ chapter: ChapterDetail }>(`/api/chapters/${number}`);
  const [entered, setEntered] = useState(false);
  const [usedExhibit, setUsedExhibit] = useState(false);
  const [morph, setMorph] = useState<{ top: number; left: number; size: number } | null>(null);
  const exhibitBand = useRef<HTMLDivElement | null>(null);

  const chapter = loaded.data?.chapter ?? null;

  useEffect(() => {
    setEntered(false);
    setUsedExhibit(false);
  }, [number]);

  useEffect(() => {
    if (!chapter || reducedMotion) return undefined;
    const origin = takeNumeralOrigin(chapter.numeral);
    if (!origin) return undefined;
    setMorph({ top: origin.rect.top, left: origin.rect.left, size: origin.rect.height });
    const frame = window.requestAnimationFrame(() => {
      const header = document.querySelector<HTMLElement>('.scene-label .numeral');
      if (!header) return;
      const box = header.getBoundingClientRect();
      setMorph({ top: box.top, left: box.left, size: box.height });
    });
    const timer = window.setTimeout(() => setMorph(null), 700);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [chapter, reducedMotion]);

  if (loaded.error) return <NotFound />;
  if (!chapter) return <p className="secondary">Opening the room.</p>;

  const enterChapter = (): void => {
    setEntered(true);
    if (!user) return;
    void api('/api/me/path/resolved', { method: 'POST', body: { chapter: chapter.number } }).catch(() => undefined);
    void api('/api/me/path/position', {
      method: 'PUT',
      body: { chapter: chapter.number, exhibit: '' },
    }).catch(() => undefined);
  };

  const useExhibit = (): void => {
    if (usedExhibit || !user || !chapter.exhibit) return;
    setUsedExhibit(true);
    void api('/api/me/path/position', {
      method: 'PUT',
      body: { chapter: chapter.number, exhibit: chapter.exhibit },
    }).catch(() => undefined);
  };

  const next = chapters.find((entry) => entry.number === chapter.number + 1) ?? chapters[0];

  return (
    <>
      {morph ? (
        <span
          aria-hidden="true"
          className="numeral"
          style={{
            position: 'fixed',
            top: morph.top,
            left: morph.left,
            fontSize: morph.size,
            zIndex: 50,
            transition: 'all 0.66s cubic-bezier(0.2, 0.8, 0.2, 1)',
            pointerEvents: 'none',
          }}
        >
          {chapter.numeral}
        </span>
      ) : null}

      <div className="band scene-band">
        <SightlineScene chapter={chapter} startResolved={chapter.resolved} onEnter={enterChapter} />
      </div>

      <div className="band">
        <div className="text-split">
          <div>
            <h2>{`Chapter ${chapter.numeral}`}</h2>
            <BookmarkButton targetType="chapter" targetId={chapter.id} title="chapter" label="Bookmark chapter" />
            <p>{chapter.body}</p>
            <NarrationPlayer narration={chapter.narration} />
          </div>
          <Plates plates={chapter.plates} />
        </div>
      </div>

      {chapter.exhibit && entered ? (
        <div className="band" ref={exhibitBand}>
          <ExhibitBand chapter={chapter} onUse={useExhibit} />
        </div>
      ) : null}

      <div className="band">
        <h2>Timeline events in this chapter</h2>
        {chapter.events.length === 0 ? (
          <p className="secondary">{copy.emptyChapterEvents}</p>
        ) : (
          <ul className="card-grid">
            {chapter.events.map((event) => (
              <li key={event.id} className="museum-card">
                <span className="catalogue figure">{event.year}</span>
                <h3>{event.title}</h3>
                <p>{event.summary}</p>
                <BookmarkButton
                  targetType="event"
                  targetId={event.id}
                  title={event.title}
                  label={`Bookmark ${event.title}`}
                />
              </li>
            ))}
          </ul>
        )}
      </div>

      {next ? (
        <div className="band">
          <ThresholdBand title={`Chapter ${next.numeral}: ${next.title}`} href={`/chapters/${next.number}`} />
        </div>
      ) : null}
    </>
  );
}
