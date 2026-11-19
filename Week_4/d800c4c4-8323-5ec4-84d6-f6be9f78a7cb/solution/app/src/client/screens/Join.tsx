import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { request } from "../api";
import { Announcements, FieldMessage, FormProblems, PegStrip, type Problem } from "../components/ui";
import { goToAccountAfterJoin } from "../nav";

const TIERS = [
  { value: "pay-what-you-can", name: "Pay what you can", price: "$15.00" },
  { value: "standard", name: "Standard", price: "$40.00" },
  { value: "supporter", name: "Supporter", price: "$75.00" },
] as const;

const FIELD_LABELS: Record<string, string> = { name: "Name", email: "Email", password: "Password", tier: "Membership tier" };

export function Join() {
  const [tier, setTier] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [news, setNews] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const busy = useRef(false);
  const summary = useRef<HTMLDivElement>(null);
  const focusSummary = useRef(false);
  useLayoutEffect(() => {
    if (focusSummary.current) {
      focusSummary.current = false;
      summary.current?.focus();
    }
  });

  const submit = async (event: Event) => {
    event.preventDefault();
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    const answer = await request("POST", "/api/members", { name, email, password, tier: tier || null });
    if (answer.status === 202) {
      goToAccountAfterJoin();
      return;
    }
    busy.current = false;
    setPending(false);
    if (answer.status === 422) {
      setFields(answer.fields);
      setNews("");
      focusSummary.current = true;
    } else {
      setFields({});
      setNews(answer.error);
    }
  };

  const problems: Problem[] = Object.entries(fields).map(([field, message]) => ({
    field,
    label: FIELD_LABELS[field] ?? field,
    message,
    target: field === "tier" ? `tier-${tier || TIERS[0].value}` : `join-${field}`,
  }));
  const describe = (field: string) => (fields[field] ? `join-${field}-message` : undefined);

  return (
    <div class="page narrow">
      <PegStrip />
      <h1>Join Pegworth</h1>
      <p class="lede">A year of borrowing from the wall. Choose what you can pay; every tier lends the same tools.</p>
      <Announcements label="Account updates" text={news} signInAgain={null} />
      <FormProblems problems={problems} summaryRef={summary} />
      <form class="form-stack" onSubmit={submit} noValidate>
        <div role="radiogroup" aria-label="Membership tier" class="tiers" aria-describedby={fields.tier ? "join-tier-message" : undefined}>
          <span class="field-label" aria-hidden="true">
            Membership tier
          </span>
          {TIERS.map((t) => (
            <label class="tier" key={t.value}>
              <input type="radio" name="tier" id={`tier-${t.value}`} value={t.value} checked={tier === t.value} onChange={() => setTier(t.value)} />
              <span>
                {t.name} — <span class="num">{t.price}</span> a year
              </span>
            </label>
          ))}
          <FieldMessage id="join-tier" message={fields.tier} />
        </div>
        <label class="field">
          <span class="field-label">Name</span>
          <input id="join-name" autoComplete="name" value={name} onInput={(e) => setName(e.currentTarget.value)} aria-describedby={describe("name")} />
        </label>
        <FieldMessage id="join-name" message={fields.name} />
        <label class="field">
          <span class="field-label">Email</span>
          <input id="join-email" type="email" autoComplete="email" value={email} onInput={(e) => setEmail(e.currentTarget.value)} aria-describedby={describe("email")} />
        </label>
        <FieldMessage id="join-email" message={fields.email} />
        <label class="field">
          <span class="field-label">Password</span>
          <input
            id="join-password"
            type="password"
            autoComplete="new-password"
            value={password}
            onInput={(e) => setPassword(e.currentTarget.value)}
            aria-describedby={describe("password")}
          />
        </label>
        <FieldMessage id="join-password" message={fields.password} />
        <button type="submit" class={`btn btn-primary${pending ? " is-pending" : ""}`} aria-busy={pending ? "true" : undefined} aria-disabled={pending ? "true" : undefined}>
          {pending ? "Starting your membership..." : "Pay and join"}
        </button>
      </form>
    </div>
  );
}
