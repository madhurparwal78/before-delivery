// Rates: add a dated rate set, read the history, and edit kiln profiles.
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import type { Kiln, Profile, RateSet } from "../../shared/api";
import { request } from "../api";
import { Dialog } from "../components/Dialog";
import { centsFromDollars, money } from "../format";

const studioDay = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" });

function firingTime(hours: string): string {
  const minutes = Math.round(Number(hours) * 60);
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

interface Form {
  bisque: string;
  glaze: string;
  discount: string;
  minimum: string;
  date: string;
}

const FIELD_FOR: Record<string, keyof Form> = {
  bisque_rate: "bisque",
  glaze_rate: "glaze",
  member_discount_percent: "discount",
  order_minimum_cents: "minimum",
  effective_date: "date",
};

function ProfileDialog({ kiln, profile, onClose, onSaved }: { kiln: Kiln; profile: Profile; onClose: () => void; onSaved: (p: Profile) => void }) {
  const [segments, setSegments] = useState<{ rate: string; target: string; hold: string }[]>(
    profile.segments.map((s) => ({ rate: String(s.rate_f_per_hour), target: String(s.target_f), hold: String(s.hold_minutes) })),
  );
  const [coolDown, setCoolDown] = useState(String(profile.cool_down_hours));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<{ text: string; tone: string }>({ text: "", tone: "" });

  const update = (index: number, key: "rate" | "target" | "hold", value: string) =>
    setSegments((current) => current.map((s, i) => (i === index ? { ...s, [key]: value } : s)));

  const save = async () => {
    setMessage({ text: "Saving profile…", tone: "" });
    setErrors({});
    const asNumber = (v: string) => (v.trim() === "" ? null : Number(v));
    const body = {
      segments: segments.map((s) => ({ rate_f_per_hour: asNumber(s.rate), target_f: asNumber(s.target), hold_minutes: asNumber(s.hold) })),
      cool_down_hours: asNumber(coolDown),
    };
    const result = await request<Profile>("PUT", `/api/kilns/${kiln.id}/profiles/${profile.id}`, body);
    if (result.ok) {
      setMessage({ text: "Profile saved. It applies to firings started from now on.", tone: "ok" });
      onSaved(result.data);
    } else if (result.error?.fields) {
      setErrors(result.error.fields);
      setMessage({ text: Object.values(result.error.fields).join(" "), tone: "error" });
    } else {
      setMessage({ text: result.error?.message ?? "Not saved — the studio server is unreachable.", tone: "error" });
    }
  };

  return (
    <Dialog title="Edit profile" onClose={onClose}>
      {(close) => (
        <>
          <p className="muted">
            {profile.name} on {kiln.name} · fires to <span className="num">cone {profile.cone}</span>
          </p>
          {errors.segments ? <p className="field-error">{errors.segments}</p> : null}
          <ol className="segments">
            {segments.map((segment, index) => (
              <li key={index} className="segment">
                <span className="segment-title">Segment {index + 1}</span>
                {(
                  [
                    ["rate", "Rate (°F per hour)", "rate_f_per_hour"],
                    ["target", "Target (°F)", "target_f"],
                    ["hold", "Hold (minutes)", "hold_minutes"],
                  ] as const
                ).map(([key, label, field]) => {
                  const id = `segment-${index}-${key}`;
                  const error = errors[`segments.${index}.${field}`];
                  return (
                    <div className="field" key={key}>
                      <label htmlFor={id}>{label}</label>
                      <input id={id} className="input num" type="number" inputMode="numeric" value={segment[key]} onChange={(e) => update(index, key, e.target.value)} aria-invalid={error ? true : undefined} aria-describedby={error ? `${id}-error` : undefined} />
                      {error ? <p className="field-error" id={`${id}-error`}>{error}</p> : null}
                    </div>
                  );
                })}
                <button type="button" className="btn btn-quiet" onClick={() => setSegments((c) => c.filter((_s, i) => i !== index))} disabled={segments.length <= 1} aria-label={`Remove segment ${index + 1}`}>
                  Remove
                </button>
              </li>
            ))}
          </ol>
          <button type="button" className="btn" onClick={() => setSegments((c) => [...c, { rate: "", target: "", hold: "0" }])} disabled={segments.length >= 8}>
            Add segment
          </button>
          <div className="field">
            <label htmlFor="cool-down">Cool-down (hours)</label>
            <input id="cool-down" className="input num" type="number" inputMode="numeric" value={coolDown} onChange={(e) => setCoolDown(e.target.value)} aria-invalid={errors.cool_down_hours ? true : undefined} aria-describedby={errors.cool_down_hours ? "cool-down-error" : undefined} />
            {errors.cool_down_hours ? <p className="field-error" id="cool-down-error">{errors.cool_down_hours}</p> : null}
          </div>
          <p role="status" aria-label="Profile result" className={`result${message.tone ? ` is-${message.tone}` : ""}`}>
            {message.text}
          </p>
          <div className="dialog-actions">
            <button type="button" className="btn btn-primary" onClick={() => void save()}>
              Save profile
            </button>
            <button type="button" className="btn btn-quiet" onClick={close}>
              Close
            </button>
          </div>
        </>
      )}
    </Dialog>
  );
}

export function Rates() {
  const [form, setForm] = useState<Form>({ bisque: "", glaze: "", discount: "", minimum: "", date: "" });
  const [errors, setErrors] = useState<Partial<Record<keyof Form, string>>>({});
  const [message, setMessage] = useState<{ text: string; tone: string }>({ text: "", tone: "" });
  const [history, setHistory] = useState<RateSet[] | null>(null);
  const [current, setCurrent] = useState<RateSet | null>(null);
  const [kilns, setKilns] = useState<Kiln[] | null>(null);
  const [editing, setEditing] = useState<{ kiln: Kiln; profile: Profile } | null>(null);

  const loadHistory = async () => {
    const [h, c] = await Promise.all([request<RateSet[]>("GET", "/api/rates"), request<RateSet>("GET", "/api/rates/current")]);
    if (h.ok) setHistory(h.data);
    if (c.ok) setCurrent(c.data);
    return { c, h };
  };

  useEffect(() => {
    void loadHistory().then(({ c, h }) => {
      const today = h.ok && h.date ? studioDay.format(h.date) : "";
      if (c.ok) {
        setForm({
          bisque: c.data.bisque_rate,
          glaze: c.data.glaze_rate,
          discount: String(c.data.member_discount_percent),
          minimum: money(c.data.order_minimum_cents).slice(1),
          date: today,
        });
      }
    });
    void request<Kiln[]>("GET", "/api/kilns").then((r) => setKilns(r.ok ? r.data : []));
  }, []);

  const set = (key: keyof Form, value: string) => setForm((f) => ({ ...f, [key]: value }));

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setErrors({});
    setMessage({ text: "Saving rates…", tone: "" });
    const body = {
      bisque_rate: form.bisque.trim(),
      glaze_rate: form.glaze.trim(),
      member_discount_percent: form.discount.trim() === "" ? null : Number(form.discount),
      order_minimum_cents: centsFromDollars(form.minimum),
      effective_date: form.date,
    };
    const result = await request<RateSet>("POST", "/api/rates", body);
    if (result.ok) {
      setMessage({ text: `Rates saved. They apply to pieces accepted from ${result.data.effective_date}.`, tone: "ok" });
      void loadHistory();
    } else if (result.error?.error === "rate_date_taken") {
      setMessage({ text: `Rates already set for ${form.date}.`, tone: "error" });
    } else if (result.error?.fields) {
      const mapped: Partial<Record<keyof Form, string>> = {};
      for (const [field, text] of Object.entries(result.error.fields)) mapped[FIELD_FOR[field] ?? "date"] = text;
      setErrors(mapped);
      setMessage({ text: Object.values(result.error.fields).join(" "), tone: "error" });
    } else {
      setMessage({ text: result.error?.message ?? "Not saved — the studio server is unreachable.", tone: "error" });
    }
  };

  const input = (key: keyof Form, id: string, label: string, props: Record<string, string>, hint?: ReactNode) => (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input id={id} className="input num" value={form[key]} onChange={(e) => set(key, e.target.value)} aria-invalid={errors[key] ? true : undefined} aria-describedby={errors[key] ? `${id}-error` : hint ? `${id}-hint` : undefined} {...props} />
      {hint && !errors[key] ? <p className="hint" id={`${id}-hint`}>{hint}</p> : null}
      {errors[key] ? <p className="field-error" id={`${id}-error`}>{errors[key]}</p> : null}
    </div>
  );

  return (
    <div className="page rates-page">
      <div className="page-head">
        <h1>Rates</h1>
        <p className="muted">A new rate set applies to pieces accepted on or after its date; earlier pieces keep their fees.</p>
      </div>
      <div className="rates-layout">
        <form className="pane" aria-label="Firing rates" onSubmit={save} noValidate>
          <h2>Firing rates</h2>
          <div className="rates-grid">
            {input("bisque", "rate-bisque", "Bisque rate ($ per in³)", { type: "text", inputMode: "decimal" }, "Up to four decimals, at most 1.0000")}
            {input("glaze", "rate-glaze", "Glaze rate ($ per in³)", { type: "text", inputMode: "decimal" }, "Up to four decimals, at most 1.0000")}
            {input("discount", "rate-discount", "Member discount (%)", { type: "number", min: "0", max: "50", step: "1" }, "Whole percent, 0 to 50")}
            {input("minimum", "rate-minimum", "Order minimum ($)", { type: "text", inputMode: "decimal" }, <>
              Per intake or drop-off, <span className="num">$0.00</span> to <span className="num">$100.00</span>
            </>)}
            {input("date", "rate-date", "Effective date", { type: "date" }, "Today or later, studio time")}
          </div>
          <div className="submit-row">
            <button type="submit" className="btn btn-primary">
              Save rates
            </button>
            <p role="status" aria-label="Rates result" className={`result${message.tone ? ` is-${message.tone}` : ""}`}>
              {message.text}
            </p>
          </div>
        </form>
        <section className="pane" aria-labelledby="history-title">
          <h2 id="history-title">Rate history</h2>
          <div className="table-wrap" tabIndex={0}>
            <table className="table" aria-label="Rate history">
              <thead>
                <tr>
                  <th scope="col">Effective</th>
                  <th scope="col" className="right">Bisque $/in³</th>
                  <th scope="col" className="right">Glaze $/in³</th>
                  <th scope="col" className="right">Discount</th>
                  <th scope="col" className="right">Minimum</th>
                </tr>
              </thead>
              <tbody>
                {(history ?? []).map((rate) => (
                  <tr key={rate.id} className={current?.id === rate.id ? "current" : ""}>
                    <td>
                      <span className="num">{rate.effective_date}</span>
                      {current?.id === rate.id ? <span className="badge paid"> In effect</span> : null}
                    </td>
                    <td className="num right">${rate.bisque_rate}</td>
                    <td className="num right">${rate.glaze_rate}</td>
                    <td className="num right">{rate.member_discount_percent}%</td>
                    <td className="num right">{money(rate.order_minimum_cents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
      {/* Shown once the rate history above has its rows, so the history never pushes it down. */}
      {kilns !== null && history !== null ? (
      <section className="pane" aria-labelledby="profiles-title">
        <h2 id="profiles-title">Kiln profiles</h2>
        <div className="profile-grid">
          {kilns.map((kiln) => (
            <div key={kiln.id} className="profile-kiln">
              <h3>{kiln.name}</h3>
              <ul className="profile-list">
                {kiln.profiles.map((profile) => (
                  <li key={profile.id}>
                    <div>
                      <span className="profile-name">{profile.name}</span>
                      <span className="small muted">
                        {" "}
                        · {profile.segments.length} segments · fires <span className="num">{firingTime(profile.firing_hours)}</span> · cools{" "}
                        <span className="num">{profile.cool_down_hours} h</span>
                      </span>
                    </div>
                    <button type="button" className="btn" onClick={() => setEditing({ kiln, profile })} aria-label={`Edit ${profile.name} on ${kiln.name}`}>
                      Edit
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>
      ) : null}
      {editing ? (
        <ProfileDialog
          kiln={editing.kiln}
          profile={editing.profile}
          onClose={() => setEditing(null)}
          onSaved={(saved) => setKilns((current) => (current ?? []).map((k) => ({ ...k, profiles: k.profiles.map((p) => (p.id === saved.id ? saved : p)) })))}
        />
      ) : null}
    </div>
  );
}
