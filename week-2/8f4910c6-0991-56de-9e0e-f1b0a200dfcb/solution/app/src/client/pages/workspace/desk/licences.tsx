// Usage licences (/workspace/licences): status tiles, the licence table (cards with a sticky Extend bar on a
// phone), Extend licence and Record licence.

import { useEffect, useRef, useState } from "react";
import { api, newKey } from "../../../api.js";
import { definePage } from "../../../router.js";
import { sessionCopy } from "../../../session.js";
import { Shell } from "../../../workspace/shell.js";
import { Button } from "../../../ui/button.js";
import { Dialog } from "../../../ui/dialog.js";
import { Select, TextField } from "../../../ui/fields.js";
import { Problems, useFormErrors } from "../../../ui/problems.js";
import { StatusLine, useAnnouncer } from "../../../ui/status.js";
import { PHONE, useMediaQuery } from "../../../ui/media.js";
import { formatDate, formatMoney, formatOfficeTime, parseMoneyInput } from "../../../../shared/format.js";
import { useFocusAfterRender, useOfficeToday, type ClientSummary, type TalentSummary } from "./common.js";
import { useResource, useMember } from "../../../workspace/data.js";
import { BILLING_DOWN } from "../../../workspace/data.js";

type Status = "active" | "expiring" | "expired";

interface Licence {
  id: string;
  clientCompany: string;
  talentDisplayName: string;
  media: string;
  territory: string;
  firstUseDate: string;
  termMonths: number;
  endsOn: string;
  status: Status;
  monthlyFeeCents: number;
  version: number;
}

const STATUS_NAMES: Record<Status, string> = { active: "Active", expiring: "Expiring", expired: "Expired" };
const MEDIA: Record<string, string> = { digital: "Digital", print: "Print", out_of_home: "Out of home", broadcast: "Broadcast" };
const TERRITORIES: Record<string, string> = { canada: "Canada", north_america: "North America", worldwide: "Worldwide" };

function EndDate({ licence }: { licence: Licence }) {
  return <span id={`ends-${licence.id}`} tabIndex={-1} className="end-date tnum">{formatDate(licence.endsOn)}</span>;
}

function ExtendDialog({ licence, onClose, onExtended, onRefused }: {
  licence: Licence;
  onClose: () => void;
  onExtended: (copy: string) => Promise<void>;
  onRefused: (copy: string) => Promise<void>;
}) {
  const member = useMember();
  const [months, setMonths] = useState("");
  const [pending, setPending] = useState(false);
  const [key] = useState(newKey);
  const form = useFormErrors({ months: "extend-months" });
  const focusLater = useFocusAfterRender();
  const submit = async () => {
    const typed = months.trim();
    setPending(true);
    const result = await api<{ licence: Licence; extension: { months: number } }>("POST",
      `/api/licences/${licence.id}/extensions`, { months: /^\d+$/.test(typed) ? Number(typed) : typed, version: licence.version },
      { idempotencyKey: key });
    setPending(false);
    if (result.ok) {
      const { licence: extended, extension } = result.data;
      await onExtended(`Extended ${extended.talentDisplayName}'s licence by ${extension.months} months to ${formatDate(extended.endsOn)}.`);
      return;
    }
    const error = result.error;
    if (form.take(error)) {
      focusLater(() => document.getElementById("extend-months"));
      return;
    }
    const copy = sessionCopy(error)
      ?? (error.error === "stale_version"
        ? `${String(error.savedBy ?? "")} extended this licence at ${
          typeof error.savedAt === "string" ? formatOfficeTime(error.savedAt, member.office) : ""}. Check the new end date before extending again.`
        : error.error === "billing_unavailable" ? BILLING_DOWN : "The licence was not extended. Reload and try again.");
    await onRefused(copy);
  };
  return (
    <Dialog title="Extend licence" onClose={onClose} sheet
      actions={<Button pending={pending} pendingLabel="Extending licence…" onClick={() => void submit()}>Extend licence</Button>}>
      <Problems items={form.problems} focusOnShow={false} />
      <p className="muted">{licence.talentDisplayName} with {licence.clientCompany}, ending {formatDate(licence.endsOn)}.
        Each month costs {formatMoney(licence.monthlyFeeCents)}.</p>
      <form noValidate onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}>
        <TextField id="extend-months" label="Months" inputMode="numeric" value={months} onChange={setMonths}
          error={form.error("months")} hint="From 1 to 36 months." />
      </form>
    </Dialog>
  );
}

