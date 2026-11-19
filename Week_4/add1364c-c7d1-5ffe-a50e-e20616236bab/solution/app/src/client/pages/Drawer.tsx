import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { ApiError, get, patch, post, put } from "../lib/api";
import { useTitle } from "../lib/hooks";
import { addDays } from "../lib/office";
import { useRouter } from "../lib/router";
import { useEvent, useStore } from "../lib/store";
import type { AsOf, AsOfStub, Credential, Rule, Vault, Vendor } from "../lib/types";
import { Cylinder, EmptyFolder } from "../ui/art";
import { Count } from "../ui/Count";
import { Dialog } from "../ui/Dialog";
import { Field, SubmitButton, useFieldErrors, useOnce } from "../ui/Field";
import { NightRuler } from "./NightRuler";
import { RuleDialog, vaultDisplay } from "./RuleDialog";
import { Slip, vendorText } from "./Slip";
import { NotFound } from "./Simple";

const HIDE_MS = 30000;
interface Detail { vault: Vault; credentials: Credential[] }
type Dlg =
  | { kind: "turn"; credential: Credential }
  | { kind: "add" } | { kind: "newVault" } | { kind: "renameVault" }
  | { kind: "renameVendor"; credential: Credential }
  | { kind: "rule"; rule?: Rule };

