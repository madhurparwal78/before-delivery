import { Upload } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { MIN_ACCEPTED_TO_BEGIN, MINUS, type Quest, type StrikeEvent } from "../../shared/api";
import { ApiError, GENERIC_FAILURE, api, explain } from "../api";
import { tenths } from "../format";
import { setState, useStore } from "../store";
import { AbandonQuest } from "./AbandonQuest";
import { Seam } from "./Seam";

const BANNER_COPY: Record<string, string> = {
  file_too_large: "The image is larger than 2,000,000 bytes.",
  unsupported_file_type: "Choose a PNG or JPEG image.",
  storage_unavailable: "File storage is unavailable. The banner was not changed.",
};

const chatLimit = Number(document.querySelector<HTMLMetaElement>('meta[name="chat-limit"]')?.content);

async function attempt(work: () => Promise<unknown>): Promise<void> {
  setState({ alert: null });
  try {
    await work();
  } catch (error) {
    setState({ alert: explain(error) });
  }
}

function Invites() {
  const invites = useStore((state) => state.invites);
  return (
    <>
      {invites.map((invite, index) => (
        <div className="invite" key={invite.id}>
          <p>{`${invite.from} invited you to ${invite.partyName}.`}</p>
          <div className="form-actions">
            <button type="button" className={index === 0 ? "btn btn-accent" : "btn"} onClick={() => void attempt(() => api("POST", `/api/invites/${invite.id}/accept`, {}))}>Join party</button>
            <button type="button" className="btn" onClick={() => void attempt(() => api("POST", `/api/invites/${invite.id}/decline`, {}))}>Decline invite</button>
          </div>
        </div>
      ))}
    </>
  );
}

function FormParty() {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const hasInvites = useStore((state) => state.invites.length > 0);
  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setError(null);
    try {
      await api("POST", "/api/parties", { name });
    } catch (failure) {
      setError(explain(failure));
    }
  };
  return (
    <form className="form" onSubmit={(event) => void submit(event)}>
      <p>You are not in a party yet.</p>
      <label className="field-label" htmlFor="party-name">Party name</label>
      <input id="party-name" type="text" value={name} onChange={(event) => setName(event.target.value)} />
      {error && <p className="field-error" role="alert">{error}</p>}
      <button type="submit" className={hasInvites ? "btn" : "btn btn-accent"}>Form party</button>
    </form>
  );
}

function StrikeLine({ event, boss, fresh }: { event: StrikeEvent; boss: string; fresh: boolean }) {
  return (
    <li className={fresh ? "strike strike-new" : "strike"}>
      {event.kind === "strike" ? (
        <>
          <span className="strike-name">{event.username}</span> <span className="strike-amount">{`${MINUS}${tenths(event.amount)}`}</span>
        </>
      ) : (
        <span className="strike-name">
          {`${boss} struck back for `}
          <span className="strike-amount">{tenths(event.amount)}</span>
          {` (${event.username} missed ${event.missed})`}
        </span>
      )}
    </li>
  );
}

export function StrikeList({ quest }: { quest: Quest }) {
  const seen = useRef<Set<string> | null>(null);
  const known = seen.current;
  useEffect(() => {
    seen.current = new Set(quest.events.map((event) => event.id));
  });
  return (
    <ul className="strikes" role="list" aria-label="Strikes">
      {quest.events.map((event) => (
        <StrikeLine key={event.id} event={event} boss={quest.boss} fresh={known !== null && !known.has(event.id)} />
      ))}
    </ul>
  );
}

function QuestControls({ quest }: { quest: Quest | null }) {
  const me = useStore((state) => state.me)!;
  const party = useStore((state) => state.party)!;
  const fixtures = useStore((state) => state.fixtures);
  const [choice, setChoice] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const leader = party.leader === me.username;
  const live = quest && (quest.state === "invited" || quest.state === "active") ? quest : null;
  const accepted = live?.acceptedBy.includes(me.username) ?? false;
  const enough = (live?.acceptedBy.length ?? 0) >= MIN_ACCEPTED_TO_BEGIN;
  const act = (move: string) => void attempt(() => api("POST", `/api/quests/${live!.id}/${move}`, {}));

  return (
    <div className="quest-controls">
      {live?.state === "invited" && (
        <p className="quest-invite">{`${live.name}: ${live.acceptedBy.length} of ${party.members.length} accepted`}</p>
      )}
      {!live && leader && (
        <div className="form">
          <label className="field-label" htmlFor="quest-pick">Quest</label>
          <select id="quest-pick" value={choice ?? fixtures[0]?.name ?? ""} onChange={(event) => setChoice(event.target.value)}>
            {fixtures.map((fixture) => (
              <option key={fixture.name} value={fixture.name}>{fixture.name}</option>
            ))}
          </select>
          <button type="button" className="btn" onClick={() => void attempt(() => api("POST", `/api/parties/${party.id}/quests`, { quest: choice ?? fixtures[0]?.name }))}>Invite party to quest</button>
        </div>
      )}
      {live?.state === "invited" && !accepted && !leader && (
        <div className="form-actions">
          <button type="button" className="btn btn-accent" onClick={() => act("accept")}>Accept quest</button>
          <button type="button" className="btn" onClick={() => act("decline")}>Decline quest</button>
        </div>
      )}
      {live?.state === "invited" && leader && (
        <button type="button" className="btn btn-accent" disabled={!enough} onClick={() => act("begin")}>Begin quest</button>
      )}
      {live && leader && <AbandonQuest open={confirming} setOpen={setConfirming} onAbandon={() => act("abandon")} />}
    </div>
  );
}

