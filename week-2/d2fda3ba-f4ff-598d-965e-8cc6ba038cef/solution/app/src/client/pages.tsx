// Single-column pages: device approval, invite acceptance and the operator console.
import { useEffect, useState } from "react";
import { ArrowLeft, User } from "lucide-react";
import { AccountDialog } from "./AccountDialog.tsx";
import { api, HttpError } from "./api.ts";
import { useApp } from "./store.ts";
import { CairnMark } from "./ui.tsx";
import { formatWhen } from "../shared/time.ts";
import type { Addon, OpsAccountRow, SweepResult, Vault, VaultDetail } from "../shared/types.ts";

function PageBar() {
  const [accountOpen, setAccountOpen] = useState(false);
  return (
    <header className="topbar page-bar">
      <a className="brand" href="/" aria-label="Cairn — back to the notebook"><ArrowLeft aria-hidden size={16} strokeWidth={1.5} /><CairnMark /> <span className="brand-name">Cairn</span></a>
      <button type="button" className="icon-button account-button" aria-label="Account" onClick={() => setAccountOpen(true)}>
        <User aria-hidden size={18} strokeWidth={1.5} /> <span className="button-text">Account</span>
      </button>
      {accountOpen && <AccountDialog onClose={() => setAccountOpen(false)} />}
    </header>
  );
}

