import { useCallback, useEffect, useState, type ReactNode } from "react";
import { codePoints } from "../../shared/codepoints";
import { frameSize, layersAt } from "../../shared/layers";
import { NOTE_MAX } from "../../shared/limits";
import { rateOf } from "../../shared/rational";
import { timecode } from "../../shared/timecode";
import type { AspectRatio, Caption, Clip, Comment, MediaDims, Row } from "../../shared/types";
import { layerFill, layerStyle } from "../components/layer";
import { api, ApiError } from "../lib/api";
import { LiveSocket } from "../lib/live";
import { useLayout } from "../lib/router";
import { Loupe, type LoupeSource } from "../project/Loupe";
import { ClipsList, Scrubber } from "../project/Review";
import { Field } from "../ui";

interface ReviewData {
  project: { title: string; frame_rate: string; aspect_ratio: AspectRatio; width: number; height: number };
  owner_name: string;
  cut: { id: string; name: string; total_frames: number; rows: Row[]; clips: Clip[]; captions: Caption[]; media: Record<string, MediaDims> };
  comments: Comment[];
  approvals: { name: string; at: string }[];
}

export function Review({ token }: { token: string }): ReactNode {
  const [data, setData] = useState<ReviewData | null>(null);
  const [ended, setEnded] = useState<string | null>(null);
  const [socket] = useState(() => new LiveSocket(`?review=${encodeURIComponent(token)}`));

  const load = useCallback(async (): Promise<void> => {
    try {
      setData(await api.get<ReviewData>(`/api/review/${encodeURIComponent(token)}`));
      setEnded(null);
    } catch (error) {
      if (error instanceof ApiError) setEnded(error.message);
    }
  }, [token]);

  useEffect(() => {
    void load();
    const offOpen = socket.onOpen(() => socket.send({ type: "subscribe_review" }));
    const offMessage = socket.onMessage((message) => {
      if (message.type === "cut_shared") void load();
      if (message.type === "comment") {
        const { comment } = message;
        setData((current) =>
          current && comment.visibility === "review" && comment.cut_id === current.cut.id && !current.comments.some((existing) => existing.id === comment.id)
            ? { ...current, comments: [...current.comments, comment] }
            : current,
        );
      }
    });
    const offClose = socket.onClose((code) => {
      if (code === 4410) void load();
    });
    socket.connect();
    return () => {
      offOpen();
      offMessage();
      offClose();
      socket.close();
    };
  }, [socket, load]);

  if (ended) {
    return (
      <main className="plain" role="region" aria-label="Review">
        <p className="title">Gatecut</p>
        <p>{ended}</p>
      </main>
    );
  }
  if (!data) return <div className="boot" aria-busy="true" />;
  return <ReviewBody token={token} data={data} />;
}

function ReviewBody({ token, data }: { token: string; data: ReviewData }): ReactNode {
  const layout = useLayout();
  const [frame, setFrame] = useState(0);
  const [name, setName] = useState("");
  const [comment, setComment] = useState("");
  const [status, setStatus] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [held, setHeld] = useState<{ x: number; y: number } | null>(null);
  const { cut, project } = data;
  const rate = rateOf(project.frame_rate);
  const last = Math.max(0, cut.total_frames - 1);
  const size = frameSize(project.aspect_ratio);
  const layers = layersAt(frame, cut.clips, cut.rows, cut.media, size);
  const clips = new Map(cut.clips.map((clip) => [clip.id, clip]));
  const over = codePoints(comment) > NOTE_MAX;

  const act = async (pending: string, work: () => Promise<string>): Promise<void> => {
    setStatus(pending);
    try {
      setStatus(await work());
      setErrors({});
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      setErrors(error.fields);
      setStatus(error.message);
    }
  };

  const send = (): Promise<void> =>
    act("Sending…", async () => {
      await api.post(`/api/review/${encodeURIComponent(token)}/comments`, { name, body: comment, frame });
      setComment("");
      return "Comment sent.";
    });
  const approve = (): Promise<void> =>
    act("Approving…", async () => {
      await api.post(`/api/review/${encodeURIComponent(token)}/approve`, { name });
      return `${cut.name} approved.`;
    });

  const loupeState = held ? { pointer: held, frame, snapped: false, pinned: false, returnTo: null } : null;
  const loupeSource: LoupeSource = { clips: cut.clips, captions: cut.captions, comments: data.comments, rate, first: 0, zoom: 2 };
  const buttons = (
    <div className="actions">
      <button type="button" onClick={() => void send()} disabled={over || comment.trim().length === 0}>
        Send comment
      </button>
      <button type="button" onClick={() => void approve()}>
        Approve this cut
      </button>
    </div>
  );

  const content = (
    <section role="region" aria-label="Review" className={`review review-${layout}`}>
      <div className="review-main">
        <div className="stage" role="region" aria-label="Stage" data-stage-mode="playhead" data-stage-frame={frame} style={{ aspectRatio: `${size.width} / ${size.height}`, ["--ratio" as string]: size.width / size.height }}>
          <div className="stage-fade">
            {layers.map((layer) => {
              const clip = clips.get(layer.clip_id);
              return clip ? (
                <div key={layer.clip_id} className="layer" data-layer-box={layer.clip_id} style={layerStyle(layer, size, layerFill(clip, clip.media_id ? cut.media[clip.media_id]?.sha256 : undefined))} />
              ) : null;
            })}
          </div>
        </div>
        <Scrubber frame={frame} last={last} rate={project.frame_rate} onChange={setFrame} onHold={setHeld} />
        <ClipsList clips={cut.clips} rows={cut.rows} rate={project.frame_rate} onPick={(clip) => setFrame(clip.start_frame)} />
      </div>
      <div className="review-side">
        <section role="region" aria-label="Comments" className="comments">
          {data.comments.length === 0 ? <p className="empty">No notes on this cut yet.</p> : null}
          <ul className="notes">
            {data.comments.map((note) => (
              <li key={note.id}>
                <p>
                  <span className="muted tnum">{timecode(rate, note.pin.frame)}</span> <span>{note.author_name}</span>
                </p>
                <p className="note-body">{note.body}</p>
              </li>
            ))}
          </ul>
          <Field label="Your name" name="name" error={errors["name"]}>
            {(a11y) => <input {...a11y} value={name} onChange={(event) => setName(event.target.value)} />}
          </Field>
          <Field label="Comment" name="body" error={errors["body"]}>
            {(a11y) => <textarea {...a11y} rows={3} value={comment} onChange={(event) => setComment(event.target.value)} />}
          </Field>
          {layout === "review-list" ? null : buttons}
        </section>
      </div>
      <div role="status" aria-label="Review status" className="review-status">
        {status}
      </div>
    </section>
  );

  const band = (
    <header className="band">
      <div className="band-row">
        <span className="brand title">Gatecut</span>
        <span className="project-title">{project.title}</span>
        <span className="muted tnum">{project.frame_rate} fps</span>
        <span>{cut.name}</span>
      </div>
    </header>
  );
  return (
    <>
      {layout === "review-list" ? (
        <>
          <div className="page-scroll">
            {band}
            {content}
          </div>
          <div className="bottom-bar">{buttons}</div>
        </>
      ) : (
        <>
          {band}
          {content}
        </>
      )}
      {loupeState ? <Loupe state={loupeSource} skim={loupeState} anchor={null} /> : null}
    </>
  );
}
