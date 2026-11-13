import { useEffect, useRef, useState } from 'react';
import type { ChatMessage, Invite, Party, Player, Quest, QuestFixture, StrikeEvent } from '../../shared/types.js';
import { MINUS, tenths1 } from '../../shared/format.js';
import { ApiFailure, api } from '../api.js';
import { chatLimit } from '../limits.js';
import { slideUpInto } from '../motion.js';
import { GENERIC_ERROR, refreshInvites, refreshParty, showAlert } from '../store.js';
import { Dialog } from './Dialog.js';
import { HealthSeam } from './HealthSeam.js';
import { BossMeter, MemberHealthMeter } from './Meters.js';

export function strikeLine(event: StrikeEvent, boss: string): string {
  if (event.kind === 'strike') return `${event.username} ${MINUS}${tenths1(event.amount)}`;
  return `${boss} struck back for ${tenths1(event.amount)} (${event.username} missed ${event.missed})`;
}

interface PartyRailProps {
  player: Player;
  party: Party | null;
  quest: Quest | null;
  invites: Invite[];
  chat: ChatMessage[];
  fixtures: QuestFixture[];
}

export function PartyRail({ player, party, quest, invites, chat, fixtures }: PartyRailProps): JSX.Element {
  return (
    <aside className="party-rail">
      {invites.length > 0 ? <InviteBlock invite={invites[0] as Invite} accent={party === null} /> : null}
      {party === null ? <FormParty accent={invites.length === 0} /> : null}
      {party !== null ? (
        <>
          <QuestRegion player={player} party={party} quest={quest} fixtures={fixtures} />
          <MemberList party={party} />
          <PartyChat party={party} chat={chat} />
        </>
      ) : null}
    </aside>
  );
}

function InviteBlock({ invite, accent }: { invite: Invite; accent: boolean }): JSX.Element {
  return (
    <section className="rail-block">
      <p>{`${invite.from} invited you to ${invite.partyName}.`}</p>
      <div className="rail-actions">
        <button
          type="button"
          className={accent ? 'primary' : ''}
          onClick={() => {
            void api
              .acceptInvite(invite.id)
              .then(() => Promise.all([refreshParty(), refreshInvites()]))
              .catch(() => showAlert(GENERIC_ERROR));
          }}
        >
          Join party
        </button>
        <button
          type="button"
          onClick={() => {
            void api
              .declineInvite(invite.id)
              .then(() => refreshInvites())
              .catch(() => showAlert(GENERIC_ERROR));
          }}
        >
          Decline invite
        </button>
      </div>
    </section>
  );
}

