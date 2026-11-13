import { useState, type ChangeEvent, type FormEvent } from "react";
import { announce } from "../announce";
import { api, get, post } from "../api";
import { ActionButton, Band, Choices, FieldError, SelectField, TextArea, TextField } from "../components/ui";
import { useAction, useLoad } from "../hooks";
import { Link, navigate } from "../router";
import { useSession } from "../session";
import { Loading, Screen } from "../shell/Page";
import { showToast } from "../toast";
import { CITIES, ROLE_FAMILIES, WORK_PATTERNS } from "../../shared/reference";
import { parseJob, type FieldErrors } from "../../shared/rules";
import type { Company, EmployerJob } from "../../shared/api";

const STATUS_NAMES = { draft: "Draft", listed: "Listed", closed: "Closed" } as const;

function Verification({ onVerified }: { onVerified: () => void }) {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sentTo, setSentTo] = useState("");
  const [emailError, setEmailError] = useState<string | undefined>();
  const [codeError, setCodeError] = useState<string | undefined>();
  const request = useAction();
  const confirm = useAction();

  async function send(event: FormEvent) {
    event.preventDefault();
    setEmailError(undefined);
    const result = await request.run(() => post("/api/employer/verification/request", { email }));
    if (result.ok) {
      setSentTo(email);
      announce(`A code is on its way to ${email}.`);
    } else {
      setEmailError(result.fields?.["email"] ?? result.message);
    }
  }

  async function verify(event: FormEvent) {
    event.preventDefault();
    setCodeError(undefined);
    const result = await confirm.run(() => post("/api/employer/verification/confirm", { code }));
    if (result.ok) {
      announce("Your team is verified.");
      onVerified();
    } else {
      setCodeError(result.message);
    }
  }

  return (
    <section aria-label="Verify your team" className="form-narrow">
      <h2>Verify your team</h2>
      <form onSubmit={(event) => void send(event)} noValidate>
        <TextField label="Work email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} error={emailError} />
        <ActionButton type="submit" busy={request.busy}>Send code</ActionButton>
        {sentTo ? <p>{`A code is on its way to ${sentTo}.`}</p> : null}
      </form>
      <form onSubmit={(event) => void verify(event)} noValidate style={{ marginTop: 24 }}>
        <TextField label="Verification code" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(event) => setCode(event.target.value)} error={codeError} />
        <ActionButton type="submit" busy={confirm.busy}>Verify</ActionButton>
      </form>
    </section>
  );
}

