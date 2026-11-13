// A review room (DP-33..DP-39): live comments pinned to views, approvals that follow the head's geometry.
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { ApiError, CommentJson, LiveEvent, PartJson, RevisionJson, RoomJson, RoomResponse } from "../shared/api";
import { display, roundHalfEven } from "../shared/numbers";
import { compareKeys } from "../shared/order";
import { graphemeCount } from "../shared/text";
import { poseOfSolid, type Pose, type Solid, type Vec3 } from "../shared/tine";
import { get, KeyedAction } from "./api";
import { Alert } from "./partDialogs";
import { PageHeading } from "./chrome";
import { useEpoch } from "./epoch";
import { Icon } from "./icons";
import { useLiveEvents } from "./live";
import { useConfig, useSession } from "./session";
import { Link, NotFound, stateLabel } from "./shell";
import { fetchSolid, StorageDown } from "./solids";
import { Viewport, type Pin, type ViewportHandle } from "./viewport/Viewport";

const NOT_SENT = "Not sent yet. Try again.";

const orderOf = (c: CommentJson): (string | number)[] => [Date.parse(c.createdAt), c.id];
const inOrder = (list: CommentJson[]): CommentJson[] => [...list].sort((a, b) => compareKeys(orderOf(a), orderOf(b)));

export function RoomPage({ roomId }: { roomId: string }) {
  const { me, ready } = useSession();
  const [state, setState] = useState<{ room: RoomResponse; part: PartJson } | "denied" | "missing" | null>(null);
  useEffect(() => {
    if (!ready) return;
    let alive = true;
    void (async () => {
      const room = await get<RoomResponse>(`/api/rooms/${roomId}`);
      if (!alive) return;
      if (room.status === 401) return setState("denied");
      if (!room.ok) return setState("missing");
      const part = await get<PartJson>(`/api/parts/${room.data.room.partSlug}`);
      if (alive) setState(part.ok ? { room: room.data, part: part.data } : "missing");
    })();
    return () => {
      alive = false;
    };
  }, [roomId, ready, me?.id]);
  if (state === "missing") return <NotFound />;
  if (state === "denied")
    return (
      <section className="notice-page">
        <h1>Sign in to open this room</h1>
        <p>Review rooms are open to the part's owner and its invited reviewers.</p>
        <Link to={`/signin?next=${encodeURIComponent(`/rooms/${roomId}`)}`} className="button primary">
          Sign in
        </Link>
      </section>
    );
  if (!state) return <div className="loading-page" aria-busy="true" />;
  return <RoomView initial={state.room} part={state.part} />;
}