const RECORD_FIELDS: Record<string, string> = { clientId: "licence-client", talentId: "licence-talent", media: "licence-media",
  territory: "licence-territory", firstUseDate: "licence-first-use", termMonths: "licence-term",
  monthlyFeeCents: "licence-fee" };

function RecordDialog({ onClose, onRecorded, announce }: {
  onClose: () => void;
  onRecorded: (copy: string) => Promise<void>;
  announce: (copy: string) => void;
}) {
  const clients = useResource<{ clients: ClientSummary[] }>("/api/clients");
  const roster = useResource<{ talent: TalentSummary[] }>("/api/talent?state=active");
  const [values, setValues] = useState({ clientId: "", talentId: "", media: "digital", territory: "canada",
    firstUseDate: "", termMonths: "12", fee: "" });
  const today = useOfficeToday("toronto");
  useEffect(() => {
    if (today) setValues((v) => (v.firstUseDate ? v : { ...v, firstUseDate: today }));
  }, [today]);
  const [pending, setPending] = useState(false);
  const form = useFormErrors(RECORD_FIELDS);
  const set = (field: keyof typeof values) => (value: string) => setValues((v) => ({ ...v, [field]: value }));
  const talent = [...(roster.data?.talent ?? [])].sort((a, b) => a.displayName.localeCompare(b.displayName));
  const submit = async () => {
    const fee = parseMoneyInput(values.fee);
    setPending(true);
    const result = await api<{ licence: Licence }>("POST", "/api/licences", {
      clientId: values.clientId, talentId: values.talentId, media: values.media, territory: values.territory,
      firstUseDate: values.firstUseDate, termMonths: /^\d+$/.test(values.termMonths.trim()) ? Number(values.termMonths) : values.termMonths,
      monthlyFeeCents: fee ?? (values.fee.trim() ? values.fee : null),
    });
    setPending(false);
    if (result.ok) {
      const licence = result.data.licence;
      await onRecorded(`Recorded licence for ${licence.talentDisplayName} with ${licence.clientCompany}, ending ${formatDate(licence.endsOn)}.`);
      return;
    }
    if (!form.take(result.error, announce)) announce(sessionCopy(result.error) ?? "The licence was not recorded. Try again.");
  };
  return (
    <Dialog title="Record licence" onClose={onClose} sheet wide
      actions={<Button pending={pending} pendingLabel="Recording licence…" onClick={() => void submit()}>Record licence</Button>}>
      <Problems items={form.problems} />
      <form noValidate className="form-grid" onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}>
        <Select id="licence-client" label="Client" value={values.clientId} onChange={set("clientId")} error={form.error("clientId")}
          choices={[{ value: "", label: "Choose a client" },
            ...(clients.data?.clients ?? []).map((c) => ({ value: c.id, label: c.company }))]} />
        <Select id="licence-talent" label="Talent" value={values.talentId} onChange={set("talentId")} error={form.error("talentId")}
          choices={[{ value: "", label: "Choose a talent" }, ...talent.map((t) => ({ value: t.id, label: t.displayName }))]} />
        <Select id="licence-media" label="Media" value={values.media} onChange={set("media")} error={form.error("media")}
          choices={Object.entries(MEDIA).map(([value, label]) => ({ value, label }))} />
        <Select id="licence-territory" label="Territory" value={values.territory} onChange={set("territory")}
          error={form.error("territory")} choices={Object.entries(TERRITORIES).map(([value, label]) => ({ value, label }))} />
        <TextField id="licence-first-use" label="First-use date" type="date" value={values.firstUseDate}
          onChange={set("firstUseDate")} error={form.error("firstUseDate")} />
        <TextField id="licence-term" label="Term in months" inputMode="numeric" value={values.termMonths}
          onChange={set("termMonths")} error={form.error("termMonths")} />
        <TextField id="licence-fee" label="Monthly fee (CAD)" inputMode="decimal" value={values.fee} onChange={set("fee")}
          error={form.error("monthlyFeeCents")} hint="For example 450.00" />
      </form>
    </Dialog>
  );
}

