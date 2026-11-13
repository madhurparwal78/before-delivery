import { useEffect, useRef, useState } from "react";
import type { Grant, Person, Valuation } from "../../shared/types.js";
import { VESTING_LABEL, displayDate, displayInstant, dollars, groupThousands } from "../../shared/format.js";
import { ApiFailure, api } from "../api.js";
import { announce, announceOnce } from "../announce.js";
import { useResource, useSettled, useSocketGate } from "../hooks.js";
import { useLive } from "../live.js";
import { Link, navigate, requestFocus } from "../router.js";
import { useSession } from "../session.js";
import { Band, TextField, ScrollRegion } from "../ui.js";
import { FailurePage } from "./notFound.js";

const STATE_WORD = { draft: "Draft", board_queue: "With the board", approved: "Approved", offered: "Offered", accepted: "Accepted", expired: "Expired" } as const;

type Valuations = { valuations: Valuation[]; current_id: string | null };

function lapsedCopy(valuations: Valuations | undefined): string | null {
  const current = valuations?.valuations.find((valuation) => valuation.id === valuations.current_id);
  if (!valuations || (current && current.status === "current")) return null;
  return current ? `The current valuation lapsed on ${displayDate(current.expires_on)}. Record a new valuation before issuing grants.` : null;
}

export function AdminGrantsPage() {
  const gate = useSocketGate();
  const { person } = useSession();
  const grants = useResource<{ grants: Grant[] }>("/api/grants", ["grants"]);
  const valuations = useResource<Valuations>("/api/valuations", ["valuations"]);
  const [error, setError] = useState<string>();
  const lapsed = lapsedCopy(valuations.data);

  const newGrant = async () => {
    try {
      const grant = await api<Grant>("POST", "/api/grants", {});
      navigate(`/admin/grants/${grant.id}`, { focus: "[data-holder-select]" });
    } catch (failure) {
      if (!(failure instanceof ApiFailure)) throw failure;
      if (failure.code === "valuation_lapsed") {
        valuations.reload();
        const current = valuations.data?.valuations.find((valuation) => valuation.id === valuations.data?.current_id);
        if (current) announceOnce(`lapsed:${current.expires_on}`, `The current valuation lapsed on ${displayDate(current.expires_on)}. Record a new valuation before issuing grants.`);
      }
    }
  };

  const sendOffer = async (grant: Grant) => {
    setError(undefined);
    try {
      const sent = await api<Grant>("POST", `/api/grants/${grant.id}/offer`, {});
      announce(`Offer for ${grant.id} sent. It lapses at ${displayInstant(sent.offer_expires_at ?? "")}.`);
    } catch (failure) {
      if (!(failure instanceof ApiFailure)) throw failure;
      setError(failure.body.error.message);
    } finally {
      grants.reload();
    }
  };

  return (
    <main className="chapter">
      <section className="sheet">
        <p className="note">{person.name}</p>
        <h1 tabIndex={-1}>Grants</h1>
        <div className="actions">
          <button type="button" className="button button-primary" disabled={gate} onClick={() => void newGrant()}>
            New grant
          </button>
        </div>
      </section>
      {lapsed && (
        <Band tone="black" role="alert">
          {lapsed}
        </Band>
      )}
      {error && <p className="field-error sheet-error">Error: {error}</p>}
      <section className="sheet wide">
        <ScrollRegion label="Grants scroll area">
          <table aria-label="Grants" className="plain-table">
            <thead>
              <tr>
                <th scope="col">Grant</th>
                <th scope="col">Holder</th>
                <th scope="col" className="num">
                  Options
                </th>
                <th scope="col" className="num">
                  Strike
                </th>
                <th scope="col">State</th>
                <th scope="col">Offer</th>
              </tr>
            </thead>
            <tbody>
              {(grants.data?.grants ?? []).map((grant) => (
                <tr key={grant.id}>
                  <td>
                    <Link href={grant.state === "draft" ? `/admin/grants/${grant.id}` : `/grants/${grant.id}`}>{grant.id}</Link>
                  </td>
                  <td>{grant.holder_name ?? "—"}</td>
                  <td className="num">{grant.options === null ? "—" : groupThousands(grant.options)}</td>
                  <td className="num">{grant.strike === null ? "—" : dollars(grant.strike)}</td>
                  <td>{STATE_WORD[grant.state]}</td>
                  <td>
                    {grant.state === "approved" && (
                      <button type="button" className="button button-primary" disabled={gate} onClick={() => void sendOffer(grant)}>
                        Send offer {grant.id}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollRegion>
      </section>
    </main>
  );
}

type Form = { holder_id: string; options: string; strike: string; vesting_type: string; vesting_start: string };
type FieldName = keyof Form;
const FIELD_ORDER: FieldName[] = ["holder_id", "options", "strike", "vesting_type", "vesting_start"];
const FIELD_ID: Record<FieldName, string> = {
  holder_id: "grant-holder",
  options: "grant-options",
  strike: "grant-strike",
  vesting_type: "grant-vesting-type",
  vesting_start: "grant-vesting-start",
};
const FOCUS_ON: Record<FieldName, string> = {
  holder_id: "#grant-holder",
  options: "#grant-options",
  strike: "#grant-strike",
  vesting_type: "#grant-vesting-type input",
  vesting_start: "#grant-vesting-start",
};

const formOf = (grant: Grant): Form => ({
  holder_id: grant.holder_id ?? "",
  options: grant.options === null ? "" : String(grant.options),
  strike: grant.strike ?? "",
  vesting_type: grant.vesting_type ?? "",
  vesting_start: grant.vesting_start ?? "",
});

function payloadOf(form: Form, names: FieldName[]): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const name of names) {
    const text = form[name].trim();
    if (name === "holder_id") body.holder_id = text === "" ? null : text;
    else if (name === "options") body.options = /^\d+$/.test(text.replace(/,/g, "")) && Number.parseInt(text.replace(/,/g, ""), 10) > 0 ? Number.parseInt(text.replace(/,/g, ""), 10) : null;
    else if (name === "strike") body.strike = /^\d+(\.\d{1,4})?$/.test(text) && /[1-9]/.test(text) ? text : null;
    else if (name === "vesting_type") body.vesting_type = text === "" ? null : text;
    else body.vesting_start = /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
  }
  return body;
}

export function AdminGrantFormPage({ id }: { id: string }) {
  const grant = useResource<Grant>(`/api/grants/${id}`, ["grants"]);
  const people = useResource<{ people: Person[] }>("/api/people", ["people"]);
  const valuations = useResource<Valuations>("/api/valuations", ["valuations"]);
  if (grant.error) return <FailurePage failure={grant.error} />;
  if (!grant.data || !people.data) {
    return (
      <main className="page-state">
        <Band tone="black" className="band-fill band-delayed">
          Loading your register.
        </Band>
      </main>
    );
  }
  return <GrantForm grant={grant.data} holders={people.data.people.filter((candidate) => candidate.role === "option_holder")} valuations={valuations.data} />;
}

function GrantForm({ grant, holders, valuations }: { grant: Grant; holders: Person[]; valuations: Valuations | undefined }) {
  const gate = useSocketGate();
  const live = useLive();
  const { person } = useSession();
  const [form, setForm] = useState<Form>(() => formOf(grant));
  const [errors, setErrors] = useState<Partial<Record<FieldName, string>>>({});
  const [changed, setChanged] = useState(false);
  const [busy, setBusy] = useState<"submit" | "delete" | null>(null);
  const [outdated, setOutdated] = useState(false);
  const version = useRef(grant.draft_version);
  const dirty = useRef(new Set<FieldName>());
  const lastEdited = useRef<FieldName>("holder_id");
  const saving = useRef(false);
  const again = useRef(false);
  const latest = useRef(form);
  latest.current = form;
  const lapsed = lapsedCopy(valuations);

  // A save from another tab shows in every field that has no keyboard focus and no unsaved typing; the carried version stays.
  useEffect(() => {
    const incoming = formOf(grant);
    setForm((previous) => {
      const next = { ...previous };
      for (const name of FIELD_ORDER) {
        const element = document.getElementById(FIELD_ID[name]);
        const focused = element !== null && element.contains(document.activeElement);
        if (!focused && !dirty.current.has(name)) next[name] = incoming[name];
      }
      return next;
    });
  }, [grant]);

  const save = async () => {
    if (saving.current) {
      again.current = true;
      return;
    }
    const names = [...dirty.current];
    if (names.length === 0) {
      setChanged(false);
      return;
    }
    saving.current = true;
    const sent = { ...latest.current };
    try {
      const saved = await api<Grant>("PATCH", `/api/grants/${grant.id}`, { ...payloadOf(sent, names), draft_version: version.current });
      version.current = saved.draft_version;
      for (const name of names) if (latest.current[name] === sent[name]) dirty.current.delete(name);
      setErrors({});
    } catch (failure) {
      if (!(failure instanceof ApiFailure)) throw failure;
      if (failure.code === "draft_outdated" && failure.body.grant) {
        version.current = failure.body.grant.draft_version;
        dirty.current.clear();
        setForm(formOf(failure.body.grant));
        setOutdated(true);
      } else if (failure.status === 422) {
        setErrors(failure.fields as Partial<Record<FieldName, string>>);
        dirty.current.clear();
      }
    } finally {
      saving.current = false;
      setChanged(dirty.current.size > 0);
      if (again.current) {
        again.current = false;
        void save();
      }
    }
  };

  const edit = (name: FieldName, value: string) => {
    setForm((previous) => ({ ...previous, [name]: value }));
    dirty.current.add(name);
    lastEdited.current = name;
    setChanged(true);
    setErrors((previous) => ({ ...previous, [name]: undefined }));
  };

  useSettled(form, 500, () => {
    if (live.open) void save();
  });
  useEffect(() => {
    if (live.open && dirty.current.size > 0) void save();
    // Typed text is saved once the socket is open again.
  }, [live.open]);

  const closeNotice = () => {
    setOutdated(false);
    requestFocus(FOCUS_ON[lastEdited.current]);
  };

  const submit = async () => {
    setBusy("submit");
    if (dirty.current.size > 0) {
      const names = [...dirty.current];
      try {
        const saved = await api<Grant>("PATCH", `/api/grants/${grant.id}`, { ...payloadOf(latest.current, names), draft_version: version.current });
        version.current = saved.draft_version;
        dirty.current.clear();
      } catch (failure) {
        if (!(failure instanceof ApiFailure)) throw failure;
        setBusy(null);
        return;
      }
    }
    try {
      await api<Grant>("POST", `/api/grants/${grant.id}/submit`, {});
      announce(`Grant ${grant.id} sent to the board for approval.`);
      navigate("/admin/grants", { focus: "main h1" });
    } catch (failure) {
      if (!(failure instanceof ApiFailure)) throw failure;
      const fields = failure.fields as Partial<Record<FieldName, string>>;
      if (failure.status === 422) {
        setErrors(fields);
        const first = FIELD_ORDER.find((name) => fields[name]);
        if (first) requestFocus(FOCUS_ON[first]);
      } else if (failure.code === "pool_exhausted") {
        setErrors({ options: failure.body.error.message });
        requestFocus(FOCUS_ON.options);
      }
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    setBusy("delete");
    try {
      await api("DELETE", `/api/grants/${grant.id}`);
      navigate("/admin/grants", { focus: "main h1" });
    } finally {
      setBusy(null);
    }
  };

  const editable = grant.state === "draft";
  return (
    <main className="chapter">
      <section className="sheet">
        <p className="note">
          {person.name}
          <br />
          {grant.id}
        </p>
        <h1 tabIndex={-1}>{grant.id}</h1>
        <p className="state-word">{STATE_WORD[grant.state]}</p>
      </section>
      {lapsed && (
        <Band tone="black" role="alert">
          {lapsed}
        </Band>
      )}
      <section className="sheet">
        <p className="note">Each change saves to the register as you type.</p>
        <form
          className="form-column"
          aria-label="Issue grant"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div className="field">
            <label htmlFor={FIELD_ID.holder_id}>Holder</label>
            <select
              id={FIELD_ID.holder_id}
              data-holder-select
              value={form.holder_id}
              disabled={!editable}
              aria-invalid={errors.holder_id ? true : undefined}
              onChange={(event) => edit("holder_id", event.target.value)}
            >
              <option value="">Choose an option holder</option>
              {[...holders]
                .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
                .map((holder) => (
                  <option key={holder.id} value={holder.id}>
                    {holder.name}
                  </option>
                ))}
            </select>
            {errors.holder_id && <p className="field-error">Error: {errors.holder_id}</p>}
          </div>
          <TextField label="Options" id={FIELD_ID.options} value={form.options} inputMode="numeric" disabled={!editable} error={errors.options} onValue={(value) => edit("options", value)} />
          <TextField label="Strike price" id={FIELD_ID.strike} value={form.strike} inputMode="decimal" disabled={!editable} error={errors.strike} onValue={(value) => edit("strike", value)} />
          <fieldset className="field" id={FIELD_ID.vesting_type}>
            <legend>Vesting type</legend>
            <div role="radiogroup" aria-label="Vesting type" className="radios">
              {(["standard", "monthly"] as const).map((type) => (
                <label key={type} className="radio">
                  <input type="radio" name="vesting-type" value={type} checked={form.vesting_type === type} disabled={!editable} onChange={() => edit("vesting_type", type)} />
                  <span>{VESTING_LABEL[type]}</span>
                </label>
              ))}
            </div>
            {errors.vesting_type && <p className="field-error">Error: {errors.vesting_type}</p>}
          </fieldset>
          <TextField
            label="Vesting start"
            id={FIELD_ID.vesting_start}
            value={form.vesting_start}
            hint="YYYY-MM-DD"
            placeholder="YYYY-MM-DD"
            disabled={!editable}
            error={errors.vesting_start}
            onValue={(value) => edit("vesting_start", value)}
          />
          <p className="draft-status">{changed ? "Saving the draft" : "Draft saved"}</p>
          <div className="actions">
            <button type="submit" className="button button-primary" disabled={gate || busy !== null || !editable || lapsed !== null}>
              {busy === "submit" ? "Sending" : "Submit to board"}
            </button>
            <button type="button" className="button button-secondary" disabled={gate || busy !== null || !editable} onClick={() => void remove()}>
              Delete draft
            </button>
          </div>
        </form>
      </section>
      {outdated && (
        <section
          className="sheet draft-notice"
          aria-label="Draft changed"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.stopPropagation();
              closeNotice();
            }
          }}
        >
          <p className="note">Another tab saved this draft first.</p>
          <p className="notice-text">This draft changed in another tab. The latest version is shown.</p>
          <div className="actions">
            <button type="button" data-autofocus ref={(element) => element?.focus()} className="button button-primary" onClick={closeNotice}>
              Keep editing
            </button>
          </div>
        </section>
      )}
    </main>
  );
}