function RoomView({ initial, part }: { initial: RoomResponse; part: PartJson }) {
  const { me } = useSession();
  const config = useConfig();
  const [room, setRoom] = useState<RoomJson>(initial.room);
  const [comments, setComments] = useState<CommentJson[]>(() => inOrder(initial.comments));
  const [head, setHead] = useState<RevisionJson>(part.revision);
  const [lines, setLines] = useState("");
  const [activity, setActivity] = useState("");
  const [refusal, setRefusal] = useState("");
  const [unanswered, setUnanswered] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [composer, setComposer] = useState<{ anchor: CommentJson["anchor"]; pose: Pose } | null>(null);
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState("");
  const [pending, setPending] = useState(false);
  const [commentLine, setCommentLine] = useState("");
  const [solid, setSolid] = useState<Solid | null>(null);
  const [outage, setOutage] = useState(false);
  const [epoch, bumpEpoch] = useEpoch(`tinework:epoch:threads:${room.id}`);
  const viewport = useRef<ViewportHandle>(null);
  const defaultPose = useRef<Pose | null>(null);
  const post = useRef(new KeyedAction());
  const approve = useRef(new KeyedAction());
  const painted = useRef(0);
  const owner = me?.id === room.createdBy;
  const mine = room.approvals.some((a) => a.reviewerId === me?.id);
  const limit = config.commentMaxChars;

  useEffect(() => {
    if (comments.length > painted.current) bumpEpoch(comments.length - painted.current);
    painted.current = comments.length;
  }, [comments.length, bumpEpoch]);

  useEffect(() => {
    let alive = true;
    setOutage(false);
    fetchSolid(head.geometryDigest).then(
      (loaded) => alive && setSolid(loaded),
      (error: unknown) => alive && error instanceof StorageDown && setOutage(true),
    );
    return () => {
      alive = false;
    };
  }, [head.geometryDigest]);
  if (solid && !defaultPose.current) defaultPose.current = poseOfSolid(solid);

  useLiveEvents(part.slug, (event: LiveEvent) => {
    if (event.type === "revision") setHead(event.revision);
    if (event.type === "comment" && event.comment.roomId === room.id) {
      setComments((list) => (list.some((c) => c.id === event.comment.id) ? list : inOrder([...list, event.comment])));
      if (event.comment.author.id !== me?.id) setActivity(`New comment from ${event.comment.author.displayName}.`);
    }
    if (event.type === "approvals" && event.room.id === room.id) {
      setRoom(event.room);
      const line =
        event.reason === "approved"
          ? `${event.displayName} approved ${event.label}.`
          : event.reason === "reset"
            ? `Approvals reset: ${event.label} changed the part.`
            : event.reason === "carried"
              ? `${event.label} has the same geometry; approvals carried over.`
              : event.reason === "matched"
                ? `${event.label} matches approved geometry; approvals count again.`
                : "";
      if (line) setActivity(line);
      if (event.reason === "reset" || event.reason === "carried" || event.reason === "matched") setLines(line);
    }
  });

  const runApprove = async () => {
    setRefusal("");
    const reply = await approve.current.send<RoomJson & ApiError>("POST", `/api/rooms/${room.id}/approvals`, { revisionId: room.headRevisionId });
    setUnanswered(reply === null);
    if (!reply) setRefusal(NOT_SENT);
    else if (reply.ok) setRoom(reply.data as RoomJson);
    else setRefusal(reply.data.message);
  };
  const closeRoom = async () => {
    const reply = await new KeyedAction().send<RoomJson & ApiError>("POST", `/api/rooms/${room.id}/close`, {});
    if (reply?.ok) setRoom(reply.data as RoomJson);
    else if (reply) setRefusal(reply.data.message);
  };

  const currentPose = (): Pose => {
    const pose = viewport.current?.getPose() ?? defaultPose.current ?? { position: [60, -60, 60], target: [0, 0, 4], up: [0, 0, 1], fov: 35 };
    const r = (v: Vec3): Vec3 => [roundHalfEven(v[0], 3), roundHalfEven(v[1], 3), roundHalfEven(v[2], 3)];
    return { position: r(pose.position), target: r(pose.target), up: [0, 0, 1], fov: 35 };
  };

  const remaining = limit - graphemeCount(text);
  const submit = async () => {
    if (!composer || pending || remaining < 0) return;
    setPending(true);
    setCommentLine("");
    const reply = await post.current.send<CommentJson & ApiError>("POST", `/api/rooms/${room.id}/comments`, { body: text, anchor: composer.anchor, pose: composer.pose });
    setPending(false);
    if (!reply) setCommentLine(NOT_SENT);
    else if (reply.status === 201) {
      const created = reply.data as CommentJson;
      setComments((list) => (list.some((c) => c.id === created.id) ? list : inOrder([...list, created])));
      setText("");
    } else setCommentLine((reply.data as ApiError).errors?.body ?? (reply.data as ApiError).message);
  };

  const onThreadKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = comments.findIndex((c) => c.id === selected);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const next = comments[Math.max(0, Math.min(comments.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)))];
      if (next) setSelected(next.id);
    } else if (event.key === "Enter" && index >= 0) {
      event.preventDefault();
      viewport.current?.glideTo((comments[index] as CommentJson).pose);
    }
  };

  const pins = useMemo<Pin[]>(
    () => comments.flatMap((c) => (c.anchor.kind === "point" ? [{ id: `c-${c.id}`, kind: "comment" as const, position: c.anchor.position }] : [])),
    [comments],
  );
  const stateWord = stateLabel(room.state);
  const required = room.requiredApprovals;

  return (
    <div className="page room-page">
      <header className="part-header">
        <PageHeading>{room.title}</PageHeading>
        <p className="by">
          <span>{`Reviewing ${head.label}`}</span>
          <span className={`state state-${room.state}`}>{stateWord}</span>
          <span>{`Approvals ${display(room.approvals.length, 0)} of ${display(required, 0)}`}</span>
        </p>
        {lines ? <p className="muted">{lines}</p> : null}
        <p className="muted small">
          <Link to={`/parts/${part.slug}`}>{part.title}</Link>
        </p>
        <div className="actions">
          {!owner && room.state !== "closed" && (!mine || unanswered) ? (
            <button type="button" className="button primary" onClick={runApprove}>
              {`Approve ${head.label}`}
            </button>
          ) : null}
          {owner && room.state !== "closed" ? (
            <button type="button" className="button" onClick={closeRoom}>
              Close room
            </button>
          ) : null}
        </div>
        {refusal ? <Alert>{refusal}</Alert> : null}
        <p className="activity" role="status" aria-label="Room activity">
          {activity}
        </p>
      </header>
      <div className="room-grid">
        <div className="stage">
          <Viewport
            ref={viewport}
            attrs={{}}
            scene={solid ? { key: `room:${head.geometryDigest}`, solid } : null}
            defaultPose={defaultPose.current}
            pins={pins}
            outage={outage ? { lastGood: null } : null}
            fallback={{ src: `/api/solids/${head.geometryDigest}/thumbnail.svg`, alt: `${part.title}, ${head.label}` }}
            onCanvasClick={(point) => {
              if (adding && point) {
                setComposer({ anchor: { kind: "point", position: point }, pose: currentPose() });
                setAdding(false);
              }
            }}
          />
        </div>
        <div className="room-side">
          <div
            className="threads"
            role="listbox"
            aria-label="Threads"
            tabIndex={0}
            data-epoch={epoch}
            aria-activedescendant={selected ? `thread-${selected}` : undefined}
            onKeyDown={onThreadKey}
          >
            {comments.map((c) => (
              <div
                key={c.id}
                id={`thread-${c.id}`}
                role="option"
                aria-label={`${c.author.displayName}: ${c.body}`}
                aria-selected={c.id === selected}
                className={c.id === selected ? "thread active" : "thread"}
                onClick={() => {
                  setSelected(c.id);
                  viewport.current?.glideTo(c.pose);
                }}
              >
                <strong>{c.author.displayName}:</strong>
                <span>{c.body}</span>
              </div>
            ))}
          </div>
          {comments.length === 0 ? <p className="muted small">No comments yet. Comment on this view to start the thread.</p> : null}
          <div className="composer">
              <div className="composer-actions">
                <button type="button" className="button" aria-pressed={adding} onClick={() => setAdding(!adding)}>
                  <Icon name="dimension" size={16} />
                  Add comment
                </button>
                <button type="button" className="button" onClick={() => setComposer({ anchor: { kind: "none" }, pose: currentPose() })}>
                  Comment on this view
                </button>
              </div>
              {adding ? <p className="muted small">Click the solid to place the comment.</p> : null}
              {composer ? (
                <>
                  <label className="stacked">
                    <span>Comment</span>
                    <textarea value={text} rows={3} onChange={(event) => setText(event.target.value)} />
                  </label>
                  <p className={remaining < 0 ? "counter over" : "counter"}>{remaining < 0 ? `${display(-remaining, 0)} characters over` : `${display(remaining, 0)} characters left`}</p>
                  {commentLine ? (
                    <p className="field-error">
                      <Icon name="alert" size={16} />
                      {commentLine}
                    </p>
                  ) : null}
                  <button type="button" className="button primary" disabled={pending} aria-disabled={remaining < 0 ? true : undefined} onClick={submit}>
                    <span className={pending ? "busy" : undefined}>Post comment</span>
                  </button>
                </>
              ) : null}
            </div>
        </div>
      </div>
    </div>
  );
}