function QuestRegion() {
  const party = useStore((state) => state.party)!;
  const quest = useStore((state) => state.quest);
  const shown = quest;
  return (
    <section className="quest-region" role="region" aria-label="Quest">
      {party.bannerUrl && <img className="banner" src={party.bannerUrl} alt={`${party.name} banner`} />}
      {shown ? (
        <>
          <h3 className="boss-name">{shown.name}</h3>
          <Seam key={shown.id} boss={shown.boss} health={shown.bossHealth} max={shown.maxHealth} label="Boss health" defeatedBy={shown.defeatedBy} />
          <StrikeList quest={shown} />
        </>
      ) : (
        <p>No quest under way.</p>
      )}
      <QuestControls quest={shown} />
    </section>
  );
}

function Members() {
  const party = useStore((state) => state.party)!;
  const maxHealth = useStore((state) => state.me!.maxHealth);
  return (
    <ul className="members" role="list" aria-label="Party members">
      {party.members.map((member) => (
        <li key={member.username}>
          <span className="member-name">{member.username}</span>
          <span className="member-level">{`Lv ${member.level}`}</span>
          {member.resting && <span className="member-rest">Resting</span>}
          <div className="meter meter-health" role="meter" aria-label={`${member.username} health`} aria-valuemin={0} aria-valuemax={maxHealth} aria-valuenow={member.health} aria-valuetext={`${tenths(member.health)} / ${tenths(maxHealth)}`}>
            <span className="meter-fill" style={{ width: `${(member.health / maxHealth) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

function LeaderTools() {
  const party = useStore((state) => state.party)!;
  const [username, setUsername] = useState("");
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [bannerResult, setBannerResult] = useState<{ ok?: boolean; error?: string }>({});

  const invite = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setInviteError(null);
    try {
      await api("POST", `/api/parties/${party.id}/invites`, { username });
      setUsername("");
    } catch (error) {
      setInviteError(explain(error));
    }
  };

  const upload = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setUploading(true);
    setBannerResult({});
    const body = new FormData();
    body.append("file", file!);
    try {
      await api("PUT", `/api/parties/${party.id}/banner`, body);
      setBannerResult({ ok: true });
    } catch (error) {
      setBannerResult({ error: (error instanceof ApiError && error.body.error && BANNER_COPY[error.body.error]) || GENERIC_FAILURE });
    } finally {
      setUploading(false);
    }
  };

  return (
    <>
      <form className="form" onSubmit={(event) => void invite(event)}>
        <label className="field-label" htmlFor="invite-name">Invite by username</label>
        <input id="invite-name" type="text" value={username} onChange={(event) => setUsername(event.target.value)} />
        {inviteError && <p className="field-error" role="alert">{inviteError}</p>}
        <button type="submit" className="btn">Invite</button>
      </form>
      <form className="form" onSubmit={(event) => void upload(event)}>
        <label className="field-label" htmlFor="banner-file">Banner image</label>
        <input id="banner-file" type="file" accept="image/png,image/jpeg" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
        {bannerResult.error && <p className="field-error" role="alert">{bannerResult.error}</p>}
        {bannerResult.ok && <p className="success" role="status">Banner updated.</p>}
        <button type="submit" className="btn" disabled={uploading || !file}>
          <Upload aria-hidden="true" size={18} /> {uploading ? "Uploading..." : "Upload banner"}
        </button>
      </form>
    </>
  );
}

function Chat() {
  const party = useStore((state) => state.party)!;
  const chat = useStore((state) => state.chat);
  const [text, setText] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const log = useRef<HTMLDivElement>(null);

  useEffect(() => {
    log.current!.scrollTop = log.current!.scrollHeight;
  }, [chat.length]);

  const send = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await api("POST", `/api/parties/${party.id}/chat`, { text });
      setText("");
    } catch (failure) {
      setError(failure instanceof ApiError && failure.status === 429 ? `Slow down: you can send ${chatLimit} messages a minute.` : explain(failure));
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="chat">
      <div className="chat-log" role="log" aria-label="Party chat" ref={log} tabIndex={0}>
        {chat.map((message) => (
          <p key={message.id}>{`${message.username}: ${message.text}`}</p>
        ))}
      </div>
      <form className="chat-form" onSubmit={(event) => void send(event)}>
        <input type="text" aria-label="Message" value={text} onChange={(event) => setText(event.target.value)} />
        <button type="submit" className="btn" disabled={pending}>Send</button>
      </form>
      {error && <p className="field-error" role="alert">{error}</p>}
    </div>
  );
}

export function PartyPanel() {
  const party = useStore((state) => state.party);
  const me = useStore((state) => state.me)!;
  return (
    <div className="party-panel">
      <Invites />
      {party ? (
        <>
          <QuestRegion />
          <Members />
          {party.leader === me.username && <LeaderTools />}
          <Chat />
        </>
      ) : (
        <FormParty />
      )}
    </div>
  );
}
