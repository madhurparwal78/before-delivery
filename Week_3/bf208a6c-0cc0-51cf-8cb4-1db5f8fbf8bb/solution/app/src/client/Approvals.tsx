import { call } from "./api";
import { Frame } from "./Frame";
import type { Post } from "../shared/types";

interface Props {
  held: Post[];
  requestFocus: (selector: string) => void;
  reload: () => Promise<unknown>;
}

/** The moderators' queue: every held post as a frame with Approve and Reject under it. */
export function Approvals({ held, requestFocus, reload }: Props) {
  const decide = async (post: Post, action: "approve" | "reject"): Promise<void> => {
    const index = held.findIndex((candidate) => candidate.id === post.id);
    const next = held[index + 1] ?? held.find((candidate) => candidate.id !== post.id);
    await call("POST", `/api/posts/${post.id}/${action}`);
    requestFocus(next ? `[data-approve-for="${next.id}"]` : "[data-approvals-heading]");
    await reload();
  };
  return (
    <section className="approvals" aria-label="Approvals">
      <h2 tabIndex={-1} data-approvals-heading>
        Approvals ({held.length})
      </h2>
      {held.length === 0 ? (
        <p className="empty">Nothing is waiting for approval.</p>
      ) : (
        <div className="run">
          {held.map((post) => (
            <div className="held" key={post.id}>
              <Frame post={post} onSheet={false} />
              <div className="held-actions">
                <button type="button" aria-label={`Approve ${post.title}`} data-approve-for={post.id} onClick={() => void decide(post, "approve")}>
                  Approve
                </button>
                <button type="button" className="quiet" aria-label={`Reject ${post.title}`} onClick={() => void decide(post, "reject")}>
                  Reject
                </button>
              </div>
              {post.push === "pending" && <p className="small muted">Push pending</p>}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export function WaitingForApproval({ held }: { held: Post[] }) {
  return (
    <section className="approvals" aria-label="Waiting for approval">
      <p className="small muted">Only you and the people who moderate this board can see these posts until they're approved.</p>
      <div className="run">
        {held.map((post) => (
          <Frame key={post.id} post={post} onSheet={false} />
        ))}
      </div>
    </section>
  );
}
