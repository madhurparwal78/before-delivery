import { useEffect, useRef, useState } from "react";
import type { LedgerEntry, Person, SavedScenario, ScenarioResult, Tender, Valuation, ValuationStatus } from "../../shared/types.js";
import { ROLE_LABEL, displayDate, displayInstant, dollars, groupThousands } from "../../shared/format.js";
import { ApiFailure, api } from "../api.js";
import { announce } from "../announce.js";
import { useResource, useSettled, useSocketGate } from "../hooks.js";
import { useLiveEvent } from "../live.js";
import { pacificToInstant } from "../pacific.js";
import { Link, queryOf, replaceAddress, requestFocus } from "../router.js";
import { useSession } from "../session.js";
import { Band, LabelledValue, SelectField, TextField, ScrollRegion } from "../ui.js";
import { SubmissionsTable } from "./tenders.js";

const loading = (
  <main className="page-state">
    <Band tone="black" className="band-fill band-delayed">
      Loading your register.
    </Band>
  </main>
);

function PageHead({ title }: { title: string }) {
  const { person } = useSession();
  return (
    <section className="sheet">
      <p className="note">{person.name}</p>
      <h1 tabIndex={-1}>{title}</h1>
    </section>
  );
}

/* ------------------------------------------------------------------ ledger */

const ENTRY_LABEL: Record<LedgerEntry["kind"], string> = {
  issuance: "Issuance",
  grant_accepted: "Grant accepted",
  exercise_issued: "Exercise issued",
  options_cancelled: "Options cancelled",
  tender_transfer: "Tender transfer",
  pool_resized: "Pool resized",
};

