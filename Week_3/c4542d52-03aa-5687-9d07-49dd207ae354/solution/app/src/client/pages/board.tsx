import { useEffect } from "react";
import type { QueueEntry } from "../../shared/types.js";
import { VESTING_LABEL, displayDate, dollars, groupThousands } from "../../shared/format.js";
import { ApiFailure, api } from "../api.js";
import { announce } from "../announce.js";
import { useResource, useSocketGate } from "../hooks.js";
import { Link, goBackOr, requestFocus } from "../router.js";
import { useSession } from "../session.js";
import { Band, ScrollRegion } from "../ui.js";
import { NotFoundPage } from "./notFound.js";

type Queue = { quorum: number; board_size: number; grants: QueueEntry[] };
type VoteResult = QueueEntry & { state: string };

const linkSelector = (id: string) => `[data-grant="${id}"]`;

async function castVote(entry: QueueEntry, vote: "approve" | "decline", quorum: number, done: () => void): Promise<void> {
  try {
    const result = await api<VoteResult>("POST", `/api/board/queue/${entry.id}/votes`, { vote });
    announce(vote === "approve" ? `Your approval of ${entry.id} is recorded: ${result.approvals} of ${quorum} approvals.` : `Your decline of ${entry.id} is recorded.`);
  } catch (failure) {
    if (!(failure instanceof ApiFailure)) throw failure;
    if (failure.code === "already_voted") announce(`You have already voted on ${entry.id}.`);
  } finally {
    done();
  }
}

export function BoardPage() {
  const gate = useSocketGate();
  const { person } = useSession();
  const queue = useResource<Queue>("/api/board/queue", ["board", "grants"]);
  if (!queue.data) {
    return (
      <main className="page-state">
        <Band tone="black" className="band-fill band-delayed">
          Loading your register.
        </Band>
      </main>
    );
  }
  const { quorum, grants } = queue.data;
  if (grants.length === 0) {
    return (
      <main className="chapter chapter-empty">
        <div className="chapter-band">
          <div className="sheet">
            <p className="note">{person.name}</p>
            <h1 tabIndex={-1}>Board queue</h1>
          </div>
        </div>
        <Band tone="black" className="band-fill-inner">
          Nothing is waiting for your vote.
        </Band>
      </main>
    );
  }
  return (
    <main className="chapter">
      <section className="sheet">
        <p className="note">{person.name}</p>
        <h1 tabIndex={-1}>Board queue</h1>
      </section>
      <section className="sheet wide">
        <ScrollRegion label="Board queue scroll area">
          <table aria-label="Board queue" className="plain-table">
            <thead>
              <tr>
                <th scope="col">Grant</th>
                <th scope="col">Holder</th>
                <th scope="col" className="num">
                  Options
                </th>
                <th scope="col">Votes</th>
                <th scope="col">Your vote</th>
              </tr>
            </thead>
            <tbody>
              {grants.map((entry) => (
                <tr key={entry.id}>
                  <td>
                    <Link href={`/board/${entry.id}`} data-grant={entry.id} returnFocus={linkSelector(entry.id)} focusTarget="main h1">
                      {entry.id}
                    </Link>
                  </td>
                  <td>{entry.holder_name}</td>
                  <td className="num">{groupThousands(entry.options)}</td>
                  <td>
                    {entry.approvals} of {quorum} approvals
                  </td>
                  <td>
                    <div className="actions">
                      <button type="button" className="button button-primary" disabled={gate} onClick={() => void castVote(entry, "approve", quorum, queue.reload)}>
                        Approve {entry.id}
                      </button>
                      <button type="button" className="button button-secondary" disabled={gate} onClick={() => void castVote(entry, "decline", quorum, queue.reload)}>
                        Decline {entry.id}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollRegion>
      </section>
    </main>
  );
}

export function BoardSummaryPage({ id }: { id: string }) {
  const queue = useResource<Queue>("/api/board/queue", ["board", "grants"]);
  if (!queue.data) {
    return (
      <main className="page-state">
        <Band tone="black" className="band-fill band-delayed">
          Loading your register.
        </Band>
      </main>
    );
  }
  const entry = queue.data.grants.find((grant) => grant.id === id);
  if (!entry) return <NotFoundPage />;
  return <GrantSummary entry={entry} quorum={queue.data.quorum} reload={queue.reload} />;
}

function GrantSummary({ entry, quorum, reload }: { entry: QueueEntry; quorum: number; reload: () => void }) {
  const gate = useSocketGate();
  const id = entry.id;
  const back = () => {
    goBackOr("/board");
    requestFocus(linkSelector(id));
  };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") back();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  return (
    <main className="chapter">
      <section className="sheet" aria-label="Grant summary">
        <p className="note">A summary only: the board sees no holder's figures.</p>
        <h1 tabIndex={-1}>{id}</h1>
        <div className="figures">
          <div className="figure">
            <span className="figure-label">Holder</span>
            <span className="figure-value">{entry.holder_name}</span>
          </div>
          <div className="figure">
            <span className="figure-label">Options</span>
            <span className="figure-value">{groupThousands(entry.options)}</span>
          </div>
          <div className="figure">
            <span className="figure-label">Strike price</span>
            <span className="figure-value">{dollars(entry.strike)}</span>
          </div>
          <div className="figure">
            <span className="figure-label">Vesting</span>
            <span className="figure-value">
              {VESTING_LABEL[entry.vesting_type]}, from {displayDate(entry.vesting_start)}
            </span>
          </div>
        </div>
        <p className="approvals">
          {entry.approvals} of {quorum} approvals
        </p>
        <div className="actions">
          <button type="button" className="button button-primary" disabled={gate} onClick={() => void castVote(entry, "approve", quorum, reload)}>
            Approve {entry.id}
          </button>
          <button type="button" className="button button-secondary" disabled={gate} onClick={() => void castVote(entry, "decline", quorum, reload)}>
            Decline {entry.id}
          </button>
          <Link href="/board" className="button button-quiet" onClick={(event) => { event.preventDefault(); back(); }}>
            Back to the queue
          </Link>
        </div>
      </section>
    </main>
  );
}
