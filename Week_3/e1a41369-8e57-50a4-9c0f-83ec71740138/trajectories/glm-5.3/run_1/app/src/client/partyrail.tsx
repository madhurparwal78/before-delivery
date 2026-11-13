import { useEffect, useRef, useState } from 'react';
import { api, fmt1, fmtGold, MINUS, QUEST_FIXTURES, type Quest, type Party, type Task } from './api.js';
import { useStore } from './store.js';

/**
 * The party rail: banner, quest region with the Health Seam, members, chat.
 * Rendered in place on desktop and inside the "Party" dialog on phone.
 */
export function PartyRail({ inDialog }: { inDialog: boolean }) {
  const store = useStore();
  const { party, quest, invites, player, chat } = store;
  const [name, setName] = useState('');
  const [inviteName, setInviteName] = useState('');
  const [questChoice, setQuestChoice] = useState(QUEST_FIXTURES[0].name as string);
  const [error, setError] = useState('');
  const [bannerBusy, setBannerBusy] = useState(false);
  const [bannerOk, setBannerOk] = useState('');
  const [abandonOpen, setAbandonOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [chatError, setChatError] = useState('');
  const [restNotice, setRestNotice] = useState('');
  const seamRef = useRef<HTMLDivElement>(null);
  const [seamAnimate, setSeamAnimate] = useState(false);

  const isLeader = party != null && player != null && party.leader === player.username;
  const pendingInvite = invites[0];

  const run = async (fn: () => Promise<unknown>) => {
    setError('');
    try {
      await fn();
    } catch (err) {
      const failure = err as { status?: number; body?: { error?: string; errors?: Record<string, string> } };
      if (failure.body?.errors?.username) {
        setError(failure.body.errors.username);
      } else {
        setError('Something went wrong. Try again.');
      }
    }
  };

  const send = async () => {
    setChatError('');
    if (!party) return;
    try {
      await api.sendChat(party.id, message);
      setMessage('');
    } catch (err) {
      const failure = err as { status?: number; body?: { error?: string } };
      if (failure.status === 429) {
        setChatError(`Slow down: you can send ${5} messages a minute.`);
      } else if (failure.body?.errors?.text) {
        setChatError(failure.body.errors.text);
      } else {
        setChatError('Something went wrong. Try again.');
      }
    }
  };

  const bossShare = quest ? Math.max(0, quest.bossHealth / quest.maxHealth) : 1;
  const defeat = quest?.state === 'defeated';

  // Animate the seam when the quest health changes (steps 2–4 of the sequence).
  const prevHealth = useRef<number | null>(null);
  useEffect(() => {
    if (!quest) return;
    if (prevHealth.current !== null && prevHealth.current !== quest.bossHealth) {
      setSeamAnimate(true);
      const t = setTimeout(() => setSeamAnimate(false), 600);
      prevHealth.current = quest.bossHealth;
      return () => clearTimeout(t);
    }
    prevHealth.current = quest.bossHealth;
  }, [quest?.bossHealth]);

  if (!party) {
    if (pendingInvite) {
      return (
        <section className="party-rail" aria-label="Party">
          <p className="invite-text">{pendingInvite.from} invited you to {pendingInvite.partyName}.</p>
          <div className="row-actions">
            <button className="btn btn-primary" type="button" onClick={() => void run(() => api.acceptInvite(pendingInvite.id))}>
              Join party
            </button>
            <button className="btn" type="button" onClick={() => void run(() => api.declineInvite(pendingInvite.id))}>
              Decline invite
            </button>
          </div>
          {error && <div className="alert-strip" role="alert">{error}</div>}
        </section>
      );
    }
    return (
      <section className="party-rail" aria-label="Party">
        <p className="empty-sentence">You are not in a party yet.</p>
        <input
          className="textbox"
          aria-label="Party name"
          placeholder="Party name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button
          className="btn btn-primary"
          type="button"
          disabled={name.trim().length === 0}
          onClick={() => void run(async () => {
            await api.formParty(name.trim());
            setName('');
          })}
        >
          Form party
        </button>
        {error && <div className="alert-strip" role="alert">{error}</div>}
      </section>
    );
  }

  return (
    <section className={`party-rail ${inDialog ? 'party-rail-dialog' : ''}`} aria-label="Party rail">
      {pendingInvite && (
        <div className="pending-invite">
          <p className="invite-text">{pendingInvite.from} invited you to {pendingInvite.partyName}.</p>
          <div className="row-actions">
            <button className="btn" type="button" onClick={() => void run(() => api.acceptInvite(pendingInvite.id))}>Join party</button>
            <button className="btn" type="button" onClick={() => void run(() => api.declineInvite(pendingInvite.id))}>Decline invite</button>
          </div>
        </div>
      )}
      {party.bannerUrl && (
        <img className="party-banner" src={party.bannerUrl} alt={`${party.name} banner`} />
      )}
      <div className="quest-region" role="region" aria-label="Quest">
        {quest ? (
          <>
            <div className={`seam-panel ${seamAnimate ? 'seam-animating' : ''}`} data-seam="panel" ref={seamRef}>
              {defeat ? (
                <div className="defeat-field">
                  <p className="defeat-word" aria-hidden="true">DOWN</p>
                  <p className="defeat-line">{quest.defeatedBy} landed the last blow.</p>
                </div>
              ) : (
                <>
                  <div className="seam-damage" style={{ height: `${(1 - bossShare) * 100}%` }} aria-hidden="true" />
                  <div className="seam-remaining" data-seam="remaining" style={{ height: `${bossShare * 100}%` }} aria-hidden="true" />
                  <p className="boss-name" aria-hidden="true">{quest.boss}</p>
                </>
              )}
            </div>
            <meter
              className="boss-meter"
              aria-label="Boss health"
              min={0}
              max={quest.maxHealth}
              value={defeat ? 0 : quest.bossHealth}
            >
              {fmt1(defeat ? 0 : quest.bossHealth)} / {fmt1(quest.maxHealth)}
            </meter>
            <span className="meter-value">{fmt1(defeat ? 0 : quest.bossHealth)} / {fmt1(quest.maxHealth)}</span>
            <ul className="strike-list" aria-label="Strikes">
              {quest.events.map((e) => (
                <li key={e.id} className="strike-line">
                  {e.kind === 'strike'
                    ? `${e.username} ${MINUS}${e.amount.toFixed(1)}`
                    : `${quest.boss} struck back for ${e.amount.toFixed(1)} (${e.username} missed ${e.missed})`}
                </li>
              ))}
            </ul>
            <p className="quest-state-line">State: {quest.state}</p>
            {quest.state === 'invited' && (
              <p className="invite-text">
                {quest.name}: {quest.acceptedBy.length} of {party.members.length} accepted
              </p>
            )}
            <div className="quest-controls">
              {isLeader && !quest && (
                <>
                  <select
                    className="textbox"
                    aria-label="Quest"
                    value={questChoice}
                    onChange={(e) => setQuestChoice(e.target.value)}
                  >
                    {QUEST_FIXTURES.map((fx) => (
                      <option key={fx.name} value={fx.name}>{fx.name}</option>
                    ))}
                  </select>
                  <button className="btn btn-primary" type="button" onClick={() => void run(() => api.inviteQuest(party.id, questChoice))}>
                    Invite party to quest
                  </button>
                </>
              )}
              {quest?.state === 'invited' && !isLeader && (
                <>
                  <button className="btn btn-primary" type="button" onClick={() => void run(() => api.acceptQuest(quest.id))}>Accept quest</button>
                  <button className="btn" type="button" onClick={() => void run(() => api.declineQuest(quest.id))}>Decline quest</button>
                </>
              )}
              {quest?.state === 'invited' && isLeader && (
                <button
                  className="btn btn-primary"
                  type="button"
                  disabled={quest.acceptedBy.length < 2}
                  onClick={() => void run(() => api.beginQuest(quest.id))}
                >
                  Begin quest
                </button>
              )}
              {quest && (quest.state === 'invited' || quest.state === 'active') && isLeader && (
                <button className="btn" type="button" onClick={() => setAbandonOpen(true)}>Abandon quest</button>
              )}
            </div>
          </>
        ) : (
          <>
            <p className="empty-sentence">No quest under way.</p>
            {isLeader && (
              <div className="quest-controls">
                <select
                  className="textbox"
                  aria-label="Quest"
                  value={questChoice}
                  onChange={(e) => setQuestChoice(e.target.value)}
                >
                  {QUEST_FIXTURES.map((fx) => (
                    <option key={fx.name} value={fx.name}>{fx.name}</option>
                  ))}
                </select>
                <button className="btn btn-primary" type="button" onClick={() => void run(() => api.inviteQuest(party.id, questChoice))}>
                  Invite party to quest
                </button>
              </div>
            )}
          </>
        )}
        {abandonOpen && quest && (
          <div className="dialog-backdrop" role="dialog" aria-label="Abandon quest">
            <div className="dialog panel-dialog">
              <h2 className="sheet-title">Abandon quest</h2>
              <p className="dialog-body">Abandon {quest.name}?</p>
              <div className="sheet-actions">
                <button
                  className="btn btn-danger"
                  type="button"
                  onClick={async () => {
                    setAbandonOpen(false);
                    await run(() => api.abandonQuest(quest.id));
                  }}
                >
                  Abandon
                </button>
                <button className="btn" type="button" onClick={() => setAbandonOpen(false)}>Keep fighting</button>
              </div>
            </div>
          </div>
        )}
      </div>

      {isLeader && (
        <div className="banner-upload">
          <label htmlFor="banner-file">Banner image</label>
          <input
            id="banner-file"
            type="file"
            accept="image/png,image/jpeg"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              setBannerBusy(true);
              setBannerOk('');
              setError('');
              try {
                await api.uploadBanner(party.id, file);
                setBannerOk('Banner updated.');
                void store.refreshAll();
              } catch (err) {
                const failure = err as { status?: number };
                if (failure.status === 413) setError('The image is larger than 2,000,000 bytes.');
                else if (failure.status === 415) setError('Choose a PNG or JPEG image.');
                else if (failure.status === 503) setError('File storage is unavailable. The banner was not changed.');
                else setError('Something went wrong. Try again.');
              } finally {
                setBannerBusy(false);
              }
            }}
          />
          <button className="btn btn-small" type="button" disabled={bannerBusy}>
            {bannerBusy ? 'Uploading...' : 'Upload banner'}
          </button>
          {bannerOk && <p className="status-ok" role="status">{bannerOk}</p>}
          {error && <div className="alert-strip" role="alert">{error}</div>}
        </div>
      )}

      {isLeader && (
        <div className="invite-form">
          <input
            className="textbox"
            aria-label="Invite by username"
            placeholder="Invite by username"
            value={inviteName}
            onChange={(e) => setInviteName(e.target.value)}
          />
          <button
            className="btn btn-small"
            type="button"
            disabled={inviteName.trim().length === 0}
            onClick={() => {
              void run(async () => {
                await api.invite(party.id, inviteName.trim());
                setInviteName('');
              });
            }}
          >
            Invite
          </button>
        </div>
      )}

      <ul className="member-list" aria-label="Party members">
        {party.members.map((m) => (
          <li key={m.username} className="member-row">
            <span>{m.username}</span>
            <meter className="member-meter" aria-label={`${m.username} health`} min={0} max={50.0} value={m.health}>
              {fmt1(m.health)} / 50.0
            </meter>
            <span className="meter-value">{fmt1(m.health)} / 50.0</span>
            {m.resting && <span className="resting-tag">resting</span>}
          </li>
        ))}
      </ul>

      <div className="party-chat">
        <div className="chat-log" role="log" aria-label="Party chat">
          {chat.map((m) => (
            <p key={m.id} className="chat-line">{m.username}: {m.text}</p>
          ))}
        </div>
        <input
          className="textbox"
          aria-label="Message"
          placeholder="Message"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void send();
            }
          }}
        />
        <button className="btn btn-small" type="button" onClick={() => void send()} disabled={message.trim().length === 0}>
          Send
        </button>
        {chatError && <div className="alert-strip" role="alert">{chatError}</div>}
      </div>
      {restNotice && <p className="status-ok" role="status">{restNotice}</p>}
    </section>
  );
}
