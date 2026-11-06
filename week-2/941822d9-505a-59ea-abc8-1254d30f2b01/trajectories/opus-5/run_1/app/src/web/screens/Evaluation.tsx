import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { request } from '../lib/api.js';
import { useFeedback } from '../lib/feedback.js';
import { navigate } from '../lib/router.js';
import { markPressPending } from '../lib/press.js';
import type { Certificate, Enrolment } from '../lib/types.js';

function evaluationCopy(code: string): string | null {
  if (code === 'lessons_unverified') return 'Finish every lesson before the post-evaluation.';
  return null;
}

export function Evaluation({ enrolmentId }: { readonly enrolmentId: string }): ReactNode {
  const feedback = useFeedback();
  const [enrolment, setEnrolment] = useState<Enrolment | null>(null);
  const [rating, setRating] = useState<number | null>(null);
  const [metOutcomes, setMetOutcomes] = useState<boolean | null>(null);
  const [comment, setComment] = useState('');
  const [pending, setPending] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    const result = await request<{ enrolment: Enrolment }>(`/api/enrolments/${enrolmentId}`);
    setEnrolment(result.enrolment);
  }, [enrolmentId]);

  useEffect(() => {
    void load().catch(() => undefined);
  }, [load]);

  async function submit(): Promise<void> {
    if (pending || rating === null || metOutcomes === null) return;
    setPending(true);
    feedback.announce('Submitting your evaluation…');
    try {
      const result = await request<{ certificate: Certificate }>(
        `/api/enrolments/${enrolmentId}/evaluation`,
        {
          method: 'POST',
          body: { rating, met_outcomes: metOutcomes, comment: comment === '' ? null : comment },
        },
      );
      markPressPending(enrolmentId);
      navigate(`/learn/${enrolmentId}/seal`);
      if (result.certificate.state === 'sealing') {
        feedback.announce(
          'Your evaluation is recorded. The certificate PDF is still being stored. Your hours appear on your transcript once it is sealed, and we\u2019ll email you then.',
        );
      } else {
        feedback.clear();
      }
    } catch (error) {
      feedback.report(error, evaluationCopy);
    } finally {
      setPending(false);
    }
  }

  if (enrolment === null) return <p className="hint">Loading the post-evaluation…</p>;

  return (
    <div className="grid">
      <div className="col-main">
        <h1>Post-evaluation</h1>
        <p className="hint">{enrolment.course_title}</p>
        <div className="region">
          <div role="radiogroup" aria-label="Overall rating">
            <p>
              <strong>Overall rating</strong>
            </p>
            <div className="radio-row">
              {[1, 2, 3, 4, 5].map((value) => (
                <label key={value}>
                  <input
                    type="radio"
                    name="rating"
                    checked={rating === value}
                    onChange={() => setRating(value)}
                  />
                  <span>{value}</span>
                </label>
              ))}
            </div>
          </div>
        </div>
        <div className="region">
          <div role="radiogroup" aria-label="Did this activity meet its stated outcomes?">
            <p>
              <strong>Did this activity meet its stated outcomes?</strong>
            </p>
            <div className="radio-row">
              <label>
                <input
                  type="radio"
                  name="outcomes"
                  checked={metOutcomes === true}
                  onChange={() => setMetOutcomes(true)}
                />
                <span>Yes</span>
              </label>
              <label>
                <input
                  type="radio"
                  name="outcomes"
                  checked={metOutcomes === false}
                  onChange={() => setMetOutcomes(false)}
                />
                <span>No</span>
              </label>
            </div>
          </div>
        </div>
        <div className="field">
          <label htmlFor="evaluation-comment">Comments (optional)</label>
          <textarea
            id="evaluation-comment"
            value={comment}
            onChange={(event) => setComment(event.target.value)}
          />
        </div>
        <button
          type="button"
          disabled={pending || rating === null || metOutcomes === null}
          onClick={() => void submit()}
        >
          {pending ? 'Submitting your evaluation…' : 'Submit evaluation'}
        </button>
      </div>
    </div>
  );
}