function joinNames(names: string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

export function Drawer({ vaultId }: { vaultId: string | null }) {
  useTitle("Drawer");
  const { me, office, say, warn, bumpAudit, reduced, refreshClock, shownVaults } = useStore();
  const { navigate } = useRouter();
  const role = me?.role ?? "staff_accountant";
  const isOffice = role === "office_manager";
  const sees = role === "office_manager" || role === "managing_partner";

  const [vaults, setVaults] = useState<Vault[] | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [missing, setMissing] = useState(false);
  const [asOf, setAsOf] = useState<AsOf | null>(null);
  // The rail (stubs, count line) sits above the stack at phone and tablet widths: show neither until the first
  // as-of read has answered, so the stack does not jump down when the stubs arrive.
  const [asOfTried, setAsOfTried] = useState(false);
  const [night, setNight] = useState(1);
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [revealing, setRevealing] = useState<Record<string, boolean>>({});
  const [dialog, setDialog] = useState<Dlg | null>(null);
  const [vendors, setVendors] = useState<Vendor[] | null>(null);
  const [roving, setRoving] = useState<string | null>(null);
  const [stagger, setStagger] = useState<Record<string, number>>({});
  const timers = useRef(new Map<string, number>());
  const labels = useRef(new Map<string, string>());
  const nightRef = useRef(night);
  nightRef.current = night;
  const selectedRef = useRef<string | null>(null);
  const focusTarget = useRef<{ kind: "heading" } | { kind: "reveal"; id: string } | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const todayRef = useRef<string | null>(null);
  todayRef.current = office?.date ?? null;
  const dialogRef = useRef<Dlg | null>(null);
  dialogRef.current = dialog;
  const vaultsRef = useRef<Vault[] | null>(null);
  vaultsRef.current = vaults;
  const detailRef = useRef<Detail | null>(null);
  detailRef.current = detail;

  const selectedId = useMemo(() => {
    if (!vaults || vaults.length === 0) return null;
    if (vaultId && vaults.some((v) => v.id === vaultId)) return vaultId;
    return vaultId ? null : vaults[0]?.id ?? null;
  }, [vaults, vaultId]);
  selectedRef.current = selectedId;

  const loadVaults = useCallback(async () => {
    try {
      const body = await get<{ vaults: Vault[] }>("/api/vaults");
      setVaults(body.vaults);
      shownVaults.current = body.vaults.map((vault) => vault.id);
      return body.vaults;
    } catch { return null; }
  }, [shownVaults]);

  const loadDetail = useCallback(async (id: string) => {
    try {
      const body = await get<Detail>(`/api/vaults/${id}`);
      if (selectedRef.current === id) { setDetail(body); setMissing(false); }
      for (const c of body.credentials) labels.current.set(c.id, c.label);
    } catch (error) {
      if (error instanceof ApiError && error.status === 404 && selectedRef.current === id) setMissing(true);
    }
  }, []);

  const loadAsOf = useCallback(async () => {
    const today = todayRef.current;
    if (!sees || !today) return;
    const wanted = nightRef.current;
    try {
      const body = await get<AsOf>(`/api/as-of?night=${addDays(today, wanted)}`);
      if (nightRef.current === wanted && todayRef.current === today) setAsOf(body);
    } catch { /* a later change asks again */ }
    setAsOfTried(true);
  }, [sees]);
  useEffect(() => {
    // never hold the drawer back for long if the office clock is slow to answer
    const timer = window.setTimeout(() => setAsOfTried(true), 3000);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => { void loadVaults(); }, [loadVaults]);
  useEffect(() => {
    if (!isOffice) return;
    get<{ vendors: Vendor[] }>("/api/vendors").then((b) => setVendors(b.vendors)).catch(() => undefined);
  }, [isOffice, detail]);
  useEffect(() => { if (selectedId) { setDetail((d) => (d && d.vault.id === selectedId ? d : null)); void loadDetail(selectedId); } }, [selectedId, loadDetail]);
  useEffect(() => { setRoving(selectedId); }, [selectedId]);
  useEffect(() => { void loadAsOf(); }, [loadAsOf, night, office?.date]);

  const clearSecrets = useCallback(() => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current.clear();
    setSecrets({});
  }, []);
  useEffect(() => () => { timers.current.forEach((t) => window.clearTimeout(t)); }, []);
  useEffect(() => { clearSecrets(); }, [selectedId, clearSecrets]);

  // folder brought forward: the band rises behind the panel and the chosen tab lifts
  const panelRef = useRef<HTMLDivElement>(null);
  // Tabs keep their drawer place; a long stack only scrolls far enough to show the open folder's tab.
  const stackRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const box = stackRef.current;
    const row = selectedId ? box?.querySelector<HTMLElement>(`#tab-${CSS.escape(selectedId)}`)?.parentElement : null;
    if (!box || !row) return;
    if (row.offsetTop < box.scrollTop) box.scrollTop = row.offsetTop;
    else if (row.offsetTop + row.offsetHeight > box.scrollTop + box.clientHeight) box.scrollTop = row.offsetTop + row.offsetHeight - box.clientHeight;
  }, [selectedId, vaults?.length, asOfTried]);
  useLayoutEffect(() => {
    if (reduced || !selectedId) return;
    // The folder rises to the front: its band slides up behind the content while the content fades in.
    // Only paint moves, so every control keeps its place for pointer and keyboard while it plays.
    const ease = "cubic-bezier(0.16, 1, 0.3, 1)";
    const panel = panelRef.current;
    panel?.animate([{ transform: "translateY(48px)" }, { transform: "translateY(0)" }], { duration: 500, easing: ease, pseudoElement: "::before" });
    panel?.animate([{ opacity: 0.35 }, { opacity: 1 }], { duration: 500, easing: ease });
  }, [selectedId, reduced]);

  useLayoutEffect(() => {
    const target = focusTarget.current;
    if (!target) return;
    if (target.kind === "heading" && heading.current) { heading.current.focus(); focusTarget.current = null; }
    if (target.kind === "reveal") {
      const el = document.querySelector<HTMLElement>(`[data-reveal="${target.id}"]`);
      if (el) { el.focus(); focusTarget.current = null; }
    }
  });

  // ----- slips -----
  const hide = useCallback((id: string, auto: boolean) => {
    const timer = timers.current.get(id);
    if (timer !== undefined) window.clearTimeout(timer);
    timers.current.delete(id);
    setSecrets((s) => { if (!(id in s)) return s; const next = { ...s }; delete next[id]; return next; });
    if (auto) say(`${labels.current.get(id) ?? "Login"} hidden.`);
  }, [say]);

  const reveal = async (c: Credential) => {
    if (revealing[c.id]) return;
    setRevealing((r) => ({ ...r, [c.id]: true }));
    try {
      const body = await post<{ secret: string }>(`/api/credentials/${c.id}/reveal`, {});
      const old = timers.current.get(c.id);
      if (old !== undefined) window.clearTimeout(old);
      setSecrets((s) => ({ ...s, [c.id]: body.secret }));
      timers.current.set(c.id, window.setTimeout(() => hide(c.id, true), HIDE_MS));
      say(`${c.label} revealed.`);
      bumpAudit();
    } catch (error) {
      if (error instanceof ApiError) {
        warn(error.message);
        if (error.status === 404) { void loadVaults(); }
      }
    } finally {
      setRevealing((r) => { const next = { ...r }; delete next[c.id]; return next; });
    }
  };

  const copy = async (c: Credential) => {
    try {
      const body = await post<{ secret: string }>(`/api/credentials/${c.id}/copy`, {});
      await navigator.clipboard.writeText(body.secret);
      say(`${c.label} copied.`);
      bumpAudit();
    } catch (error) {
      if (error instanceof ApiError) warn(error.message);
      else warn("This browser blocked copying to the clipboard.");
    }
  };

  // ----- live pushes -----
  const turning = useRef<{ id: string; name: string }[]>([]);
  useEvent("rule-in-force", (data) => {
    const id = typeof data.vault_id === "string" ? data.vault_id : "";
    const name = typeof data.name === "string" ? data.name : "Vault";
    const first = turning.current.length === 0;
    turning.current.push({ id, name });
    if (!first) return;
    window.setTimeout(() => {
      const batch = turning.current;
      turning.current = [];
      const order = (vaultsRef.current ?? []).map((v) => v.id);
      batch.sort((x, y) => order.indexOf(x.id) - order.indexOf(y.id));
      setStagger(Object.fromEntries(batch.map((entry, index) => [entry.id, index * 250])));
      batch.forEach((entry, index) => { window.setTimeout(() => say(`${entry.name} rule now in force.`), index * 250); });
      void refreshClock().then(() => { void loadVaults(); void loadAsOf(); });
      window.setTimeout(() => setStagger({}), 4000);
    }, 200);
  });

  const onAccessChanged = (data: Record<string, unknown>) => {
    const cause = data.cause === "change" ? "change" : "boundary";
    const ended = Array.isArray(data.ended) ? (data.ended as { vault_id: string; name: string }[]) : [];
    const endedIds = new Set(ended.map((e) => e.vault_id));
    const before = vaultsRef.current;
    void (async () => {
      const list = await loadVaults();
      if (!list) return;
      const open = dialogRef.current;
      let refocus = false;
      if (open && (open.kind === "turn" || open.kind === "renameVendor") && endedIds.has(open.credential.vault_id)) { setDialog(null); refocus = true; }
      if (ended.length > 0) {
        setSecrets((s) => {
          const next = { ...s };
          for (const id of Object.keys(s)) {
            const credential = detailRef.current?.credentials.find((c) => c.id === id);
            if (credential && endedIds.has(credential.vault_id)) { delete next[id]; const t = timers.current.get(id); if (t !== undefined) window.clearTimeout(t); timers.current.delete(id); }
          }
          return next;
        });
        const order = (before ?? []).map((v) => v.id);
        const ordered = [...ended].sort((a, b) => order.indexOf(a.vault_id) - order.indexOf(b.vault_id)).map((e) => e.name);
        if (cause === "change") warn(`Your access to ${joinNames(ordered)} ended.`);
        else say("Your access changed. Some vaults are no longer shown.");
        const current = selectedRef.current;
        if (current && endedIds.has(current)) {
          const first = list[0];
          if (first) { navigate(`/desk/vaults/${first.id}`, true); refocus = true; }
          else navigate("/desk", true);
        }
      }
      if (refocus) focusTarget.current = { kind: "heading" };
      const current = selectedRef.current;
      if (current && !endedIds.has(current)) void loadDetail(current);
      void loadAsOf();
    })();
  };
  useEvent("access-changed", onAccessChanged);

  // ----- tabs -----
  const onTabKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (!vaults) return;
    let next = index;
    if (event.key === "ArrowRight") next = (index + 1) % vaults.length;
    else if (event.key === "ArrowLeft") next = (index - 1 + vaults.length) % vaults.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = vaults.length - 1;
    else return;
    event.preventDefault();
    const target = vaults[next];
    if (!target) return;
    setRoving(target.id);
    document.getElementById(`tab-${target.id}`)?.focus();
  };

  const reloadAll = async () => {
    await loadVaults();
    if (selectedRef.current) await loadDetail(selectedRef.current);
    await loadAsOf();
  };

  // ----- ruler / stubs -----
  const stubs = useMemo(() => {
    if (!sees || !vaults) return { asOf: [] as { vault: Vault; stub: AsOfStub }[], drafts: [] as { vault: Vault; rule: Rule }[] };
    const byId = new Map(vaults.map((v) => [v.id, v]));
    const list: { vault: Vault; stub: AsOfStub }[] = [];
    for (const entry of asOf?.vaults ?? []) {
      const vault = byId.get(entry.vault_id);
      if (!vault) continue;
      for (const stub of entry.stubs) list.push({ vault, stub });
    }
    const drafts: { vault: Vault; rule: Rule }[] = [];
    for (const vault of vaults) for (const rule of vault.pending_rules) if (rule.state === "drafted") drafts.push({ vault, rule });
    return { asOf: list, drafts };
  }, [sees, vaults, asOf]);

  const [signing, setSigning] = useState<string | null>(null);
  const sign = async (rule: Rule) => {
    if (signing) return;
    setSigning(rule.id);
    try {
      const signed = await post<Rule>(`/api/rules/${rule.id}/sign`, { version: rule.version });
      say(`Rule signed. ${signed.stub_text ?? ""}.`);
      bumpAudit();
    } catch (error) {
      if (error instanceof ApiError) warn(error.code === "rule_changed" ? error.message : "This rule can't be signed now.");
    } finally {
      setSigning(null);
      await loadVaults();
      await loadAsOf();
    }
  };

  const selIndex = vaults?.findIndex((v) => v.id === selectedId) ?? -1;
  const selBand = selIndex > 0 ? selIndex % 3 : 0;

  const cylinderFor = (id: string) => asOf?.vaults.find((v) => v.vault_id === id)?.cylinder;
  const selected = vaults?.find((v) => v.id === selectedId) ?? null;

  if (vaults && vaultId && !selectedId) return <NotFound inShell />;
  if (missing) return <NotFound inShell />;

  const orderedAsOfRule = (stub: AsOfStub, vault: Vault) => vault.pending_rules.find((r) => r.id === stub.rule_id);

  if (vaults === null || (sees && !asOfTried)) {
    return (
      <div className={`drawer ${sees ? "drawer-office" : ""}`}>
        {sees ? <NightRuler today={office?.date ?? ""} value={night} onChange={setNight} /> : null}
        <div className="stack-wrap">
          <div className="stack stack-loading">
            <div className="folder-ghost"><span className="folder-tab ghost-tab">Opening the drawer</span></div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`drawer ${sees ? "drawer-office" : ""}`} style={{ ["--sel" as string]: `var(--band-${selBand})`, ["--on-sel" as string]: selBand === 2 ? "var(--paper)" : "var(--ink)" }}>
      {sees ? (
        <NightRuler today={office?.date ?? ""} value={night} onChange={setNight} />
      ) : null}
      {sees ? (
        <section className="rail" aria-label="Pending rules">
          <h2 className="rail-title">Pending rules</h2>
          <button type="button" className="btn btn-solid btn-cut rail-new" onClick={() => setDialog({ kind: "rule" })}>New rule</button>
          <ul className="stubs" aria-label="Pending rules">
            {stubs.asOf.map(({ vault, stub }) => {
              const rule = orderedAsOfRule(stub, vault);
              return (
                <li className="stub" key={`${stub.rule_id}`}>
                  <span className="stub-vault">{vaultDisplay(vault)}</span>
                  <span className="stub-text fig">{stub.text}</span>
                  {rule ? <button type="button" className="btn btn-quiet" onClick={() => setDialog({ kind: "rule", rule })}>Edit rule</button> : null}
                </li>
              );
            })}
            {stubs.drafts.map(({ vault, rule }) => (
              <li className="stub stub-draft" key={rule.id}>
                <span className="stub-vault">{vaultDisplay(vault)}</span>
                <span className="stub-text fig">{rule.stub_text}</span>
                <span className="stub-actions">
                  <button type="button" className="btn btn-quiet" onClick={() => setDialog({ kind: "rule", rule })}>Edit rule</button>
                  {role === "managing_partner" ? <button type="button" className="btn btn-solid" aria-disabled={signing === rule.id || undefined} onClick={() => void sign(rule)}>{signing === rule.id ? "Signing" : "Sign rule"}</button> : null}
                </span>
              </li>
            ))}
          </ul>
          <p className="count-line">{asOf ? <><Count value={asOf.out_of_policy_count} /> logins out of policy on this night</> : " "}</p>
        </section>
      ) : null}

      <div className="stack-wrap">
        {vaults === null ? (
          <div className="stack stack-loading">
            <div className="folder-ghost"><span className="folder-tab ghost-tab">Opening the drawer</span></div>
          </div>
        ) : (
          <div role="tablist" aria-label="Vaults" className="stack" ref={stackRef}>
            {vaults.map((vault, index) => {
              const open = vault.id === selectedId;
              const cyl = cylinderFor(vault.id);
              const pos = index;
              return (
                <div
                  className="folder-row" role="presentation" key={vault.id}
                  style={{ ["--pos" as string]: pos, ["--col" as string]: pos % 5, ["--band" as string]: `var(--band-${pos % 3})`, ["--prev" as string]: pos === 0 ? "transparent" : `var(--band-${(pos - 1) % 3})` }}
                  data-band={pos % 3} data-p={pos % 3} data-open={open}
                >
                  <button
                    type="button"
                    role="tab"
                    id={`tab-${vault.id}`}
                    aria-label={vault.name}
                    aria-selected={open}
                    aria-controls={open ? "vault-panel" : undefined}
                    tabIndex={vault.id === roving ? 0 : -1}
                    className="folder-tab"
                    onClick={() => navigate(`/desk/vaults/${vault.id}`)}
                    onKeyDown={(e) => onTabKey(e, index)}
                    onFocus={() => setRoving(vault.id)}
                  >
                    <span className="tab-name">{vault.name}</span>
                    {sees && cyl ? <Cylinder name={`${vault.name} lock: rule ${cyl === "pending" ? "pending" : "in force"}`} turned={cyl === "in_force"} delay={stagger[vault.id] ?? 0} /> : null}
                  </button>
                </div>
              );
            })}
          </div>
        )}
        {isOffice && vaults ? (
          <div className="stack-actions"><button type="button" className="btn btn-quiet" onClick={() => setDialog({ kind: "newVault" })}>New vault</button></div>
        ) : null}
      </div>

      {selected && detail && detail.vault.id === selected.id ? (
        <div className="panel" role="tabpanel" id="vault-panel" aria-label={selected.name} ref={panelRef} data-band={selBand}>
          <header className="panel-head">
            <h2 tabIndex={-1} ref={heading}>{selected.name}{selected.formerly ? <small className="formerly"> (formerly {selected.formerly})</small> : null}</h2>
            <p className="rule-line fig">At least {detail.vault.rule_in_force.min_length} characters</p>
          </header>
          {detail.credentials.length === 0 ? (
            <div className="empty">
              <EmptyFolder />
              <p>Nothing filed here yet.</p>
            </div>
          ) : (
            <>
              <div className="ledger-head" aria-hidden="true"><span>Name</span><span>Held by</span><span>Next turn</span><span>Health</span></div>
              <ul className="slips" aria-label={`Logins in ${selected.name}`}>
                {detail.credentials.map((c) => (
                  <Slip
                    key={c.id}
                    credential={c}
                    secret={secrets[c.id] ?? null}
                    revealing={!!revealing[c.id]}
                    canTurn={isOffice || role === "staff_accountant"}
                    canRename={isOffice}
                    onReveal={() => void reveal(c)}
                    onHide={() => hide(c.id, false)}
                    onCopy={() => void copy(c)}
                    onTurn={() => setDialog({ kind: "turn", credential: c })}
                    onRenameVendor={() => setDialog({ kind: "renameVendor", credential: c })}
                  />
                ))}
              </ul>
            </>
          )}
          {isOffice ? (
            <div className="panel-actions">
              <button type="button" className="btn btn-solid btn-cut" disabled={vendors === null} onClick={() => setDialog({ kind: "add" })}>Add login</button>
              <button type="button" className="btn btn-quiet" onClick={() => setDialog({ kind: "renameVault" })}>Rename vault</button>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="panel panel-loading" data-band="0" style={{ background: "transparent" }}>{vaults !== null ? <p className="loading-text">Opening the drawer</p> : null}</div>
      )}

      {dialog?.kind === "turn" ? <TurnDialog credential={dialog.credential} vault={selected} onClose={() => setDialog(null)} onDone={(c) => { hide(c.id, false); void loadDetail(c.vault_id); void loadVaults(); }} /> : null}
      {dialog?.kind === "add" && selected && vendors ? <AddLoginDialog vendors={vendors} vault={selected} onClose={() => setDialog(null)} onDone={async (id) => { focusTarget.current = { kind: "reveal", id }; await loadDetail(selected.id); await loadVaults(); }} /> : null}
      {dialog?.kind === "newVault" ? <NewVaultDialog onClose={() => setDialog(null)} onDone={async (id) => { await loadVaults(); focusTarget.current = { kind: "heading" }; navigate(`/desk/vaults/${id}`); }} /> : null}
      {dialog?.kind === "renameVault" && selected ? <RenameDialog title="Rename vault" path={`/api/vaults/${selected.id}`} current={selected.name} onClose={() => setDialog(null)} onDone={reloadAll} /> : null}
      {dialog?.kind === "renameVendor" ? <RenameDialog title="Rename vendor" path={`/api/vendors/${dialog.credential.vendor.id}`} current={dialog.credential.vendor.name} onClose={() => setDialog(null)} onDone={reloadAll} /> : null}
      {dialog?.kind === "rule" && vaults ? (
        <RuleDialog vaults={vaults} defaultVaultId={selectedId ?? vaults[0]?.id ?? ""} rule={dialog.rule} onClose={() => setDialog(null)} onSaved={() => { bumpAudit(); void loadVaults().then(loadAsOf); }} onChanged={() => { void loadVaults().then(loadAsOf); }} />
      ) : null}
    </div>
  );
}

function TurnDialog({ credential, vault, onClose, onDone }: { credential: Credential; vault: Vault | null; onClose: () => void; onDone: (c: Credential) => void }) {
  const { say, warn, bumpAudit } = useStore();
  const [secret, setSecret] = useState("");
  const { errors, setErrors, formRef } = useFieldErrors();
  const { pending, run } = useOnce();
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      try {
        await put(`/api/credentials/${credential.id}/secret`, { secret });
        say(`${credential.label} turned.`);
        bumpAudit();
        onDone(credential);
        onClose();
      } catch (error) {
        if (error instanceof ApiError) {
          if (error.status === 422) setErrors({ secret: error.fields.secret ?? error.message });
          else warn(error.message);
        }
      }
    });
  };
  return (
    <Dialog label={`Turn ${credential.label}`} onClose={onClose} onSubmit={submit} formRef={formRef} returnFocus={() => document.querySelector<HTMLElement>(`[data-turn="${credential.id}"]`)}>
      <p className="muted">{vault ? `At least ${vault.rule_in_force.min_length} characters.` : ""}</p>
      <Field label="New password" error={errors.secret}>
        {(p) => <input {...p} type="password" autoComplete="new-password" value={secret} onChange={(e) => setSecret(e.target.value)} />}
      </Field>
      <div className="dialog-actions">
        <SubmitButton pending={pending} pendingText="Saving">Save new password</SubmitButton>
        <button type="button" className="btn btn-quiet" onClick={onClose}>Cancel</button>
      </div>
    </Dialog>
  );
}

