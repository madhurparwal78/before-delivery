// The Account dialog (sign-in, account creation, plans, devices, vault, invites, sign-out) and the
// vault passphrase dialogs.
import { useEffect, useRef, useState, type FormEvent } from "react";
import { KeyRound, LogOut, Mail, ShieldCheck } from "lucide-react";
import { api, HttpError, NetworkError } from "./api.ts";
import { MIN_PASSPHRASE } from "./crypto.ts";
import {
  activeNotebook, createAccount, enableSync, invitePartner, loadBilling, loadDossiers, requestUnlock, signIn, signOut, unlockVault,
  type AccountResult,
} from "./sync.ts";
import { update, useApp } from "./store.ts";
import { ErrorLine, Modal } from "./ui.tsx";
import { formatWhen } from "../shared/time.ts";
import type { Addon, AddonName, Billing, Device } from "../shared/types.ts";

const BILLING_OUTAGE = "Billing is unavailable. Your plan hasn't changed — try again shortly.";

export function AccountDialog({ onClose }: { onClose: () => void }) {
  const app = useApp();
  const [status, setStatus] = useState("");
  return (
    <Modal title="Account" onClose={onClose} className="account-dialog">
      {app.session.kind === "signed_in"
        ? <SignedIn status={status || `Signed in as ${app.session.account.email}`} />
        : <SignedOut onStatus={setStatus} status={status} />}
    </Modal>
  );
}

