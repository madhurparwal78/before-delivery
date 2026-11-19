import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ApiFailure,
  type AsOf,
  type Clock,
  type Credential,
  type Person,
  type Rule,
  type Vault,
  type Vendor,
} from '../api.js';
import { call } from '../guard.js';
import { addDays, displayName, joinNames, officeDate, officeOffsetAtMidnight } from '../format.js';
import { refuse, say, useLive } from '../live.js';
import { go } from '../router.js';
import { Cylinder, useCountTo } from './Cylinder.js';
import { Dialog, FieldRow } from './Dialog.js';
import { NightRuler, type Night } from './NightRuler.js';
import { Slip } from './Slip.js';

const BANDS = ['paper', 'surface', 'muted'] as const;

type Loaded = { vault: Vault; credentials: Credential[] };

export function Drawer(props: { me: Person; clock: Clock; openVaultId: string | null }): React.ReactElement {
  const [vaults, setVaults] = useState<Vault[] | null>(null);
  const [folder, setFolder] = useState<Loaded | null>(null);
  const [night, setNight] = useState(1);
  const [asOf, setAsOf] = useState<AsOf | null>(null);
  const [turnOpenFor, setTurnOpenFor] = useState<string | null>(null);
  const [narrow, setNarrow] = useState(() => window.matchMedia('(max-width: 767px)').matches);
  const heading = useRef<HTMLHeadingElement>(null);
  const tabRefs = useRef(new Map<string, HTMLButtonElement>());
  const newSlipReveal = useRef<HTMLButtonElement | null>(null);
  const focusHeading = useRef(false);
  const focusNewSlip = useRef(false);
  const showsRules = props.me.role === 'office_manager' || props.me.role === 'managing_partner';

  useEffect(() => {
    const media = window.matchMedia('(max-width: 767px)');
    const listen = (): void => setNarrow(media.matches);
    media.addEventListener('change', listen);
    return () => media.removeEventListener('change', listen);
  }, []);

  const nights: Night[] = useMemo(() => {
    const list: Night[] = [];
    for (let step = 1; step <= 60; step += 1) {
      const date = addDays(props.clock.office_date, step);
      list.push({ value: step, date, offset: officeOffsetAtMidnight(date) });
    }
    return list;
  }, [props.clock.office_date]);

  const loadVaults = useCallback(async (): Promise<Vault[]> => {
    const answer = await call<{ vaults: Vault[] }>('/api/vaults');
    setVaults(answer.vaults);
    return answer.vaults;
  }, []);

  useEffect(() => {
    void loadVaults().catch(() => undefined);
  }, [loadVaults]);

  const openId = props.openVaultId ?? vaults?.[0]?.id ?? null;

  useEffect(() => {
    if (openId === null) {
      setFolder(null);
      return;
    }
    let current = true;
    void call<Loaded>(`/api/vaults/${openId}`)
      .then((answer) => {
        if (current) setFolder(answer);
      })
      .catch(() => {
        if (current) setFolder(null);
      });
    return () => {
      current = false;
    };
  }, [openId]);

  // Each change of night asks the server; an answer for a night no longer chosen is dropped.
  useEffect(() => {
    if (!showsRules) return;
    const chosen = nights[night - 1];
    if (chosen === undefined) return;
    let current = true;
    void call<AsOf>(`/api/as-of?night=${chosen.date}`)
      .then((answer) => {
        if (current) setAsOf(answer);
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [night, nights, showsRules]);

  const reloadAll = useCallback(() => {
    void loadVaults().catch(() => undefined);
    if (openId !== null) {
      void call<Loaded>(`/api/vaults/${openId}`)
        .then(setFolder)
        .catch(() => undefined);
    }
  }, [loadVaults, openId]);

  useLive(
    'access-changed',
    useCallback(
      (raw: unknown) => {
        const data = raw as { vault_ids: string[]; ended: { vault_id: string; name: string }[]; cause: string };
        void loadVaults()
          .then((next) => {
            const stillThere = next.some((vault) => vault.id === openId);
            if (!stillThere) {
              const first = next[0];
              setTurnOpenFor(null);
              setFolder(null);
              focusHeading.current = true;
              go(first === undefined ? '/desk' : `/desk/vaults/${first.id}`);
            }
            if (data.cause === 'change' && data.ended.length > 0) {
              refuse(`Your access to ${joinNames(data.ended.map((entry) => entry.name))} ended.`);
            } else if (data.cause === 'boundary') {
              say('Your access changed. Some vaults are no longer shown.');
            }
          })
          .catch(() => undefined);
      },
      [loadVaults, openId],
    ),
  );

  useLive(
    'rule-in-force',
    useCallback(
      (raw: unknown) => {
        const data = raw as { name: string };
        say(`${data.name} rule now in force.`);
        const chosen = nights[night - 1];
        if (chosen !== undefined) {
          void call<AsOf>(`/api/as-of?night=${chosen.date}`)
            .then(setAsOf)
            .catch(() => undefined);
        }
        reloadAll();
      },
      [night, nights, reloadAll],
    ),
  );

  useEffect(() => {
    if (focusHeading.current && heading.current !== null) {
      focusHeading.current = false;
      heading.current.focus();
    }
    if (focusNewSlip.current && newSlipReveal.current !== null) {
      focusNewSlip.current = false;
      newSlipReveal.current.focus();
    }
  }, [folder]);

  const asOfVault = (vaultId: string): AsOf['vaults'][number] | undefined =>
    asOf?.vaults.find((entry) => entry.vault_id === vaultId);

  const openTab = (vaultId: string): void => {
    setTurnOpenFor(null);
    go(`/desk/vaults/${vaultId}`);
  };

  const onTabKeyDown = (event: React.KeyboardEvent, index: number): void => {
    if (vaults === null) return;
    const move = (to: number): void => {
      const target = vaults[Math.min(vaults.length - 1, Math.max(0, to))];
      if (target !== undefined) tabRefs.current.get(target.id)?.focus();
    };
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      move(index + 1);
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      move(index - 1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      move(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      move(vaults.length - 1);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      const target = vaults[index];
      if (target !== undefined) openTab(target.id);
    }
  };

  if (vaults === null) {
    return (
      <main>
        <span className="folder-tab" style={{ background: 'transparent' }}>
          Opening the drawer
        </span>
      </main>
    );
  }

  const tablist = (
    <div className="tablist" role="tablist" aria-label="Vaults">
      {vaults.map((vault, index) => {
        const selected = vault.id === openId;
        const asOfEntry = asOfVault(vault.id);
        return (
          <div className="tab-row" key={vault.id} style={{ paddingLeft: narrow ? `${(index % 3) * 18}%` : `${index * 6}%` }}>
            <button
              type="button"
              role="tab"
              className="folder-tab vault-tab"
              aria-selected={selected}
              tabIndex={selected ? 0 : -1}
              ref={(node) => {
                if (node === null) tabRefs.current.delete(vault.id);
                else tabRefs.current.set(vault.id, node);
              }}
              onClick={() => openTab(vault.id)}
              onKeyDown={(event) => onTabKeyDown(event, index)}
            >
              {showsRules ? (
                <Cylinder vaultName={vault.name} state={asOfEntry?.cylinder ?? 'in_force'} />
              ) : null}
              <span>{displayName(vault)}</span>
            </button>
          </div>
        );
      })}
    </div>
  );

  const bandOf = (vaultId: string): string => {
    const index = vaults.findIndex((vault) => vault.id === vaultId);
    return BANDS[index % BANDS.length] as string;
  };

  const openFolder =
    folder === null ? (
      <span className="folder-tab" style={{ background: 'transparent' }}>
        Opening the drawer
      </span>
    ) : (
      <div
        className={`folder-band folder-band--${bandOf(folder.vault.id)}`}
        role="tabpanel"
        aria-label={folder.vault.name}
      >
        <h2 tabIndex={-1} ref={heading}>
          {folder.vault.name}
        </h2>
        {folder.vault.formerly === null ? null : <p>formerly {folder.vault.formerly}</p>}
        <p>
          {folder.vault.rule_in_force === null
            ? 'No rule in force'
            : `At least ${folder.vault.rule_in_force.min_length} characters`}
        </p>
        {folder.credentials.length === 0 ? (
          <p>Nothing filed here yet.</p>
        ) : (
          <ul className="slips" aria-label={`Logins in ${folder.vault.name}`}>
            {folder.credentials.map((credential, index) => (
              <Slip
                key={credential.id}
                credential={credential}
                vault={folder.vault}
                me={props.me}
                narrow={narrow}
                turnOpen={turnOpenFor === credential.id}
                onTurnOpen={(open) => setTurnOpenFor(open ? credential.id : null)}
                onTurned={reloadAll}
                revealRef={
                  index === folder.credentials.length - 1
                    ? (node) => {
                        newSlipReveal.current = node;
                      }
                    : undefined
                }
              />
            ))}
          </ul>
        )}
        {props.me.role === 'office_manager' ? (
          <p style={{ marginTop: '1rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <AddLogin
              vault={folder.vault}
              onFiled={() => {
                focusNewSlip.current = true;
                reloadAll();
              }}
            />
            <RenameVault vault={folder.vault} onRenamed={reloadAll} />
          </p>
        ) : null}
      </div>
    );

  return (
    <main>
      <div className={showsRules ? 'drawer-columns' : 'drawer-columns drawer-columns--wide'}>
        {showsRules ? (
          <div className="drawer-area-ruler">
            <NightRuler
              nights={
                asOf === null
                  ? nights
                  : nights.map((entry) => (entry.date === asOf.night ? { ...entry, offset: asOf.offset } : entry))
              }
              value={night}
              onChange={setNight}
            />
          </div>
        ) : null}
        {showsRules ? <PendingRules vaults={vaults} asOf={asOf} me={props.me} onChanged={reloadAll} /> : null}
        <div className="drawer-area-tabs">
          {tablist}
          {props.me.role === 'office_manager' ? (
            <NewVault
              onFiled={(vaultId) => {
                focusHeading.current = true;
                void loadVaults().catch(() => undefined);
                go(`/desk/vaults/${vaultId}`);
              }}
            />
          ) : null}
        </div>
        <div className="drawer-area-folder">{openFolder}</div>
      </div>
    </main>
  );
}

function PendingRules(props: {
  vaults: Vault[];
  asOf: AsOf | null;
  me: Person;
  onChanged: () => void;
}): React.ReactElement {
  const count = useCountTo(props.asOf?.out_of_policy_count ?? 0);
  const asOfStubs = (props.asOf?.vaults ?? []).flatMap((vault) =>
    vault.stubs.map((stub) => ({ kind: 'as-of' as const, vaultId: vault.vault_id, stub })),
  );
  const drafts = props.vaults.flatMap((vault) =>
    vault.pending_rules
      .filter((rule) => rule.state === 'drafted')
      .map((rule) => ({ kind: 'draft' as const, vaultId: vault.id, rule })),
  );

  return (
    <section className="stub-rail" aria-label="Pending rules">
      <h2>Pending rules</h2>
      <ul aria-label="Pending rules">
        {asOfStubs.map((entry) => {
          const vault = props.vaults.find((item) => item.id === entry.vaultId);
          return (
            <li className="stub" key={`asof-${entry.stub.rule_id}`}>
              <p>
                <strong>{vault === undefined ? '' : displayName(vault)}</strong>
              </p>
              <p>{entry.stub.text}</p>
              <EditRule
                ruleId={entry.stub.rule_id}
                version={entry.stub.version}
                vaults={props.vaults}
                onChanged={props.onChanged}
              />
            </li>
          );
        })}
        {drafts.map((entry) => {
          const vault = props.vaults.find((item) => item.id === entry.vaultId);
          return (
            <li className="stub" key={`draft-${entry.rule.id}`}>
              <p>
                <strong>{vault === undefined ? '' : displayName(vault)}</strong>
              </p>
              <p>{entry.rule.stub_text}</p>
              <EditRule
                ruleId={entry.rule.id}
                version={entry.rule.version}
                vaults={props.vaults}
                onChanged={props.onChanged}
              />
              {props.me.role === 'managing_partner' ? (
                <SignRule rule={entry.rule} onChanged={props.onChanged} />
              ) : null}
            </li>
          );
        })}
      </ul>
      <p className="out-of-policy-count">
        <span className="count">{count}</span> logins out of policy on this night
      </p>
      <NewRule vaults={props.vaults} onChanged={props.onChanged} />
    </section>
  );
}

function RuleFields(props: {
  vaults: Vault[];
  vaultId: string;
  minLength: string;
  effectiveOn: string;
  fields: Record<string, string>;
  onVault: (value: string) => void;
  onMinLength: (value: string) => void;
  onEffectiveOn: (value: string) => void;
  idPrefix: string;
}): React.ReactElement {
  return (
    <>
      <FieldRow label="Vault" id={`${props.idPrefix}-vault`} message={props.fields.vault_id}>
        <select
          id={`${props.idPrefix}-vault`}
          value={props.vaultId}
          onChange={(event) => props.onVault(event.target.value)}
        >
          {props.vaults.map((vault) => (
            <option key={vault.id} value={vault.id}>
              {displayName(vault)}
            </option>
          ))}
        </select>
      </FieldRow>
      <FieldRow label="Minimum length" id={`${props.idPrefix}-min`} message={props.fields.min_length}>
        <input
          id={`${props.idPrefix}-min`}
          type="number"
          value={props.minLength}
          onChange={(event) => props.onMinLength(event.target.value)}
        />
      </FieldRow>
      <FieldRow label="Takes force on" id={`${props.idPrefix}-date`} message={props.fields.effective_on}>
        <input
          id={`${props.idPrefix}-date`}
          type="date"
          value={props.effectiveOn}
          onChange={(event) => props.onEffectiveOn(event.target.value)}
        />
      </FieldRow>
    </>
  );
}

function NewRule(props: { vaults: Vault[]; onChanged: () => void }): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [vaultId, setVaultId] = useState(props.vaults[0]?.id ?? '');
  const [minLength, setMinLength] = useState('12');
  const [effectiveOn, setEffectiveOn] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);

  const save = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    try {
      await call<Rule>('/api/rules', {
        method: 'POST',
        body: { vault_id: vaultId, min_length: Number(minLength), effective_on: effectiveOn },
      });
      say('Rule saved as a draft.');
      setOpen(false);
      props.onChanged();
    } catch (error) {
      if (error instanceof ApiFailure) {
        setFields(error.fields);
        refuse(error.message);
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        New rule
      </button>
      {open ? (
        <Dialog title="New rule" onClose={() => setOpen(false)}>
          <form onSubmit={save} noValidate>
            <RuleFields
              vaults={props.vaults}
              vaultId={vaultId}
              minLength={minLength}
              effectiveOn={effectiveOn}
              fields={fields}
              onVault={setVaultId}
              onMinLength={setMinLength}
              onEffectiveOn={setEffectiveOn}
              idPrefix="new-rule"
            />
            <div className="dialog-actions">
              <button type="submit" className="solid">
                {pending ? 'Saving' : 'Save draft'}
              </button>
              <button type="button" onClick={() => setOpen(false)}>
                Cancel
              </button>
            </div>
          </form>
        </Dialog>
      ) : null}
    </>
  );
}

function EditRule(props: {
  ruleId: string;
  version: number;
  vaults: Vault[];
  onChanged: () => void;
}): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [minLength, setMinLength] = useState('');
  const [effectiveOn, setEffectiveOn] = useState('');
  const [vaultId, setVaultId] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);

  const start = async (): Promise<void> => {
    const rule = await call<Rule>(`/api/rules/${props.ruleId}`).catch(() => null);
    if (rule !== null) {
      setMinLength(String(rule.min_length));
      setEffectiveOn(rule.effective_on);
      setVaultId(rule.vault_id);
    }
    setOpen(true);
  };

  const save = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    try {
      await call<Rule>(`/api/rules/${props.ruleId}`, {
        method: 'PATCH',
        body: { version: props.version, min_length: Number(minLength), effective_on: effectiveOn },
      });
      say('Rule saved as a draft.');
      setOpen(false);
      props.onChanged();
    } catch (error) {
      if (error instanceof ApiFailure) {
        setFields(error.fields);
        refuse(error.message);
        props.onChanged();
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      <button type="button" onClick={() => void start()}>
        Edit rule
      </button>
      {open ? (
        <Dialog title="Edit rule" onClose={() => setOpen(false)}>
          <form onSubmit={save} noValidate>
            <RuleFields
              vaults={props.vaults}
              vaultId={vaultId}
              minLength={minLength}
              effectiveOn={effectiveOn}
              fields={fields}
              onVault={setVaultId}
              onMinLength={setMinLength}
              onEffectiveOn={setEffectiveOn}
              idPrefix="edit-rule"
            />
            <div className="dialog-actions">
              <button type="submit" className="solid">
                {pending ? 'Saving' : 'Save rule'}
              </button>
              <button type="button" onClick={() => setOpen(false)}>
                Cancel
              </button>
            </div>
          </form>
        </Dialog>
      ) : null}
    </>
  );
}

function SignRule(props: { rule: Rule; onChanged: () => void }): React.ReactElement {
  const [pending, setPending] = useState(false);
  const sign = async (): Promise<void> => {
    if (pending) return;
    setPending(true);
    try {
      const signed = await call<Rule>(`/api/rules/${props.rule.id}/sign`, {
        method: 'POST',
        body: { version: props.rule.version },
      });
      say(`Rule signed. Takes force 00:00 ${stubOffset(signed)}, ${officeDate(signed.effective_on)}.`);
      props.onChanged();
    } catch (error) {
      if (error instanceof ApiFailure) {
        refuse(error.message);
        props.onChanged();
      }
    } finally {
      setPending(false);
    }
  };
  return (
    <button type="button" onClick={() => void sign()}>
      {pending ? 'Signing' : 'Sign rule'}
    </button>
  );
}

function stubOffset(rule: Rule): string {
  const match = /00:00 (CST|CDT)/.exec(rule.stub_text ?? '');
  return match?.[1] ?? 'CST';
}

function AddLogin(props: { vault: Vault; onFiled: () => void }): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [vendorId, setVendorId] = useState('');
  const [label, setLabel] = useState('');
  const [username, setUsername] = useState('');
  const [secret, setSecret] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);

  const start = async (): Promise<void> => {
    const answer = await call<{ vendors: Vendor[] }>('/api/vendors').catch(() => ({ vendors: [] }));
    setVendors(answer.vendors);
    setVendorId(answer.vendors[0]?.id ?? '');
    setOpen(true);
  };

  const save = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    try {
      await call<Credential>('/api/credentials', {
        method: 'POST',
        body: { vault_id: props.vault.id, vendor_id: vendorId, label, username, secret },
      });
      say(`${label} filed.`);
      setOpen(false);
      props.onFiled();
    } catch (error) {
      if (error instanceof ApiFailure) {
        setFields(error.fields);
        refuse(error.message);
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      <button type="button" onClick={() => void start()}>
        Add login
      </button>
      {open ? (
        <Dialog title="Add login" onClose={() => setOpen(false)}>
          <form onSubmit={save} noValidate>
            <FieldRow label="Vendor" id="add-vendor" message={fields.vendor_id}>
              <select id="add-vendor" value={vendorId} onChange={(event) => setVendorId(event.target.value)}>
                {vendors.map((vendor) => (
                  <option key={vendor.id} value={vendor.id}>
                    {displayName(vendor)}
                  </option>
                ))}
              </select>
            </FieldRow>
            <FieldRow label="Login for" id="add-label" message={fields.label}>
              <input id="add-label" type="text" value={label} onChange={(event) => setLabel(event.target.value)} />
            </FieldRow>
            <FieldRow label="Username" id="add-username" message={fields.username}>
              <input
                id="add-username"
                type="text"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
              />
            </FieldRow>
            <FieldRow label="Password" id="add-secret" message={fields.secret}>
              <input
                id="add-secret"
                type="password"
                autoComplete="new-password"
                value={secret}
                onChange={(event) => setSecret(event.target.value)}
              />
            </FieldRow>
            <div className="dialog-actions">
              <button type="submit" className="solid">
                {pending ? 'Filing' : 'File login'}
              </button>
              <button type="button" onClick={() => setOpen(false)}>
                Cancel
              </button>
            </div>
          </form>
        </Dialog>
      ) : null}
    </>
  );
}

function RenameVault(props: { vault: Vault; onRenamed: () => void }): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const [message, setMessage] = useState<string | undefined>(undefined);
  const [pending, setPending] = useState(false);

  const save = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    try {
      await call<Vault>(`/api/vaults/${props.vault.id}`, { method: 'PATCH', body: { name: value } });
      say(`Renamed to ${value}.`);
      setOpen(false);
      props.onRenamed();
    } catch (error) {
      if (error instanceof ApiFailure) {
        setMessage(error.fields.name);
        refuse(error.message);
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Rename vault
      </button>
      {open ? (
        <Dialog title="Rename vault" onClose={() => setOpen(false)}>
          <form onSubmit={save} noValidate>
            <FieldRow label="New name" id="vault-name" message={message}>
              <input id="vault-name" type="text" value={value} onChange={(event) => setValue(event.target.value)} />
            </FieldRow>
            <div className="dialog-actions">
              <button type="submit" className="solid">
                {pending ? 'Saving' : 'Save name'}
              </button>
              <button type="button" onClick={() => setOpen(false)}>
                Cancel
              </button>
            </div>
          </form>
        </Dialog>
      ) : null}
    </>
  );
}

export function NewVault(props: { onFiled: (vaultId: string) => void }): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [offWhenTravelling, setOffWhenTravelling] = useState(false);
  const [message, setMessage] = useState<string | undefined>(undefined);
  const [pending, setPending] = useState(false);

  const save = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    try {
      const vault = await call<Vault>('/api/vaults', {
        method: 'POST',
        body: { name, off_when_travelling: offWhenTravelling },
      });
      say(`${vault.name} filed.`);
      setOpen(false);
      props.onFiled(vault.id);
    } catch (error) {
      if (error instanceof ApiFailure) {
        setMessage(error.fields.name);
        refuse(error.message);
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        New vault
      </button>
      {open ? (
        <Dialog title="New vault" onClose={() => setOpen(false)}>
          <form onSubmit={save} noValidate>
            <FieldRow label="Vault name" id="new-vault-name" message={message}>
              <input
                id="new-vault-name"
                type="text"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </FieldRow>
            <div className="field">
              <label htmlFor="new-vault-travel">
                <input
                  id="new-vault-travel"
                  type="checkbox"
                  checked={offWhenTravelling}
                  onChange={(event) => setOffWhenTravelling(event.target.checked)}
                  style={{ width: 'auto', minHeight: 0, marginRight: '0.5rem' }}
                />
                Off when travelling
              </label>
            </div>
            <div className="dialog-actions">
              <button type="submit" className="solid">
                {pending ? 'Filing' : 'File vault'}
              </button>
              <button type="button" onClick={() => setOpen(false)}>
                Cancel
              </button>
            </div>
          </form>
        </Dialog>
      ) : null}
    </>
  );
}
