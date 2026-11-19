import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import { request, sessionEnded, type Board, type Hold, type Item, type Part } from "../api";
import { BoardView } from "../board/Board";
import { ITEM_WORD, outlineWord } from "../board/outline";
import { Announcements, FormProblems, Num, Status, usePoll, type Problem } from "../components/ui";
import { dollars } from "../format";
import { takeDraft } from "../session";
import { useShell, type Me } from "../shell";
import { useAnnouncer } from "./useAnnouncer";

function matchesFilter(item: Item, typed: string): boolean {
  const needle = typed.trim().toLowerCase();
  return needle === "" || item.tag.toLowerCase().includes(needle) || item.name.toLowerCase().includes(needle);
}

/** Item detail for a tool: name, tag, status, parts, replacement cost, due date and the hold queue line. */
export function ToolDetail({ item }: { item: Item }) {
  return (
    <div class="tool-detail">
      <h2 class="detail-title">{item.name}</h2>
      <dl class="facts">
        <div>
          <dt>Tag</dt>
          <dd>
            <Num>{item.tag}</Num>
          </dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd>
            <Status word={ITEM_WORD[item.status]} />
          </dd>
        </div>
        <div>
          <dt>Replacement cost</dt>
          <dd>
            <Num>${dollars(item.replacement_cost_cents)}</Num>
          </dd>
        </div>
        {item.due_date && (
          <div>
            <dt>Due</dt>
            <dd>
              <Num>{item.due_date}</Num>
            </dd>
          </div>
        )}
      </dl>
      <p class="queue-line">
        {item.hold_queue_length > 0 ? (
          <>
            <span class="queue-label">Queued holds</span> <Num>{item.hold_queue_length}</Num>
          </>
        ) : (
          "No one is waiting for this tool."
        )}
      </p>
      <table class="ledger compact" aria-label={`Parts of ${item.name}`}>
        <thead>
          <tr>
            <th scope="col">Part</th>
            <th scope="col">State</th>
          </tr>
        </thead>
        <tbody>
          {item.parts.map((part) => (
            <tr key={part.id}>
              <td>{part.name}</td>
              <td>
                <Status word={outlineWord(part.state, item.status)} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Pegboard({ me }: { me: Me | null }) {
  const shell = useShell();
  const [board, setBoard] = useState<Board | null>(null);
  const [holds, setHolds] = useState<Hold[]>([]);
  const [filter, setFilter] = useState("");
  const typed = useRef(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [placing, setPlacing] = useState(false);
  const news = useAnnouncer(me);
  const detailRef = useRef<HTMLElement>(null);
  const summary = useRef<HTMLDivElement>(null);
  const announceTimer = useRef(0);
  const isMember = me?.user.role === "member";

  const read = useCallback(async () => {
    const [boardAnswer, holdAnswer] = await Promise.all([request<Board>("GET", "/api/board"), isMember ? request<{ holds: Hold[] }>("GET", "/api/holds") : null]);
    if (boardAnswer.status === 200) {
      setBoard(boardAnswer.body);
      shell.setCounts(boardAnswer.body.counts);
    }
    if (holdAnswer?.status === 200) setHolds(holdAnswer.body.holds);
  }, [isMember]);

  useEffect(() => {
    void read().then(() => {
      if (!me) return;
      const draft = takeDraft("/", me.user.id);
      if (draft) {
        if (draft.fields.filter !== undefined) {
          typed.current = true;
          setFilter(draft.fields.filter);
        }
        if (draft.toolId !== undefined) setSelectedId(draft.toolId);
      }
    });
  }, []);
  usePoll(read, 10_000);

  const items = board?.items ?? [];
  const rows = useMemo(() => items.filter((item) => matchesFilter(item, filter)), [items, filter]);
  const selected = items.find((item) => item.id === selectedId) ?? null;
  const scrollDetail = useRef(false);
  useLayoutEffect(() => {
    if (scrollDetail.current && window.innerWidth < 700) detailRef.current?.scrollIntoView({ block: "start", behavior: "instant" });
    scrollDetail.current = false;
  }, [selectedId]);

  const choose = (id: number) => {
    scrollDetail.current = true;
    setSelectedId(id);
  };

  const onFilter = (value: string) => {
    typed.current = true;
    setFilter(value);
    window.clearTimeout(announceTimer.current);
    announceTimer.current = window.setTimeout(() => {
      const count = (board?.items ?? []).filter((item) => matchesFilter(item, value)).length;
      news.announce(count === 1 ? "1 tool matches." : `${count} tools match.`);
    }, 300);
  };

  const placeHold = async (item: Item) => {
    setPlacing(true);
    const answer = await request<{ hold: Hold }>("POST", "/api/holds", { item_id: item.id });
    setPlacing(false);
    if (sessionEnded(answer)) {
      news.sessionEnded({ fields: typed.current ? { filter } : {}, toolId: item.id });
      return;
    }
    news.announce(answer.status === 201 ? `Hold placed. You are number ${answer.body.hold.position} in the queue.` : answer.error);
    await read();
  };

  const myHold = selected ? holds.find((h) => h.item_id === selected.id && (h.status === "queued" || h.status === "ready")) : undefined;
  const canHold = selected && selected.status !== "on-wall" && !myHold;

  const stateOf = useCallback(
    (part: Part) => ({ selected: part.item_id === selectedId, snap: false, hover: false, animateHang: false }),
    [selectedId],
  );
  const onOutline = useCallback((part: Part) => choose(part.item_id), []);
  const register = useCallback(() => undefined, []);

  if (board === null) return <p class="loading-line page">Loading the board…</p>;
  return (
    <div class="panes panes-pegboard">
      <PaneAnnouncements news={news} summary={summary} />
      <section class="pane pane-list" aria-label="Tool list">
        <h1 class="pane-title">Tools</h1>
        <label class="field">
          <span class="field-label">Find a tool</span>
          <input type="search" value={filter} onInput={(e) => onFilter(e.currentTarget.value)} aria-label="Find a tool" />
        </label>
        <table class="ledger tools" aria-label="Tools">
          <thead>
            <tr>
              <th scope="col">Tag</th>
              <th scope="col">Name</th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && board ? (
              <tr>
                <td colSpan={3}>No tools match that search.</td>
              </tr>
            ) : (
              rows.map((item) => (
                <tr key={item.id} class={`row-pick${item.id === selectedId ? " is-selected" : ""}`} onClick={() => choose(item.id)}>
                  <td>
                    <Num>{item.tag}</Num>
                  </td>
                  <td>
                    <button type="button" class="row-button" aria-pressed={item.id === selectedId} onClick={(e) => {
                        e.stopPropagation();
                        choose(item.id);
                      }}
                    >
                      {item.name}
                    </button>
                  </td>
                  <td>
                    <Status word={ITEM_WORD[item.status]} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>
      <BoardView board={board} states={stateOf} onActivate={onOutline} register={register} ghost={null} />
      <section class="pane pane-detail" aria-label="Item detail" ref={detailRef} tabIndex={-1}>
        {selected ? (
          <>
            <ToolDetail item={selected} />
            {isMember && me!.membership?.status === "active" ? (
              canHold && (
                <button
                  type="button"
                  class={`btn btn-primary${placing ? " is-pending" : ""}`}
                  aria-busy={placing ? "true" : undefined}
                  aria-disabled={placing ? "true" : undefined}
                  onClick={() => !placing && void placeHold(selected)}
                >
                  {placing ? "Placing hold..." : "Place hold"}
                </button>
              )
            ) : isMember ? (
              <p class="note">Holds open once your membership is active.</p>
            ) : (
              !me && (
                <a class="btn" href="/signin">
                  Sign in to place a hold
                </a>
              )
            )}
            {myHold && (
              <p class="note">
                Your hold: {myHold.status}
                {myHold.position !== null && <> — number <Num>{myHold.position}</Num> in the queue</>}
              </p>
            )}
          </>
        ) : (
          <p class="empty-note">Choose a tool on the board or in the list to see its parts, status and queue.</p>
        )}
      </section>
    </div>
  );
}

/** A screen's announcement region with its Sign in again link, and the page-level problems summary
 * (left out while a dialog is open, because the dialog then holds the page's one summary). */
export function PaneAnnouncements({
  news,
  summary,
  label = "Account updates",
  problems = [],
  showProblems = true,
}: {
  news: ReturnType<typeof useAnnouncer>;
  summary: { current: HTMLDivElement | null };
  label?: string;
  problems?: Problem[];
  showProblems?: boolean;
}) {
  return (
    <div class="screen-notices">
      <Announcements label={label} text={news.text} signInAgain={news.signInAgain} />
      {showProblems && <FormProblems problems={problems} summaryRef={summary} />}
    </div>
  );
}
