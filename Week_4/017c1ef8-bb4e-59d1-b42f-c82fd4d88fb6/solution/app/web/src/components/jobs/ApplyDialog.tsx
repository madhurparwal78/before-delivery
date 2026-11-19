import { useEffect, useRef, useState } from 'react';
import { ApiError, api, newIdempotencyKey } from '../../api';
import { announce } from '../../announce';
import { useConfig } from '../../clock';
import { formatCount } from '../../format';
import { Alert, Button, Dialog } from '../../ui';
import { SOMETHING_WENT_WRONG, STORAGE_UNAVAILABLE, fieldMessages, type JobObject, type Question } from './jobModel';

type Answer = string | number;
type Answers = Record<string, Answer | undefined>;

interface ApplyDialogProps {
  job: JobObject;
  open: boolean;
  onClose: () => void;
  onApplied: () => void;
}

const isBlank = (value: Answer | undefined): boolean => value === undefined || value === '';

/** The answers the page sends: blank answers are left out; a number question sends a JSON number. */
function payloadOf(questions: Question[], answers: Answers): Record<string, Answer> {
  const sent: Record<string, Answer> = {};
  for (const question of questions) {
    const value = answers[question.id];
    if (isBlank(value)) continue;
    sent[question.id] = question.type === 'number' ? Number(value) : (value as Answer);
  }
  return sent;
}