export function ApprovalPage({ token }: { token: string }) {
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const approve = async () => {
    setBusy(true);
    try {
      await api("POST", `/api/device-approvals/${encodeURIComponent(token)}`);
      setStatus("Device approved. You can close this tab.");
    } catch (e) {
      const code = e instanceof HttpError ? e.code : "";
      setStatus(code === "link_expired" ? "This approval link has expired. Sign in again on the new device to get a fresh one."
        : code === "link_used" ? "This device is already approved."
          : code === "not_found" ? "This approval link isn't valid. Check that the whole link from the email was opened."
            : "The server can't be reached. Try the link again shortly.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="page">
      <PageBar />
      <main className="page-column">
        <h1 className="display">Approve a new device</h1>
        <p className="muted">A device signed in to your Cairn account and is waiting before it can pull any vault. Approve it only if you just signed in there.</p>
        <button type="button" className="button button-strong" disabled={busy} onClick={() => void approve()}>Approve this device</button>
        <p role="status" aria-label="Device approval status" className="page-status">{status}</p>
      </main>
    </div>
  );
}

export function InvitePage({ token }: { token: string }) {
  const app = useApp();
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const accept = async () => {
    setBusy(true);
    try {
      const { vault } = await api<{ vault: Vault }>("POST", `/api/invites/${encodeURIComponent(token)}/accept`);
      const detail = await api<VaultDetail>("GET", `/api/vaults/${vault.id}`).catch(() => null);
      const inviter = detail?.members.find((m) => m.role === "owner")?.display_name ?? "the vault owner";
      setStatus(`You've joined the vault. Enter the vault passphrase from ${inviter} to unlock it.`);
    } catch (e) {
      const code = e instanceof HttpError ? e.code : "";
      setStatus(code === "link_expired" ? "This invite has expired."
        : code === "invite_email_mismatch" ? "This invite was sent to a different email address."
          : code === "unauthenticated" ? "Sign in with the invited email address under Account, then accept."
            : code === "link_used" ? "This invite has already been used."
              : code === "not_found" ? "This invite link isn't valid."
                : "The server can't be reached. Try again shortly.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="page">
      <PageBar />
      <main className="page-column">
        <h1 className="display">Join a shared vault</h1>
        <p className="muted">
          {app.session.kind === "signed_in" ? `Signed in as ${app.session.account.email}. ` : "Sign in with the invited email address first. "}
          After you accept, the vault appears in your notebook switcher, locked until you enter the passphrase your partner gave you.
        </p>
        <button type="button" className="button button-strong" disabled={busy} onClick={() => void accept()}>Accept invite</button>
        <p role="status" aria-label="Vault status" className="page-status">{status}</p>
        <a className="text-link" href="/">Open the notebook</a>
      </main>
    </div>
  );
}

const STATE_COPY: Record<Addon["state"], string> = { none: "none", active: "active", ending: "ending", grace: "grace", lapsed: "lapsed" };

export function OpsConsole() {
  const app = useApp();
  const [rows, setRows] = useState<OpsAccountRow[] | null>(null);
  const [source, setSource] = useState("");
  const [denied, setDenied] = useState<string | null>(null);
  const [sweep, setSweep] = useState("");
  const zone = app.session.kind === "signed_in" ? app.session.account.time_zone : "UTC";
  const when = (iso: string | null) => (iso ? formatWhen(iso, zone) : "—");

  const load = async () => {
    try {
      const result = await api<{ source: "killbill" | "cache"; accounts: OpsAccountRow[] }>("GET", "/api/ops/accounts");
      setDenied(null);
      setRows(result.accounts);
      const oldest = result.accounts.map((r) => r.sync.checked_at).sort()[0];
      setSource(result.source === "killbill" ? "Live from Kill Bill" : `Billing unavailable — showing last known state from ${when(oldest ?? null)}`);
    } catch (e) {
      setDenied(e instanceof HttpError && e.status === 403 ? "This account isn't the operator account."
        : e instanceof HttpError && e.status === 401 ? "Sign in with the operator account to see the console."
          : "The server can't be reached.");
    }
  };
  useEffect(() => {
    void load();
  }, [app.session.kind]);

  const runSweep = async () => {
    setSweep("Running lapse check…");
    try {
      const r = await api<SweepResult>("POST", "/api/ops/sweep");
      setSweep(`Lapse check done: ${r.warnings_sent} warnings sent, ${r.dossiers_taken_down} dossiers taken down`);
    } catch (e) {
      setSweep(e instanceof HttpError && e.code === "sweep_running" ? "Another lapse check is still running — try again in a moment."
        : e instanceof HttpError ? e.message : "The server can't be reached.");
    }
    await load();
  };

  const columns = ["Account", "Time zone", "Sync", "Writable until", "Publish", "Warning at", "Takedown at", "Vaults", "Ciphertext blobs", "Stored bytes", "Live dossiers"];
  return (
    <div className="page">
      <PageBar />
      <main className="page-column page-wide">
        <h1 className="display">Operator console</h1>
        {denied ? <p className="page-status">{denied}</p> : rows === null ? <p className="muted">Loading accounts…</p> : (
          <>
            <div className="console-bar">
              <p role="status" aria-label="Billing source" className="billing-source">{source}</p>
              <button type="button" className="button" onClick={() => void runSweep()}>Run lapse check now</button>
              <p role="status" aria-label="Lapse check" className="lapse-status">{sweep}</p>
            </div>
            <div className="console-scroll">
              <table className="console" aria-label="Accounts">
                <thead><tr>{columns.map((c) => <th key={c} scope="col">{c}</th>)}</tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.account.id}>
                      <td data-label="Account"><strong>{r.account.display_name}</strong><br /><span className="muted">{r.account.email}</span></td>
                      <td data-label="Time zone">{r.account.time_zone}</td>
                      <td data-label="Sync"><span className={`state state-${r.sync.state}`}>{STATE_COPY[r.sync.state]}</span></td>
                      <td data-label="Writable until" className="num">{when(r.sync.writable_until)}</td>
                      <td data-label="Publish"><span className={`state state-${r.publish.state}`}>{STATE_COPY[r.publish.state]}</span></td>
                      <td data-label="Warning at" className="num">{when(r.publish.warning_at)}</td>
                      <td data-label="Takedown at" className="num">{when(r.publish.takedown_at)}</td>
                      <td data-label="Vaults" className="num">{r.vault_count}</td>
                      <td data-label="Ciphertext blobs" className="num">{r.blob_count}</td>
                      <td data-label="Stored bytes" className="num">{r.stored_bytes.toLocaleString("en-GB")}</td>
                      <td data-label="Live dossiers">{r.live_dossiers.length ? r.live_dossiers.map((d) => <span key={d.slug} className="slug mono">{d.slug}</span>) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="console-foot">Every stored revision passed the encrypted-envelope check on upload.</p>
          </>
        )}
      </main>
    </div>
  );
}
