import { useEffect, useRef, useState, type FormEvent, type RefObject } from "react";
import { announce } from "../announce";
import { get, post } from "../api";
import { Combobox } from "../components/Combobox";
import { RatingGroup } from "../components/Rating";
import { ActionButton, Band, Choices, SelectField, TextArea, TextField } from "../components/ui";
import { useAction } from "../hooks";
import { Link, navigate } from "../router";
import { Screen } from "../shell/Page";
import { showToast } from "../toast";
import {
  REVIEW_STEPS, interviewNoteShape, parseShape, payReportShape, reviewShape, type FieldErrors,
} from "../../shared/rules";
import { CITIES, OUTCOMES, POST_KIND_NAMES, ROLE_FAMILIES, type PostKind } from "../../shared/reference";
import type { PostCreated } from "../../shared/api";

type CompanyChoice = { text: string; id: string };
const NO_COMPANY: CompanyChoice = { text: "", id: "" };

function CompanyPicker({ value, onChange, error, inputRef }: { value: CompanyChoice; onChange: (next: CompanyChoice) => void; error?: string; inputRef?: RefObject<HTMLInputElement | null> }) {
  return (
    <Combobox
      label="Company"
      value={value.text}
      inputRef={inputRef}
      error={error}
      onChange={(text) => onChange({ text, id: "" })}
      onPick={(option) => onChange({ text: option.label, id: option.id })}
      load={async (text) => {
        const answer = await get<{ options: { id: string; name: string }[] }>(`/api/companies/options?q=${encodeURIComponent(text)}`);
        return answer.ok ? answer.data.options.map((entry) => ({ id: entry.id, label: entry.name })) : [];
      }}
    />
  );
}

function useSubmitPost(kind: PostKind) {
  const { busy, run } = useAction();
  const [failure, setFailure] = useState("");
  async function submit(body: Record<string, unknown>): Promise<{ fields?: FieldErrors; field?: string } | undefined> {
    setFailure("");
    const result = await run(() => post<PostCreated>("/api/posts", { kind, ...body }));
    if (result.ok) {
      showToast(`Thanks. Your ${POST_KIND_NAMES[kind]} is waiting for a moderator.`);
      navigate("/me/contributions");
      return undefined;
    }
    setFailure(result.message);
    return { fields: result.fields, field: result.field };
  }
  return { busy, failure, submit };
}

const toNumber = (text: string): number => (text.trim() === "" ? Number.NaN : Number(text));

function Chooser() {
  return (
    <Screen title="Share">
      <h1 className="page-title">Share something</h1>
      <p>Your first approved post unlocks full pay and review detail for every lab. Posts stay anonymous.</p>
      <div className="items">
        <Link to="/contribute/review" className="btn">Write a review</Link>
        <Link to="/contribute/pay" className="btn">Report your pay</Link>
        <Link to="/contribute/interview" className="btn">Add an interview note</Link>
      </div>
    </Screen>
  );
}

const STEP_NAMES = ["Company", "Ratings", "Your review", "Check and post"] as const;
const RATING_GROUPS = [
  { name: "overall", label: "Overall rating" },
  { name: "work_life", label: "Work-life balance rating" },
  { name: "pay", label: "Pay rating" },
  { name: "management", label: "Management rating" },
] as const;