function SignedOut({ status, onStatus }: { status: string; onStatus: (s: string) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [deviceName, setDeviceName] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [alert, setAlert] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const finish = (result: AccountResult, success: string) => {
    setBusy(false);
    if (result.ok) {
      onStatus(success);
      return;
    }
    onStatus("");
    const error = result.error;
    if (error instanceof NetworkError) {
      setAlert("The server can't be reached. Your notes are safe on this device; try again when you're online.");
    } else if (error.code === "invalid_credentials") {
      onStatus("Wrong email or password.");
      setAlert("Wrong email or password.");
    } else {
      const given = error.body?.error.fields ?? {};
      setFields(given);
      setAlert(Object.values(given).join(" ") || error.message);
    }
  };
  const submit = async (event: FormEvent, action: "sign_in" | "create") => {
    event.preventDefault();
    setFields({});
    setAlert(null);
    setBusy(true);
    if (action === "sign_in") {
      onStatus("Signing in…");
      finish(await signIn(email, password, deviceName), "");
    } else {
      onStatus("Creating account…");
      finish(await createAccount(email, password, displayName, deviceName), "Account created — this browser is your first device.");
    }
  };
  const field = (name: string, label: string, value: string, set: (v: string) => void, type = "text", auto = "") => (
    <label className="field">
      <span>{label}</span>
      <input name={name} aria-label={label} type={type} value={value} autoComplete={auto} aria-invalid={Boolean(fields[name])}
        aria-describedby={fields[name] ? `${name}-error` : undefined} onChange={(e) => set(e.target.value)} />
      {fields[name] && <span className="field-error" id={`${name}-error`}>{fields[name]}</span>}
    </label>
  );
  return (
    <form className="stack" onSubmit={(e) => void submit(e, "sign_in")}>
      <p className="muted">Sync and Publish need an account. The notebook itself never does.</p>
      {field("email", "Email", email, setEmail, "email", "email")}
      {field("password", "Password", password, setPassword, "password", "current-password")}
      {field("display_name", "Display name", displayName, setDisplayName, "text", "name")}
      {field("device_name", "Device name", deviceName, setDeviceName, "text", "off")}
      <p className="hint">Display name is needed only to create an account.</p>
      <div className="modal-actions">
        <button type="submit" className="button" disabled={busy}>Sign in</button>
        <button type="button" className="button" disabled={busy} onClick={(e) => void submit(e, "create")}>Create account</button>
      </div>
      <p className="account-status" role="status" aria-label="Account status">{status}</p>
      {alert && <ErrorLine>{alert}</ErrorLine>}
    </form>
  );
}

function planLine(name: string, addon: Addon & { writable_until?: string | null; takedown_at?: string | null }, zone: string): string | null {
  const when = (iso: string | null | undefined) => (iso ? formatWhen(iso, zone) : "");
  switch (addon.state) {
    case "none": return null;
    case "active": return `${name} active`;
    case "ending": return `${name} ends ${when(addon.period_end)}`;
    case "grace": return name === "Sync" ? `Sync ended — writable until ${when(addon.writable_until)}` : `Publish ended — dossiers go offline ${when(addon.takedown_at)}`;
    case "lapsed": return name === "Sync" ? "Sync has lapsed — vaults are read-only" : "Publish has lapsed";
  }
}

function SignedIn({ status }: { status: string }) {
  const app = useApp();
  const session = app.session.kind === "signed_in" ? app.session : null;
  const [devices, setDevices] = useState<Device[]>([]);
  const [planStatus, setPlanStatus] = useState("");
  const [vaultStatus, setVaultStatus] = useState("");
  const [dialog, setDialog] = useState<"passphrase" | "invite" | null>(null);
  const zone = session?.account.time_zone ?? "UTC";

  useEffect(() => {
    api<{ devices: Device[] }>("GET", "/api/devices").then((r) => setDevices(r.devices)).catch(() => undefined);
    void loadBilling().then((billing) => {
      if (!billing) setPlanStatus(BILLING_OUTAGE);
    });
  }, [session?.device.approved]);

  const describe = (billing: Billing) => [planLine("Sync", billing.sync, zone), planLine("Publish", billing.publish, zone)]
    .filter(Boolean).join(" · ") || "No add-ons yet. The notebook is free.";
  const shownPlan = planStatus || (app.billing ? describe(app.billing) : "");

  const change = async (addon: AddonName, action: "add" | "cancel") => {
    setPlanStatus("Updating plan…");
    try {
      const billing = action === "add"
        ? await api<Billing>("POST", "/api/billing/subscriptions", { addon })
        : await api<Billing>("DELETE", `/api/billing/subscriptions/${addon}`);
      update({ billing });
      setPlanStatus(describe(billing));
      if (addon === "publish") void loadDossiers();
    } catch (e) {
      setPlanStatus(e instanceof HttpError && e.code !== "billing_unavailable" ? e.message : BILLING_OUTAGE);
    }
  };
  const can = (addon: AddonName, action: "add" | "cancel") => {
    const state = app.billing?.[addon].state;
    if (!state) return true;
    return action === "add" ? state === "none" || state === "grace" || state === "lapsed" : state === "active";
  };

  const notebook = activeNotebook();
  const vault = app.vaults.find((v) => v.id === notebook.vaultId);
  const approved = session?.device.approved ?? false;

  return (
    <div className="stack">
      <p className="account-status" role="status" aria-label="Account status">{status}</p>
      <section className="panel" role="region" aria-label="Plans">
        <h3 className="panel-title">Plans</h3>
        <div className="plan-grid">
          <div className="plan">
            <p><strong>Sync</strong> <span className="muted">· 6.00 USD a month</span></p>
            <p className="muted">End-to-end encrypted revisions between your devices and a partner's.</p>
            <div className="button-row">
              <button type="button" className="button" disabled={!can("sync", "add")} onClick={() => void change("sync", "add")}>Add Sync</button>
              <button type="button" className="button" disabled={!can("sync", "cancel")} onClick={() => void change("sync", "cancel")}>Cancel Sync</button>
            </div>
          </div>
          <div className="plan">
            <p><strong>Publish</strong> <span className="muted">· 9.00 USD a month</span></p>
            <p className="muted">Public dossiers from a bounded slice of the case.</p>
            <div className="button-row">
              <button type="button" className="button" disabled={!can("publish", "add")} onClick={() => void change("publish", "add")}>Add Publish</button>
              <button type="button" className="button" disabled={!can("publish", "cancel")} onClick={() => void change("publish", "cancel")}>Cancel Publish</button>
            </div>
          </div>
        </div>
        <p className="plan-status" role="status" aria-label="Plan status">{shownPlan}</p>
      </section>
      <section className="panel">
        <h3 className="panel-title">Vault</h3>
        {vault ? (
          <>
            <p><ShieldCheck aria-hidden size={16} strokeWidth={1.5} /> <strong>{vault.name}</strong> <span className="muted">· {vault.role === "owner" ? "you own this vault" : "shared with you"}</span></p>
            {vault.role === "owner" && (
              <button type="button" className="button" onClick={() => setDialog("invite")}><Mail aria-hidden size={16} strokeWidth={1.5} /> Invite partner</button>
            )}
          </>
        ) : (
          <>
            <p className="muted">This notebook lives only on this device. Syncing encrypts every revision here first; the server never sees your notes.</p>
            <button type="button" className="button" disabled={!approved} onClick={() => setDialog("passphrase")}>
              <KeyRound aria-hidden size={16} strokeWidth={1.5} /> Enable sync for this notebook
            </button>
          </>
        )}
        <p role="status" aria-label="Vault status" className="vault-status">{vaultStatus}</p>
      </section>
      <section className="panel">
        <h3 className="panel-title">Devices</h3>
        <ul className="devices" aria-label="Devices">
          {devices.map((d) => (
            <li key={d.id}><span>{d.name}{d.id === session?.device.id ? " (this browser)" : ""}</span>
              <span className={`badge ${d.approved ? "badge-synced" : "badge-pending"}`}>{d.approved ? "approved" : "waiting for approval"}</span></li>
          ))}
        </ul>
      </section>
      <div className="modal-actions">
        <button type="button" className="button" onClick={() => void signOut()}><LogOut aria-hidden size={16} strokeWidth={1.5} /> Sign out</button>
      </div>
      {dialog === "passphrase" && <SetPassphrase onDone={(copy) => { setDialog(null); if (copy) setVaultStatus(copy); }} />}
      {dialog === "invite" && vault && <InvitePartner vaultId={vault.id} onDone={(copy) => { setDialog(null); if (copy) setVaultStatus(copy); }} />}
    </div>
  );
}

function SetPassphrase({ onDone }: { onDone: (status: string | null) => void }) {
  const [passphrase, setPassphrase] = useState("");
  const [confirm, setConfirm] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (passphrase.length < MIN_PASSPHRASE) return setError(`Use at least ${MIN_PASSPHRASE} characters.`);
    if (passphrase !== confirm) return setError("The two passphrases don't match.");
    setStatus("Creating vault…");
    try {
      await enableSync(passphrase);
      onDone("Vault created — this notebook now syncs");
    } catch (e) {
      setStatus("");
      setError(e instanceof HttpError && e.code === "sync_not_entitled" ? "Creating a vault needs the Sync add-on — add it under Plans."
        : e instanceof HttpError && e.code === "billing_unavailable" ? BILLING_OUTAGE
          : e instanceof Error ? e.message : "The vault could not be created.");
    }
  };
  return (
    <Modal title="Set vault passphrase" onClose={() => onDone(null)}>
      <form className="stack" onSubmit={(e) => void submit(e)}>
        <p className="muted">The passphrase wraps the vault key in this browser. Cairn never receives it and can't recover it. Share it with a partner in person or over a channel you trust.</p>
        <label className="field"><span>Vault passphrase</span>
          <input type="password" aria-label="Vault passphrase" value={passphrase} autoComplete="new-password" onChange={(e) => setPassphrase(e.target.value)} />
        </label>
        <label className="field"><span>Confirm passphrase</span>
          <input type="password" aria-label="Confirm passphrase" value={confirm} autoComplete="new-password" onChange={(e) => setConfirm(e.target.value)} />
        </label>
        <div className="modal-actions"><button type="submit" className="button">Create vault</button></div>
        <p role="status" className="vault-status">{status}</p>
        {error && <ErrorLine>{error}</ErrorLine>}
      </form>
    </Modal>
  );
}

