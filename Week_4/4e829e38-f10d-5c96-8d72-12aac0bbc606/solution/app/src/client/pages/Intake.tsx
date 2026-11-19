import { useRef, useState } from "preact/hooks";
import { api, get } from "../api";
import { useMount } from "../hooks";
import { Pill, useBusy } from "../ui";
import { EmptyState } from "./NotFound";
import { navigate } from "../router";

interface Form { title: string; categories: string[] }

const LINKS: Array<[string, string]> = [["title", "Request title"], ["neededBy", "Needed by"], ["email", "Your email"], ["category", "Category"]];
const IDS: Record<string, string> = { title: "intake-title", neededBy: "intake-needed", email: "intake-email", category: "intake-category" };

export function Intake({ slug }: { slug: string }) {
  const [form, setForm] = useState<Form | "missing" | null>(null);
  const [values, setValues] = useState({ title: "", details: "", neededBy: "", email: "", category: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [reference, setReference] = useState("");
  const [busy, run] = useBusy();
  const summary = useRef<HTMLDivElement>(null);

  useMount(() => {
    void get<Form>(`/api/forms/${slug}`).then((r) => setForm(r.ok ? r.data : "missing"));
  }, [slug]);

  const submit = (event: Event) => {
    event.preventDefault();
    void run(async () => {
      const result = await api<{ reference: string }>("POST", `/api/forms/${slug}/submissions`, {
        title: values.title, details: values.details, neededBy: values.neededBy, email: values.email, category: values.category || undefined,
      });
      setErrors(result.errors);
      if (result.ok) setReference(result.data.reference);
      else queueMicrotask(() => summary.current?.focus());
    });
  };

  if (form === null) return <div class="page narrow"><p class="muted">Loading</p></div>;
  if (form === "missing") return <div class="page narrow"><EmptyState level={1} title="Form not found" action="Back to My work" onAction={() => navigate("/")} /></div>;
  if (reference) {
    return (
      <div class="page narrow">
        <h1>{form.title}</h1>
        <p class="confirmation">{`Request received. Your reference is ${reference}.`}</p>
      </div>
    );
  }
  const problems = LINKS.filter(([key]) => errors[key]);
  const set = (key: keyof typeof values) => (e: Event) => setValues({ ...values, [key]: (e.target as HTMLInputElement).value });
  const mark = (key: string) => ({ "aria-invalid": errors[key] ? ("true" as const) : undefined, "aria-describedby": errors[key] ? `${IDS[key]}-error` : undefined });
  return (
    <div class="page narrow intake-page">
      <h1>{form.title}</h1>
      {problems.length > 0 && (
        <div ref={summary} role="alert" tabIndex={-1} class="error-summary">
          <h2>There is a problem</h2>
          <ul>
            {problems.map(([key]) => (
              <li key={key}>
                <a href={`#${IDS[key]}`} onClick={(e) => { e.preventDefault(); document.getElementById(IDS[key])?.focus(); }}>{errors[key]}</a>
              </li>
            ))}
          </ul>
        </div>
      )}
      <form class="card form-card" onSubmit={submit} noValidate>
        <div class="field">
          <label for="intake-title">Request title</label>
          <input id="intake-title" value={values.title} onInput={set("title")} {...mark("title")} />
          {errors.title && <p id="intake-title-error" class="field-error">{errors.title}</p>}
        </div>
        <div class="field">
          <label for="intake-details">Details</label>
          <textarea id="intake-details" rows={4} value={values.details} onInput={set("details")} />
        </div>
        <div class="field">
          <label for="intake-needed">Needed by</label>
          <input id="intake-needed" placeholder="YYYY-MM-DD" value={values.neededBy} onInput={set("neededBy")} {...mark("neededBy")} />
          {errors.neededBy && <p id="intake-needed-error" class="field-error">{errors.neededBy}</p>}
        </div>
        <div class="field">
          <label for="intake-email">Your email</label>
          <input id="intake-email" type="text" inputMode="email" value={values.email} onInput={set("email")} {...mark("email")} />
          {errors.email && <p id="intake-email-error" class="field-error">{errors.email}</p>}
        </div>
        <div class="field">
          <label for="intake-category">Category</label>
          <select id="intake-category" value={values.category} onChange={set("category")} {...mark("category")}>
            <option value="">Choose a category</option>
            {form.categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          {errors.category && <p id="intake-category-error" class="field-error">{errors.category}</p>}
        </div>
        <Pill type="submit" busy={busy} onClick={submit}>Submit request</Pill>
      </form>
    </div>
  );
}
