import { Copy, RefreshCw, Send, XCircle } from "lucide-react";
import { useCallback, useEffect, useId, useState } from "react";
import type { Me, Objective, Role, ShareLink } from "../../shared/api.js";
import { api, isFailure } from "../api.js";
import { useFeedback } from "../feedback.js";
import { localTime, ROLE_LABELS } from "../format.js";

const weightsOf = (list: Objective[]): Record<string, string> => Object.fromEntries(list.map((o) => [o.id, String(o.weight)]));

function Objectives({ initial }: { initial: Objective[] }) {
  const feedback = useFeedback();
  const id = useId();
  const [objectives, setObjectives] = useState<Objective[]>(initial);
  const [weights, setWeights] = useState<Record<string, string>>(weightsOf(initial));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [newName, setNewName] = useState("");
  const [newWeight, setNewWeight] = useState("0");

  const load = useCallback(async () => {
    const { objectives: list } = await api.get<{ objectives: Objective[] }>("/api/objectives");
    setObjectives(list);
    setWeights(weightsOf(list));
  }, []);

  const asNumber = (value: string): number | string => (value.trim() !== "" && Number.isFinite(Number(value)) ? Number(value) : value);

  const save = async (): Promise<void> => {
    setBusy(true);
    setErrors({});
    feedback.clearAlert();
    feedback.say("save", "Saving weights…");
    try {
      for (const o of objectives) {
        if (weights[o.id] === String(o.weight)) continue;
        try {
          await api.patch(`/api/objectives/${o.id}`, { weight: asNumber(weights[o.id] ?? "") });
        } catch (error) {
          if (isFailure(error, 422)) {
            setErrors({ [o.id]: error.fields.weight ?? error.message });
            feedback.say("save", "");
            return;
          }
          throw error;
        }
      }
      await load();
      feedback.say("save", "Weights saved. Priorities updated.");
    } catch (error) {
      feedback.fail(error);
    } finally {
      setBusy(false);
    }
  };

  const add = async (): Promise<void> => {
    setErrors({});
    feedback.clearAlert();
    try {
      await api.post("/api/objectives", { name: newName, weight: asNumber(newWeight) });
      setNewName("");
      setNewWeight("0");
      await load();
      feedback.say("save", "Objective added. Priorities updated.");
    } catch (error) {
      if (isFailure(error, 422)) setErrors({ new: Object.values(error.fields).join(" ") });
      else feedback.fail(error);
    }
  };

  return (
    <section aria-label="Objectives" className="panel">
      <h2>Objectives</h2>
      <p className="hint">Weights are whole numbers from 0 to 100. Every feature's objective fit and priority follow them.</p>
      <form onSubmit={(e) => { e.preventDefault(); void save(); }}>
        {objectives.map((o) => (
          <div className="field field-inline" key={o.id}>
            <label htmlFor={`${id}-${o.id}`}>{o.name} weight</label>
            <input id={`${id}-${o.id}`} type="number" inputMode="numeric" className="num" value={weights[o.id] ?? ""}
              onChange={(e) => setWeights({ ...weights, [o.id]: e.target.value })} aria-describedby={errors[o.id] ? `${id}-${o.id}-error` : undefined} />
            {errors[o.id] && <p id={`${id}-${o.id}-error`} className="field-error">{errors[o.id]}</p>}
          </div>
        ))}
        <button type="submit" className="button" aria-busy={busy} disabled={busy}>Save weights</button>
      </form>
      <form className="inline-form" onSubmit={(e) => { e.preventDefault(); void add(); }}>
        <div className="field">
          <label htmlFor={`${id}-new-name`}>New objective</label>
          <input id={`${id}-new-name`} type="text" value={newName} onChange={(e) => setNewName(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor={`${id}-new-weight`}>New objective weight</label>
          <input id={`${id}-new-weight`} type="number" inputMode="numeric" value={newWeight} onChange={(e) => setNewWeight(e.target.value)}
            aria-describedby={errors.new ? `${id}-new-error` : undefined} />
        </div>
        <button type="submit" className="button-quiet">Add objective</button>
        {errors.new && <p id={`${id}-new-error`} className="field-error">{errors.new}</p>}
      </form>
    </section>
  );
}

function Members() {
  const feedback = useFeedback();
  const id = useId();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("product_manager");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const invite = async (): Promise<void> => {
    setBusy(true);
    setError("");
    feedback.clearAlert();
    try {
      const { invitation } = await api.post<{ invitation: { email: string } }>("/api/invitations", { email, role });
      feedback.say("save", `Invitation queued for ${invitation.email}.`);
      setEmail("");
    } catch (failure) {
      if (isFailure(failure, 409)) feedback.warn(`${email.trim().toLowerCase()} already has an Evidence Desk account.`);
      else if (isFailure(failure, 422)) setError(Object.values(failure.fields).join(" "));
      else feedback.fail(failure);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section aria-label="Members" className="panel">
      <h2>Members</h2>
      <p className="hint">Invitations arrive by email and their link works once.</p>
      <form className="inline-form" onSubmit={(e) => { e.preventDefault(); void invite(); }}>
        <div className="field">
          <label htmlFor={`${id}-email`}>Invite email</label>
          <input id={`${id}-email`} type="email" value={email} onChange={(e) => setEmail(e.target.value)} aria-describedby={error ? `${id}-error` : undefined} />
        </div>
        <div className="field">
          <label htmlFor={`${id}-role`}>Role</label>
          <select id={`${id}-role`} value={ROLE_LABELS[role]}
            onChange={(e) => setRole((Object.keys(ROLE_LABELS) as Role[]).find((r) => ROLE_LABELS[r] === e.target.value) ?? "product_manager")}>
            {(Object.keys(ROLE_LABELS) as Role[]).map((r) => <option key={r} value={ROLE_LABELS[r]}>{ROLE_LABELS[r]}</option>)}
          </select>
        </div>
        <button type="submit" className="button" aria-busy={busy} disabled={busy}><Send aria-hidden="true" size={16} />{busy ? "Sending invitation…" : "Send invitation"}</button>
        {error && <p id={`${id}-error`} className="field-error">{error}</p>}
      </form>
    </section>
  );
}

const STATE_WORDS = { active: "Active", expired: "Expired", revoked: "Revoked" };

function ShareLinks({ timeZone, initial }: { timeZone: string; initial: ShareLink[] }) {
  const feedback = useFeedback();
  const id = useId();
  const [links, setLinks] = useState<ShareLink[]>(initial);
  const [lifetime, setLifetime] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLinks((await api.get<{ shareLinks: ShareLink[] }>("/api/roadmap/share-links")).shareLinks);
  }, []);
  useEffect(() => {
    const timer = setInterval(() => { load().catch(() => undefined); }, 30_000);
    return () => clearInterval(timer);
  }, [load]);

  const act = async (work: () => Promise<unknown>, success: string): Promise<void> => {
    feedback.clearAlert();
    try {
      await work();
      feedback.say("save", success);
    } catch (failure) {
      feedback.fail(failure);
    }
    await load().catch(() => undefined);
  };

  const create = async (): Promise<void> => {
    setError("");
    const value = lifetime.trim();
    const expiresInSeconds = value === "" ? null : Number.isFinite(Number(value)) ? Number(value) : value;
    feedback.clearAlert();
    try {
      await api.post("/api/roadmap/share-links", { expiresInSeconds });
      feedback.say("save", "Share link created.");
    } catch (failure) {
      if (isFailure(failure, 422)) setError(failure.fields.expiresInSeconds ?? failure.message);
      else feedback.fail(failure);
    }
    await load().catch(() => undefined);
  };

  return (
    <section aria-label="Share links" className="panel">
      <h2>Share links</h2>
      <p className="hint">Anyone with an active link sees public releases, feature names and public descriptions — nothing else.</p>
      <form className="inline-form" onSubmit={(e) => { e.preventDefault(); void create(); }}>
        <div className="field">
          <label htmlFor={`${id}-lifetime`}>Link lifetime (seconds)</label>
          <input id={`${id}-lifetime`} type="number" inputMode="numeric" placeholder="No expiry" value={lifetime} onChange={(e) => setLifetime(e.target.value)}
            aria-describedby={error ? `${id}-error` : undefined} />
        </div>
        <button type="submit" className="button">Create share link</button>
        {error && <p id={`${id}-error`} className="field-error">{error}</p>}
      </form>
      {links.length === 0 ? <p className="empty-line">No share links yet.</p> : (
        <ul aria-label="Share links" className="link-list">
          {links.map((link) => (
            <li key={link.id} className={`link-item link-${link.status}`}>
              <div className="link-main">
                <span className={`badge badge-${link.status}`}>{STATE_WORDS[link.status]}</span>
                <code className="link-url">{link.url}</code>
              </div>
              <p className="link-dates num">
                Created {localTime(link.createdAt, timeZone)} · {link.expiresAt ? `Expires ${localTime(link.expiresAt, timeZone)}` : "No expiry"}
                {link.revokedAt ? ` · Revoked ${localTime(link.revokedAt, timeZone)}` : ""}
              </p>
              <div className="link-actions">
                <button type="button" className="button-quiet" onClick={() => void act(() => navigator.clipboard.writeText(link.url), "Link copied.")}>
                  <Copy aria-hidden="true" size={14} />Copy link
                </button>
                {link.status !== "revoked" && (
                  <>
                    <button type="button" className="button-quiet" onClick={() => void act(() => api.post(`/api/roadmap/share-links/${link.id}/regenerate`), "New link created. The old link no longer works.")}>
                      <RefreshCw aria-hidden="true" size={14} />Regenerate
                    </button>
                    <button type="button" className="button-quiet button-quiet-danger" onClick={() => void act(() => api.delete(`/api/roadmap/share-links/${link.id}`), "Link revoked. It no longer works.")}>
                      <XCircle aria-hidden="true" size={14} />Revoke
                    </button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Settings loads its data before it renders, so no section moves once the page is on screen. */
export function SettingsPage({ me }: { me: Me }) {
  const feedback = useFeedback();
  const [data, setData] = useState<{ objectives: Objective[]; shareLinks: ShareLink[] } | null>(null);
  useEffect(() => {
    Promise.all([
      api.get<{ objectives: Objective[] }>("/api/objectives"),
      api.get<{ shareLinks: ShareLink[] }>("/api/roadmap/share-links"),
    ]).then(([o, l]) => setData({ objectives: o.objectives, shareLinks: l.shareLinks }), (error: unknown) => feedback.fail(error));
  }, [feedback]);
  return (
    <div className="page-body settings">
      <header className="page-head"><h1>Settings</h1></header>
      {data ? (
        <>
          <Objectives initial={data.objectives} />
          <Members />
          <ShareLinks timeZone={me.workspace.timeZone} initial={data.shareLinks} />
        </>
      ) : <p className="hint" aria-busy="true">Loading settings…</p>}
    </div>
  );
}
