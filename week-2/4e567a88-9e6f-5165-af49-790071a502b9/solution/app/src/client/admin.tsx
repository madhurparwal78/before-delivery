// The Admin screen: the org policy form (saved as numbered versions) and the list of saved versions.

import { useEffect, useState } from "preact/hooks";
import { ApiError, get, request, type Access, type Policy, type TeamAccess, type TeamPolicy } from "./api";
import { personName, setOrgZone, usePoll, when } from "./hooks";
import { CreditMeter } from "./meter";
import { JobDialog } from "./jobs";
import { teamNameOf, useSession } from "./session";
import { Alert, ScreenHead, TeamPicker } from "./ui";

interface Version {
  version: number;
  saved_by: { id: string; name: string } | string | null;
  saved_at: string;
}

const ACCESS_WORDS: Record<TeamAccess, string> = { allowed: "Allowed", blocked: "Blocked", inherit: "Inherit" };
const ZONES: string[] = Intl.supportedValuesOf("timeZone");

function Choice<T extends string>({ id, label, value, options, words, disabled, onChange }: {
  id: string;
  label: string;
  value: T;
  options: readonly T[];
  words: Record<T, string>;
  disabled: boolean;
  onChange: (value: T) => void;
}) {
  return (
    <div class="field">
      <label for={id}>{label}</label>
      <select id={id} value={value} disabled={disabled} onChange={(e) => onChange(e.currentTarget.value as T)}>
        {options.map((o) => <option key={o} value={o}>{words[o]}</option>)}
      </select>
    </div>
  );
}

function Count({ id, label, value, min, max, disabled, onChange }: {
  id: string;
  label: string;
  value: string;
  min: number;
  max: number;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <div class="field">
      <label for={id}>{label}</label>
      <input id={id} type="number" class="input num" min={min} max={max} step={1} value={value} disabled={disabled}
        onInput={(e) => onChange(e.currentTarget.value)} />
    </div>
  );
}

/** The editable copy keeps typed numbers as text until Save, so a half-typed value is never lost. */
type Draft = Omit<Policy, "teams"> & { teams: (Omit<TeamPolicy, "concurrency" | "soft_cap_credits" | "hard_cap_credits"> & {
  concurrency: string;
  soft_cap_credits: string;
  hard_cap_credits: string;
})[] };

const toDraft = (p: Policy): Draft => ({
  ...p,
  teams: p.teams.map((t) => ({
    ...t, concurrency: String(t.concurrency), soft_cap_credits: String(t.soft_cap_credits), hard_cap_credits: String(t.hard_cap_credits),
  })),
});

const whole = (text: string): number | string => (/^\d+$/.test(text.trim()) ? Number(text.trim()) : text);

