import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { codePoints } from "../../shared/codepoints";
import { NOTE_MAX } from "../../shared/limits";
import { timecode } from "../../shared/timecode";
import type { Comment, Visibility } from "../../shared/types";
import { api, ApiError } from "../lib/api";
import { notify } from "../lib/notices";
import { useProject } from "./context";
import { canApprove, rateOfState } from "./state";

interface NoteForm {
  body: string;
  setBody: (value: string) => void;
  visibility: Visibility;
  setVisibility: (value: Visibility) => void;
  replyTo: Comment | null;
  setReplyTo: (comment: Comment | null) => void;
  error: string | undefined;
  pin: () => Promise<void>;
  count: number;
}

const NoteContext = createContext<NoteForm | null>(null);

function useNote(): NoteForm {
  const form = useContext(NoteContext);
  if (!form) throw new Error("outside the note form");
  return form;
}

const DRAFT_DELAY_MS = 1000;

/** The note box, shared by the Comments panel and the fixed bottom bar; the server keeps the draft. */
export function NoteProvider({ children }: { children: ReactNode }): ReactNode {
  const { store, state } = useProject();
  const [body, setBodyState] = useState("");
  const [visibility, setVisibility] = useState<Visibility>("team");
  const [replyTo, setReplyTo] = useState<Comment | null>(null);
  const [error, setError] = useState<string | undefined>();
  const timer = useRef<number | null>(null);
  const edited = useRef(false);

  useEffect(() => {
    void api.get<{ draft: { body: string; visibility: Visibility } | null }>(`/api/projects/${store.projectId}/comment-draft`).then(({ draft }) => {
      if (draft && !edited.current) {
        setBodyState(draft.body);
        setVisibility(draft.visibility);
      }
    });
  }, [store.projectId]);

  const clip = state.clips.find((candidate) => candidate.id === state.current);
  const payload = (text: string): Record<string, unknown> => ({
    body: text,
    frame: state.playhead,
    visibility,
    ...(clip ? { row_id: clip.row_id, clip_id: clip.id } : {}),
    ...(replyTo ? { parent_id: replyTo.id } : {}),
  });

  const setBody = (value: string): void => {
    edited.current = true;
    setBodyState(value);
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      void api.put(`/api/projects/${store.projectId}/comment-draft`, payload(value)).catch(() => undefined);
    }, DRAFT_DELAY_MS);
  };

  const pin = async (): Promise<void> => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    notify("Pinning…");
    try {
      await store.postComment(payload(body));
      setBodyState("");
      setReplyTo(null);
      setError(undefined);
      notify(`Note pinned at ${timecode(rateOfState(state), state.playhead)}.`);
    } catch (failure) {
      if (!(failure instanceof ApiError)) throw failure;
      setError(failure.fields["body"] ?? failure.fields["mention"] ?? failure.fields["mentions"] ?? failure.message);
      notify(failure.message);
    }
  };

  return <NoteContext.Provider value={{ body, setBody, visibility, setVisibility, replyTo, setReplyTo, error, pin, count: codePoints(body) }}>{children}</NoteContext.Provider>;
}

export function CommentActions(): ReactNode {
  const { store, state } = useProject();
  const form = useNote();
  const cut = state.cuts[state.cuts.length - 1];
  const approve = async (): Promise<void> => {
    if (!cut) {
      notify("There is no named cut to approve yet.");
      return;
    }
    notify("Approving…");
    try {
      await api.post(`/api/projects/${store.projectId}/cuts/${cut.id}/approval`);
      notify(`${cut.name} approved.`);
      await store.refreshCuts();
    } catch (failure) {
      if (!(failure instanceof ApiError)) throw failure;
      notify(failure.message);
    }
  };
  const invalid = form.count > NOTE_MAX || form.body.trim().length === 0;
  return (
    <div className="actions">
      <button type="button" disabled={invalid} onClick={() => void form.pin()}>
        Pin note
      </button>
      {canApprove(state.role) ? (
        <button type="button" onClick={() => void approve()}>
          Approve cut
        </button>
      ) : null}
    </div>
  );
}

export function Comments({ inlineActions, showHeading }: { inlineActions: boolean; showHeading: boolean }): ReactNode {
  const { store, state } = useProject();
  const form = useNote();
  const rate = rateOfState(state);
  const top = state.comments.filter((comment) => !comment.parent_id);
  return (
    <section role="region" aria-label="Comments" className="comments">
      {inlineActions && !showHeading ? null : <p className="section-title">Comments</p>}
      {top.length === 0 ? <p className="empty">No notes on this cut yet.</p> : null}
      <ul className="notes">
        {top.map((comment) => (
          <li key={comment.id}>
            <p>
              <button type="button" className="link" onClick={() => store.movePlayhead(comment.pin.live_frame)}>
                {timecode(rate, comment.pin.live_frame)}
              </button>{" "}
              <span>{comment.author_name}</span> <span className="muted nowrap">{comment.visibility === "team" ? "team only" : "client can see"}</span>
            </p>
            <p className="note-body">{comment.body}</p>
            <ul className="replies">
              {state.comments
                .filter((reply) => reply.parent_id === comment.id)
                .map((reply) => (
                  <li key={reply.id}>
                    <span>{reply.author_name}</span> <span className="note-body">{reply.body}</span>
                  </li>
                ))}
            </ul>
            <button type="button" aria-label="Reply" onClick={() => form.setReplyTo(comment)}>
              Reply
            </button>
          </li>
        ))}
      </ul>
      <div className="note-form">
        {form.replyTo ? <p className="muted">Replying to {form.replyTo.author_name}</p> : null}
        <label htmlFor="note-box">Note</label>
        <textarea id="note-box" rows={3} value={form.body} onChange={(event) => form.setBody(event.target.value)} aria-invalid={form.error ? true : undefined} />
        <p className="muted tnum" data-count={form.count}>
          {form.count} of 2,000
        </p>
        {form.error ? <p className="field-error">Error: {form.error}</p> : null}
        <div role="radiogroup" aria-label="Who can see this" className="toggles">
          {(
            [
              ["team", "Team only"],
              ["review", "Client can see"],
            ] as const
          ).map(([value, label]) => (
            <label key={value} className="toggle">
              <input type="radio" name="visibility" checked={form.visibility === value} onChange={() => form.setVisibility(value)} />
              <span>{label}</span>
            </label>
          ))}
        </div>
        {inlineActions ? <CommentActions /> : null}
      </div>
    </section>
  );
}