function QuestionControl({ question, value, error, onChange }: { question: Question; value: Answer | undefined; error?: string; onChange: (value: Answer) => void }) {
  const errorId = `answer-${question.id}-error`;
  const common = { 'aria-describedby': error ? errorId : undefined, 'aria-invalid': error ? true : undefined, 'aria-required': question.required || undefined };
  return (
    <div className="question" data-question-id={question.id}>
      {question.type === 'short_answer' ? (
        <>
          <label htmlFor={`answer-${question.id}`} className="field-label">
            {question.text}
          </label>
          <textarea id={`answer-${question.id}`} className="input" rows={3} value={String(value ?? '')} onChange={(event) => onChange(event.target.value)} {...common} />
        </>
      ) : null}
      {question.type === 'number' ? (
        <>
          <label htmlFor={`answer-${question.id}`} className="field-label">
            {question.text}
          </label>
          <input id={`answer-${question.id}`} className="input" type="number" inputMode="numeric" step="any" value={String(value ?? '')} onChange={(event) => onChange(event.target.value)} {...common} />
        </>
      ) : null}
      {question.type === 'yes_no' || question.type === 'single_choice' ? (
        <div role="radiogroup" aria-label={question.text} className="choices" {...common}>
          <span className="field-label" aria-hidden="true">
            {question.text}
          </span>
          {(question.type === 'yes_no' ? ['Yes', 'No'] : (question.options ?? [])).map((option) => {
            const optionValue = question.type === 'yes_no' ? option.toLowerCase() : option;
            return (
              <label key={option} className="choice">
                <input type="radio" name={`answer-${question.id}`} checked={value === optionValue} onChange={() => onChange(optionValue)} />
                {option}
              </label>
            );
          })}
        </div>
      ) : null}
      {error ? (
        <p id={errorId} className="field-message">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Apply: the resume uploads at once and is confirmed by storage, then the screening answers and Submit. */
export function ApplyDialog({ job, open, onClose, onApplied }: ApplyDialogProps) {
  const config = useConfig();
  const [resumeId, setResumeId] = useState<string | null>(null);
  const [resumeName, setResumeName] = useState('');
  const [uploading, setUploading] = useState(false);
  const [resumeAlert, setResumeAlert] = useState('');
  const [answers, setAnswers] = useState<Answers>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitAlert, setSubmitAlert] = useState('');
  const [pending, setPending] = useState(false);
  const [refusals, setRefusals] = useState(0);
  const key = useRef<string | null>(null);
  const body = useRef<HTMLDivElement>(null);

  const upload = async (file: File): Promise<void> => {
    setUploading(true);
    setResumeAlert('');
    setResumeId(null);
    announce('Jobs announcements', 'Uploading…');
    try {
      const stored = await api.upload<{ resume_id: string }>('/api/uploads/resume', file, file.name);
      setResumeId(stored.resume_id);
      setResumeName(file.name);
      announce('Jobs announcements', 'Resume attached.');
    } catch (error) {
      const refusal = error instanceof ApiError ? error : null;
      const tooLarge = (limit: unknown): string => `Resumes can be up to ${formatCount(typeof limit === 'number' ? limit : config.resume_max_bytes)} bytes.`;
      if (refusal?.body.error === 'resume_type') setResumeAlert('Upload a PDF file.');
      else if (refusal?.body.error === 'resume_too_large') setResumeAlert(tooLarge(refusal.body.limit));
      else if (refusal?.body.error === 'payload_too_large') setResumeAlert(tooLarge(undefined));
      else if (refusal?.body.error === 'storage_unavailable') setResumeAlert(STORAGE_UNAVAILABLE);
      else setResumeAlert(SOMETHING_WENT_WRONG);
    } finally {
      setUploading(false);
    }
  };

  // Focus goes to the first failing question's control once its message has rendered.
  useEffect(() => {
    if (refusals === 0) return;
    const failing = job.questions.find((question) => errors[`answers.${question.id}`]);
    if (!failing) return;
    body.current?.querySelector<HTMLElement>(`[data-question-id="${failing.id}"]`)?.querySelector<HTMLElement>('textarea, input')?.focus();
  }, [refusals]);

  const submit = async (): Promise<void> => {
    if (pending || !resumeId) return;
    setPending(true);
    setSubmitAlert('');
    setErrors({});
    key.current ??= newIdempotencyKey();
    try {
      await api.post(`/api/jobs/${job.id}/applications`, { resume_id: resumeId, answers: payloadOf(job.questions, answers) }, { idempotencyKey: key.current });
      key.current = null;
      announce('Jobs announcements', 'Application submitted.');
      onApplied();
    } catch (error) {
      if (error instanceof ApiError) key.current = null;
      announce('Jobs announcements', 'Application not submitted.');
      const refusal = error instanceof ApiError ? error : null;
      if (refusal?.body.error === 'already_applied') setSubmitAlert('You already applied to this job.');
      else if (refusal?.body.error === 'job_closed') setSubmitAlert('This job stopped accepting applications.');
      else if (refusal?.body.error === 'validation') {
        const messages = fieldMessages(refusal);
        setErrors(messages);
        if (messages.answers) setSubmitAlert(messages.answers);
        setRefusals((count) => count + 1);
      } else setSubmitAlert(SOMETHING_WENT_WRONG);
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog name={`Apply to ${job.title}`} open={open} onClose={onClose} className="apply-dialog">
      <div ref={body} className="stack">
        <h2 className="t-larger">{`Apply to ${job.title}`}</h2>
        <div className="field">
          <label htmlFor="apply-resume" className="field-label">
            Resume (PDF)
          </label>
          <input
            id="apply-resume"
            type="file"
            accept="application/pdf"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (file) void upload(file);
            }}
          />
          {uploading ? <p className="muted">Uploading…</p> : null}
          {resumeId && !uploading ? <p className="muted">{resumeName}</p> : null}
          <Alert>{resumeAlert}</Alert>
        </div>
        {job.questions.map((question) => (
          <QuestionControl key={question.id} question={question} value={answers[question.id]} error={errors[`answers.${question.id}`]} onChange={(value) => setAnswers((current) => ({ ...current, [question.id]: value }))} />
        ))}
        {errors.resume_id ? <p className="field-message">{errors.resume_id}</p> : null}
        <Alert>{submitAlert}</Alert>
        <div className="dialog-actions">
          <Button onClick={() => void submit()} disabled={!resumeId || uploading || pending}>
            Submit application
          </Button>
          <Button onClick={onClose}>Cancel</Button>
        </div>
      </div>
    </Dialog>
  );
}
