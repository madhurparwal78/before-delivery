// Operator console `/ops`, `/ops/workspaces`, `/ops/billing` (brief: Screens and layout, Operator console;
// Feedback states, Operator).
import type { JSX } from "preact";
import { useEffect, useState } from "preact/hooks";
import { formatCount, formatTime } from "../shared/format";
import { ApiError, type OpsBilling, type OpsRegion, type OpsWorkspace, api } from "./api";
import { ILLEGAL_TRANSITION, generalCopy } from "./copy";
import { SignOut } from "./console";
import { Dialog, Field, Status } from "./dialog";
import { Icon } from "./icons";
import { type Place, follow } from "./router";

const SECTIONS = [
  ["/ops", "Regions"],
  ["/ops/workspaces", "Workspaces"],
  ["/ops/billing", "Billing"],
] as const;

const dash = "—";
const OPS_REREAD_MS = 2000;

// Operator figures re-read every two seconds and update in place; an open dialog, its typed text,
// focus and caret are untouched because only the rows' data changes.
function useLiveRead(read: () => Promise<void>, onError: (error: unknown) => void): void {
  useEffect(() => {
    read().catch(onError);
    const timer = setInterval(() => void read().catch(() => undefined), OPS_REREAD_MS);
    return () => clearInterval(timer);
  }, []);
}

function operatorCopy(error: unknown): string {
  return error instanceof ApiError && error.code === "invalid_transition" ? ILLEGAL_TRANSITION : generalCopy(error);
}