export function Employer() {
  const { me } = useSession();
  const company = useLoad(() => get<Company>(`/api/companies/${me?.company_slug}`), [me?.company_slug]);
  const jobs = useLoad(() => get<{ jobs: EmployerJob[] }>("/api/employer/jobs"), []);
  const [failure, setFailure] = useState("");
  const [markError, setMarkError] = useState<string | undefined>();
  const action = useAction();
  const data = company.data;

  async function change(job: EmployerJob, path: "close" | "list") {
    setFailure("");
    const result = await action.run(() => post<EmployerJob>(`/api/employer/jobs/${job.id}/${path}`));
    if (result.ok) announce(path === "close" ? `${job.title} is closed.` : `${job.title} is listed.`);
    else setFailure(result.message);
    jobs.reload();
  }

  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setMarkError(undefined);
    const result = await action.run(() => api<{ mark_url: string }>("PUT", "/api/employer/company/mark", file, { "Content-Type": "image/png" }));
    if (result.ok) {
      announce("Mark updated.");
      company.reload();
    } else {
      setMarkError(result.message);
    }
  }

  // Draw the page once both loads land, so the verification block and the job list cannot push it down.
  if (company.loading || jobs.loading) return <Loading />;
  return (
    <Screen title="Employer" band={failure ? <Band>{failure}</Band> : null}>
      <h1 className="page-title">{data?.name ?? "Employer"}</h1>
      {data?.verified ? <p className="verified">Verified employer</p> : null}
      {data && !data.verified && me?.role === "employer_admin" ? <Verification onVerified={company.reload} /> : null}
      {data && !data.verified && me?.role === "recruiter" ? <p>Your team is not verified yet. An employer admin can verify it by email.</p> : null}
      <section>
        <h2 style={{ margin: "32px 0 16px" }}>Your jobs</h2>
        <div className="row" style={{ marginBottom: 16 }}>
          <Link to="/employer/jobs/new" className="btn">List a job</Link>
        </div>
        <ul className="items" aria-label="Your jobs">
          {(jobs.data?.jobs ?? []).map((job) => (
            <li key={job.id} data-id={job.id}>
              <Link className="item-title" to={`/employer/jobs/${job.id}`}>{job.title}</Link>
              <p className="meta">{STATUS_NAMES[job.status]}</p>
              <div className="row">
                {job.status === "draft" ? (
                  <button type="button" className="btn-quiet" aria-label={`List ${job.title} again`} onClick={() => void change(job, "list")}><span className="painted" data-text="List again" /></button>
                ) : null}
                {job.status !== "closed" ? (
                  <button type="button" className="btn-quiet" aria-label={`Close ${job.title}`} onClick={() => void change(job, "close")}>Close</button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      </section>
      <section style={{ marginTop: 40 }}>
        <h2>Lab mark</h2>
        {data?.mark_url ? <img className="mark" src={data.mark_url} alt={`${data.name} mark`} width="64" height="64" /> : <p>No mark yet. The drawn glassware stands in.</p>}
        <div className="field">
          <label htmlFor="mark-file">Lab mark (PNG)</label>
          <input id="mark-file" type="file" accept="image/png" onChange={(event) => void upload(event)} aria-describedby={markError ? "mark-error" : undefined} />
          <FieldError id="mark-error">{markError}</FieldError>
        </div>
      </section>
    </Screen>
  );
}

export function NewJob() {
  const [values, setValues] = useState({ title: "", role_family: "", city: "", remote: "", pay_low: "", pay_high: "", description: "" });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [failure, setFailure] = useState("");
  const { busy, run } = useAction();
  const set = (name: keyof typeof values, value: string) => setValues({ ...values, [name]: value });
  const amount = (text: string): number => (text.trim() === "" ? Number.NaN : Number(text));

  async function send(event: FormEvent) {
    event.preventDefault();
    setFailure("");
    const body = { ...values, pay_low: amount(values.pay_low), pay_high: amount(values.pay_high) };
    const checked = parseJob(body);
    if (!checked.ok) {
      setErrors(checked.fields);
      return;
    }
    setErrors({});
    const result = await run(() => post<{ title: string }>("/api/employer/jobs", body));
    if (result.ok) {
      showToast(`${result.data.title} is listed.`);
      navigate("/employer");
    } else if (result.fields) {
      setErrors(result.fields);
    } else {
      setFailure(result.message);
    }
  }

  return (
    <Screen title="List a job" band={failure ? <Band>{failure}</Band> : null}>
      <h1 className="page-title">List a job</h1>
      <form className="form-narrow" onSubmit={(event) => void send(event)} noValidate>
        <TextField label="Title" value={values.title} onChange={(event) => set("title", event.target.value)} error={errors["title"]} />
        <SelectField label="Role" placeholder="Choose a role" options={ROLE_FAMILIES} value={values.role_family} onChange={(event) => set("role_family", event.target.value)} error={errors["role_family"]} />
        <SelectField label="City" placeholder="Choose a city" options={CITIES} value={values.city} onChange={(event) => set("city", event.target.value)} error={errors["city"]} />
        <Choices legend="Work pattern" name="work-pattern" value={values.remote} onChange={(value) => set("remote", value)} options={WORK_PATTERNS} error={errors["remote"]} />
        <TextField label="Pay from (rupees a year)" type="number" inputMode="numeric" value={values.pay_low} onChange={(event) => set("pay_low", event.target.value)} error={errors["pay_low"]} />
        <TextField label="Pay to (rupees a year)" type="number" inputMode="numeric" value={values.pay_high} onChange={(event) => set("pay_high", event.target.value)} error={errors["pay_high"]} />
        <TextArea label="Description" value={values.description} onChange={(event) => set("description", event.target.value)} error={errors["description"]} />
        <ActionButton type="submit" busy={busy}>List job</ActionButton>
      </form>
    </Screen>
  );
}