export function LedgerPage() {
  const ledger = useResource<{ entries: LedgerEntry[] }>("/api/ledger", ["registry"]);
  if (!ledger.data) return loading;
  return (
    <main className="chapter">
      <PageHead title="Securities ledger" />
      <section className="sheet wide">
        <ScrollRegion label="Ledger scroll area">
          <table aria-label="Securities ledger" className="plain-table">
            <thead>
              <tr>
                <th scope="col">When</th>
                <th scope="col">Holder</th>
                <th scope="col">Entry</th>
                <th scope="col">Class</th>
                <th scope="col" className="num">
                  Shares
                </th>
                <th scope="col" className="num">
                  Options
                </th>
                <th scope="col">Reference</th>
              </tr>
            </thead>
            <tbody>
              {ledger.data.entries.map((entry) => (
                <tr key={entry.id}>
                  <td>{displayInstant(entry.at)}</td>
                  <td>{entry.holder_name ?? "—"}</td>
                  <td>{ENTRY_LABEL[entry.kind]}</td>
                  <td>{entry.class ?? "—"}</td>
                  <td className="num">{groupThousands(entry.shares_delta)}</td>
                  <td className="num">{groupThousands(entry.options_delta)}</td>
                  <td>{entry.reference}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollRegion>
      </section>
    </main>
  );
}

/* -------------------------------------------------------------- valuations */

type Valuations = { valuations: Valuation[]; current_id: string | null };
type Filter = "all" | ValuationStatus;
const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: "all", label: "All" },
  { value: "current", label: "Current" },
  { value: "superseded", label: "Superseded" },
  { value: "lapsed", label: "Lapsed" },
];
const STATUS_WORD: Record<ValuationStatus, string> = { current: "Current", superseded: "Superseded", lapsed: "Lapsed" };

export function ValuationsPage({ search }: { search: string }) {
  const gate = useSocketGate();
  const valuations = useResource<Valuations>("/api/valuations", ["valuations"]);
  const asked = queryOf(search).get("status");
  const [filter, setFilter] = useState<Filter>(FILTERS.some((candidate) => candidate.value === asked) ? (asked as Filter) : "all");
  const [form, setForm] = useState({ effective_on: "", expires_on: "", fmv_per_share: "", firm: "" });
  const [errors, setErrors] = useState<Partial<Record<keyof typeof form, string>>>({});
  const [busy, setBusy] = useState(false);

  const choose = (value: Filter) => {
    setFilter(value);
    replaceAddress(`/admin/valuations?status=${value}`);
  };

  const record = async () => {
    setBusy(true);
    try {
      const created = await api<Valuation>("POST", "/api/valuations", form);
      announce(`Valuation recorded: fair market value ${dollars(created.fmv_per_share)} from ${displayDate(created.effective_on)}.`);
      setErrors({});
      setForm({ effective_on: "", expires_on: "", fmv_per_share: "", firm: "" });
      choose("all");
      requestFocus(`[data-valuation="${created.id}"] [data-cell="effective"]`);
    } catch (failure) {
      if (!(failure instanceof ApiFailure) || failure.status !== 422) throw failure;
      const fields = failure.fields as Partial<Record<keyof typeof form, string>>;
      setErrors(fields);
      const first = (["effective_on", "expires_on", "fmv_per_share", "firm"] as const).find((name) => fields[name]);
      if (first) requestFocus(`#valuation-${first}`);
    } finally {
      setBusy(false);
    }
  };

  if (!valuations.data) return loading;
  const rows = valuations.data.valuations.filter((valuation) => filter === "all" || valuation.status === filter);
  const set = (name: keyof typeof form) => (value: string) => setForm((previous) => ({ ...previous, [name]: value }));
  return (
    <main className="chapter">
      <PageHead title="Valuations" />
      <section className="sheet">
        <p className="note">The current valuation is the latest in effect today.</p>
        <fieldset className="field">
          <legend id="valuation-filter-label">Show valuations</legend>
          <div role="radiogroup" aria-labelledby="valuation-filter-label" className="radios radios-row">
            {FILTERS.map((candidate) => (
              <label key={candidate.value} className="radio">
                <input type="radio" name="valuation-status" value={candidate.value} checked={filter === candidate.value} onChange={() => choose(candidate.value)} />
                <span>{candidate.label}</span>
              </label>
            ))}
          </div>
        </fieldset>
      </section>
      <section className="sheet wide">
        {rows.length === 0 ? (
          <p className="empty-line">No valuations with this status.</p>
        ) : (
          <ScrollRegion label="Valuations scroll area">
            <table aria-label="Valuations" className="plain-table">
              <thead>
                <tr>
                  <th scope="col">Effective date</th>
                  <th scope="col">Expiry date</th>
                  <th scope="col" className="num">
                    Fair market value
                  </th>
                  <th scope="col">Firm</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((valuation) => (
                  <tr key={valuation.id} data-valuation={valuation.id}>
                    <td data-cell="effective" tabIndex={-1}>
                      {displayDate(valuation.effective_on)}
                    </td>
                    <td>{displayDate(valuation.expires_on)}</td>
                    <td className="num">{dollars(valuation.fmv_per_share)}</td>
                    <td>{valuation.firm}</td>
                    <td className="status">{STATUS_WORD[valuation.status]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollRegion>
        )}
      </section>
      <section className="sheet">
        <p className="note">A valuation expires; after that no grant can be issued.</p>
        <form
          className="form-column"
          aria-label="Record valuation"
          onSubmit={(event) => {
            event.preventDefault();
            void record();
          }}
        >
          <TextField label="Effective date" id="valuation-effective_on" value={form.effective_on} hint="YYYY-MM-DD" error={errors.effective_on} onValue={set("effective_on")} />
          <TextField label="Expiry date" id="valuation-expires_on" value={form.expires_on} hint="YYYY-MM-DD" error={errors.expires_on} onValue={set("expires_on")} />
          <TextField label="Fair market value per share" id="valuation-fmv_per_share" value={form.fmv_per_share} inputMode="decimal" error={errors.fmv_per_share} onValue={set("fmv_per_share")} />
          <TextField label="Valuation firm" id="valuation-firm" value={form.firm} error={errors.firm} onValue={set("firm")} />
          <button type="submit" className="button button-primary" disabled={gate || busy}>
            Record valuation
          </button>
        </form>
      </section>
    </main>
  );
}

/* ---------------------------------------------------------------- scenario */

type Inputs = { pre: string; investment: string; pool: string };

function inputsOf(search: string): Inputs {
  const params = queryOf(search);
  return { pre: params.get("pre") ?? "", investment: params.get("investment") ?? "", pool: params.get("pool") ?? "" };
}

const scenarioAddress = (inputs: Inputs): string =>
  `/admin/scenario?pre=${encodeURIComponent(inputs.pre)}&investment=${encodeURIComponent(inputs.investment)}&pool=${encodeURIComponent(inputs.pool)}`;

export function ScenarioPage({ search }: { search: string }) {
  const gate = useSocketGate();
  const saved = useResource<{ scenarios: SavedScenario[] }>("/api/scenarios/saved", ["scenarios"]);
  const [inputs, setInputs] = useState<Inputs>(() => inputsOf(search));
  const [result, setResult] = useState<ScenarioResult>();
  const [errors, setErrors] = useState<Partial<Record<"pre_money" | "investment" | "target_pool_percent", string>>>({});
  const [name, setName] = useState("");
  const [nameError, setNameError] = useState<string>();
  const ownSearch = useRef(search);
  const typed = useRef(false);
  const latest = useRef(inputs);
  latest.current = inputs;

  useEffect(() => {
    if (search === ownSearch.current) return;
    ownSearch.current = search;
    typed.current = false;
    setInputs(inputsOf(search));
  }, [search]);

  const compute = async (values: Inputs, onResult?: (result: ScenarioResult) => void) => {
    try {
      const next = await api<ScenarioResult>("POST", "/api/scenarios/round", { pre_money: values.pre, investment: values.investment, target_pool_percent: values.pool });
      setResult(next);
      setErrors({});
      onResult?.(next);
    } catch (failure) {
      if (!(failure instanceof ApiFailure) || failure.status !== 422) throw failure;
      setErrors(failure.fields);
    }
  };

  useEffect(() => {
    if (inputs.pre || inputs.investment || inputs.pool) void compute(inputs);
    // The result for an address opened by reload, Back or a second tab.
  }, [search]);

  useSettled(inputs, 300, (values) => {
    ownSearch.current = scenarioAddress(values);
    replaceAddress(ownSearch.current);
    if (!typed.current) return;
    void compute(values, (next) => announce(`Scenario updated: price per share ${dollars(next.price_per_share)}.`));
  });

  useLiveEvent((message) => {
    if (message.type !== "valuation.changed") return;
    void compute(latest.current, (next) =>
      announce(
        next.fmv_per_share && next.price_to_fmv
          ? `Fair market value is now ${dollars(next.fmv_per_share)}; the round price is ${next.price_to_fmv}× it.`
          : "There is no current valuation to compare the round price with.",
      ),
    );
  });

  const set = (name: keyof Inputs) => (value: string) => {
    typed.current = true;
    setInputs((previous) => ({ ...previous, [name]: value }));
  };

  const save = async () => {
    setNameError(undefined);
    try {
      const created = await api<{ scenario: SavedScenario }>("POST", "/api/scenarios/saved", {
        name,
        pre_money: inputs.pre,
        investment: inputs.investment,
        target_pool_percent: inputs.pool,
      });
      announce(`Scenario ${created.scenario.name} saved.`);
      setName("");
    } catch (failure) {
      if (!(failure instanceof ApiFailure)) throw failure;
      setNameError(failure.fields.name ?? failure.body.error.message);
    }
  };

  const stale = Object.keys(errors).length > 0;
  return (
    <main className="chapter">
      <PageHead title="Round scenario" />
      <section className="sheet">
        <p className="note">Nothing here changes the register.</p>
        <form className="form-column" aria-label="Round scenario" onSubmit={(event) => event.preventDefault()}>
          <TextField label="Pre-money valuation" value={inputs.pre} inputMode="decimal" error={errors.pre_money} onValue={set("pre")} />
          <TextField label="New investment" value={inputs.investment} inputMode="decimal" error={errors.investment} onValue={set("investment")} />
          <TextField label="Target pool after the round" value={inputs.pool} inputMode="decimal" error={errors.target_pool_percent} onValue={set("pool")} />
        </form>
      </section>
      <section className={`sheet${stale ? " stale" : ""}`} aria-label="Scenario result">
        <p className="note">{stale ? "The last good result, until the inputs are valid again." : "Updates as you type."}</p>
        {result ? (
          <div className="figures figures-grid">
            <LabelledValue label="Pool top-up">{groupThousands(result.pool_top_up)}</LabelledValue>
            <LabelledValue label="Price per share">{dollars(result.price_per_share)}</LabelledValue>
            <LabelledValue label="New shares">{groupThousands(result.new_shares)}</LabelledValue>
            <LabelledValue label="Post-money fully diluted">{groupThousands(result.fully_diluted_after)}</LabelledValue>
            <LabelledValue label="New investor">{result.new_investor_percent}%</LabelledValue>
            <LabelledValue label="Pool after">{result.pool_after_percent}%</LabelledValue>
            <LabelledValue label="Dilution">{result.dilution_percent}%</LabelledValue>
            <LabelledValue label="Investment used">{dollars(result.investment_used)}</LabelledValue>
            <LabelledValue label="Price vs fair market value">{result.price_to_fmv ? `${result.price_to_fmv}×` : "No current valuation"}</LabelledValue>
          </div>
        ) : (
          <p className="empty-line">Enter the three amounts to see the round.</p>
        )}
      </section>
      <section className="sheet">
        <p className="note">Saved scenarios keep the three typed inputs.</p>
        <form
          className="form-column"
          aria-label="Save scenario"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <TextField label="Scenario name" value={name} error={nameError} onValue={setName} />
          <button type="submit" className="button button-secondary" disabled={gate}>
            Save scenario
          </button>
        </form>
        <h2 className="saved-heading">Saved scenarios</h2>
        {saved.data && saved.data.scenarios.length === 0 && <p className="empty-line">No saved scenarios yet.</p>}
        <ul role="list" aria-label="Saved scenarios" className="rows">
          {(saved.data?.scenarios ?? []).map((scenario) => (
            <li key={scenario.id} className="row-item">
              <Link
                href={scenarioAddress({ pre: scenario.pre_money, investment: scenario.investment, pool: scenario.target_pool_percent })}
                data-saved={scenario.id}
                returnFocus={`[data-saved="${scenario.id}"]`}
              >
                {scenario.name}
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}

/* ------------------------------------------------------------------ people */

const ASSIGNABLE = [
  { value: "board_member", label: "Board member" },
  { value: "option_holder", label: "Option holder" },
  { value: "investor", label: "Investor" },
] as const;

export function PeoplePage() {
  const gate = useSocketGate();
  const { person: me } = useSession();
  const people = useResource<{ people: Person[] }>("/api/people", ["people"]);
  const [form, setForm] = useState({ name: "", email: "", role: "option_holder", password: "" });
  const [errors, setErrors] = useState<Partial<Record<keyof typeof form, string>>>({});
  const [refusal, setRefusal] = useState<string>();

  const act = async (work: () => Promise<void>) => {
    setRefusal(undefined);
    try {
      await work();
    } catch (failure) {
      if (!(failure instanceof ApiFailure)) throw failure;
      setRefusal(failure.body.error.message);
    } finally {
      people.reload();
    }
  };

  const add = async () => {
    try {
      const created = await api<{ person: Person }>("POST", "/api/people", form);
      announce(`${created.person.name} added as ${ROLE_LABEL[created.person.role]}.`);
      setForm({ name: "", email: "", role: "option_holder", password: "" });
      setErrors({});
    } catch (failure) {
      if (!(failure instanceof ApiFailure) || failure.status !== 422) throw failure;
      setErrors(failure.fields as Partial<Record<keyof typeof form, string>>);
    } finally {
      people.reload();
    }
  };

  if (!people.data) return loading;
  const set = (name: keyof typeof form) => (value: string) => setForm((previous) => ({ ...previous, [name]: value }));
  return (
    <main className="chapter">
      <PageHead title="People" />
      {refusal && <p className="field-error sheet-error">Error: {refusal}</p>}
      <section className="sheet wide">
        <ScrollRegion label="People scroll area">
          <table aria-label="People" className="plain-table">
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Role</th>
                <th scope="col">Access</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {people.data.people.map((person) => {
                const fixed = person.role === "founder_admin" || person.role === "leaver";
                return (
                  <tr key={person.id}>
                    <td>
                      {person.name}
                      <br />
                      <span className="muted">{person.email}</span>
                    </td>
                    <td>
                      <select
                        aria-label={`Role for ${person.name}`}
                        value={person.role}
                        disabled={gate || fixed || person.id === me.id}
                        onChange={(event) => void act(async () => void (await api("PATCH", `/api/people/${person.id}`, { role: event.target.value })))}
                      >
                        {fixed && <option value={person.role}>{ROLE_LABEL[person.role]}</option>}
                        {ASSIGNABLE.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>{person.access === "active" ? "Active" : person.access === "removed" ? "Removed" : "No login"}</td>
                    <td>
                      <div className="actions">
                        <button
                          type="button"
                          className="button button-secondary"
                          disabled={gate || person.id === me.id || person.access === "removed"}
                          onClick={() =>
                            void act(async () => {
                              await api("POST", `/api/people/${person.id}/remove-access`, {});
                              announce(`Access removed for ${person.name}.`);
                            })
                          }
                        >
                          Remove access for {person.name}
                        </button>
                        <button
                          type="button"
                          className="button button-secondary"
                          disabled={gate || person.role !== "option_holder"}
                          onClick={() =>
                            void act(async () => {
                              const left = await api<{ person: Person }>("POST", `/api/people/${person.id}/departure`, {});
                              announce(`Departure recorded for ${person.name}. Their exercise window ends at ${displayInstant(left.person.departure?.window_ends_at ?? "")}.`);
                            })
                          }
                        >
                          Record departure for {person.name}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </ScrollRegion>
      </section>
      <section className="sheet">
        <p className="note">New people can sign in with the password you set.</p>
        <form
          className="form-column"
          aria-label="Add person"
          onSubmit={(event) => {
            event.preventDefault();
            void add();
          }}
        >
          <TextField label="Name" value={form.name} error={errors.name} onValue={set("name")} />
          <TextField label="Email" value={form.email} error={errors.email} onValue={set("email")} />
          <SelectField label="Role" value={form.role} error={errors.role} onValue={set("role")}>
            {ASSIGNABLE.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </SelectField>
          <TextField label="Initial password" value={form.password} error={errors.password} onValue={set("password")} />
          <button type="submit" className="button button-primary" disabled={gate}>
            Add person
          </button>
        </form>
      </section>
    </main>
  );
}

/* ----------------------------------------------------------- admin tenders */

export function AdminTendersPage() {
  const gate = useSocketGate();
  const tenders = useResource<{ tenders: Tender[] }>("/api/tenders", ["tenders", "registry"]);
  const [form, setForm] = useState({ title: "", price: "", cap: "", closes: "" });
  const [errors, setErrors] = useState<Partial<Record<"title" | "price_per_share" | "share_cap" | "closes_at", string>>>({});
  const [refusal, setRefusal] = useState<string>();
  const [busy, setBusy] = useState(false);

  const open = async () => {
    setBusy(true);
    setRefusal(undefined);
    const closesAt = pacificToInstant(form.closes);
    const digits = form.cap.replace(/,/g, "");
    try {
      const created = await api<Tender>("POST", "/api/tenders", {
        title: form.title,
        price_per_share: form.price,
        share_cap: /^\d+$/.test(digits) ? Number.parseInt(digits, 10) : form.cap,
        closes_at: closesAt ?? "",
      });
      announce(`Tender ${created.id} is open until ${displayInstant(created.closes_at)}.`);
      setErrors({});
      setForm({ title: "", price: "", cap: "", closes: "" });
    } catch (failure) {
      if (!(failure instanceof ApiFailure)) throw failure;
      if (failure.status === 422) setErrors(failure.fields);
      else setRefusal(failure.body.error.message);
    } finally {
      setBusy(false);
      tenders.reload();
    }
  };

  if (!tenders.data) return loading;
  const latest = tenders.data.tenders[0];
  const set = (name: keyof typeof form) => (value: string) => setForm((previous) => ({ ...previous, [name]: value }));
  return (
    <main className="chapter">
      <PageHead title="Tenders" />
      <section className="sheet">
        <p className="note">One tender at a time, bought by Harbourline Secondary Partners.</p>
        <form
          className="form-column"
          aria-label="Open tender offer"
          onSubmit={(event) => {
            event.preventDefault();
            void open();
          }}
        >
          <TextField label="Title" value={form.title} error={errors.title} onValue={set("title")} />
          <TextField label="Price per share" value={form.price} inputMode="decimal" error={errors.price_per_share} onValue={set("price")} />
          <TextField label="Share cap" value={form.cap} inputMode="numeric" error={errors.share_cap} onValue={set("cap")} />
          <TextField label="Closes at" value={form.closes} hint="YYYY-MM-DD HH:MM, Pacific time" error={errors.closes_at} onValue={set("closes")} />
          {refusal && <p className="field-error">Error: {refusal}</p>}
          <button type="submit" className="button button-primary" disabled={gate || busy}>
            Open tender
          </button>
        </form>
      </section>
      {tenders.data.tenders.length > 0 && (
        <section className="sheet">
          <p className="note">Every tender, newest first.</p>
          <ul role="list" aria-label="Tender offers" className="rows">
            {tenders.data.tenders.map((tender) => (
              <li key={tender.id} className="row-item">
                <Link href={`/tenders/${tender.id}`}>{tender.title}</Link>
                <span>{tender.id}</span>
                <span>{tender.state === "open" ? `Closes ${displayInstant(tender.closes_at)}` : "Closed"}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {latest?.submissions && <SubmissionsTable submissions={latest.submissions} />}
    </main>
  );
}

