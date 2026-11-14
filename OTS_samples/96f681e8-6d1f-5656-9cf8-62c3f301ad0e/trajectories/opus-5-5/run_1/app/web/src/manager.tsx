import { useCallback, useEffect, useState } from "preact/hooks";
import {
  addDays,
  api,
  clubDateTime,
  codePoints,
  dateMessage,
  errorText,
  get,
  goSignIn,
  navigate,
  todayClub,
  validDate,
} from "./lib";
import { Alert, FieldError, PendingButton } from "./ui";

type PricingEntry = {
  version: number;
  effective_from: string;
  offpeak_cents_per_minute: number;
  peak_cents_per_minute: number;
  peak_start: string;
  peak_end: string;
  peak_days: string[];
  saved_by: { name: string } | null;
  saved_at: string;
};

type Pricing = PricingEntry & { schedule: PricingEntry[] };

type Rule = { version: number; late_fee_percent: number; description: string; saved_by: { name: string } | null; saved_at: string };

const DAYS: [string, string][] = [
  ["mon", "Mon"],
  ["tue", "Tue"],
  ["wed", "Wed"],
  ["thu", "Thu"],
  ["fri", "Fri"],
  ["sat", "Sat"],
  ["sun", "Sun"],
];

function focusFirst(formId: string, errors: Record<string, string>, order: string[]) {
  const first = order.find((f) => errors[f]);
  if (first) requestAnimationFrame(() => document.querySelector<HTMLElement>(`#${formId} [data-field="${first}"]`)?.focus());
}

