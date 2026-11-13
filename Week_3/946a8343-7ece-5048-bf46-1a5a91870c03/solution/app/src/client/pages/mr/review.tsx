// Writing a review: the comment box (under a diff row, or in the sheet a long press opens) and the submit dialog.
//   <Composer boxName reviewing draft onPost onCancel>   textarea + `Add comment`, `Start review` / `Add to review`, `Cancel`.
//       Ctrl+Enter posts (adds to the review when one is in progress), Escape cancels. Both hand the text to the caller and the
//       box closes at once, so focus is back on the row before the request has answered.
//   <ReviewDialog open count opener onSubmit onDiscard onClose>   `dialog "Submit review"`
//   postComment / submitReview / discardReview   the requests; each resolves to a refusal message (also announced) or null
//   pendingCount(threads)   comments the signed-in user holds in the review in progress
import type { RefObject } from "preact";
import { useId, useRef, useState } from "preact/hooks";
import { Dialog } from "../../a11y/dialog.tsx";
import { announce } from "../../announce.tsx";
import { api, asApiError } from "../../api.ts";
import { Button } from "../../ui/button.tsx";
import { Notice } from "../../ui/feedback.tsx";
import { TextArea } from "../../ui/fields.tsx";
import { mrBase, type MrPage, type ThreadView } from "./data.ts";
import type { CommentTarget } from "./diff-types.ts";

export function pendingCount(threads: readonly ThreadView[]): number {
  return threads.reduce((total, thread) => total + thread.notes.filter((note) => note.pending).length, 0);
}

async function refusalOf(work: () => Promise<unknown>): Promise<string | null> {
  try {
    await work();
    return null;
  } catch (cause) {
    const failure = asApiError(cause);
    announce(failure.message, "error");
    return failure.message;
  }
}

export function postComment(page: MrPage, target: CommentTarget, body: string, pending: boolean): Promise<string | null> {
  const line = target.start;
  return refusalOf(() =>
    api.post(`${mrBase(page.project, page.iid)}/threads`, {
      body,
      pending,
      position: {
        path: target.path,
        old_line: target.side === "old" ? line : null,
        new_line: target.side === "new" ? line : null,
        end_line: target.end,
        version: target.version,
      },
    }),
  );
}

export function submitReview(page: MrPage, summary: string): Promise<string | null> {
  return refusalOf(() => api.post(`${mrBase(page.project, page.iid)}/review`, { summary }));
}

export function discardReview(page: MrPage): Promise<string | null> {
  return refusalOf(() => api.del(`${mrBase(page.project, page.iid)}/review`));
}

interface ComposerProps {
  /** Name of the text box: the sheet calls it `Comment`, the box under a row names its line. */
  boxName: string;
  /** The signed-in user has a review in progress. */
  reviewing: boolean;
  /** Text and refusal of a post that came back refused, so nothing typed is lost. */
  draft: { text: string; refusal: string | null } | null;
  /** Hands the comment over and closes the box; the caller reopens it with a draft when the post is refused. */
  onPost(text: string, pending: boolean): void;
  onCancel(): void;
}

export function Composer({ boxName, reviewing, draft, onPost, onCancel }: ComposerProps) {
  const id = useId();
  const [text, setText] = useState(draft?.text ?? "");
  const box = useRef<HTMLTextAreaElement>(null);
  return (
    <form
      class="sp-composer"
      onSubmit={(event) => {
        event.preventDefault();
        onPost(text, false);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          onCancel();
        } else if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && event.target === box.current) {
          event.preventDefault();
          onPost(text, reviewing);
        }
      }}
    >
      {draft?.refusal ? <Notice>{draft.refusal}</Notice> : null}
      <TextArea label={boxName} name="comment" id={`composer-${id}`} hideLabel rows={3} innerRef={box} value={text} onInput={(event) => setText(event.currentTarget.value)} />
      <div class="sp-composer__actions">
        <Button type="submit">Add comment</Button>
        <Button variant="secondary" onClick={() => onPost(text, true)}>
          {reviewing ? "Add to review" : "Start review"}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

interface ReviewDialogProps {
  open: boolean;
  count: number;
  opener: RefObject<HTMLElement>;
  onSubmit(summary: string): Promise<string | null>;
  onDiscard(): Promise<string | null>;
  onClose(): void;
}

function ReviewForm({ count, onSubmit, onDiscard }: Pick<ReviewDialogProps, "count" | "onSubmit" | "onDiscard">) {
  const [summary, setSummary] = useState("");
  const [doing, setDoing] = useState<"submit" | "discard" | null>(null);
  const [refused, setRefused] = useState<string | null>(null);
  const run = async (kind: "submit" | "discard") => {
    if (doing !== null) return;
    setDoing(kind);
    const message = await (kind === "submit" ? onSubmit(summary) : onDiscard());
    setDoing(null);
    setRefused(message);
  };
  return (
    <form
      class="sp-review-dialog"
      onSubmit={(event) => {
        event.preventDefault();
        void run("submit");
      }}
    >
      <div class="sp-dialog__bar">
        <h2 class="sp-dialog__title">Finish your review</h2>
      </div>
      {refused === null ? null : <Notice>{refused}</Notice>}
      <p>Pending comments: {count}</p>
      <TextArea label="Summary" name="summary" id="review-summary" rows={4} value={summary} onInput={(event) => setSummary(event.currentTarget.value)} />
      <div class="sp-review-dialog__actions">
        <Button type="submit" pending={doing === "submit"} disabled={doing !== null}>
          Submit review
        </Button>
        <Button variant="danger" pending={doing === "discard"} disabled={doing !== null} onClick={() => void run("discard")}>
          Discard review
        </Button>
      </div>
    </form>
  );
}

export function ReviewDialog({ open, count, opener, onSubmit, onDiscard, onClose }: ReviewDialogProps) {
  return (
    <Dialog name="Submit review" open={open} onClose={onClose} opener={opener}>
      <ReviewForm count={count} onSubmit={onSubmit} onDiscard={onDiscard} />
    </Dialog>
  );
}
