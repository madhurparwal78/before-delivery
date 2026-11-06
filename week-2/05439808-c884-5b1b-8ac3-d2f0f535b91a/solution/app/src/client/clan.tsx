// The Clan panel: founding and invitations, the roster with warden powers, chat, unit requests and
// donations. Roles are decided by the server; buttons only appear where the role rules allow them.
import { Fragment } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { UNIT_KEYS, UNITS, type ClanRole, type UnitKey } from '../shared/catalog';
import { api, type ApiFailure } from './api';
import { fmt, localDateTime, REQUEST_CLOSED, ROLE_CHANGE_REFUSED, ROLE_LABEL, START_RAID_ERRORS, WARDENS_ONLY } from './copy';
import { Panel } from './panel';
import { Tabs } from './panels';
import { loadClan, loadMe, loadVillage, setChatVisible, setLeavingClan, state, update } from './store';
import type { Clan, Member, Message, UnitRequest } from './types';
import { trapTab } from './village';
import { Button, Empty, Field, invalid, useBusy, useStore, type FieldErrors } from './ui';

const refresh = (): void => {
  void loadClan().catch(() => undefined);
};

const progress = (r: UnitRequest): string => `${r.given} of ${r.count} ${UNITS[r.unit].name}`;

function NoClan() {
  const s = useStore();
  const [name, setName] = useState('');
  const [motto, setMotto] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [founding, found] = useBusy();
  const [answering, answer] = useBusy();
  const invitations = s.clan?.invitations ?? [];
  const submit = (e: Event): void => {
    e.preventDefault();
    void found({
      pending: 'Founding…',
      run: () => api.post<{ clan: Clan }>('/api/clans', { name, motto }),
      success: (r) => `${r.clan.name} founded. You lead it.`,
      errors: { clan_name_taken: 'That clan name is taken.', already_in_clan: 'Leave your current clan first.' },
      fields: setErrors,
    }).then((r) => {
      if (r) {
        refresh();
        void loadMe().catch(() => undefined);
      }
    });
  };
  return (
    <>
      {s.removedFrom && (
        <section>
          <p class="danger-text">You are no longer in {s.removedFrom}.</p>
        </section>
      )}
      <section>
        <h3>Invitations</h3>
        <ul class="plain-list" aria-label="Invitations">
          {invitations.map((inv) => (
            <li key={inv.id} class="invite">
              <span>
                <strong>{inv.clan.name}</strong> <span class="hint">from {inv.invitedBy.displayName}</span>
              </span>
              <span class="button-row">
                <Button
                  variant="primary"
                  busy={answering}
                  onClick={() =>
                    void answer({
                      pending: 'Joining…',
                      run: () => api.post<{ clan: Clan }>(`/api/invitations/${inv.id}/accept`),
                      success: (r) => `You joined ${r.clan.name}.`,
                      errors: { clan_full: 'That clan is full.', already_in_clan: 'Leave your current clan first.', not_found: 'That invitation is no longer open.' },
                    }).then(() => {
                      refresh();
                      void loadMe().catch(() => undefined);
                    })
                  }
                >
                  Accept invitation to {inv.clan.name}
                </Button>
                <Button
                  busy={answering}
                  onClick={() =>
                    void answer({
                      run: () => api.post(`/api/invitations/${inv.id}/decline`),
                      errors: { not_found: 'That invitation is no longer open.' },
                    }).then(refresh)
                  }
                >
                  Decline invitation to {inv.clan.name}
                </Button>
              </span>
            </li>
          ))}
        </ul>
        {invitations.length === 0 && <Empty>No invitations waiting.</Empty>}
      </section>
      <form onSubmit={submit} noValidate>
        <section>
          <h3>Found a clan</h3>
          <Field id="clan-name" label="Clan name" error={errors.name}>
            <input id="clan-name" type="text" value={name} onInput={(e) => setName(e.currentTarget.value)} {...invalid('clan-name', errors.name)} />
          </Field>
          <Field id="clan-motto" label="Motto" error={errors.motto}>
            <input id="clan-motto" type="text" value={motto} onInput={(e) => setMotto(e.currentTarget.value)} {...invalid('clan-motto', errors.motto)} />
          </Field>
          <Button type="submit" variant="primary" busy={founding}>
            Found clan
          </Button>
        </section>
      </form>
    </>
  );
}

const ROLE_ERRORS = { forbidden: WARDENS_ONLY, invalid_role_change: ROLE_CHANGE_REFUSED };

/** What the caller's role may do to a member, per the warden rules. */
function powers(clan: Clan, m: Member, self: number | undefined): { promote: boolean; demote: boolean; remove: boolean } {
  const skipper = clan.myRole === 'skipper';
  const other = m.accountId !== self;
  return {
    promote: other && skipper && m.role !== 'skipper',
    demote: other && skipper && m.role === 'mate',
    remove: other && m.role !== 'skipper' && (skipper || (clan.myRole === 'mate' && m.role === 'deckhand')),
  };
}