function AddLoginDialog({ vendors, vault, onClose, onDone }: { vendors: Vendor[]; vault: Vault; onClose: () => void; onDone: (credentialId: string) => Promise<void> }) {
  const { say, warn, bumpAudit } = useStore();
  const [vendorId, setVendorId] = useState(vendors[0]?.id ?? "");
  const [label, setLabel] = useState("");
  const [username, setUsername] = useState("");
  const [secret, setSecret] = useState("");
  const { errors, setErrors, formRef } = useFieldErrors();
  const { pending, run } = useOnce();
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      try {
        const made = await post<Credential>("/api/credentials", { vault_id: vault.id, vendor_id: vendorId, label, username, secret });
        say(`${label} filed.`);
        bumpAudit();
        onClose();
        await onDone(made.id);
      } catch (error) {
        if (error instanceof ApiError) {
          warn("Check the highlighted fields.");
          const map: Record<string, string> = { vendor_id: "vendor", label: "label", username: "username", secret: "secret" };
          const next: Record<string, string> = {};
          for (const [k, v] of Object.entries(error.fields)) next[map[k] ?? k] = v;
          setErrors(next);
        }
      }
    });
  };
  return (
    <Dialog label="Add login" onClose={onClose} onSubmit={submit} formRef={formRef}>
      <Field label="Vendor" error={errors.vendor}>
        {(p) => (
          <select {...p} value={vendorId} onChange={(e) => setVendorId(e.target.value)}>
            {vendors.map((v) => <option key={v.id} value={v.id}>{vendorText(v)}</option>)}
          </select>
        )}
      </Field>
      <Field label="Login for" error={errors.label}>{(p) => <input {...p} value={label} onChange={(e) => setLabel(e.target.value)} />}</Field>
      <Field label="Username" error={errors.username}>{(p) => <input {...p} autoComplete="off" autoCapitalize="none" value={username} onChange={(e) => setUsername(e.target.value)} />}</Field>
      <Field label="Password" error={errors.secret} hint={`At least ${vault.rule_in_force.min_length} characters.`}>
        {(p) => <input {...p} type="password" autoComplete="new-password" value={secret} onChange={(e) => setSecret(e.target.value)} />}
      </Field>
      <div className="dialog-actions">
        <SubmitButton pending={pending} pendingText="Filing">File login</SubmitButton>
        <button type="button" className="btn btn-quiet" onClick={onClose}>Cancel</button>
      </div>
    </Dialog>
  );
}

