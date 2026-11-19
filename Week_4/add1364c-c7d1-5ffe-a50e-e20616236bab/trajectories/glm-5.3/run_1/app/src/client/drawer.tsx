import { StrictMode, useEffect, useState, useRef, useCallback, useMemo, type ReactNode } from 'react';
import { api, ApiError, type Vault, type Credential, type AsOfAnswer, type Rule, displayOfficeDate, type Person } from './api.js';
import { useApp } from './core.js';
import { DeskShell, type Navigate } from './shell.js';
import { getEvents } from './events.js';
import { Dialog } from './dialog.js';

/* ------------------------------------------------------------------ */
/* Reveal timers: each revealed slip owns its own hide timer.           */
/* ------------------------------------------------------------------ */

interface RevealedState {
  secret: string;
  timer: number;
}

class RevealTimers {
  private readonly revealed = new Map<string, RevealedState>();
  private readonly listeners = new Set<() => void>();

  show(credentialId: string, secret: string, onHide: (credentialId: string) => void): void {
    const existing = this.revealed.get(credentialId);
    if (existing) {
      window.clearTimeout(existing.timer);
    }
    const timer = window.setTimeout(() => {
      this.revealed.delete(credentialId);
      onHide(credentialId);
      this.emit();
    }, 30000);
    this.revealed.set(credentialId, { secret, timer });
    this.emit();
  }

  hide(credentialId: string): void {
    const existing = this.revealed.get(credentialId);
    if (existing) {
      window.clearTimeout(existing.timer);
      this.revealed.delete(credentialId);
      this.emit();
    }
  }

  secretOf(credentialId: string): string | null {
    return this.revealed.get(credentialId)?.secret ?? null;
  }