function ReviewForm() {
  const [step, setStep] = useState(1);
  const [company, setCompany] = useState<CompanyChoice>(NO_COMPANY);
  const [ratings, setRatings] = useState<Record<string, number | undefined>>({});
  const [text, setText] = useState({ title: "", pros: "", cons: "" });
  const [errors, setErrors] = useState<FieldErrors>({});
  const heading = useRef<HTMLHeadingElement>(null);
  const focusTarget = useRef<"heading" | "invalid" | undefined>(undefined);
  const refs = {
    company_id: useRef<HTMLInputElement>(null),
    overall: useRef<HTMLInputElement>(null),
    work_life: useRef<HTMLInputElement>(null),
    pay: useRef<HTMLInputElement>(null),
    management: useRef<HTMLInputElement>(null),
    title: useRef<HTMLInputElement>(null),
    pros: useRef<HTMLTextAreaElement>(null),
    cons: useRef<HTMLTextAreaElement>(null),
  };
  const { busy, failure, submit } = useSubmitPost("review");
  const values = { company_id: company.id, ...ratings, ...text };

  useEffect(() => {
    const target = focusTarget.current;
    focusTarget.current = undefined;
    if (target === "heading") heading.current?.focus();
    if (target === "invalid") {
      const first = Object.keys(refs).find((name) => errors[name] !== undefined);
      if (first) refs[first as keyof typeof refs].current?.focus();
    }
  });

  function next() {
    const checked = parseShape(reviewShape, values, REVIEW_STEPS[step - 1]);
    if (!checked.ok) {
      setErrors(checked.fields);
      focusTarget.current = "invalid";
      return;
    }
    setErrors({});
    focusTarget.current = "heading";
    setStep(step + 1);
  }

  function back() {
    setErrors({});
    focusTarget.current = "heading";
    setStep(step - 1);
  }

  async function send(event: FormEvent) {
    event.preventDefault();
    const failed = await submit(values);
    if (!failed) return;
    const fields: FieldErrors = failed.fields ?? (failed.field ? { [failed.field]: failure } : {});
    const earliest = REVIEW_STEPS.findIndex((names) => names.some((name) => fields[name] !== undefined));
    if (earliest >= 0) {
      setErrors(fields);
      focusTarget.current = "invalid";
      setStep(earliest + 1);
    }
  }

  return (
    <Screen title="Write a review" band={failure && step === 4 ? <Band>{failure}</Band> : null}>
      <h1 className="page-title">Write a review</h1>
      <ol className="steps" aria-label="Review steps">
        {STEP_NAMES.map((name, index) => (
          <li key={name} aria-current={step === index + 1 ? "step" : undefined}>{name}</li>
        ))}
      </ol>
      <form className="form-narrow" onSubmit={(event) => void send(event)} noValidate>
        <h2 className="steps-heading" tabIndex={-1} ref={heading}>{`Step ${step} of 4: ${STEP_NAMES[step - 1]}`}</h2>
        {step === 1 ? <CompanyPicker value={company} onChange={setCompany} error={errors["company_id"]} inputRef={refs.company_id} /> : null}
        {step === 2
          ? RATING_GROUPS.map((group) => (
              <RatingGroup
                key={group.name}
                label={group.label}
                value={ratings[group.name]}
                onChange={(value) => setRatings({ ...ratings, [group.name]: value })}
                error={errors[group.name]}
                firstRef={refs[group.name]}
              />
            ))
          : null}
        {step === 3 ? (
          <>
            <TextField label="Title" value={text.title} onChange={(event) => setText({ ...text, title: event.target.value })} error={errors["title"]} inputRef={refs.title} />
            <TextArea label="Pros" value={text.pros} onChange={(event) => setText({ ...text, pros: event.target.value })} error={errors["pros"]} inputRef={refs.pros} />
            <TextArea label="Cons" value={text.cons} onChange={(event) => setText({ ...text, cons: event.target.value })} error={errors["cons"]} inputRef={refs.cons} />
          </>
        ) : null}
        {step === 4 ? (
          <dl className="summary-list">
            <dt>Company</dt>
            <dd>{company.text}</dd>
            {RATING_GROUPS.map((group) => (
              <div key={group.name}>
                <dt>{group.label}</dt>
                <dd className="figure">{ratings[group.name]} of 5</dd>
              </div>
            ))}
            <dt>Title</dt>
            <dd>{text.title}</dd>
            <dt>Pros</dt>
            <dd>{text.pros}</dd>
            <dt>Cons</dt>
            <dd>{text.cons}</dd>
          </dl>
        ) : null}
        <div className="row">
          {step > 1 ? <button type="button" className="btn-quiet" onClick={back}>Back</button> : null}
          {step < 4 ? (
            <button type="button" className="btn" onClick={next}>Next</button>
          ) : (
            <ActionButton type="submit" busy={busy}>Post review</ActionButton>
          )}
        </div>
      </form>
    </Screen>
  );
}

