// Security page (owner): workspace key rotation and the audit trail (brief: Screens and layout,
// Security page; Interactions, Security; Feedback states, Encryption and Audit). The audit trail
// keeps its filters and page in the address: action, actor, cursor and prev.
import type { JSX } from "preact";
import { useEffect, useState } from "preact/hooks";
import { AUDIT_ACTIONS } from "../shared/auditActions";
import { formatCount, formatTime } from "../shared/format";
import { ApiError, type AuditEntry, type Encryption, api, query } from "./api";
import type { Scope } from "./console";
import { Dialog, Field, Status } from "./dialog";
import { Icon } from "./icons";
import { navigate, type Place } from "./router";


function EncryptionRegion({ scope, initial }: { scope: Scope; initial: Encryption | null }): JSX.Element {
  const [state, setState] = useState<Encryption | null>(initial);
  const [status, setStatus] = useState("");
  const [confirming, setConfirming] = useState(false);
  const path = `/api/w/${scope.ws}/encryption`;
  const load = async (): Promise<void> => setState(await api<Encryption>("GET", path));
  useEffect(() => {
    if (!initial) load().catch((e: unknown) => setStatus(scope.report(e)));
  }, [scope.ws]);

  const rotate = async (): Promise<void> => {
    setConfirming(false);
    setStatus("Rotating workspace key…");
    try {
      const result = await api<{ generation: number; rewrapped: number }>("POST", `${path}/rotate`);
      setStatus(`Workspace key rotated to generation ${formatCount(result.generation)}. ${formatCount(result.rewrapped)} data keys re-wrapped.`);
      await load();
    } catch (error) {
      setStatus(error instanceof ApiError && error.code === "rotation_in_progress"
        ? "Another rotation is running. Try again when it finishes." : scope.report(error));
    }
  };

  return (
    <section class="panel" role="region" aria-labelledby="encryption-title">
      <h2 id="encryption-title" class="panel__title">
        Encryption
      </h2>
      {state && (
        <p class="panel__line">
          {state.rotated_at
            ? <>Workspace key generation <span class="mono">{formatCount(state.generation)}</span>, rotated <span class="mono">{formatTime(state.rotated_at)}</span>.</>
            : <>Workspace key generation <span class="mono">1</span>, never rotated.</>}
        </p>
      )}
      <div class="form__actions form__actions--start">
        <button type="button" class="button" onClick={() => setConfirming(true)}>
          <Icon name="key" />
          Rotate workspace key
        </button>
      </div>
      <Status label="Encryption status" text={status} />
      {confirming && (
        <Dialog title="Rotate workspace key" onClose={() => setConfirming(false)}>
          <p class="dialog__text">Rotate the workspace key? Object bytes stay where they are; only their data keys are re-wrapped.</p>
          <div class="form__actions">
            <button type="button" class="button" onClick={() => setConfirming(false)}>
              Cancel
            </button>
            <button type="button" class="button button--primary" onClick={() => void rotate()}>
              Rotate
            </button>
          </div>
        </Dialog>
      )}
    </section>
  );
}

interface AuditQuery {
  action: string;
  actor: string;
  cursor: string | null;
  prev: string[];
}

function readAuditQuery(search: URLSearchParams): AuditQuery {
  return { action: search.get("action") ?? "", actor: search.get("actor") ?? "", cursor: search.get("cursor") || null, prev: search.getAll("prev") };
}

function auditHref(ws: string, q: AuditQuery): string {
  const search = new URLSearchParams();
  if (q.action) search.set("action", q.action);
  if (q.actor) search.set("actor", q.actor);
  if (q.cursor) {
    search.set("cursor", q.cursor);
    for (const cursor of q.prev) search.append("prev", cursor);
  }
  const text = search.toString();
  return `/console/${ws}/_security${text ? `?${text}` : ""}`;
}