function MemberActions({ m, can }: { m: Member; can: ReturnType<typeof powers> }) {
  const [busy, run] = useBusy();
  const { promote: canPromote, demote: canDemote, remove: canRemove } = can;
  const change = (verb: 'promote' | 'demote'): void =>
    void run({
      pending: 'Updating…',
      run: () => api.post<Member>(`/api/clan/members/${m.accountId}/${verb}`),
      success: (r) => `${r.displayName} is now ${ROLE_LABEL[r.role]}.`,
      errors: ROLE_ERRORS,
    }).then(refresh);
  return (
    <span class="button-row">
      {canPromote && (
        <Button busy={busy} onClick={() => change('promote')}>
          Promote {m.displayName}
        </Button>
      )}
      {canDemote && (
        <Button busy={busy} onClick={() => change('demote')}>
          Demote {m.displayName}
        </Button>
      )}
      {canRemove && (
        <Button
          variant="danger"
          busy={busy}
          onClick={() =>
            void run({
              pending: 'Removing…',
              run: () => api.del(`/api/clan/members/${m.accountId}`),
              success: () => `${m.displayName} was removed from the clan.`,
              errors: ROLE_ERRORS,
            }).then(refresh)
          }
        >
          Remove {m.displayName}
        </Button>
      )}
    </span>
  );
}

const ROLE_ORDER: Record<ClanRole, number> = { skipper: 0, mate: 1, deckhand: 2 };

