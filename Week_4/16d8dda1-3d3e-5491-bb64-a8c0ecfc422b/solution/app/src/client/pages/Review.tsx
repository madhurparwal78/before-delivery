import { useEffect, useState } from 'react';
import type { ReviewBody } from '../../shared/wire';
import { Alert, Empty, NotFound, Skeleton } from '../ui/feedback';
import { useLoad } from './useLoad';

const isTextField = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

function Stepper({ review }: { review: ReviewBody }) {
  const [at, setAt] = useState(0);
  const total = review.slides.length;
  const slide = review.slides[at];

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey || isTextField(event.target)) return;
      if (event.key === 'ArrowLeft') setAt((current) => Math.max(0, current - 1));
      if (event.key === 'ArrowRight') setAt((current) => Math.min(total - 1, current + 1));
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [total]);

  return (
    <>
      {slide ? (
        <>
          <div className="board-frame">
            <img src={slide.url} alt={`Slide ${slide.number}`} />
          </div>
          <p className="slide-position mono">
            Slide {slide.number} of {total}
          </p>
          <div className="row">
            <button type="button" onClick={() => setAt(at - 1)} disabled={at === 0}>
              Previous slide
            </button>
            <button type="button" className="primary" onClick={() => setAt(at + 1)} disabled={at === total - 1}>
              Next slide
            </button>
          </div>
        </>
      ) : (
        <Empty drawing="tray">This lesson has no slides.</Empty>
      )}
      {review.models.length > 0 ? (
        <section className="panel" aria-labelledby="models-heading">
          <h2 id="models-heading">3D models</h2>
          <ul className="ruled" aria-label="Models">
            {review.models.map((model) => (
              <li key={model.fileId}>
                <a href={model.url} download>
                  Download model {model.number}
                </a>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}

export function ReviewPage({ sessionId }: { sessionId: string }) {
  const { result } = useLoad<ReviewBody>(`/api/sessions/${sessionId}/review`);
  if (result.state === 'missing') return <NotFound />;
  return (
    <main className="page review">
      {result.state === 'ready' ? <h1>Review: {result.data.lessonTitle}</h1> : <h1>Review</h1>}
      {result.state === 'loading' ? <Skeleton rows={3} label="Loading the review" /> : null}
      {result.state === 'refused' ? <Alert>{result.message}</Alert> : null}
      {result.state === 'ready' ? <Stepper key={sessionId} review={result.data} /> : null}
    </main>
  );
}