function NewVaultDialog({ onClose, onDone }: { onClose: () => void; onDone: (id: string) => Promise<void> }) {
  const { say, warn, bumpAudit } = useStore();
  const [name, setName] = useState("");
  const [off, setOff] = useState(false);
  const { errors, setErrors, formRef } = useFieldErrors();
  const { pending, run } = useOnce();
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      try {
        const made = await post<Vault>("/api/vaults", { name, off_when_travelling: off });
        say(`${made.name} filed.`);
        bumpAudit();
        onClose();
        await onDone(made.id);
      } catch (error) {
        if (error instanceof ApiError) {
          warn("Check the highlighted fields.");
          setErrors({ name: error.fields.name ?? "", off: error.fields.off_when_travelling ?? "" });
        }
      }
    });
  };
  return (
    <Dialog label="New vault" onClose={onClose} onSubmit={submit} formRef={formRef}>
      <Field label="Vault name" error={errors.name || undefined}>{(p) => <input {...p} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
      <label className="check"><input type="checkbox" checked={off} onChange={(e) => setOff(e.target.checked)} /> <span>Off when travelling</span></label>
      <div className="dialog-actions">
        <SubmitButton pending={pending} pendingText="Filing">File vault</SubmitButton>
        <button type="button" className="btn btn-quiet" onClick={onClose}>Cancel</button>
      </div>
    </Dialog>
  );
}

function RenameDialog({ title, path, current, onClose, onDone }: { title: string; path: string; current: string; onClose: () => void; onDone: () => Promise<void> }) {
  const { say, warn, bumpAudit } = useStore();
  const [name, setName] = useState(current);
  const { errors, setErrors, formRef } = useFieldErrors();
  const { pending, run } = useOnce();
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      try {
        await patch(path, { name });
        say(`Renamed to ${name}.`);
        bumpAudit();
        onClose();
        await onDone();
      } catch (error) {
        if (error instanceof ApiError) { warn("Check the highlighted fields."); setErrors({ name: error.fields.name ?? error.message }); }
      }
    });
  };
  return (
    <Dialog label={title} onClose={onClose} onSubmit={submit} formRef={formRef}>
      <Field label="New name" error={errors.name}>{(p) => <input {...p} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
      <div className="dialog-actions">
        <SubmitButton pending={pending} pendingText="Saving">Save name</SubmitButton>
        <button type="button" className="btn btn-quiet" onClick={onClose}>Cancel</button>
      </div>
    </Dialog>
  );
}