function OpsRail({ path, onNavigate }: { path: string; onNavigate: () => void }): JSX.Element {
  return (
    <div class="rail">
      <p class="rail__workspace">Farshore operator</p>
      <nav aria-label="Operator" class="rail__section">
        <ul class="rail__list">
          {SECTIONS.map(([href, label]) => (
            <li key={href}>
              <a class="rail__link" href={href} aria-current={path === href ? "page" : undefined}
                onClick={(e) => {
                  follow(e, href);
                  onNavigate();
                }}>
                {label}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      <a class="rail__link rail__account" href="/account">
        <Icon name="user" />
        Account
      </a>
      <SignOut />
    </div>
  );
}

function Regions({ onStatus }: { onStatus: (text: string) => void }): JSX.Element {
  const [regions, setRegions] = useState<OpsRegion[]>([]);
  useLiveRead(async () => setRegions((await api<{ regions: OpsRegion[] }>("GET", "/api/ops/regions")).regions), (e) => onStatus(generalCopy(e)));

  const setState = async (region: OpsRegion, state: "online" | "offline"): Promise<void> => {
    try {
      const updated = await api<OpsRegion>("POST", `/api/ops/regions/${region.id}/state`, { state });
      setRegions((all) => all.map((r) => (r.id === updated.id ? updated : r)));
      onStatus(`${updated.name} is now ${updated.state}.`);
    } catch (error) {
      onStatus(operatorCopy(error));
    }
  };

  const runLifecycle = async (): Promise<void> => {
    try {
      const run = await api<{ expired_versions: number; aborted_uploads: number; skipped_locked: number }>("POST", "/api/ops/lifecycle/run");
      onStatus(
        `Lifecycle run: ${formatCount(run.expired_versions)} versions expired, ${formatCount(run.aborted_uploads)} uploads aborted, ${formatCount(run.skipped_locked)} held versions skipped.`,
      );
    } catch (error) {
      onStatus(operatorCopy(error));
    }
  };

  return (
    <section class="page" aria-labelledby="regions-title">
      <div class="page__head">
        <h1 id="regions-title" class="page__title">
          Regions
        </h1>
        <button type="button" class="button button--primary" onClick={() => void runLifecycle()}>
          Run lifecycle now
        </button>
      </div>
      <div class="table-frame">
        <table class="table table--cards table--ops" aria-label="Region backlog">
          <thead>
            <tr>
              <th scope="col">Region</th>
              <th scope="col">State</th>
              <th scope="col" class="num">Pending</th>
              <th scope="col" class="num">Failed</th>
              <th scope="col" class="num">Oldest pending</th>
              <th scope="col" class="cell--actions">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {regions.map((region) => (
              <tr key={region.id}>
                <td data-label="Region">{region.name}</td>
                <td data-label="State">
                  <span class={`state state--${region.state}`}>{region.state}</span>
                </td>
                <td data-label="Pending" class="num">{formatCount(region.pending)}</td>
                <td data-label="Failed" class="num">{formatCount(region.failed)}</td>
                <td data-label="Oldest pending" class="num">
                  {region.oldest_pending_ms === null ? dash : `${formatCount(region.oldest_pending_ms)} ms`}
                </td>
                <td class="cell--actions">
                  {region.state === "online" ? (
                    <button type="button" class="button button--small button--region" onClick={() => void setState(region, "offline")}>
                      Take {region.name} offline
                    </button>
                  ) : (
                    <button type="button" class="button button--small button--region" onClick={() => void setState(region, "online")}>
                      Bring {region.name} online
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Workspaces({ onStatus }: { onStatus: (text: string) => void }): JSX.Element {
  const [workspaces, setWorkspaces] = useState<OpsWorkspace[]>([]);
  const [suspending, setSuspending] = useState<OpsWorkspace | null>(null);
  useLiveRead(async () => setWorkspaces((await api<{ workspaces: OpsWorkspace[] }>("GET", "/api/ops/workspaces")).workspaces),
    (e) => onStatus(generalCopy(e)));
  const replace = (updated: OpsWorkspace): void => setWorkspaces((all) => all.map((w) => (w.slug === updated.slug ? updated : w)));

  const reinstate = async (workspace: OpsWorkspace): Promise<void> => {
    try {
      replace(await api<OpsWorkspace>("POST", `/api/ops/workspaces/${workspace.slug}/reinstate`));
      onStatus(`${workspace.name} reinstated.`);
    } catch (error) {
      onStatus(operatorCopy(error));
    }
  };

  return (
    <section class="page" aria-labelledby="workspaces-title">
      <h1 id="workspaces-title" class="page__title">
        Workspaces
      </h1>
      <div class="table-frame">
        <table class="table table--cards table--ops" aria-label="Workspaces">
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Slug</th>
              <th scope="col">Plan</th>
              <th scope="col" class="num">Members</th>
              <th scope="col" class="num">Buckets</th>
              <th scope="col">Status</th>
              <th scope="col" class="cell--actions">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {workspaces.map((workspace) => (
              <tr key={workspace.slug}>
                <td data-label="Name">{workspace.name}</td>
                <td data-label="Slug" class="mono">{workspace.slug}</td>
                <td data-label="Plan">{workspace.plan}</td>
                <td data-label="Members" class="num">{formatCount(workspace.members)}</td>
                <td data-label="Buckets" class="num">{formatCount(workspace.buckets)}</td>
                <td data-label="Status">
                  <span class={`state state--${workspace.status}`}>{workspace.status}</span>
                  {workspace.suspended_reason && <span class="cell__sub">{workspace.suspended_reason}</span>}
                </td>
                <td class="cell--actions">
                  {workspace.status === "active" ? (
                    <button type="button" class="button button--small" onClick={() => setSuspending(workspace)}>
                      Suspend {workspace.name}
                    </button>
                  ) : (
                    <button type="button" class="button button--small" onClick={() => void reinstate(workspace)}>
                      Reinstate {workspace.name}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {suspending && (
        <SuspendDialog
          workspace={suspending}
          onDone={(updated) => {
            replace(updated);
            setSuspending(null);
            onStatus(`${updated.name} suspended.`);
          }}
          onStatus={onStatus}
          onClose={() => setSuspending(null)}
        />
      )}
    </section>
  );
}

interface SuspendDialogProps {
  workspace: OpsWorkspace;
  onDone: (updated: OpsWorkspace) => void;
  onStatus: (text: string) => void;
  onClose: () => void;
}

function SuspendDialog({ workspace, onDone, onStatus, onClose }: SuspendDialogProps): JSX.Element {
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");

  const suspend = async (event: Event): Promise<void> => {
    event.preventDefault();
    setError("");
    try {
      onDone(await api<OpsWorkspace>("POST", `/api/ops/workspaces/${workspace.slug}/suspend`, { reason }));
    } catch (failure) {
      const message = failure instanceof ApiError ? failure.body.errors?.["reason"] : undefined;
      if (message) setError(message);
      else onStatus(operatorCopy(failure));
    }
  };

  return (
    <Dialog title="Suspend workspace" onClose={onClose}>
      <form class="form" onSubmit={suspend}>
        <p class="dialog__lead">
          Suspending {workspace.name} pauses its uploads, downloads, share links and S3 access, and emails its owners the reason.
        </p>
        <Field label="Reason" hint="1 to 280 characters." error={error}>
          {(described, id) => (
            <textarea id={id} rows={3} value={reason} aria-describedby={described} aria-invalid={error ? true : undefined}
              onInput={(e) => setReason(e.currentTarget.value)} />
          )}
        </Field>
        <div class="form__actions">
          <button type="button" class="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" class="button button--primary">
            Suspend
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function Billing({ onStatus }: { onStatus: (text: string) => void }): JSX.Element {
  const [billing, setBilling] = useState<OpsBilling | null>(null);
  const load = async (): Promise<void> => setBilling(await api<OpsBilling>("GET", "/api/ops/billing"));
  useLiveRead(load, (e) => onStatus(generalCopy(e)));

  const sync = async (): Promise<void> => {
    try {
      const result = await api<{ posted: number; queued: number }>("POST", "/api/ops/billing/sync");
      onStatus(`Billing sync: ${formatCount(result.posted)} rows posted, ${formatCount(result.queued)} still queued.`);
      await load();
    } catch (error) {
      onStatus(operatorCopy(error));
    }
  };

  const facts: [string, string][] = billing
    ? [
        ["State", billing.state.replace("_", " ")],
        ["Queued rows", formatCount(billing.queued_rows)],
        ["Posted rows", formatCount(billing.posted_rows)],
        ["Last attempt", billing.last_attempt_at ? formatTime(billing.last_attempt_at) : dash],
        ["Last error", billing.last_error ?? dash],
      ]
    : [];
  return (
    <section class="page" aria-labelledby="billing-title">
      <div class="page__head">
        <h1 id="billing-title" class="page__title">
          Billing
        </h1>
        <button type="button" class="button button--primary" onClick={() => void sync()}>
          Sync billing now
        </button>
      </div>
      <dl class="facts facts--panel">
        {facts.map(([term, value]) => (
          <div key={term}>
            <dt>{term}</dt>
            <dd class="mono">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export function Ops({ place }: { place: Place }): JSX.Element {
  const [status, setStatus] = useState("");
  const [navOpen, setNavOpen] = useState(false);
  const section = place.path.replace(/\/+$/, "");
  const page =
    section === "/ops/workspaces" ? <Workspaces onStatus={setStatus} /> : section === "/ops/billing" ? <Billing onStatus={setStatus} /> : <Regions onStatus={setStatus} />;
  return (
    <div class="console console--ops">
      <a class="skip" href="#ops-main" onClick={(e) => {
        e.preventDefault();
        document.getElementById("ops-main")?.focus();
      }}>
        Skip to content
      </a>
      <header class="console__bar">
        <button type="button" class="button button--icon" aria-label="Operator pages" onClick={() => setNavOpen(true)}>
          <Icon name="menu" />
        </button>
        <span class="console__bar-name">Farshore operator</span>
      </header>
      <aside class="console__rail">
        <OpsRail path={section} onNavigate={() => undefined} />
      </aside>
      <main id="ops-main" class="console__main" tabIndex={-1}>
        <div class="notices">
          <Status label="Operator status" text={status} />
        </div>
        {page}
      </main>
      {navOpen && (
        <Dialog title="Navigation" titleHidden sheet onClose={() => setNavOpen(false)}>
          <button type="button" class="button button--icon nav-dialog__close" aria-label="Close navigation" onClick={() => setNavOpen(false)}>
            <Icon name="x" />
          </button>
          <OpsRail path={section} onNavigate={() => setNavOpen(false)} />
        </Dialog>
      )}
    </div>
  );
}
