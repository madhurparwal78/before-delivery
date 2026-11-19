import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { ADMIN_KINDS } from "../../../shared/screens.js";
import { homeScreen } from "../../../shared/types.js";
import { api, ApiFailure, failureText, get, post } from "../../lib/api.js";
import { useAnnounce } from "../../lib/announce.js";
import { Link, navigate, useLocation } from "../../lib/router.js";
import { useSession } from "../../lib/session.js";
import { Button, loadingScreen, Page, Rest, StatusBlock, useLoad } from "../../lib/ui.js";
import { NotFound } from "../NotFound.js";
import { KINDS, labelOf, ROLE_KEYS, saveCall, toBody, toValues, type FieldSpec, type KindSpec, type Plain, type Values } from "./adminKinds.js";
import { CheckField, Labelled } from "./controls.js";
import { formatLocalIso } from "../../../shared/tz.js";

export function Admin({ slug }: { slug: string }): JSX.Element {
  const kind = ADMIN_KINDS[slug];
  const spec = KINDS[slug];
  if (slug === "audit-log" && kind) return <AuditLog plural={kind.plural} />;
  if (!kind || !spec) return <NotFound />;
  return <AdminKind key={slug} slug={slug} spec={spec} plural={kind.plural} singular={kind.singular} />;
}