function FormParty({ accent }: { accent: boolean }): JSX.Element {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <section className="rail-block">
      <p className="rail-empty">You are not in a party yet.</p>
      <div className="field">
        <label htmlFor="party-name">Party name</label>
        <input id="party-name" type="text" value={name} onChange={(event) => setName(event.currentTarget.value)} />
        {error ? (
          <p className="field-error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
      <button
        type="button"
        className={accent ? 'primary' : ''}
        disabled={busy}
        onClick={() => {
          setBusy(true);
          setError(null);
          void api
            .formParty(name)
            .then(() => refreshParty())
            .catch((failure: unknown) => {
              if (failure instanceof ApiFailure && failure.status === 422) {
                setError(failure.fieldErrors.name ?? GENERIC_ERROR);
              } else showAlert(GENERIC_ERROR);
            })
            .finally(() => setBusy(false));
        }}
      >
        Form party
      </button>
    </section>
  );
}

function QuestRegion({
  player,
  party,
  quest,
  fixtures,
}: {
  player: Player;
  party: Party;
  quest: Quest | null;
  fixtures: QuestFixture[];
}): JSX.Element {
  const isLeader = party.leader === player.username;
  const [chosen, setChosen] = useState(fixtures[0]?.name ?? '');
  const [abandoning, setAbandoning] = useState(false);
  const [busy, setBusy] = useState(false);
  const strikeList = useRef<HTMLUListElement | null>(null);
  const strikeCount = useRef(quest ? quest.events.length : 0);

  useEffect(() => {
    const count = quest ? quest.events.length : 0;
    if (count > strikeCount.current) {
      const items = strikeList.current?.children;
      if (items) slideUpInto(items[items.length - 1] as HTMLElement);
    }
    strikeCount.current = count;
  }, [quest]);

  useEffect(() => {
    if (chosen === '' && fixtures[0]) setChosen(fixtures[0].name);
  }, [fixtures, chosen]);

  const live = quest !== null && (quest.state === 'invited' || quest.state === 'active');
  const accepted = quest !== null && quest.acceptedBy.includes(player.username);
  const showAccept = quest !== null && quest.state === 'invited' && !accepted;
  const canBegin = quest !== null && quest.acceptedBy.length >= 2;
  const defeated = quest !== null && quest.state === 'defeated';

  const run = (work: () => Promise<unknown>): void => {
    setBusy(true);
    void work()
      .then(() => refreshParty())
      .catch(() => showAlert(GENERIC_ERROR))
      .finally(() => setBusy(false));
  };

  return (
    <section className="rail-block" role="region" aria-label="Quest">
      {party.bannerUrl ? <img className="party-banner" src={party.bannerUrl} alt={`${party.name} banner`} /> : null}
      {quest === null ? (
        <p className="rail-empty">No quest under way.</p>
      ) : (
        <>
          <HealthSeam
            boss={quest.boss}
            health={quest.bossHealth}
            max={quest.maxHealth}
            defeated={quest.state === 'defeated'}
            defeatLine={`${quest.defeatedBy ?? ''} landed the last blow.`}
          />
          <BossMeter name="Boss health" value={quest.bossHealth} max={quest.maxHealth} />
          {quest.state === 'invited' ? (
            <p className="quest-invite">{`${quest.name}: ${quest.acceptedBy.length} of ${party.members.length} accepted`}</p>
          ) : null}
          <ul className="strike-list" role="list" aria-label="Strikes" ref={strikeList}>
            {quest.events.map((event) => (
              <li key={event.id} className="strike-line">
                <span>{strikeLine(event, quest.boss)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      <div className="quest-controls">
        {isLeader && !live ? (
          <>
            <div className="field">
              <label htmlFor="quest-choice">Quest</label>
              <select id="quest-choice" value={chosen} onChange={(event) => setChosen(event.currentTarget.value)}>
                {fixtures.map((fixture) => (
                  <option key={fixture.name} value={fixture.name}>
                    {fixture.name}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              className={defeated ? '' : 'primary'}
              disabled={busy}
              onClick={() => run(() => api.inviteQuest(party.id, chosen))}
            >
              Invite party to quest
            </button>
          </>
        ) : null}
        {showAccept && quest ? (
          <>
            <button type="button" className="primary" disabled={busy} onClick={() => run(() => api.acceptQuest(quest.id))}>
              Accept quest
            </button>
            <button type="button" disabled={busy} onClick={() => run(() => api.declineQuest(quest.id))}>
              Decline quest
            </button>
          </>
        ) : null}
        {isLeader && quest && quest.state === 'invited' ? (
          <button
            type="button"
            className="primary"
            disabled={busy || !canBegin}
            onClick={() => run(() => api.beginQuest(quest.id))}
          >
            Begin quest
          </button>
        ) : null}
        {isLeader && live ? (
          <button type="button" disabled={busy} onClick={() => setAbandoning(true)}>
            Abandon quest
          </button>
        ) : null}
      </div>
      {isLeader ? <BannerUpload party={party} /> : null}
      {isLeader ? <InviteByUsername party={party} /> : null}
      {abandoning && quest ? (
        <Dialog name="Abandon quest" onClose={() => setAbandoning(false)}>
          <h2 className="dialog-title">Abandon quest</h2>
          <div className="dialog-actions">
            <button
              type="button"
              className="danger"
              onClick={() => {
                setAbandoning(false);
                run(() => api.abandonQuest(quest.id));
              }}
            >
              Abandon
            </button>
            <button type="button" onClick={() => setAbandoning(false)}>
              Keep fighting
            </button>
          </div>
        </Dialog>
      ) : null}
    </section>
  );
}

function InviteByUsername({ party }: { party: Party }): JSX.Element {
  const [username, setUsername] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="rail-invite">
      <div className="field">
        <label htmlFor="invite-username">Invite by username</label>
        <input
          id="invite-username"
          type="text"
          value={username}
          onChange={(event) => setUsername(event.currentTarget.value)}
        />
        {error ? (
          <p className="field-error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          setError(null);
          void api
            .invite(party.id, username)
            .then(() => {
              setUsername('');
              return refreshParty();
            })
            .catch((failure: unknown) => {
              if (failure instanceof ApiFailure && failure.status === 422) {
                setError(failure.fieldErrors.username ?? GENERIC_ERROR);
              } else showAlert(GENERIC_ERROR);
            })
            .finally(() => setBusy(false));
        }}
      >
        Invite
      </button>
    </div>
  );
}

function BannerUpload({ party }: { party: Party }): JSX.Element {
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="rail-banner">
      <div className="field">
        <label htmlFor="banner-image">Banner image</label>
        <input
          id="banner-image"
          type="file"
          accept="image/png,image/jpeg"
          onChange={(event) => setFile(event.currentTarget.files?.[0] ?? null)}
        />
      </div>
      <button
        type="button"
        disabled={busy || file === null}
        onClick={() => {
          if (!file) return;
          setBusy(true);
          setStatus(null);
          showAlert(null);
          void api
            .uploadBanner(party.id, file)
            .then(() => {
              setStatus('Banner updated.');
              return refreshParty();
            })
            .catch((failure: unknown) => {
              if (failure instanceof ApiFailure) {
                if (failure.status === 413) showAlert('The image is larger than 2,000,000 bytes.');
                else if (failure.status === 415) showAlert('Choose a PNG or JPEG image.');
                else if (failure.status === 503) showAlert('File storage is unavailable. The banner was not changed.');
                else showAlert(GENERIC_ERROR);
              } else showAlert(GENERIC_ERROR);
            })
            .finally(() => setBusy(false));
        }}
      >
        {busy ? 'Uploading...' : 'Upload banner'}
      </button>
      {status ? <p role="status">{status}</p> : null}
    </div>
  );
}

function MemberList({ party }: { party: Party }): JSX.Element {
  return (
    <section className="rail-block">
      <ul className="member-list" role="list" aria-label="Party members">
        {party.members.map((member) => (
          <li key={member.username}>
            <span className="member-name">{member.username}</span>
            <MemberHealthMeter username={member.username} value={member.health} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function PartyChat({ party, chat }: { party: Party; chat: ChatMessage[] }): JSX.Element {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const send = (): void => {
    if (busy) return;
    setBusy(true);
    setError(null);
    void api
      .sendChat(party.id, text)
      .then(() => setText(''))
      .catch((failure: unknown) => {
        if (failure instanceof ApiFailure && failure.status === 429) {
          setError(`Slow down: you can send ${chatLimit()} messages a minute.`);
        } else if (failure instanceof ApiFailure && failure.status === 422) {
          setError(failure.fieldErrors.text ?? GENERIC_ERROR);
        } else showAlert(GENERIC_ERROR);
      })
      .finally(() => setBusy(false));
  };

  return (
    <section className="rail-block">
      <ul className="chat-log" role="log" aria-label="Party chat">
        {chat.map((message) => (
          <li key={message.id}>{`${message.username}: ${message.text}`}</li>
        ))}
      </ul>
      <div className="chat-composer">
        <div className="field">
          <label htmlFor="chat-message">Message</label>
          <input
            id="chat-message"
            type="text"
            value={text}
            onChange={(event) => setText(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                send();
              }
            }}
          />
        </div>
        <button type="button" disabled={busy} onClick={send}>
          Send
        </button>
        {error ? (
          <p className="field-error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </section>
  );
}
