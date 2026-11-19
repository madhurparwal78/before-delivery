import { useRef } from 'preact/hooks';
import type { PresentationInfo, SkippedSlide } from '../../shared/model.ts';
import { parseNote } from '../../shared/notes.ts';
import { canStep } from '../../shared/rules.ts';
import { api } from '../api.ts';
import { NoteView } from './Details.tsx';
import { newOpId, type MapSession } from './session.ts';
import { useSession } from './useSession.ts';

/** Call a presentation endpoint and keep the screen's copy of the session current. */
async function presentationCall(session: MapSession, path: string, body: unknown): Promise<void> {
  const result = await api<{ presentation: PresentationInfo; skipped?: SkippedSlide[] }>('POST', path, body);
  session.presentation = result.presentation;
  for (const skip of result.skipped ?? []) {
    session.notice(skip.reason === 'deleted' ? `Slide ${skip.index + 1} was skipped: its topic was deleted.` : `Slide ${skip.index + 1} was skipped: it is restricted.`);
  }
  session.notify();
}

export async function startPresentation(session: MapSession): Promise<void> {
  if (session.presentation && session.presentation.state !== 'ended') return;
  const result = await api<{ presentation: PresentationInfo }>('POST', `/api/maps/${session.mapId}/presentations`);
  session.presentation = result.presentation;
  session.notify();
}

export function stepSlide(session: MapSession, direction: 1 | -1): Promise<void> {
  const current = session.presentation;
  if (!current || !canStep(current.state)) return Promise.resolve();
  return presentationCall(session, `/api/presentations/${current.id}/step`, { index: current.slide_index + direction });
}

export function endPresentation(session: MapSession): Promise<void> {
  const current = session.presentation;
  if (!current) return Promise.resolve();
  return presentationCall(session, `/api/presentations/${current.id}/state`, { to: 'ended' });
}

export function Presenter(props: { session: MapSession }) {
  const { session } = props;
  useSession(session);
  const presentation = session.presentation;
  const region = useRef<HTMLDivElement>(null);
  if (!presentation) return null;
  const slides = session.display.slides;
  const link = `${window.location.origin}/p/${presentation.code}`;
  const current = slides[presentation.slide_index];
  const note = current ? (session.display.topics[current]?.note ?? '') : '';

  const reorder = (from: number, to: number): void => {
    if (to < 0 || to >= slides.length) return;
    const order = [...slides];
    const [moved] = order.splice(from, 1);
    if (moved === undefined) return;
    order.splice(to, 0, moved);
    session.submit([{ op_id: newOpId(), kind: 'slides', order }]);
    queueMicrotask(() => region.current?.querySelectorAll<HTMLElement>('[data-slide]')[to]?.focus());
  };

  return (
    <div ref={region} role="region" aria-label="Presenter" class="presenter" tabIndex={-1} data-region="panel">
      <h2 class="presenter-title">Presenter</h2>
      <div class="presenter-head">
        <p class="presenter-state">
          {presentation.state === 'waiting' ? 'Waiting to go live' : presentation.state === 'paused' ? 'Paused' : presentation.state === 'ended' ? 'Ended' : 'Live'}
        </p>
        <p class="figure">Slide {Math.min(presentation.slide_index + 1, Math.max(slides.length, 1))} of {slides.length}</p>
        <p class="figure">{presentation.followers} following</p>
      </div>
      <p class="presenter-link">
        <a href={link} target="_blank" rel="noopener noreferrer">
          {link}
        </a>
      </p>
      <div class="presenter-actions">
        <button type="button" class="btn btn-secondary" onClick={() => void navigator.clipboard.writeText(link)}>
          Copy link
        </button>
        <button type="button" class="btn btn-primary" disabled={presentation.state === 'live' || presentation.state === 'ended'} onClick={() => void presentationCall(session, `/api/presentations/${presentation.id}/state`, { to: 'live' }).then(() => region.current?.focus())}>
          Go live
        </button>
        <button type="button" class="btn btn-secondary btn-danger" onClick={() => void endPresentation(session)}>
          End presentation
        </button>
      </div>
      <h3 class="presenter-heading">Slides</h3>
      <ul aria-label="Slides" class="slide-list">
        {slides.map((id, at) => {
          const topic = session.display.topics[id];
          return (
            <li
              key={id}
              data-slide={id}
              tabIndex={0}
              class={`slide${at === presentation.slide_index ? ' current' : ''}`}
              onKeyDown={(event) => {
                if (!event.altKey) return;
                if (event.key === 'ArrowUp') {
                  event.preventDefault();
                  reorder(at, at - 1);
                } else if (event.key === 'ArrowDown') {
                  event.preventDefault();
                  reorder(at, at + 1);
                }
              }}
            >
              <span class="figure">{at + 1}.</span> {topic ? topic.title : 'Deleted topic'}
            </li>
          );
        })}
      </ul>
      <button
        type="button"
        class="btn btn-secondary"
        onClick={() => {
          const id = session.focusId;
          if (id && session.display.topics[id] && !slides.includes(id)) session.submit([{ op_id: newOpId(), kind: 'slides', order: [...slides, id] }]);
        }}
      >
        Add slide
      </button>
      <h3 class="presenter-heading">Speaker notes</h3>
      <div role="region" aria-label="Speaker notes" class="speaker-notes">
        {parseNote(note).length > 0 ? <NoteView text={note} /> : null}
      </div>
    </div>
  );
}