function LicencesPage() {
  const phone = useMediaQuery(PHONE);
  const { message, announce } = useAnnouncer();
  const { data, reload } = useResource<{ counts: Record<Status, number>; licences: Licence[] }>("/api/licences");
  const [extending, setExtending] = useState<Licence | null>(null);
  const [recording, setRecording] = useState(false);
  const [selected, setSelected] = useState("");
  const focusEnd = useRef("");
  useEffect(() => {
    if (focusEnd.current && !extending) {
      const target = document.getElementById(`ends-${focusEnd.current}`);
      if (target) {
        focusEnd.current = "";
        target.focus();
      }
    }
  });
  const licences = data?.licences ?? [];
  const chosen = licences.find((l) => l.id === selected) ?? null;

  const extended = async (copy: string) => {
    const id = extending?.id ?? "";
    await reload();
    announce(copy);
    focusEnd.current = id;
    setExtending(null);
  };
  const refused = async (copy: string) => {
    await reload();
    announce(copy);
    setExtending(null);
  };

  return (
    <Shell>
      <div className="workspace-head">
        <p className="eyebrow">Usage licences and renewals</p>
        <h1>Licences</h1>
      </div>
      <StatusLine name="Licence" message={message} />
      <div className="tiles">
        {(["active", "expiring", "expired"] as const).map((status) => (
          <p key={status} className="tile"><span className="tile-label">{STATUS_NAMES[status]}</span>{" "}
            <span className="tile-count num">{data?.counts[status] ?? 0}</span></p>
        ))}
      </div>
      <div className="btn-row">
        <Button variant="quiet" onClick={() => setRecording(true)}>Record licence</Button>
      </div>
      {!data ? <p className="muted">Loading licences…</p> : !licences.length ? <p className="desk-empty">No licences recorded yet.</p> : null}
      {phone ? (
        <>
          <ul aria-label="Licences" role="list" className="licence-cards">
            {licences.map((licence) => (
              <li key={licence.id}>
                <article className="licence-card" aria-label={`${licence.talentDisplayName} with ${licence.clientCompany}`}>
                  <label className="licence-pick">
                    <input type="radio" name="licence" value={licence.id} checked={selected === licence.id}
                      onChange={() => setSelected(licence.id)} />
                    <span className="licence-card-body">
                      <span className="licence-card-title">{licence.talentDisplayName}</span>
                      <span>{licence.clientCompany}</span>
                      <span className="muted">{MEDIA[licence.media]}, {TERRITORIES[licence.territory]}</span>
                      <span>Ends <EndDate licence={licence} /></span>
                      <span className="status-word" data-status={licence.status}>{STATUS_NAMES[licence.status]}</span>
                    </span>
                  </label>
                </article>
              </li>
            ))}
          </ul>
          <div className="sticky-bar">
            <span className="muted">{chosen ? `${chosen.talentDisplayName}, ${chosen.clientCompany}` : "Choose a licence"}</span>
            <Button disabled={!chosen} onClick={() => setExtending(chosen)}>Extend</Button>
          </div>
        </>
      ) : licences.length ? (
        <div className="desk-region" role="region" aria-label="Licence table" tabIndex={0}>
          <table aria-label="Licences" className="desk-table">
            <thead>
              <tr>
                <th scope="col">Talent</th><th scope="col">Client</th><th scope="col">Media</th><th scope="col">Territory</th>
                <th scope="col">First use</th><th scope="col">Ends</th><th scope="col">Status</th>
                <th scope="col" className="num">Monthly fee</th><th scope="col"><span className="visually-hidden">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {licences.map((licence) => (
                <tr key={licence.id}>
                  <th scope="row">{licence.talentDisplayName}</th>
                  <td>{licence.clientCompany}</td>
                  <td>{MEDIA[licence.media]}</td>
                  <td>{TERRITORIES[licence.territory]}</td>
                  <td className="tnum">{formatDate(licence.firstUseDate)}</td>
                  <td><EndDate licence={licence} /></td>
                  <td>{STATUS_NAMES[licence.status]}</td>
                  <td className="num">{formatMoney(licence.monthlyFeeCents)}</td>
                  <td><Button variant="quiet" onClick={() => setExtending(licence)}>Extend</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {extending ? (
        <ExtendDialog licence={extending} onClose={() => setExtending(null)} onExtended={extended} onRefused={refused} />
      ) : null}
      {recording ? (
        <RecordDialog announce={announce} onClose={() => setRecording(false)} onRecorded={async (copy) => {
          await reload();
          announce(copy);
          setRecording(false);
        }} />
      ) : null}
    </Shell>
  );
}

definePage({ pattern: "/workspace/licences", kind: "workspace", roles: ["agency_director", "accounts_lead"],
  render: () => <LicencesPage /> });