function AdminKind({ slug, spec, plural, singular }: { slug: string; spec: KindSpec; plural: string; singular: string }): JSX.Element {
  const session = useSession();
  const announce = useAnnounce();
  const { path, search } = useLocation();
  const selectedKey = search.get("record");
  const { state, reload } = useLoad(async () => (await get<Record<string, Plain[]>>(spec.listPath))[spec.listKey] ?? [], [slug, session.workspace, session.accessVersion]);
  const rows = state.status === "ready" ? state.data : null;
  const selected = rows && selectedKey !== null ? (rows.find((row) => String(row[spec.idKey]) === selectedKey) ?? null) : null;

  const blank = (): Plain => (slug === "users" ? { ...spec.blank, time_zone: session.user?.time_zone ?? "" } : spec.blank);
  const [values, setValues] = useState<Values>(() => toValues(spec, { ...blank() }));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [impersonating, setImpersonating] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const form = useRef<HTMLFormElement>(null);

  useEffect(() => {
    setSaved(null);
    setErrors({});
    setFormError(null);
  }, [selectedKey]);

  useEffect(() => {
    if (rows === null || (selectedKey !== null && selected === null)) return;
    setValues(toValues(spec, selected ?? blank()));
  }, [rows, selectedKey]);

  const pending = loadingScreen(state, plural.toLowerCase(), reload);
  if (pending || rows === null) return pending ?? <></>;

  const nameOf = (row: Plain): string => String(row[spec.nameKey] ?? row[spec.idKey] ?? "");

  const startNew = (): void => {
    navigate(path);
    setValues(toValues(spec, blank()));
    setErrors({});
    setFormError(null);
    setSaved(null);
    form.current?.querySelector<HTMLElement>("input:not([readonly]), textarea")?.focus();
  };

  const refused = (error: unknown): void => {
    const message = failureText(error);
    if (!(error instanceof ApiFailure)) {
      setFormError(message);
      announce(message);
      return;
    }
    const known = new Set(spec.fields.map((field) => field.key));
    const next: Record<string, string> = {};
    const loose: string[] = [];
    for (const [key, text] of Object.entries(error.fields ?? {})) {
      if (known.has(key)) next[key] = text;
      else loose.push(text);
    }
    if (error.code === "expression_error" && known.has("condition")) next.condition = message;
    setErrors(next);
    setFormError(error.code === "expression_error" && known.has("condition") ? null : [message, ...loose.filter((text) => text !== message)].join(" "));
    announce(message);
  };

  const save = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setSaved(null);
    setFormError(null);
    const { body, errors: mine } = toBody(spec, values);
    setErrors(mine);
    const count = Object.keys(mine).length;
    if (count > 0) {
      const message = `${count} ${count === 1 ? "problem" : "problems"} to fix before saving.`;
      setFormError(message);
      announce(message);
      return;
    }
    setBusy(true);
    const call = saveCall(slug, spec, selected, body, rows);
    try {
      await api(call.method, call.path, call.body);
      const message = `Saved ${String(body[spec.nameKey] ?? "") || singular}.`;
      setSaved(message);
      announce(message);
      const id = String(body[spec.idKey] ?? "");
      if (selected === null && id !== "") navigate(`${path}?record=${encodeURIComponent(id)}`, true);
      reload();
    } catch (error) {
      refused(error);
    }
    setBusy(false);
  };

  const impersonate = async (row: Plain): Promise<void> => {
    const username = String(row.username);
    setImpersonating(username);
    setListError(null);
    try {
      await post("/api/impersonate", { username });
      await session.refresh();
      navigate(homeScreen(Array.isArray(row.roles) ? (row.roles as string[]) : []));
    } catch (error) {
      setListError(failureText(error));
      setImpersonating(null);
    }
  };

  const set = (key: string, value: string | boolean | string[]): void => setValues((previous) => ({ ...previous, [key]: value }));

  const control = (field: FieldSpec): JSX.Element => {
    const label = labelOf(field.key);
    const value = values[field.key];
    if (field.kind === "bool") return <CheckField key={field.key} label={label} checked={value === true} onChange={(checked) => set(field.key, checked)} />;
    if (field.kind === "roles") return <RolesGroup key={field.key} chosen={Array.isArray(value) ? value : []} error={errors[field.key]} onChange={(roles) => set(field.key, roles)} />;
    const text = typeof value === "string" ? value : "";
    return (
      <div key={field.key}>
        <Labelled label={label} hint={field.hint} error={errors[field.key]}>
          {(described) =>
            field.kind === "area" || field.kind === "json" ? (
              <textarea {...described} rows={field.kind === "json" ? 4 : 2} value={text} onChange={(event) => set(field.key, event.target.value)} spellCheck={false} />
            ) : (
              <input
                {...described}
                type={field.kind === "secret" ? "password" : "text"}
                inputMode={field.kind === "number" ? "numeric" : undefined}
                autoComplete={field.kind === "secret" ? "new-password" : "off"}
                value={text}
                readOnly={field.fixed === true && selected !== null}
                onChange={(event) => set(field.key, event.target.value)}
              />
            )
          }
        </Labelled>
        {slug === "catalog-items" && field.key === "workflow" ? <FlowLink name={text} /> : null}
      </div>
    );
  };

  return (
    <Page subject={plural} wide>
      <div className="design-split">
        <Rest className="admin-list-section">
          <Button onClick={startNew}>{`New ${singular}`}</Button>
          {listError ? <p className="form-error">{listError}</p> : null}
          {rows.length === 0 ? <p className="muted">Nothing here yet.</p> : null}
          <ul role="list" aria-label={plural} className="admin-list">
            {rows.map((row) => {
              const id = String(row[spec.idKey]);
              const off = row.active === false || row.enabled === false;
              return (
                <li key={id} className="admin-row">
                  <Link to={`${path}?record=${encodeURIComponent(id)}`} aria-current={id === selectedKey ? "true" : undefined} className="admin-link">
                    {nameOf(row)}
                  </Link>
                  {off ? <StatusBlock outlined>{row.enabled === false ? "Disabled" : "Inactive"}</StatusBlock> : null}
                  {slug === "users" ? (
                    <Button variant="outline" busy={impersonating === id} disabled={impersonating !== null} onClick={() => void impersonate(row)}>
                      {`Impersonate ${nameOf(row)}`}
                    </Button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </Rest>
        <Rest className="admin-form-section">
          <form ref={form} aria-label={singular} className="stack admin-form" onSubmit={(event) => void save(event)}>
            <h2>{selected ? nameOf(selected) : `New ${singular}`}</h2>
            {spec.fields.map(control)}
            {formError ? <p className="form-error">{formError}</p> : null}
            {saved ? <p className="admin-saved">{saved}</p> : null}
            <div>
              <Button type="submit" busy={busy} disabled={busy}>{`Save ${singular}`}</Button>
            </div>
          </form>
        </Rest>
      </div>
    </Page>
  );
}

function RolesGroup({ chosen, error, onChange }: { chosen: string[]; error?: string; onChange: (roles: string[]) => void }): JSX.Element {
  const id = useId();
  return (
    <div className="field">
      <div role="group" aria-labelledby={id} className="roles-group">
        <span id={id} className="field-label">
          Roles
        </span>
        {ROLE_KEYS.map((role) => (
          <CheckField key={role} label={role} checked={chosen.includes(role)} onChange={(on) => onChange(on ? [...chosen, role] : chosen.filter((c) => c !== role))} />
        ))}
      </div>
      {error ? <p className="field-error">{error}</p> : null}
    </div>
  );
}

/** A link from a catalog item's flow name to that flow in the designer, once the flow is found in this workspace. */
function FlowLink({ name }: { name: string }): JSX.Element | null {
  const session = useSession();
  const [flows, setFlows] = useState<Array<{ id: number; name: string }>>([]);
  useEffect(() => {
    void get<{ workflows: Array<{ id: number; name: string }> }>("/api/workflows").then(
      (result) => setFlows(result.workflows),
      () => setFlows([]),
    );
  }, [session.workspace]);
  const flow = flows.find((candidate) => candidate.name === name);
  return flow ? (
    <p className="field-hint">
      <Link to={`/desk/workflows/${flow.id}`}>Open {flow.name} in the designer</Link>
    </p>
  ) : null;
}

interface AuditEntry {
  at: string;
  kind: string;
  actor: string;
  target: string;
}

function AuditLog({ plural }: { plural: string }): JSX.Element {
  const session = useSession();
  const zone = session.user?.time_zone ?? "UTC";
  const { state, reload } = useLoad(async () => (await get<{ entries: AuditEntry[] }>("/api/audit-log")).entries, [session.workspace, session.accessVersion]);
  const pending = loadingScreen(state, plural.toLowerCase(), reload);
  if (pending || state.status !== "ready") return pending ?? <></>;
  return (
    <Page subject={plural} wide>
      <Rest>
        {state.data.length === 0 ? <p className="muted">Nothing here yet.</p> : null}
        <ul role="list" aria-label={plural} className="admin-list">
          {state.data.map((entry, index) => (
            <li key={`${entry.at}:${index}`} className="admin-row audit-row">
              <StatusBlock outlined={entry.kind === "impersonation_stopped"}>{entry.kind === "impersonation_started" ? "Impersonation started" : "Impersonation stopped"}</StatusBlock>
              <span>
                {entry.actor} {entry.kind === "impersonation_started" ? "acting as" : "stopped acting as"} {entry.target}
              </span>
              <span className="muted">{formatLocalIso(entry.at, zone)}</span>
            </li>
          ))}
        </ul>
      </Rest>
    </Page>
  );
}
