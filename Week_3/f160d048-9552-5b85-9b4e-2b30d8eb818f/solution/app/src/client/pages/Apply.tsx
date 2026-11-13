import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { announce } from "../announce";
import { api, get } from "../api";
import { Band, FieldError, TextArea, TextField } from "../components/ui";
import { useLoad } from "../hooks";
import { Link } from "../router";
import { Loading, NotFound, Screen } from "../shell/Page";
import type { ApplicationCreated, JobDetail } from "../../shared/api";
import type { FieldErrors } from "../../shared/rules";

export function Apply({ id }: { id: string }) {
  const job = useLoad(() => get<JobDetail>(`/api/jobs/${id}`), [id]);
  const key = useRef(crypto.randomUUID());
  const [values, setValues] = useState({ candidate_name: "", contact_email: "", phone: "", cover_note: "" });
  const [file, setFile] = useState<File | undefined>();
  const [errors, setErrors] = useState<FieldErrors>({});
  const [failure, setFailure] = useState<{ error: string; message: string } | undefined>();
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState<ApplicationCreated | undefined>();
  const heading = useRef<HTMLHeadingElement>(null);
  const fileId = "resume-file";

  useEffect(() => {
    if (sent) heading.current?.focus();
  }, [sent]);

  async function send(event?: FormEvent) {
    event?.preventDefault();
    setErrors({});
    setFailure(undefined);
    setPending(true);
    announce("Sending your application");
    const form = new FormData();
    form.set("candidate_name", values.candidate_name);
    form.set("contact_email", values.contact_email);
    form.set("phone", values.phone);
    form.set("cover_note", values.cover_note);
    if (file) form.set("resume", file);
    const result = await api<ApplicationCreated>("POST", `/api/jobs/${id}/applications`, form, { "Idempotency-Key": key.current });
    setPending(false);
    if (result.ok) setSent(result.data);
    else if (result.fields) setErrors(result.fields);
    else if (result.error === "resume_not_pdf" || result.error === "resume_too_large") setErrors({ resume: result.message });
    else setFailure({ error: result.error, message: result.message });
  }

  if (job.failure?.status === 404) return <NotFound />;
  if (!job.data) return <Loading />;
  const title = job.data.title;

  if (sent) {
    return (
      <Screen title="Application sent" narrow>
        <h1 tabIndex={-1} ref={heading}>Application sent</h1>
        <p>{`Your application for ${title} at ${job.data.company_name} is with the employer team. Each stage move shows on My applications.`}</p>
        <div className="row">
          <a className="btn-quiet" href={`/api/files/${sent.resume_file_id}`}>Download resume</a>
          <Link to={`/applications/${sent.id}`} className="btn">See your application</Link>
        </div>
      </Screen>
    );
  }

  const resumeError = errors["resume"];
  return (
    <Screen title="Apply" narrow band={failure ? <Band>{failure.message}</Band> : null}>
      <h1>{`Apply for ${title}`}</h1>
      <form onSubmit={(event) => void send(event)} noValidate>
        <TextField label="Full name" value={values.candidate_name} onChange={(event) => setValues({ ...values, candidate_name: event.target.value })} error={errors["candidate_name"]} />
        <TextField label="Contact email" type="email" value={values.contact_email} onChange={(event) => setValues({ ...values, contact_email: event.target.value })} error={errors["contact_email"]} />
        <TextField label="Phone (optional)" type="tel" value={values.phone} onChange={(event) => setValues({ ...values, phone: event.target.value })} error={errors["phone"]} />
        <TextArea label="Note to the employer (optional)" value={values.cover_note} onChange={(event) => setValues({ ...values, cover_note: event.target.value })} error={errors["cover_note"]} />
        <div className="field">
          <label htmlFor={fileId}>Resume (PDF, up to 5 MB)</label>
          <input
            id={fileId}
            type="file"
            accept="application/pdf"
            aria-describedby={resumeError ? `${fileId}-error` : undefined}
            aria-invalid={resumeError ? true : undefined}
            onChange={(event: ChangeEvent<HTMLInputElement>) => setFile(event.target.files?.[0])}
          />
          <FieldError id={`${fileId}-error`}>{resumeError}</FieldError>
          <FieldError id="key-error">{errors["idempotency_key"]}</FieldError>
        </div>
        <div className="row">
          <button type="submit" className="btn" disabled={pending}>Send application</button>
          {pending ? <span className="working">Sending your application</span> : null}
          {failure?.error === "storage_unavailable" ? (
            <button type="button" className="btn-quiet" disabled={pending} onClick={() => void send()}>Try again</button>
          ) : null}
        </div>
      </form>
    </Screen>
  );
}