function PayForm() {
  const [company, setCompany] = useState<CompanyChoice>(NO_COMPANY);
  const [role, setRole] = useState("");
  const [city, setCity] = useState("");
  const [pay, setPay] = useState("");
  const [years, setYears] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const { busy, failure, submit } = useSubmitPost("pay_report");

  async function send(event: FormEvent) {
    event.preventDefault();
    const body = { company_id: company.id, role_family: role, city, annual_pay: toNumber(pay), years_experience: toNumber(years) };
    const checked = parseShape(payReportShape, body);
    if (!checked.ok) {
      setErrors(checked.fields);
      return;
    }
    setErrors({});
    const failed = await submit(body);
    if (failed?.fields) setErrors(failed.fields);
    else if (failed?.field) setErrors({ [failed.field]: failure });
  }

  return (
    <Screen title="Report your pay" band={failure && Object.keys(errors).length === 0 ? <Band>{failure}</Band> : null}>
      <h1 className="page-title">Report your pay</h1>
      <form className="form-narrow" onSubmit={(event) => void send(event)} noValidate>
        <CompanyPicker value={company} onChange={setCompany} error={errors["company_id"]} />
        <SelectField label="Role" placeholder="Choose a role" options={ROLE_FAMILIES} value={role} onChange={(event) => setRole(event.target.value)} error={errors["role_family"]} />
        <SelectField label="City" placeholder="Choose a city" options={CITIES} value={city} onChange={(event) => setCity(event.target.value)} error={errors["city"]} />
        <TextField label="Annual pay in rupees" type="number" inputMode="numeric" value={pay} onChange={(event) => setPay(event.target.value)} error={errors["annual_pay"]} />
        <TextField label="Years of experience" type="number" inputMode="numeric" value={years} onChange={(event) => setYears(event.target.value)} error={errors["years_experience"]} />
        <ActionButton type="submit" busy={busy}>Post pay report</ActionButton>
      </form>
    </Screen>
  );
}

function InterviewForm() {
  const [company, setCompany] = useState<CompanyChoice>(NO_COMPANY);
  const [role, setRole] = useState("");
  const [difficulty, setDifficulty] = useState<number | undefined>();
  const [outcome, setOutcome] = useState("");
  const [text, setText] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const { busy, failure, submit } = useSubmitPost("interview_note");

  async function send(event: FormEvent) {
    event.preventDefault();
    const body = { company_id: company.id, role_family: role, difficulty, outcome, text };
    const checked = parseShape(interviewNoteShape, body);
    if (!checked.ok) {
      setErrors(checked.fields);
      announce(Object.values(checked.fields)[0] ?? "");
      return;
    }
    setErrors({});
    const failed = await submit(body);
    if (failed?.fields) setErrors(failed.fields);
    else if (failed?.field) setErrors({ [failed.field === "text" ? "text" : failed.field]: failure });
  }

  return (
    <Screen title="Add an interview note" band={failure && Object.keys(errors).length === 0 ? <Band>{failure}</Band> : null}>
      <h1 className="page-title">Add an interview note</h1>
      <form className="form-narrow" onSubmit={(event) => void send(event)} noValidate>
        <CompanyPicker value={company} onChange={setCompany} error={errors["company_id"]} />
        <SelectField label="Role" placeholder="Choose a role" options={ROLE_FAMILIES} value={role} onChange={(event) => setRole(event.target.value)} error={errors["role_family"]} />
        <RatingGroup label="Difficulty rating" value={difficulty} onChange={setDifficulty} error={errors["difficulty"]} />
        <Choices legend="Outcome" name="outcome" value={outcome} onChange={setOutcome} options={OUTCOMES} error={errors["outcome"]} />
        <TextArea label="What happened" value={text} onChange={(event) => setText(event.target.value)} error={errors["text"]} />
        <ActionButton type="submit" busy={busy}>Post interview note</ActionButton>
      </form>
    </Screen>
  );
}

export function Contribute({ kind }: { kind: "chooser" | PostKind }) {
  if (kind === "review") return <ReviewForm />;
  if (kind === "pay_report") return <PayForm />;
  if (kind === "interview_note") return <InterviewForm />;
  return <Chooser />;
}
