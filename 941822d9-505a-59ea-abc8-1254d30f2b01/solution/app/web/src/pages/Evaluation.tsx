import { useState, type FormEvent } from "react";
import { api, type Certificate, type Enrolment } from "../api";
import { Alert, describeFailure, FieldError, useFeedback } from "../ui/feedback";
import { navigate, PageHeading } from "../ui/router";
import { useLoad } from "../ui/useLoad";
import { LearnFrame } from "./Player";

/** Marks that this browser just submitted the evaluation, so the completion screen plays the Seal press once. */
export const pressKey = (enrolmentId: string): string => `credwell:seal-press:${enrolmentId}`;

const EVALUATION_COPY: Record<string, string> = {
  lessons_unverified: "Finish every lesson before the post-evaluation.",
  enrolment_inactive: "This enrolment is no longer active, so the post-evaluation can't be submitted.",
};

export function Evaluation({ enrolmentId }: { enrolmentId: string }) {
  const { announce } = useFeedback();
  const page = useLoad(() => api<{ enrolment: Enrolment }>("GET", `/api/enrolments/${encodeURIComponent(enrolmentId)}`));
  const [rating, setRating] = useState<number | null>(null);
  const [met, setMet] = useState<boolean | null>(null);
  const [comment, setComment] = useState("");
  const [pending, setPending] = useState(false);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [alert, setAlert] = useState<string | null>(null);

  if (!page.data) return page.failure ? <Alert>{page.failure}</Alert> : <p aria-busy="true" className="muted">Loading the post-evaluation…</p>;
  const { enrolment } = page.data;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (pending || rating === null || met === null) return;
    setPending(true);
    setAlert(null);
    try {
      const response = await fetchEvaluation(enrolment.id, { rating, met_outcomes: met, comment: comment.trim() === "" ? null : comment });
      sessionStorage.setItem(pressKey(enrolment.id), "1");
      if (response.state === "sealing") {
        announce("Your evaluation is recorded. The certificate PDF is still being stored. Your hours appear on your transcript once it is sealed, and we'll email you then.");
      }
      navigate(`/learn/${enrolment.id}/seal`);
    } catch (error) {
      const failure = describeFailure(error, EVALUATION_COPY);
      setFields(failure.fields);
      setAlert(failure.alert);
      setPending(false);
    }
  };

  return (
    <LearnFrame enrolment={enrolment} current="evaluation">
      <form className="lesson" onSubmit={submit} noValidate>
        <div className="stack">
          <p className="eyebrow">Last step</p>
          <PageHeading>Post-evaluation</PageHeading>
          <p className="lede muted">Your answers help Sorrel &amp; Pike improve this activity. Time spent here counts toward your contact hours.</p>
        </div>
        {alert && <Alert>{alert}</Alert>}
        <div className="check">
          <p id="rating-label" className="check-prompt">
            Overall rating
          </p>
          <div role="radiogroup" aria-labelledby="rating-label" aria-describedby="rating-hint" className="choices inline">
            {[1, 2, 3, 4, 5].map((n) => (
              <label key={n} className="choice">
                <input type="radio" name="rating" checked={rating === n} onChange={() => setRating(n)} />
                <span>{n}</span>
              </label>
            ))}
          </div>
          <p id="rating-hint" className="hint">
            1 is poor, 5 is excellent.
          </p>
          <FieldError id="rating-error" message={fields.rating} />
        </div>
        <div className="check">
          <p id="outcomes-label" className="check-prompt">
            Did this activity meet its stated outcomes?
          </p>
          <div role="radiogroup" aria-labelledby="outcomes-label" className="choices inline pair">
            {[
              ["Yes", true],
              ["No", false],
            ].map(([label, value]) => (
              <label key={String(label)} className="choice">
                <input type="radio" name="outcomes" checked={met === value} onChange={() => setMet(value === true)} />
                <span>{label}</span>
              </label>
            ))}
          </div>
          <FieldError id="outcomes-error" message={fields.met_outcomes} />
        </div>
        <div className="field">
          <label htmlFor="comment">Comments (optional)</label>
          <textarea id="comment" value={comment} onChange={(e) => setComment(e.target.value)} aria-describedby={fields.comment ? "comment-error" : undefined} />
          <FieldError id="comment-error" message={fields.comment} />
        </div>
        <div>
          <button type="submit" className={`btn${pending ? " busy" : ""}`} disabled={pending || rating === null || met === null}>
            {pending ? "Submitting your evaluation…" : "Submit evaluation"}
          </button>
        </div>
      </form>
    </LearnFrame>
  );
}

async function fetchEvaluation(enrolmentId: string, body: Record<string, unknown>): Promise<Certificate> {
  const response = await api<{ certificate: Certificate }>("POST", `/api/enrolments/${enrolmentId}/evaluation`, body);
  return response.certificate;
}