function Members({ clan }: { clan: Clan }) {
  const s = useStore();
  const [email, setEmail] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, run] = useBusy();
  const warden = clan.myRole !== 'deckhand';
  const roster = [...clan.members].sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || Date.parse(a.joinedAt) - Date.parse(b.joinedAt));
  const invite = (e: Event): void => {
    e.preventDefault();
    const to = email;
    void run({
      pending: 'Inviting…',
      run: () => api.post('/api/clan/invitations', { email: to }),
      success: () => `Invitation recorded for ${to}. The mail may take a few minutes.`,
      errors: { forbidden: WARDENS_ONLY },
      fields: setErrors,
    }).then((r) => {
      if (r) setEmail('');
    });
  };
  return (
    <>
      <section class="roster">
        <table aria-label="Roster">
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Role</th>
              <th scope="col">Trophies</th>
              <th scope="col">Donated</th>
              <th scope="col">Received</th>
            </tr>
          </thead>
          <tbody>
            {roster.map((m) => {
              const can = powers(clan, m, s.me?.id);
              return (
                <Fragment key={m.accountId}>
                  <tr>
                    <th scope="row">{m.displayName}</th>
                    <td>{ROLE_LABEL[m.role]}</td>
                    <td class="num">{fmt(m.trophies)}</td>
                    <td class="num">{m.donated}</td>
                    <td class="num">{m.received}</td>
                  </tr>
                  {(can.promote || can.demote || can.remove) && (
                    <tr class="actions">
                      <td colSpan={5}>
                        <MemberActions m={m} can={can} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </section>
      {warden && (
        <form onSubmit={invite} noValidate>
          <section>
            <Field id="invite-email" label="Invite by email" error={errors.email}>
              <input id="invite-email" type="email" value={email} onInput={(e) => setEmail(e.currentTarget.value)} {...invalid('invite-email', errors.email)} />
            </Field>
            <Button type="submit" variant="primary" busy={busy}>
              Send invitation
            </Button>
          </section>
        </form>
      )}
    </>
  );
}

function ChatMessage({ m, warden, zone }: { m: Message; warden: boolean; zone: string }) {
  const [busy, run] = useBusy();
  return (
    <li class="message">
      <span>
        <span class="who">{m.author.displayName}</span> <span class="hint num">{localDateTime(m.createdAt, zone)}</span>
      </span>
      {m.removed ? <p class="removed">Message removed by a warden</p> : <p class="body">{m.body}</p>}
      {warden && !m.removed && (
        <Button
          variant="quiet"
          busy={busy}
          onClick={() =>
            void run({
              pending: 'Removing…',
              run: () => api.del(`/api/clan/messages/${m.id}`),
              errors: { forbidden: WARDENS_ONLY },
            }).then(refresh)
          }
        >
          Delete message from {m.author.displayName}
        </Button>
      )}
    </li>
  );
}

function Chat({ clan }: { clan: Clan }) {
  const s = useStore();
  const [body, setBody] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, run] = useBusy();
  const log = useRef<HTMLUListElement>(null);
  const messages = s.clan?.messages ?? [];
  useLayoutEffect(() => {
    setChatVisible(true);
    return () => setChatVisible(false);
  }, []);
  useLayoutEffect(() => {
    const el = log.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);
  const send = (e: Event): void => {
    e.preventDefault();
    void run({
      pending: 'Sending…',
      run: () => api.post<Message>('/api/clan/messages', { body }),
      fields: setErrors,
    }).then((m) => {
      if (m) {
        setBody('');
        refresh();
      }
    });
  };
  const warden = clan.myRole !== 'deckhand';
  const zone = s.me?.timeZone ?? 'UTC';
  return (
    <>
      <ul ref={log} class="list chat-log" role="log" aria-label="Clan chat">
        {messages.map((m) => (
          <ChatMessage key={m.id} m={m} warden={warden} zone={zone} />
        ))}
      </ul>
      {messages.length === 0 && (
        <section>
          <Empty>The chat is quiet. Say hello to your clan.</Empty>
        </section>
      )}
      <form onSubmit={send} noValidate>
        <section>
          <Field id="chat-body" label="Message" error={errors.body}>
            <input id="chat-body" type="text" maxLength={500} value={body} onInput={(e) => setBody(e.currentTarget.value)} {...invalid('chat-body', errors.body)} />
          </Field>
          <Button type="submit" variant="primary" busy={busy}>
            Send
          </Button>
        </section>
      </form>
    </>
  );
}

function Requests() {
  const s = useStore();
  const [unit, setUnit] = useState<UnitKey>('saltjack');
  const [count, setCount] = useState('1');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, run] = useBusy();
  const open = (s.clan?.requests?.requests ?? []).filter((r) => r.requester.accountId !== s.me?.id && r.state === 'open');
  const submit = (e: Event): void => {
    e.preventDefault();
    const n = Number(count);
    void run({
      pending: 'Posting…',
      run: () => api.post<UnitRequest>('/api/clan/requests', { unit, count: Number.isInteger(n) && count.trim() !== '' ? n : count }),
      success: (r) => `Request posted for ${r.count} ${UNITS[r.unit].name}.`,
      errors: { request_open: 'You already have an open request.' },
      fields: setErrors,
    }).then(refresh);
  };
  return (
    <>
      <ul class="list" aria-label="Open requests">
        {open.map((r) => (
          <li key={r.id}>
            <span>
              <strong>{r.requester.displayName}</strong> · <span class="num">{progress(r)}</span>
            </span>
            <Button onClick={(e) => update({ dialog: { kind: 'donate', request: r, opener: e.currentTarget as HTMLElement } })}>Donate to {r.requester.displayName}</Button>
          </li>
        ))}
      </ul>
      {open.length === 0 && (
        <section>
          <Empty>No clanmate is asking for units.</Empty>
        </section>
      )}
      <form onSubmit={submit} noValidate>
        <section>
          <h3>Ask for units</h3>
          <fieldset class="stack bare">
            <legend class="sr-only">Unit</legend>
            {UNIT_KEYS.map((key) => (
              <label key={key} class="radio-chip">
                <input type="radio" name="request-unit" checked={unit === key} onChange={() => setUnit(key)} {...invalid('request-unit', errors.unit)} />
                <span>{UNITS[key].name}</span>
              </label>
            ))}
            {errors.unit && (
              <p class="field-error" id="request-unit-error">
                {errors.unit}
              </p>
            )}
          </fieldset>
          <Field id="request-count" label="Count" error={errors.count}>
            <input id="request-count" type="number" min={1} max={6} step={1} value={count} onInput={(e) => setCount(e.currentTarget.value)} {...invalid('request-count', errors.count)} />
          </Field>
          <Button type="submit" variant="primary" busy={busy}>
            Request units
          </Button>
        </section>
      </form>
    </>
  );
}

function MyRequest({ mine }: { mine: UnitRequest }) {
  const [busy, run] = useBusy();
  return (
    <section role="region" aria-label="My request" class="my-request">
      <p>
        <span class="num">{progress(mine)}</span>
        {mine.state !== 'open' && <span class="hint"> · {mine.state}</span>}
      </p>
      {mine.state === 'open' && (
        <Button
          busy={busy}
          onClick={() =>
            void run({
              pending: 'Cancelling…',
              run: () => api.post<UnitRequest>(`/api/clan/requests/${mine.id}/cancel`),
              success: () => 'Request cancelled.',
              errors: { request_closed: REQUEST_CLOSED },
            }).then(refresh)
          }
        >
          Cancel my request
        </Button>
      )}
    </section>
  );
}

const CLAN_TABS = [
  { key: 'members', label: 'Members' },
  { key: 'chat', label: 'Chat' },
  { key: 'requests', label: 'Requests' },
] as const;
type ClanTab = (typeof CLAN_TABS)[number]['key'];

function InClan({ clan }: { clan: Clan }) {
  const s = useStore();
  const [tab, setTab] = useState<ClanTab>('members');
  const [busy, run] = useBusy();
  const mine = s.clan?.requests?.mine ?? null;
  const leave = (): void => {
    setLeavingClan(true);
    void run({
      pending: 'Leaving…',
      run: () => api.post<{ newSkipper: { displayName: string } | null; disbanded: boolean }>('/api/clan/leave'),
      success: (r) =>
        r.disbanded ? `You left ${clan.name}. The clan was disbanded.` : r.newSkipper ? `You left ${clan.name}. ${r.newSkipper.displayName} now leads it.` : `You left ${clan.name}.`,
    })
      .then(() => loadClan())
      .catch(() => undefined)
      .finally(() => {
        setLeavingClan(false);
        void loadMe().catch(() => undefined);
      });
  };
  return (
    <>
      <section>
        <p>
          Rank <span class="num">{clan.rank}</span> · <span class="num">{fmt(clan.trophies)}</span> trophies
        </p>
        {clan.motto && <p class="hint">“{clan.motto}”</p>}
      </section>
      {mine && <MyRequest mine={mine} />}
      <Tabs id="clan" tabs={CLAN_TABS} value={tab} onChange={setTab} />
      <div id="clan-panel" role="tabpanel" aria-labelledby={`clan-tab-${tab}`}>
        {tab === 'members' && <Members clan={clan} />}
        {tab === 'chat' && <Chat clan={clan} />}
        {tab === 'requests' && <Requests />}
      </div>
      <section>
        <Button variant="danger" busy={busy} onClick={leave}>
          Leave clan
        </Button>
      </section>
    </>
  );
}

export function ClanPanel() {
  const s = useStore();
  useEffect(refresh, []);
  const clan = s.clan?.clan ?? null;
  return (
    <Panel label="Clan" title={clan ? clan.name : 'Clan'}>
      {!s.clan ? <div class="skeleton" /> : clan ? <InClan key={clan.id} clan={clan} /> : <NoClan />}
    </Panel>
  );
}

const DONATE_ERRORS = {
  request_closed: REQUEST_CLOSED,
  exceeds_request: 'That request needs fewer units now.',
  donor_limit: "You've already given 3 units to this request.",
  units_unavailable: "You don't have those units.",
  recipient_housing_full: 'Their camps are full.',
  raid_in_progress: START_RAID_ERRORS.raid_in_progress,
};

export function DonateDialog({ request, opener }: { request: UnitRequest; opener: HTMLElement | null }) {
  const [count, setCount] = useState('1');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, run] = useBusy();
  const input = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => {
    input.current?.focus();
  }, []);
  const name = request.requester.displayName;
  const unit = UNITS[request.unit].name;
  const close = (): void => {
    update({ dialog: null });
    const label = opener?.textContent;
    const again = [...document.querySelectorAll<HTMLElement>('.panel button')].find((b) => b.textContent === label);
    (again ?? opener)?.focus();
  };
  const submit = (e: Event): void => {
    e.preventDefault();
    const n = Number(count);
    void run({
      pending: 'Donating…',
      run: () => api.post<{ donation: { count: number } }>(`/api/clan/requests/${request.id}/donations`, { count: Number.isInteger(n) && count.trim() !== '' ? n : count }),
      success: (r) => `You donated ${r.donation.count} ${unit} to ${name}.`,
      errors: {
        ...DONATE_ERRORS,
        donation_cap_reached: (f: ApiFailure) => `You've given 8 units today. Donate again at ${localDateTime(f.body?.nextDonationAt ?? Date.now(), state.me?.timeZone ?? 'UTC')}.`,
      },
      fields: setErrors,
    }).then((r) => {
      if (!r) return;
      close();
      refresh();
      void loadVillage().catch(() => undefined);
    });
  };
  return (
    <div class="scrim" onClick={(e) => e.target === e.currentTarget && close()}>
      <div
        class="dialog narrow"
        role="dialog"
        aria-modal="true"
        aria-labelledby="donate-title"
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            close();
          } else trapTab(e, e.currentTarget);
        }}
      >
        <header class="panel-head">
          <h2 id="donate-title">Donate</h2>
          <Button variant="quiet" onClick={close}>
            Close
          </Button>
        </header>
        <form onSubmit={submit} noValidate>
          <section class="dialog-body">
            <p>
              {name} asks for <span class="num">{progress(request)}</span>. You may give up to 3 units to one request and 8 a day.
            </p>
            <Field id="donate-count" label="Count" error={errors.count}>
              <input ref={input} id="donate-count" type="number" min={1} max={3} step={1} value={count} onInput={(e) => setCount(e.currentTarget.value)} {...invalid('donate-count', errors.count)} />
            </Field>
            <Button type="submit" variant="primary" busy={busy}>
              Donate
            </Button>
          </section>
        </form>
      </div>
    </div>
  );
}