export function AdminScreen() {
  const session = useSession();
  const { me, models, notify, teamId } = session;
  const editable = me.role === "admin";
  const [draft, setDraft] = useState<Draft | null>(null);
  const [versions, setVersions] = useState<Version[]>([]);
  const [alert, setAlert] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [openJob, setOpenJob] = useState<string | null>(null);

  const load = async () => {
    const { policy } = await get<{ policy: Policy }>("/api/policy");
    setOrgZone(policy.timezone);
    setDraft(toDraft(policy));
  };
  useEffect(() => {
    void load().catch(() => setAlert("The policy could not be loaded. Reload the page."));
  }, []);
  usePoll(async () => {
    setVersions((await get<{ versions: Version[] }>("/api/policy/versions")).versions);
  }, 5000, []);

  const team = (id: string, change: (t: Draft["teams"][number]) => Draft["teams"][number]) =>
    setDraft((d) => d && { ...d, teams: d.teams.map((t) => (t.id === id ? change(t) : t)) });

  const save = async (event: Event) => {
    event.preventDefault();
    if (!draft || busy) return;
    setBusy(true);
    setAlert(null);
    notify("Saving…");
    const body = {
      ...draft,
      teams: draft.teams.map((t) => ({
        ...t, concurrency: whole(t.concurrency), soft_cap_credits: whole(t.soft_cap_credits), hard_cap_credits: whole(t.hard_cap_credits),
      })),
    };
    try {
      const { data } = await request<{ policy: Policy }>("PUT", "/api/policy", { body });
      notify(`Policy saved as version ${data.policy.version}.`);
      setOrgZone(data.policy.timezone);
      setDraft(toDraft(data.policy));
      setVersions((await get<{ versions: Version[] }>("/api/policy/versions")).versions);
    } catch (failure) {
      notify("");
      if (failure instanceof ApiError && failure.body.code === "policy_version_stale") {
        setAlert(`Someone saved a newer policy (version ${String(failure.body.current_version)}). Reload to see it before saving again.`);
      } else if (failure instanceof ApiError && failure.body.fields) {
        setAlert(Object.entries(failure.body.fields).map(([path, message]) => `${path}: ${message}`).join(" "));
      } else setAlert(failure instanceof ApiError ? failure.message : "The policy did not reach Dispatch. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const contextOptions = ["allowed", "blocked", "inherit"] as const;
  const orgOptions = ["allowed", "blocked"] as const;
  const disabled = !editable;

  return (
    <div class="screen">
      <ScreenHead title="Admin"><TeamPicker id="admin-team" /></ScreenHead>
      <CreditMeter teamId={teamId} teamName={teamNameOf(session, teamId)} onOpenJob={setOpenJob} />
      {!draft ? <p class="muted">Loading the policy…</p> : (
        <form class="policy" aria-label="Org policy" onSubmit={save} noValidate>
          <section class="panel">
            <header class="panel__head">
              <h2 class="panel__title">Organisation</h2>
              <span class="panel__meta">Editing version <span class="num">{draft.version}</span>{editable ? "" : " · read only"}</span>
            </header>
            <div class="policy__row">
              <div class="field">
                <label for="policy-zone">Time zone</label>
                <select id="policy-zone" value={draft.timezone} disabled={disabled}
                  onChange={(e) => setDraft({ ...draft, timezone: e.currentTarget.value })}>
                  {(ZONES.includes(draft.timezone) ? ZONES : [draft.timezone, ...ZONES]).map((z) => <option key={z} value={z}>{z}</option>)}
                </select>
              </div>
              <div class="field">
                <label for="policy-retention">Retention</label>
                <select id="policy-retention" value={String(draft.retention_days)} disabled={disabled}
                  onChange={(e) => setDraft({ ...draft, retention_days: Number(e.currentTarget.value) })}>
                  {[7, 30, 90].map((d) => <option key={d} value={String(d)}>{d} days</option>)}
                </select>
              </div>
            </div>
          </section>
          {draft.teams.map((t) => (
            <fieldset key={t.id} class="panel policy__team" disabled={disabled}>
              <legend class="panel__title">{t.name}</legend>
              <div class="policy__row">
                <Count id={`${t.id}-concurrency`} label="Concurrency" value={t.concurrency} min={1} max={20} disabled={disabled}
                  onChange={(v) => team(t.id, (x) => ({ ...x, concurrency: v }))} />
                <Choice id={`${t.id}-visibility`} label="Payload visibility" value={t.payload_visibility}
                  options={["team", "restricted"] as const} words={{ team: "Team", restricted: "Restricted" }} disabled={disabled}
                  onChange={(v) => team(t.id, (x) => ({ ...x, payload_visibility: v }))} />
                <Count id={`${t.id}-soft`} label="Soft cap (credits)" value={t.soft_cap_credits} min={0} max={10_000_000}
                  disabled={disabled} onChange={(v) => team(t.id, (x) => ({ ...x, soft_cap_credits: v }))} />
                <Count id={`${t.id}-hard`} label="Hard cap (credits)" value={t.hard_cap_credits} min={0} max={10_000_000}
                  disabled={disabled} onChange={(v) => team(t.id, (x) => ({ ...x, hard_cap_credits: v }))} />
                <Choice id={`${t.id}-default-api`} label="Default for API" value={t.context_defaults.api}
                  options={contextOptions} words={ACCESS_WORDS} disabled={disabled}
                  onChange={(v) => team(t.id, (x) => ({ ...x, context_defaults: { ...x.context_defaults, api: v } }))} />
                <Choice id={`${t.id}-default-playground`} label="Default for playground" value={t.context_defaults.playground}
                  options={contextOptions} words={ACCESS_WORDS} disabled={disabled}
                  onChange={(v) => team(t.id, (x) => ({ ...x, context_defaults: { ...x.context_defaults, playground: v } }))} />
              </div>
              <div class="access-grid">
                {models.map((m) => {
                  const setting = t.model_access[m.slug] ?? { api: "inherit", playground: "inherit" };
                  const set = (context: "api" | "playground", v: TeamAccess) =>
                    team(t.id, (x) => ({ ...x, model_access: { ...x.model_access, [m.slug]: { ...setting, [context]: v } } }));
                  return (
                    <div key={m.slug} class="access-grid__model">
                      <Choice id={`${t.id}-${m.slug}-api`} label={`${m.name} API`} value={setting.api} options={contextOptions}
                        words={ACCESS_WORDS} disabled={disabled} onChange={(v) => set("api", v)} />
                      <Choice id={`${t.id}-${m.slug}-playground`} label={`${m.name} playground`} value={setting.playground}
                        options={contextOptions} words={ACCESS_WORDS} disabled={disabled} onChange={(v) => set("playground", v)} />
                    </div>
                  );
                })}
              </div>
            </fieldset>
          ))}
          <fieldset class="panel policy__team" disabled={disabled}>
            <legend class="panel__title">Org model access</legend>
            <div class="access-grid">
              {models.map((m) => {
                const setting = draft.org_model_access[m.slug] ?? { api: "allowed", playground: "allowed" };
                const set = (context: "api" | "playground", v: Access) =>
                  setDraft({ ...draft, org_model_access: { ...draft.org_model_access, [m.slug]: { ...setting, [context]: v } } });
                return (
                  <div key={m.slug} class="access-grid__model">
                    <Choice id={`org-${m.slug}-api`} label={`${m.name} API`} value={setting.api} options={orgOptions}
                      words={ACCESS_WORDS} disabled={disabled} onChange={(v) => set("api", v)} />
                    <Choice id={`org-${m.slug}-playground`} label={`${m.name} playground`} value={setting.playground}
                      options={orgOptions} words={ACCESS_WORDS} disabled={disabled} onChange={(v) => set("playground", v)} />
                  </div>
                );
              })}
            </div>
          </fieldset>
          <Alert text={alert} />
          {editable && (
            <div class="policy__save">
              <button type="submit" class="btn btn--primary" disabled={busy}>{busy ? "Saving…" : "Save policy"}</button>
            </div>
          )}
        </form>
      )}
      {draft && (
        <section class="panel">
          <header class="panel__head"><h2 class="panel__title">Policy versions</h2></header>
          <ol class="versions" aria-label="Policy versions">
            {versions.map((v) => (
              <li key={v.version} class="versions__item">
                <span class="num versions__number">Version {v.version}</span>
                <span>{personName(v.saved_by) === "—" ? "Seed" : personName(v.saved_by)}</span>
                <span class="num muted">{when(v.saved_at)}</span>
              </li>
            ))}
          </ol>
        </section>
      )}
      <JobDialog jobId={openJob} onClose={() => setOpenJob(null)} />
    </div>
  );
}