  hideAllOf(vaultId: string, credentialsOfVault: string[]): void {
    void vaultId;
    for (const id of credentialsOfVault) {
      this.hide(id);
    }
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

let timers: RevealTimers | null = null;
function getTimers(): RevealTimers {
  if (!timers) timers = new RevealTimers();
  return timers;
}

/* ------------------------------------------------------------------ */
/* Drawer                                                              */
/* ------------------------------------------------------------------ */

export function Drawer(props: { navigate: Navigate; route: string }): ReactNode {
  const { me, status, alert } = useApp();
  const [vaults, setVaults] = useState<Vault[] | null>(null);
  const [openVaultId, setOpenVaultId] = useState<string | null>(null);
  const [credentials, setCredentials] = useState<Record<string, Credential[]>>({});
  const [asOf, setAsOf] = useState<AsOfAnswer | null>(null);
  const [night, setNight] = useState<number>(1);
  const [outage, setOutage] = useState<string | null>(null);
  const [sessionEnded, setSessionEnded] = useState(false);
  const [droppedAt, setDroppedAt] = useState(0);
  const [, forceTick] = useState(0);
  const seesRules = me?.role === 'office_manager' || me?.role === 'managing_partner';
  const loading = vaults === null;

  const pathname = props.route.split('?')[0] ?? props.route;
  const routeVaultId = pathname.startsWith('/desk/vaults/') ? pathname.slice('/desk/vaults/'.length) : null;

  const loadVaults = useCallback(async (): Promise<Vault[]> => {
    const answer = await api<{ vaults: Vault[] }>('GET', '/api/vaults');
    setVaults(answer.vaults);
    return answer.vaults;
  }, []);

  // initial load and event stream
  useEffect(() => {
    void loadVaults().catch(() => undefined);
    const events = getEvents();
    const offs: Array<() => void> = [];
    offs.push(
      events.on('access-changed', (data) => {
        void loadVaults().then((fresh) => {
          const visible = (data.vault_ids as string[] | undefined) ?? fresh.map((vault) => vault.id);
          const ended = (data.ended as Array<{ vault_id: string; name: string }> | undefined) ?? [];
          // Within five seconds: hide every revealed secret and any open Turn dialog in a dropped vault.
          const droppedIds = fresh
            .filter((vault) => !visible.includes(vault.id))
            .map((vault) => vault.id);
          for (const droppedId of droppedIds) {
            const creds = credentials[droppedId] ?? [];
            for (const credential of creds) {
              getTimers().hide(credential.id);
            }
          }
          setCredentials((current) => {
            const next: Record<string, Credential[]> = {};
            for (const [vaultId, list] of Object.entries(current)) {
              if (visible.includes(vaultId)) next[vaultId] = list;
            }
            return next;
          });
          setVaults(fresh.filter((vault) => visible.includes(vault.id)));
          if (ended.length > 0) {
            if (data.cause === 'boundary') {
              status('Your access changed. Some vaults are no longer shown.');
            } else {
              const names = ended.map((entry) => entry.name);
              const joined =
                names.length === 1
                  ? names[0]
                  : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
              alert(`Your access to ${joined} ended.`);
            }
          }
          const wasOpenDropped = openVaultId !== null && droppedIds.includes(openVaultId);
          setOpenVaultId((current) => {
            if (current && visible.includes(current)) return current;
            return fresh.length > 0 ? fresh[0].id : null;
          });
          if (wasOpenDropped) {
            // An open Turn dialog on the dropped vault closes; the folder that opens next takes focus.
            setDroppedAt(Date.now());
          }
        });
      })
    );
    offs.push(
      events.on('session-ended', () => {
        setSessionEnded(true);
      })
    );
    offs.push(
      events.on('rule-in-force', (data) => {
        status(`${String(data.name)} rule now in force.`);
        void loadVaults().catch(() => undefined);
        void loadAsOf(nightRef.current).catch(() => undefined);
      })
    );
    const timerSub = getTimers().subscribe(() => forceTick((value) => value + 1));
    return () => {
      for (const off of offs) off();
      timerSub();
    };
  }, []);

  const nightRef = useRef(night);
  nightRef.current = night;

  const loadAsOf = useCallback(async (value: number): Promise<void> => {
    if (!seesRules) return;
    const today = new Date();
    const target = addDaysIso(today.toISOString().slice(0, 10), value);
    try {
      const answer = await api<AsOfAnswer>('GET', `/api/as-of?night=${target}`);
      if (answer.night === target) setAsOf(answer);
    } catch {
      // discard answers for a night no longer chosen
    }
  }, [seesRules]);

  useEffect(() => {
    void loadAsOf(night);
  }, [night, loadAsOf]);

  // open the route's vault, or the first
  useEffect(() => {
    if (vaults === null) return;
    if (routeVaultId && vaults.some((vault) => vault.id === routeVaultId)) {
      setOpenVaultId(routeVaultId);
    } else if (!routeVaultId) {
      setOpenVaultId((current) => (current && vaults.some((v) => v.id === current) ? current : vaults.length > 0 ? vaults[0].id : null));
    }
  }, [routeVaultId, vaults]);

  const openVault = vaults?.find((vault) => vault.id === openVaultId) ?? null;

  // load credentials of the open vault
  useEffect(() => {
    if (!openVaultId) return;
    void api<{ vault: Vault; credentials: Credential[] }>('GET', `/api/vaults/${openVaultId}`)
      .then((answer) => {
        setCredentials((current) => ({ ...current, [openVaultId]: answer.credentials }));
      })
      .catch(() => undefined);
  }, [openVaultId, vaults]);

  if (sessionEnded) {
    return <SessionEndedScreen next={props.route} navigate={props.navigate} />;
  }

  return (
    <DeskShell navigate={props.navigate}>
      {loading ? (
        <div className="loading">Opening the drawer</div>
      ) : (
        <>
          {seesRules ? <NightRuler night={night} setNight={setNight} asOf={asOf} /> : null}
          {seesRules ? <PendingRules asOf={asOf} vaults={vaults ?? []} /> : null}
          {outage ? <div className="outage-band" role="alert">{outage}</div> : null}
          <VaultTablist
            vaults={vaults ?? []}
            openVaultId={openVaultId}
            seesRules={seesRules}
            asOf={asOf}
            navigate={props.navigate}
            onOpen={(id) => {
              const leaving = openVaultId;
              if (leaving && credentials[leaving]) {
                getTimers().hideAllOf(leaving, credentials[leaving].map((credential) => credential.id));
              }
              setOpenVaultId(id);
            }}
          >
            {openVault ? (
              <OpenFolder
                key={`${openVault.id}-${droppedAt}`}
                focusHeading={droppedAt > 0}
                vault={openVault}
                credentials={credentials[openVault.id] ?? null}
                navigate={props.navigate}
                onReloadVaults={() => void loadVaults()}
              />
            ) : (
              <EmptyDrawer />
            )}
          </VaultTablist>
        </>
      )}
    </DeskShell>
  );
}

function addDaysIso(dateStr: string, days: number): string {
  const date = new Date(`${dateStr}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function SessionEndedScreen(props: { next: string; navigate: Navigate }): ReactNode {
  return (
    <main className="session-ended-screen">
      <div className="paper slip">
        <h1>Your reveal session has ended</h1>
        <p>Sign in again to reveal logins.</p>
        <a
          href={`/sign-in?next=${encodeURIComponent(props.next)}`}
          onClick={(event) => {
            event.preventDefault();
            props.navigate(`/sign-in?next=${encodeURIComponent(props.next)}`);
          }}
        >
          Sign in
        </a>
      </div>
    </main>
  );
}

function EmptyDrawer(): ReactNode {
  return <div className="open-folder empty-folder">Nothing filed here yet.</div>;
}

/* ------------------------------------------------------------------ */
/* Night ruler                                                         */
/* ------------------------------------------------------------------ */

function NightRuler(props: { night: number; setNight: (value: number) => void; asOf: AsOfAnswer | null }): ReactNode {
  const { clock } = useApp();
  const trackRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const reducedMotion = useMemo(
    () => typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    []
  );

  const nights = useMemo(() => {
    const today = clock?.office_date ?? new Date().toISOString().slice(0, 10);
    return Array.from({ length: 60 }, (_, index) => addDaysIso(today, index + 1));
  }, [clock?.office_date]);

  const chosen = nights[props.night - 1] ?? nights[0];
  const valueText = `${displayOfficeDate(chosen)}, 00:00 ${offsetOf(chosen, clock)}`;

  const onKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
      event.preventDefault();
      props.setNight(Math.min(60, props.night + 1));
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
      event.preventDefault();
      props.setNight(Math.max(1, props.night - 1));
    } else if (event.key === 'Home') {
      event.preventDefault();
      props.setNight(1);
    } else if (event.key === 'End') {
      event.preventDefault();
      props.setNight(60);
    }
  };

  const onPointer = (event: React.PointerEvent): void => {
    void event;
  };

  return (
    <section className="night-ruler-region" aria-label="Lockset turns at midnight">
      <h2 className="region-heading">Lockset turns at midnight</h2>
      <div
        ref={trackRef}
        className="night-ruler-track"
        onPointerDown={(event) => {
          dragging.current = true;
          event.currentTarget.setPointerCapture(event.pointerId);
          updateFromPointer(event.clientX, trackRef.current, nights.length, props.setNight);
        }}
        onPointerMove={(event) => {
          if (!dragging.current) return;
          event.preventDefault();
          updateFromPointer(event.clientX, trackRef.current, nights.length, props.setNight);
        }}
        onPointerUp={(event) => {
          dragging.current = false;
          event.currentTarget.releasePointerCapture(event.pointerId);
        }}
      >
        <div
          role="slider"
          tabIndex={0}
          aria-label="Night ruler"
          aria-valuemin={1}
          aria-valuemax={60}
          aria-valuenow={props.night}
          aria-valuetext={valueText}
          onKeyDown={onKeyDown}
          className="night-ruler-handle"
          style={{ left: `${((props.night - 1) / 59) * 100}%` }}
        >
          <span className="ruler-date">{displayOfficeDate(chosen)}</span>
          <span className="ruler-offset">{offsetOf(chosen, clock)}</span>
        </div>
        <div className="night-ruler-marks" aria-hidden="true">
          {nights.map((night, index) => (
            <span key={night} className={index % 5 === 0 ? 'mark major' : 'mark'} />
          ))}
        </div>
      </div>
      {props.asOf ? (
        <p className="out-of-policy-count">{`${props.asOf.out_of_policy_count} logins out of policy on this night`}</p>
      ) : null}
      {reducedMotion ? null : null}
    </section>
  );
}

function offsetOf(dateStr: string, clock: { office_date: string; offset: string } | null): string {
  if (clock && clock.office_date === dateStr) return clock.offset;
  const date = new Date(`${dateStr}T12:00:00Z`);
  // CST is UTC-6 (second Sunday March to first Sunday November)
  const month = Number(dateStr.slice(5, 7));
  const day = Number(dateStr.slice(8, 10));
  if (month > 3 && month < 11) return 'CDT';
  if (month === 3 && day >= 8) return 'CDT';
  if (month === 11 && day < 1) return 'CDT';
  void date;
  return 'CST';
}

function updateFromPointer(clientX: number, track: HTMLDivElement | null, count: number, setNight: (value: number) => void): void {
  if (!track) return;
  const rect = track.getBoundingClientRect();
  const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  const index = Math.round(ratio * (count - 1)) + 1;
  setNight(index);
}

/* ------------------------------------------------------------------ */
/* Pending rules                                                       */
/* ------------------------------------------------------------------ */

function PendingRules(props: { asOf: AsOfAnswer | null; vaults: Vault[] }): ReactNode {
  const { me, status, alert } = useApp();
  const [dialog, setDialog] = useState<'new' | { edit: Rule } | null>(null);
  const orderOf = useMemo(() => {
    const order = new Map<string, number>();
    props.vaults.forEach((vault, index) => order.set(vault.id, index));
    return order;
  }, [props.vaults]);

  const asOfStubs = (props.asOf?.vaults ?? []).flatMap((vault) =>
    vault.stubs.map((stub) => ({ vaultId: vault.vault_id, vaultName: vault.name, stub, cylinder: vault.cylinder }))
  );
  const draftStubs = props.vaults.flatMap((vault) =>
    vault.pending_rules
      .filter((rule) => rule.state === 'drafted')
      .map((rule) => ({ vaultId: vault.id, vaultName: vault.name, rule }))
  );
  const scheduledStubs = props.vaults.flatMap((vault) =>
    vault.pending_rules.filter((rule) => rule.state === 'scheduled').map((rule) => ({ vaultId: vault.id, vaultName: vault.name, rule }))
  );

  return (
    <section className="pending-rules" aria-label="Pending rules">
      <h2 className="region-heading">Pending rules</h2>
      <ul aria-label="Pending rules">
        {asOfStubs.map((entry) => (
          <li key={`asof-${entry.stub.rule_id}`} className="stub perforated">
            <span className="stub-text">{entry.stub.text}</span>
          </li>
        ))}
        {scheduledStubs.map((entry) => (
          <li key={`sched-${entry.rule.id}`} className="stub perforated">
            <span className="stub-text">{entry.rule.stub_text ?? ''}</span>
            <span className="stub-buttons">
              {me?.role === 'office_manager' ? (
                <button onClick={() => setDialog({ edit: entry.rule })}>Edit rule</button>
              ) : null}
            </span>
          </li>
        ))}
        {draftStubs.map((entry) => (
          <li key={`draft-${entry.rule.id}`} className="stub perforated">
            <span className="stub-text">{entry.rule.stub_text ?? ''}</span>
            <span className="stub-buttons">
              {me?.role === 'managing_partner' ? (
                <button onClick={() => void signRule(entry.rule, status, alert)}>Sign rule</button>
              ) : null}
              {me?.role === 'office_manager' ? (
                <button onClick={() => setDialog({ edit: entry.rule })}>Edit rule</button>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
      <button className="solid" onClick={() => setDialog('new')}>New rule</button>
      {dialog ? <RuleDialog dialog={dialog} vaults={props.vaults} onClose={() => setDialog(null)} status={status} alert={alert} /> : null}
    </section>
  );
}

async function signRule(rule: Rule, status: (m: string) => void, alert: (m: string) => void): Promise<void> {
  try {
    const answer = await api<Rule>('POST', `/api/rules/${rule.id}/sign`, { version: rule.version });
    status(`Rule signed. Takes force 00:00 CST, ${displayOfficeDate(answer.effective_on)}.`);
    window.location.reload();
  } catch (error) {
    if (error instanceof ApiError) {
      alert(error.message);
    }
  }
}

function RuleDialog(props: {
  dialog: 'new' | { edit: Rule };
  vaults: Vault[];
  onClose: () => void;
  status: (m: string) => void;
  alert: (m: string) => void;
}): ReactNode {
  const editing = props.dialog === 'new' ? null : props.dialog.edit;
  const [vaultId, setVaultId] = useState(editing?.vault_id ?? props.vaults[0]?.id ?? '');
  const [minLength, setMinLength] = useState(String(editing?.min_length ?? 16));
  const [effectiveOn, setEffectiveOn] = useState(editing?.effective_on ?? '');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const firstField = useRef<HTMLSelectElement>(null);

  useEffect(() => {
    firstField.current?.focus();
  }, []);

  const submit = async (): Promise<void> => {
    if (pending) return;
    setPending(true);
    try {
      if (editing) {
        await api<Rule>('PATCH', `/api/rules/${editing.id}`, {
          version: editing.version,
          min_length: Number(minLength),
          effective_on: effectiveOn
        });
      } else {
        await api<Rule>('POST', '/api/rules', {
          vault_id: vaultId,
          min_length: Number(minLength),
          effective_on: effectiveOn
        });
      }
      props.status('Rule saved as a draft.');
      window.location.reload();
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.fields) setFields(error.fields);
        props.alert(error.message);
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog label={editing ? 'Edit rule' : 'New rule'} onClose={props.onClose}>
      <div className="dialog-body paper slip">
        <h2>{editing ? 'Edit rule' : 'New rule'}</h2>
        <label>
          Vault
          <select ref={firstField} value={vaultId} onChange={(event) => setVaultId(event.target.value)}>
            {props.vaults.map((vault) => (
              <option key={vault.id} value={vault.id}>
                {displayName(vault.name, vault.formerly)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Minimum length
          <input
            type="number"
            value={minLength}
            onChange={(event) => setMinLength(event.target.value)}
          />
          {fields.min_length ? <span className="field-error">{fields.min_length}</span> : null}
        </label>
        <label>
          Takes force on
          <input type="date" value={effectiveOn} onChange={(event) => setEffectiveOn(event.target.value)} />
          {fields.effective_on ? <span className="field-error">{fields.effective_on}</span> : null}
        </label>
        <div className="dialog-buttons">
          <button className="solid" onClick={() => void submit()}>{pending ? 'Saving' : editing ? 'Save rule' : 'Save draft'}</button>
          <button onClick={props.onClose}>Cancel</button>
        </div>
      </div>
    </Dialog>
  );
}

export function displayName(name: string, formerly: string | null): string {
  return formerly ? `${name} (formerly ${formerly})` : name;
}

/* ------------------------------------------------------------------ */
/* Vault tablist                                                       */
/* ------------------------------------------------------------------ */

function VaultTablist(props: {
  vaults: Vault[];
  openVaultId: string | null;
  seesRules: boolean;
  asOf: AsOfAnswer | null;
  navigate: Navigate;
  onOpen: (id: string) => void;
  children?: ReactNode;
}): ReactNode {
  const tabRefs = useRef<Array<HTMLDivElement | null>>([]);
  const cylinders = useMemo(() => {
    const map = new Map<string, 'pending' | 'in_force'>();
    for (const vault of props.asOf?.vaults ?? []) {
      map.set(vault.vault_id, vault.cylinder);
    }
    return map;
  }, [props.asOf]);

  const focusTab = (index: number): void => {
    const clamped = Math.max(0, Math.min(props.vaults.length - 1, index));
    tabRefs.current[clamped]?.focus();
  };

  return (
    <div className="vault-stack folder-stack">
      <div role="tablist" aria-label="Vaults" className="tab-stack">
        {props.vaults.map((vault, index) => {
          const open = vault.id === props.openVaultId;
          const cylinder = cylinders.get(vault.id) ?? 'in_force';
          return (
            <div
              key={vault.id}
              ref={(element) => {
                tabRefs.current[index] = element;
              }}
              className={`tab-row ${open ? 'front' : 'behind'}`}
              role="tab"
              aria-selected={open}
              aria-controls={open ? `panel-${vault.id}` : undefined}
              id={`tab-${vault.id}`}
              tabIndex={open ? 0 : -1}
              onKeyDown={(event) => {
                if (event.key === 'ArrowRight') {
                  event.preventDefault();
                  focusTab(index + 1);
                } else if (event.key === 'ArrowLeft') {
                  event.preventDefault();
                  focusTab(index - 1);
                } else if (event.key === 'Home') {
                  event.preventDefault();
                  focusTab(0);
                } else if (event.key === 'End') {
                  event.preventDefault();
                  focusTab(props.vaults.length - 1);
                }
              }}
              onClick={() => {
                props.onOpen(vault.id);
                props.navigate(`/desk/vaults/${vault.id}`);
              }}
              onKeyUp={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  props.onOpen(vault.id);
                  props.navigate(`/desk/vaults/${vault.id}`);
                }
              }}
            >
              <span
                className={`cylinder ${cylinder === 'in_force' ? 'turned' : 'upright'}`}
                role="img"
                aria-label={`${vault.name} lock: ${cylinder === 'in_force' ? 'rule in force' : 'rule pending'}`}
              >
                ◷
              </span>
              <span className="tab-name">{displayName(vault.name, vault.formerly)}</span>
            </div>
          );
        })}
      </div>
      {props.vaults
        .filter((vault) => vault.id === props.openVaultId)
        .map((vault) => (
          <div
            key={vault.id}
            role="tabpanel"
            id={`panel-${vault.id}`}
            aria-labelledby={`tab-${vault.id}`}
            className="open-folder"
          >
            {props.children}
          </div>
        ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Open folder                                                         */
/* ------------------------------------------------------------------ */

type FolderDialog =
  | { kind: 'add-login' }
  | { kind: 'rename-vault' }
  | { kind: 'turn'; credential: Credential }
  | { kind: 'renameVendor'; credential: Credential };

function OpenFolder(props: {
  vault: Vault;
  credentials: Credential[] | null;
  navigate: Navigate;
  onReloadVaults: () => void;
  focusHeading?: boolean;
}): ReactNode {
  const { me, status, alert } = useApp();
  const [dialog, setDialog] = useState<FolderDialog | null>(null);
  const isOfficeManager = me?.role === 'office_manager';
  const isStaffInOwnVault = me?.role === 'staff_accountant';
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (props.focusHeading) {
      headingRef.current?.focus();
    }
  }, [props.focusHeading]);

  return (
    <div className="open-folder-contents">
      <h2 className="folder-heading" ref={headingRef} tabIndex={-1}>
        {displayName(props.vault.name, props.vault.formerly)}
      </h2>
      {props.vault.rule_in_force ? (
        <p className="rule-in-force-line">At least {props.vault.rule_in_force.min_length} characters</p>
      ) : null}
      {props.credentials === null ? (
        <p className="loading">Opening the drawer</p>
      ) : props.credentials.length === 0 ? (
        <div className="empty-folder">
          <p>Nothing filed here yet.</p>
        </div>
      ) : (
        <ul className="login-list" aria-label={`Logins in ${props.vault.name}`}>
          {props.credentials.map((credential) => (
            <LoginSlip
              key={credential.id}
              credential={credential}
              vaultName={props.vault.name}
              canTurn={isOfficeManager || isStaffInOwnVault}
              canRenameVendor={isOfficeManager}
              onTurn={() => setDialog({ kind: 'turn', credential })}
              onRenameVendor={() => setDialog({ kind: 'renameVendor', credential })}
              onReloadVaults={props.onReloadVaults}
            />
          ))}
        </ul>
      )}
      {isOfficeManager ? (
        <div className="folder-controls">
          <button onClick={() => setDialog({ kind: 'add-login' })}>Add login</button>
          <button onClick={() => setDialog({ kind: 'rename-vault' })}>Rename vault</button>
        </div>
      ) : null}
      {dialog?.kind === 'add-login' ? (
        <AddLoginDialog vault={props.vault} onClose={() => setDialog(null)} onReloadVaults={props.onReloadVaults} />
      ) : null}
      {dialog?.kind === 'rename-vault' ? (
        <RenameVaultDialog vault={props.vault} onClose={() => setDialog(null)} onReloadVaults={props.onReloadVaults} />
      ) : null}
      {dialog?.kind === 'turn' ? (
        <TurnDialog credential={dialog.credential} vault={props.vault} onClose={() => setDialog(null)} />
      ) : null}
      {dialog?.kind === 'renameVendor' ? (
        <RenameVendorDialog credential={dialog.credential} onClose={() => setDialog(null)} onReloadVaults={props.onReloadVaults} />
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Login slip                                                          */
/* ------------------------------------------------------------------ */

function LoginSlip(props: {
  credential: Credential;
  vaultName: string;
  canTurn: boolean;
  canRenameVendor: boolean;
  onTurn: () => void;
  onRenameVendor: () => void;
  onReloadVaults: () => void;
}): ReactNode {
  const { status, alert } = useApp();
  const revealed = getTimers().secretOf(props.credential.id);
  const [pending, setPending] = useState(false);

  const reveal = async (): Promise<void> => {
    if (pending) return;
    setPending(true);
    try {
      const answer = await api<{ secret: string }>('POST', `/api/credentials/${props.credential.id}/reveal`, {});
      getTimers().show(props.credential.id, answer.secret, (id) => status(`${props.credential.label} hidden.`));
      status(`${props.credential.label} revealed.`);
    } catch (error) {
      if (error instanceof ApiError) {
        alert(error.message);
      }
    } finally {
      setPending(false);
    }
  };

  const copy = async (): Promise<void> => {
    try {
      const answer = await api<{ secret: string }>('POST', `/api/credentials/${props.credential.id}/copy`, {});
      await navigator.clipboard.writeText(answer.secret);
      status(`${props.credential.label} copied.`);
    } catch (error) {
      if (error instanceof ApiError) {
        alert(error.message);
      }
    }
  };

  const hide = (): void => {
    getTimers().hide(props.credential.id);
  };

  const healthLine = props.credential.health === 'sound' ? 'Sound' : props.credential.health === 'out_of_policy' ? 'Out of policy' : props.credential.health === 'exposed' ? 'Exposed' : props.credential.health === 'vendor_breached' ? 'Vendor breached' : 'Not checked';

  return (
    <li className="slip login-slip">
      <div className="slip-columns">
        <span className="slip-name">{props.credential.label}</span>
        <span className="slip-held-by">
          {props.credential.held_by.map((holder) => (holder.left ? `${holder.name} (left)` : holder.name)).join(', ')}
        </span>
        <span className="slip-next-turn">
          {props.credential.next_turn
            ? `${displayOfficeDate(props.credential.next_turn.office_date)} ${props.credential.next_turn.office_time}`
            : '—'}
        </span>
        <span className="slip-health">{healthLine}</span>
      </div>
      <div className="slip-secret-row">
        {revealed !== null ? (
          <span className="secret">{revealed}</span>
        ) : null}
      </div>
      <div className="slip-buttons">
        {revealed === null ? (
          <button onClick={() => void reveal()}>{pending ? 'Revealing' : `Reveal ${props.credential.label}`}</button>
        ) : (
          <button onClick={hide}>{`Hide ${props.credential.label}`}</button>
        )}
        <button onClick={() => void copy()}>{`Copy ${props.credential.label}`}</button>
        {props.canTurn ? <button onClick={props.onTurn}>{`Turn ${props.credential.label}`}</button> : null}
        {props.canRenameVendor ? (
          <button onClick={props.onRenameVendor}>{`Rename vendor ${props.credential.vendor.name}`}</button>
        ) : null}
      </div>
    </li>
  );
}

/* ------------------------------------------------------------------ */
/* Dialogs                                                             */
/* ------------------------------------------------------------------ */

function useFocusFirstField<T extends HTMLElement>(): React.RefObject<T> {
  const ref = useRef<T>(null as unknown as T);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return ref;
}

function TurnDialog(props: { credential: Credential; vault: Vault; onClose: () => void }): ReactNode {
  const { status, alert } = useApp();
  const [password, setPassword] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const firstField = useFocusFirstField<HTMLInputElement>();

  const submit = async (): Promise<void> => {
    if (pending) return;
    setPending(true);
    try {
      await api('PUT', `/api/credentials/${props.credential.id}/secret`, { secret: password });
      status(`${props.credential.label} turned.`);
      window.location.reload();
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.fields) setFields(error.fields);
        else alert(error.message);
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog label={`Turn ${props.credential.label}`} onClose={props.onClose}>
      <div className="dialog-body paper slip">
        <h2>{`Turn ${props.credential.label}`}</h2>
        <label>
          New password
          <input
            ref={firstField}
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="new-password"
          />
          {fields.secret ? <span className="field-error">{fields.secret}</span> : null}
        </label>
        <div className="dialog-buttons">
          <button className="solid" onClick={() => void submit()}>{pending ? 'Saving' : 'Save new password'}</button>
          <button onClick={props.onClose}>Cancel</button>
        </div>
      </div>
    </Dialog>
  );
}

function AddLoginDialog(props: { vault: Vault; onClose: () => void; onReloadVaults: () => void }): ReactNode {
  const { status, alert } = useApp();
  const [vendors, setVendors] = useState<Array<{ id: string; name: string; formerly: string | null }>>([]);
  const [vendorId, setVendorId] = useState('');
  const [label, setLabel] = useState('');
  const [username, setUsername] = useState('');
  const [secret, setSecret] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const firstField = useFocusFirstField<HTMLSelectElement>();

  useEffect(() => {
    void api<{ vendors: Array<{ id: string; name: string; formerly: string | null }> }>('GET', '/api/vendors')
      .then((answer) => {
        setVendors(answer.vendors);
        setVendorId(answer.vendors[0]?.id ?? '');
      })
      .catch(() => undefined);
  }, []);

  const submit = async (): Promise<void> => {
    if (pending) return;
    setPending(true);
    try {
      const created = await api<Credential>('POST', '/api/credentials', {
        vault_id: props.vault.id,
        vendor_id: vendorId,
        label,
        username,
        secret
      });
      status(`${created.label} filed.`);
      props.onClose();
      props.onReloadVaults();
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.fields) setFields(error.fields);
        alert(error.message);
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog label="Add login" onClose={props.onClose}>
      <div className="dialog-body paper slip">
        <h2>Add login</h2>
        <label>
          Vendor
          <select ref={firstField} value={vendorId} onChange={(event) => setVendorId(event.target.value)}>
            {vendors.map((vendor) => (
              <option key={vendor.id} value={vendor.id}>
                {displayName(vendor.name, vendor.formerly)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Login for
          <input value={label} onChange={(event) => setLabel(event.target.value)} />
          {fields.label ? <span className="field-error">{fields.label}</span> : null}
        </label>
        <label>
          Username
          <input value={username} onChange={(event) => setUsername(event.target.value)} />
          {fields.username ? <span className="field-error">{fields.username}</span> : null}
        </label>
        <label>
          Password
          <input type="password" value={secret} onChange={(event) => setSecret(event.target.value)} />
          {fields.secret ? <span className="field-error">{fields.secret}</span> : null}
        </label>
        <div className="dialog-buttons">
          <button className="solid" onClick={() => void submit()}>{pending ? 'Filing' : 'File login'}</button>
          <button onClick={props.onClose}>Cancel</button>
        </div>
      </div>
    </Dialog>
  );
}

function RenameVaultDialog(props: { vault: Vault; onClose: () => void; onReloadVaults: () => void }): ReactNode {
  const { status, alert } = useApp();
  const [name, setName] = useState(props.vault.name);
  const [fields, setFields] = useState<Record<string, string>>({});
  const firstField = useFocusFirstField<HTMLInputElement>();

  const submit = async (): Promise<void> => {
    try {
      await api<Vault>('PATCH', `/api/vaults/${props.vault.id}`, { name });
      status(`Renamed to ${name}.`);
      props.onClose();
      props.onReloadVaults();
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.fields) setFields(error.fields);
        alert(error.message);
      }
    }
  };

  return (
    <Dialog label="Rename vault" onClose={props.onClose}>
      <div className="dialog-body paper slip">
        <h2>Rename vault</h2>
        <label>
          New name
          <input ref={firstField} value={name} onChange={(event) => setName(event.target.value)} />
          {fields.name ? <span className="field-error">{fields.name}</span> : null}
        </label>
        <div className="dialog-buttons">
          <button className="solid" onClick={() => void submit()}>Save name</button>
          <button onClick={props.onClose}>Cancel</button>
        </div>
      </div>
    </Dialog>
  );
}

function RenameVendorDialog(props: { credential: Credential; onClose: () => void; onReloadVaults: () => void }): ReactNode {
  const { status, alert } = useApp();
  const [name, setName] = useState(props.credential.vendor.name);
  const [fields, setFields] = useState<Record<string, string>>({});
  const firstField = useFocusFirstField<HTMLInputElement>();

  const submit = async (): Promise<void> => {
    try {
      await api('PATCH', `/api/vendors/${props.credential.vendor.id}`, { name });
      status(`Renamed to ${name}.`);
      props.onClose();
      props.onReloadVaults();
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.fields) setFields(error.fields);
        alert(error.message);
      }
    }
  };

  return (
    <Dialog label="Rename vendor" onClose={props.onClose}>
      <div className="dialog-body paper slip">
        <h2>Rename vendor</h2>
        <label>
          New name
          <input ref={firstField} value={name} onChange={(event) => setName(event.target.value)} />
          {fields.name ? <span className="field-error">{fields.name}</span> : null}
        </label>
        <div className="dialog-buttons">
          <button className="solid" onClick={() => void submit()}>Save name</button>
          <button onClick={props.onClose}>Cancel</button>
        </div>
      </div>
    </Dialog>
  );
}