function AuditRegion({ scope, place }: { scope: Scope; place: Place }): JSX.Element {
  const q = readAuditQuery(place.search);
  const [action, setAction] = useState(q.action);
  const [actor, setActor] = useState(q.actor);
  const [page, setPage] = useState<{ entries: AuditEntry[]; next_cursor: string | null } | null>(null);
  const [status, setStatus] = useState("");
  const [preparing, setPreparing] = useState(false);
  const path = `/api/w/${scope.ws}/audit`;
  const filters = { action: q.action || undefined, actor: q.actor || undefined };

  // Back and Forward restore the filters as well as the rows.
  useEffect(() => {
    setAction(q.action);
    setActor(q.actor);
  }, [q.action, q.actor]);

  useEffect(() => {
    let live = true;
    api<{ entries: AuditEntry[]; next_cursor: string | null }>("GET", `${path}${query({ ...filters, cursor: q.cursor ?? undefined })}`).then(
      (found) => {
        if (!live) return;
        setPage(found);
        if (found.entries.length === 0) setStatus("No audit entries match.");
      },
      (error: unknown) => {
        if (!live) return;
        setPage({ entries: [], next_cursor: null });
        const fields = error instanceof ApiError ? error.body.errors : undefined;
        setStatus(fields ? `Filter not accepted: ${Object.values(fields)[0] ?? ""}` : scope.report(error));
      },
    );
    return () => {
      live = false;
    };
  }, [place.href]);

  const go = (next: AuditQuery): void => navigate(auditHref(scope.ws, next));

  const apply = (event: Event): void => {
    event.preventDefault();
    go({ action, actor: actor.trim(), cursor: null, prev: [] });
  };

  const verify = async (): Promise<void> => {
    setStatus("Verifying chain…");
    try {
      const result = await api<{ ok: boolean; entries: number; first_broken_seq: number | null }>("GET", `${path}/verify`);
      setStatus(result.ok ? `Chain verified: ${formatCount(result.entries)} entries intact.`
        : `Chain broken at entry ${formatCount(result.first_broken_seq ?? 0)}.`);
    } catch (error) {
      setStatus(scope.report(error));
    }
  };

  // The export for the current filters, downloaded from this origin as an attachment.
  const download = async (): Promise<void> => {
    setPreparing(true);
    try {
      const response = await fetch(`${path}/export.csv${query(filters)}`);
      if (!response.ok) throw new ApiError(response.status, await response.json());
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = `farshore-${scope.ws}-audit.csv`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      setStatus(scope.report(error));
    }
    setPreparing(false);
  };

  return (
    <section class="panel" role="region" aria-labelledby="audit-title">
      <h2 id="audit-title" class="panel__title">
        Audit trail
      </h2>
      <form class="toolbar toolbar--audit" onSubmit={apply}>
        <Field label="Action">
          {(described, id) => (
            <select id={id} value={action} aria-describedby={described} onChange={(e) => setAction(e.currentTarget.value)}>
              <option value="">All actions</option>
              {AUDIT_ACTIONS.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Actor">
          {(described, id) => (
            <input id={id} value={actor} spellcheck={false} aria-describedby={described} onInput={(e) => setActor(e.currentTarget.value)} />
          )}
        </Field>
        <button type="submit" class="button">
          Apply audit filters
        </button>
      </form>
      <div class="table-frame">
        <table class="table table--cards" aria-label="Audit trail">
          <thead>
            <tr>
              <th scope="col" class="cell--num">Seq</th>
              <th scope="col">Time (UTC)</th>
              <th scope="col">Actor</th>
              <th scope="col">Action</th>
              <th scope="col">Target</th>
              <th scope="col">Detail</th>
            </tr>
          </thead>
          <tbody>
            {(page?.entries ?? []).map((e) => (
              <tr key={e.seq}>
                <td data-label="Seq" class="mono cell--num">{formatCount(e.seq)}</td>
                <td data-label="Time (UTC)" class="mono cell--nowrap">{formatTime(e.at)}</td>
                <td data-label="Actor" class="cell--wrap" title={e.actor}>{e.actor}</td>
                <td data-label="Action" class="mono cell--nowrap">{e.action}</td>
                <td data-label="Target" class="cell--wrap" title={e.target}>{e.target}</td>
                <td data-label="Detail" class="cell--wrap" title={e.detail}>{e.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* The paging bar waits for the first page, so rows arriving never push it down. */}
      {page && (
        <div class="paging">
          <button type="button" class="button" disabled={!q.cursor} onClick={() => {
            const prev = [...q.prev];
            go({ ...q, cursor: prev.pop() || null, prev });
          }}>
            <Icon name="chevron-left" />
            Newer entries
          </button>
          <button type="button" class="button" disabled={!page?.next_cursor} onClick={() =>
            go({ ...q, cursor: page?.next_cursor ?? null, prev: [...q.prev, q.cursor ?? ""] })}>
            Older entries
            <Icon name="chevron-right" />
          </button>
          <button type="button" class="button" onClick={() => void verify()}>
            <Icon name="shield-check" />
            Verify chain
          </button>
          <button type="button" class="button" disabled={preparing} onClick={() => void download()}>
            <Icon name="download" />
            Download audit CSV
          </button>
        </div>
      )}
      <Status label="Audit status" text={status} />
    </section>
  );
}

// The key line loads before the regions render, so it never appears late and pushes the audit trail down.
// A failed load leaves the region to retry and report in its own status line.
export function Security({ scope, place }: { scope: Scope; place: Place }): JSX.Element {
  const [encryption, setEncryption] = useState<{ state: Encryption | null } | null>(null);
  useEffect(() => {
    setEncryption(null);
    api<Encryption>("GET", `/api/w/${scope.ws}/encryption`).then((state) => setEncryption({ state }), () => setEncryption({ state: null }));
  }, [scope.ws]);
  if (!encryption) return <section class="page" aria-label="Security" />;
  return (
    <section class="page" aria-labelledby="security-title">
      <div class="page__head">
        <h1 id="security-title" class="page__title">
          Security
        </h1>
      </div>
      <EncryptionRegion scope={scope} initial={encryption.state} />
      <AuditRegion scope={scope} place={place} />
    </section>
  );
}