function PricesForm() {
  const [data, setData] = useState<Pricing | null>(null);
  const [form, setForm] = useState({ offpeak: "", peak: "", start: "", end: "", days: [] as string[], from: "" });
  const [version, setVersion] = useState(0);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [alert, setAlert] = useState("");
  const [stale, setStale] = useState(false);
  const [saved, setSaved] = useState(false);
  const [pending, setPending] = useState(false);

  const load = useCallback(async () => {
    const a = await get<Pricing>("/api/manager/pricing");
    if (a.status !== 200) return setAlert(errorText(a));
    setData(a.data);
    setVersion(a.data.version);
    setForm({
      offpeak: String(a.data.offpeak_cents_per_minute),
      peak: String(a.data.peak_cents_per_minute),
      start: a.data.peak_start,
      end: a.data.peak_end,
      days: a.data.peak_days,
      from: addDays(todayClub(), 1),
    });
    setStale(false);
    setAlert("");
    setErrors({});
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const save = async () => {
    if (pending) return;
    setErrors({});
    setAlert("");
    setSaved(false);
    setPending(true);
    const num = (s: string) => (s.trim() === "" || isNaN(Number(s)) ? s : Number(s));
    const a = await api<Pricing>("PUT", "/api/manager/pricing", {
      version,
      offpeak_cents_per_minute: num(form.offpeak),
      peak_cents_per_minute: num(form.peak),
      peak_start: form.start.trim(),
      peak_end: form.end.trim(),
      peak_days: form.days,
      effective_from: form.from.trim(),
    });
    setPending(false);
    if (a.status === 401) return goSignIn();
    if (a.status === 200) {
      setData(a.data);
      setVersion(a.data.version);
      setSaved(true);
      return;
    }
    if (a.status === 412) {
      setStale(true);
      setAlert(errorText(a));
      return;
    }
    if (a.status === 422 && a.error?.errors) {
      setErrors(a.error.errors);
      focusFirst("prices-form", a.error.errors, [
        "offpeak_cents_per_minute", "peak_cents_per_minute", "peak_start", "peak_end", "peak_days", "effective_from",
      ]);
      if (a.error.errors.version) setAlert(a.error.errors.version);
      return;
    }
    setAlert(errorText(a));
  };

  const set = (k: keyof typeof form) => (e: Event) => setForm({ ...form, [k]: (e.target as HTMLInputElement).value });
  return (
    <form id="prices-form" aria-label="Prices" class="card form-card" noValidate onSubmit={(e) => { e.preventDefault(); save(); }}>
      <h2>Prices</h2>
      <div class="form-grid">
        <div class="field">
          <label for="p-off">Off-peak cents per minute</label>
          <input id="p-off" type="number" data-field="offpeak_cents_per_minute" value={form.offpeak} onInput={set("offpeak")} />
          {errors.offpeak_cents_per_minute && <FieldError text={errors.offpeak_cents_per_minute} />}
        </div>
        <div class="field">
          <label for="p-peak">Peak cents per minute</label>
          <input id="p-peak" type="number" data-field="peak_cents_per_minute" value={form.peak} onInput={set("peak")} />
          {errors.peak_cents_per_minute && <FieldError text={errors.peak_cents_per_minute} />}
        </div>
        <div class="field">
          <label for="p-start">Peak starts</label>
          <input id="p-start" type="text" data-field="peak_start" value={form.start} onInput={set("start")} />
          {errors.peak_start && <FieldError text={errors.peak_start} />}
        </div>
        <div class="field">
          <label for="p-end">Peak ends</label>
          <input id="p-end" type="text" data-field="peak_end" value={form.end} onInput={set("end")} />
          {errors.peak_end && <FieldError text={errors.peak_end} />}
        </div>
      </div>
      <fieldset class="days">
        <legend>Peak days</legend>
        {DAYS.map(([k, label], i) => (
          <label class="check">
            <input
              type="checkbox"
              data-field={i === 0 ? "peak_days" : undefined}
              checked={form.days.includes(k)}
              onChange={(e) => {
                const on = (e.target as HTMLInputElement).checked;
                setForm({ ...form, days: on ? DAYS.map(([d]) => d).filter((d) => d === k || form.days.includes(d)) : form.days.filter((d) => d !== k) });
              }}
            />
            {label}
          </label>
        ))}
      </fieldset>
      {errors.peak_days && <FieldError text={errors.peak_days} />}
      <div class="field">
        <label for="p-from">Effective from</label>
        <input id="p-from" type="text" data-field="effective_from" value={form.from} onInput={set("from")} />
        {errors.effective_from && <FieldError text={errors.effective_from} />}
      </div>
      <Alert text={alert} />
      <div class="form-actions">
        <PendingButton label="Save prices" pendingLabel="Saving..." pending={pending} onClick={save} />
        {stale && (
          <button type="button" class="pill pill-outline" onClick={load}>
            Reload
          </button>
        )}
        {saved && <span class="saved">Saved.</span>}
      </div>
      {data && (
        <table class="data-table compact" aria-label="Price schedule">
          <thead>
            <tr>
              <th scope="col">Version</th>
              <th scope="col">From</th>
              <th scope="col">Off-peak</th>
              <th scope="col">Peak</th>
              <th scope="col">Saved by</th>
              <th scope="col">Saved at</th>
            </tr>
          </thead>
          <tbody>
            {data.schedule.map((v) => (
              <tr>
                <td>{v.version}</td>
                <td>{v.effective_from}</td>
                <td>{v.offpeak_cents_per_minute}</td>
                <td>{v.peak_cents_per_minute}</td>
                <td>{v.saved_by ? v.saved_by.name : "Seed"}</td>
                <td>{clubDateTime(v.saved_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </form>
  );
}

function RuleForm() {
  const [rule, setRule] = useState<Rule | null>(null);
  const [fee, setFee] = useState("");
  const [description, setDescription] = useState("");
  const [version, setVersion] = useState(0);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [alert, setAlert] = useState("");
  const [stale, setStale] = useState(false);
  const [saved, setSaved] = useState(false);
  const [pending, setPending] = useState(false);

  const load = useCallback(async () => {
    const a = await get<Rule>("/api/manager/cancellation-rule");
    if (a.status !== 200) return setAlert(errorText(a));
    setRule(a.data);
    setVersion(a.data.version);
    setFee(String(a.data.late_fee_percent));
    setDescription(a.data.description);
    setStale(false);
    setAlert("");
    setErrors({});
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const save = async () => {
    if (pending) return;
    setErrors({});
    setAlert("");
    setSaved(false);
    setPending(true);
    const a = await api<Rule>("PUT", "/api/manager/cancellation-rule", {
      version,
      late_fee_percent: fee.trim() === "" || isNaN(Number(fee)) ? fee : Number(fee),
      description,
    });
    setPending(false);
    if (a.status === 401) return goSignIn();
    if (a.status === 200) {
      setRule(a.data);
      setVersion(a.data.version);
      setSaved(true);
      return;
    }
    if (a.status === 412) {
      setStale(true);
      setAlert(errorText(a));
      return;
    }
    if (a.status === 422 && a.error?.errors) {
      setErrors(a.error.errors);
      focusFirst("rule-form", a.error.errors, ["late_fee_percent", "description"]);
      return;
    }
    setAlert(errorText(a));
  };

  return (
    <form id="rule-form" aria-label="Cancellation rule" class="card form-card" noValidate onSubmit={(e) => { e.preventDefault(); save(); }}>
      <h2>Cancellation rule</h2>
      <div class="field">
        <label for="r-fee">Late fee percent</label>
        <input id="r-fee" type="number" data-field="late_fee_percent" value={fee} onInput={(e) => setFee((e.target as HTMLInputElement).value)} />
        {errors.late_fee_percent && <FieldError text={errors.late_fee_percent} />}
      </div>
      <div class="field">
        <label for="r-desc">Rule description</label>
        <textarea id="r-desc" rows={4} data-field="description" value={description} onInput={(e) => setDescription((e.target as HTMLTextAreaElement).value)} />
        <span class="counter">{codePoints(description)}/280</span>
        {errors.description && <FieldError text={errors.description} />}
      </div>
      <Alert text={alert} />
      <div class="form-actions">
        <PendingButton label="Save rule" pendingLabel="Saving..." pending={pending} onClick={save} />
        {stale && (
          <button type="button" class="pill pill-outline" onClick={load}>
            Reload
          </button>
        )}
        {saved && <span class="saved">Saved.</span>}
      </div>
      {rule && (
        <p class="caption">
          Last saved by {rule.saved_by ? rule.saved_by.name : "Seed"}, {clubDateTime(rule.saved_at)}.
        </p>
      )}
    </form>
  );
}

type Utilisation = {
  date: string;
  courts: { court: number; booked_minutes: number; open_minutes: number; percent: number }[];
  total: { booked_minutes: number; open_minutes: number; percent: number };
};

function UtilisationPanel({ query }: { query: URLSearchParams }) {
  const raw = query.get("date");
  const valid = raw === null || validDate(raw);
  const date = raw && valid ? raw : todayClub();
  const [field, setField] = useState(raw ?? date);
  const [data, setData] = useState<Utilisation | null>(null);
  useEffect(() => setField(raw ?? date), [raw]);
  useEffect(() => {
    (async () => {
      const a = await get<Utilisation>(`/api/manager/utilisation?date=${date}`);
      if (a.status === 200) setData(a.data);
    })();
  }, [date]);
  const commit = () => {
    const v = field.trim();
    if (v !== (raw ?? "")) navigate(`/manager?date=${encodeURIComponent(v)}`);
  };
  return (
    <section class="card utilisation" aria-labelledby="util-heading">
      <h2 id="util-heading">Utilisation</h2>
      <div class="field">
        <label for="u-date">Utilisation date</label>
        <input
          id="u-date"
          type="text"
          value={field}
          aria-invalid={!valid}
          onInput={(e) => setField((e.target as HTMLInputElement).value)}
          onChange={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            }
          }}
        />
        {!valid && <FieldError text={dateMessage} />}
      </div>
      {data && (
        <table class="data-table compact" aria-label="Utilisation">
          <thead>
            <tr>
              <th scope="col">Court</th>
              <th scope="col">Booked minutes</th>
              <th scope="col">Open minutes</th>
              <th scope="col">Used</th>
            </tr>
          </thead>
          <tbody>
            {data.courts.map((c) => (
              <tr>
                <td>Court {c.court}</td>
                <td>{c.booked_minutes}</td>
                <td>{c.open_minutes}</td>
                <td>{c.percent}%</td>
              </tr>
            ))}
            <tr class="total-row">
              <td>All courts</td>
              <td>{data.total.booked_minutes}</td>
              <td>{data.total.open_minutes}</td>
              <td>{data.total.percent}%</td>
            </tr>
          </tbody>
        </table>
      )}
    </section>
  );
}

export function ManagerPage({ query }: { query: URLSearchParams }) {
  return (
    <div class="column page">
      <h1>Club settings</h1>
      <div class="two-up">
        <PricesForm />
        <RuleForm />
      </div>
      <UtilisationPanel query={query} />
    </div>
  );
}