function InvitePartner({ vaultId, onDone }: { vaultId: string; onDone: (status: string | null) => void }) {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    try {
      await invitePartner(vaultId, email);
      onDone(`Invite created — an email is on its way to ${email}`);
    } catch (e) {
      setError(e instanceof HttpError ? e.body?.error.fields?.email ?? e.message : "The server can't be reached.");
    }
  };
  return (
    <Modal title="Invite partner" onClose={() => onDone(null)}>
      <form className="stack" onSubmit={(e) => void submit(e)}>
        <p className="muted">The invite email carries only an accept link. Give your partner the vault passphrase separately.</p>
        <label className="field"><span>Partner email</span>
          <input type="email" aria-label="Partner email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <div className="modal-actions"><button type="submit" className="button">Send invite</button></div>
        {error && <ErrorLine>{error}</ErrorLine>}
      </form>
    </Modal>
  );
}

/** The Unlock vault dialog, opened for each vault this device can't read yet. */
export function PassphraseDialogs() {
  const app = useApp();
  const vault = app.vaults.find((v) => v.id === app.unlockVaultId);
  if (!vault) return null;
  return <UnlockVault key={vault.id} vaultId={vault.id} name={vault.name} />;
}

function UnlockVault({ vaultId, name }: { vaultId: string; name: string }) {
  const [passphrase, setPassphrase] = useState("");
  const [status, setStatus] = useState("");
  const box = useRef<HTMLInputElement>(null);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setStatus("Unlocking…");
    const result = await unlockVault(vaultId, passphrase);
    if (result === "wrong_passphrase") setStatus("That passphrase doesn't unlock this vault.");
    if (result === "unavailable") setStatus("The vault can't be reached right now. Try again shortly.");
  };
  return (
    <Modal title="Unlock vault" onClose={() => requestUnlock(null)} initialFocus={box}>
      <form className="stack" onSubmit={(e) => void submit(e)}>
        <p className="muted"><strong>{name}</strong> is encrypted. Enter its vault passphrase to read it on this device.</p>
        <label className="field"><span>Vault passphrase</span>
          <input ref={box} type="password" aria-label="Vault passphrase" value={passphrase} autoComplete="current-password" onChange={(e) => setPassphrase(e.target.value)} />
        </label>
        <div className="modal-actions"><button type="submit" className="button">Unlock</button></div>
        <p role="status" aria-label="Vault status" className="vault-status">{status}</p>
      </form>
    </Modal>
  );
}
