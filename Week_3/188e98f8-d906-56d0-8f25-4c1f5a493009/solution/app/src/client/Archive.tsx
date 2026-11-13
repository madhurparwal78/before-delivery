import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import type { Answer } from "../shared/api-types";
import { timeSent } from "../shared/text";
import { Unreachable, fieldError, get, post } from "./api";
import { COPY, answersMatching, noMatch } from "./copy";
import { focusQuietly } from "./focus";
import { useMessages } from "./messages";
import { Link, useLandAtTop } from "./router";
import { useSession } from "./session";
import { Empty, LimitedField, Page } from "./ui";
import { deskPath } from "../shared/roles";

interface Archived {
  answers: Answer[];
  next_cursor: string | null;
}

function AnswerRows({ rows, results, register }: { rows: Answer[]; results?: boolean; register?: (id: number, element: HTMLTableRowElement | null) => void }) {
  return (
    <tbody>
      {rows.map((answer) => (
        <tr
          key={answer.id}
          role="row"
          tabIndex={-1}
          data-result={results ? "" : undefined}
          ref={register === undefined ? undefined : (element) => register(answer.id, element)}
        >
          <td role="cell" data-label="Round">
            {answer.round}
          </td>
          <td role="cell" data-label="Question">
            {answer.question}
          </td>
          <td role="cell" data-label="Team">
            {answer.team_name}
          </td>
          <td role="cell" data-label="Answer">
            <span className="answer-text">{answer.text}</span>
            <span className="sent-inline">{timeSent(answer.submitted_at)}</span>
          </td>
          <td role="cell" data-label="Time sent" className="col-sent">
            {timeSent(answer.submitted_at)}
          </td>
          <td role="cell" data-label="Mark">
            {answer.mark ?? "–"}
          </td>
        </tr>
      ))}
    </tbody>
  );
}

function Heads() {
  return (
    <thead>
      <tr role="row">
        <th role="columnheader">Round</th>
        <th role="columnheader">Question</th>
        <th role="columnheader">Team</th>
        <th role="columnheader">Answer</th>
        <th role="columnheader" className="col-sent">
          Time sent
        </th>
        <th role="columnheader">Mark</th>
      </tr>
    </thead>
  );
}

export function Archive() {
  useLandAtTop();
  const messages = useMessages();
  const { state } = useSession();
  const heading = useRef<HTMLHeadingElement>(null);
  const field = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const resultRows = useRef(new Map<number, HTMLTableRowElement>());
  const archiveRows = useRef(new Map<number, HTMLTableRowElement>());
  const caret = useRef<[number, number]>([0, 0]);
  const [rows, setRows] = useState<Answer[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [round, setRound] = useState("");
  const [refusal, setRefusal] = useState<string | undefined>();
  const [found, setFound] = useState<Answer[] | null>(null);
  const [busy, setBusy] = useState<"more" | "search" | null>(null);

  useLayoutEffect(() => focusQuietly(heading.current), []);

  const guard = async (work: () => Promise<void>) => {
    try {
      await work();
    } catch (error) {
      if (!(error instanceof Unreachable)) throw error;
      messages.say(COPY.unreachable, "error");
    }
  };

  useEffect(() => {
    messages.pending(COPY.loadingAnswers);
    void guard(async () => {
      const reply = await get<Archived>("/api/answers");
      if (reply.ok) {
        setRows(reply.data.answers);
        setCursor(reply.data.next_cursor);
        messages.clear();
      } else messages.say(COPY.unreachable, "error");
    });
  }, []);

  useLayoutEffect(() => {
    if (focusId === null) return;
    focusQuietly(archiveRows.current.get(focusId));
    setFocusId(null);
  }, [focusId, rows]);

  const nextPage = async () => {
    messages.pending(COPY.loadingAnswers);
    setBusy("more");
    await guard(async () => {
      const reply = await get<Archived>(`/api/answers${cursor === null ? "" : `?cursor=${encodeURIComponent(cursor)}`}`);
      if (!reply.ok) {
        messages.say(COPY.unreachable, "error");
        return;
      }
      const page = reply.data;
      if (page.answers.length === 0) {
        messages.say(COPY.noNewer);
        return;
      }
      messages.clear();
      setRows((existing) => [...(existing ?? []), ...page.answers]);
      setCursor(page.next_cursor ?? cursor);
      setFocusId((page.answers[0] as Answer).id);
    });
    setBusy(null);
  };

  const search = async () => {
    messages.pending(COPY.searching);
    setBusy("search");
    await guard(async () => {
      const reply = await post<{ answers: Answer[]; count: number }>("/api/answers/search", {
        query,
        ...(round === "" ? {} : { round: Number(round) }),
      });
      if (reply.ok) {
        setFound(reply.data.answers);
        setRefusal(undefined);
        messages.say(reply.data.count === 0 ? noMatch(query) : answersMatching(reply.data.count));
      } else if (reply.status === 422) {
        const copy = fieldError(reply, "query") === "too_long" ? COPY.queryOver : COPY.emptySearch;
        setRefusal(copy);
        messages.say(copy, "error");
      } else if (reply.status === 503) {
        messages.say(COPY.searchTimeout, "error");
      } else messages.say(COPY.unreachable, "error");
    });
    setBusy(null);
  };

  const fromField = (event: KeyboardEvent<HTMLInputElement & HTMLTextAreaElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void search();
    } else if (event.key === "ArrowDown" && found !== null && found.length > 0) {
      event.preventDefault();
      caret.current = [event.currentTarget.selectionStart ?? 0, event.currentTarget.selectionEnd ?? 0];
      focusQuietly(resultRows.current.get((found[0] as Answer).id));
    }
  };

  const fromResults = (event: KeyboardEvent<HTMLTableElement>) => {
    if (found === null || found.length === 0) return;
    const ids = found.map((answer) => answer.id);
    const at = ids.findIndex((id) => resultRows.current.get(id) === document.activeElement);
    if (at < 0) return;
    const go = (index: number) => {
      event.preventDefault();
      focusQuietly(resultRows.current.get(ids[index] as number));
    };
    if (event.key === "ArrowDown") go(Math.min(at + 1, ids.length - 1));
    else if (event.key === "ArrowUp") go(Math.max(at - 1, 0));
    else if (event.key === "Home") go(0);
    else if (event.key === "End") go(ids.length - 1);
    else if (event.key === "Escape") {
      event.preventDefault();
      field.current?.focus({ preventScroll: true });
      field.current?.setSelectionRange(caret.current[0], caret.current[1]);
    }
  };

  const home = state.status === "in" ? deskPath(state.info.role) : "/";
  return (
    <Page>
      <h1 tabIndex={-1} ref={heading}>
        Answer archive
      </h1>
      <p>
        <Link to={home} className="back-link">
          Back to the desk
        </Link>
      </p>
      <form
        className="mat search-bar"
        aria-label="Search the archive"
        onSubmit={(event) => {
          event.preventDefault();
          void search();
        }}
        noValidate
      >
        <div className="search-field">
          <LimitedField
            label="Search answers"
            type="search"
            value={query}
            onValue={(value) => {
              setQuery(value);
              setRefusal(undefined);
            }}
            limit="query"
            overCopy={COPY.queryOver}
            refusal={refusal}
            inputRef={field}
            onKeyDown={fromField}
            enterKeyHint="search"
          />
        </div>
        <div className="search-controls">
          <select aria-label="Round" value={round} onChange={(event) => setRound(event.target.value)}>
            <option value="">All rounds</option>
            {Array.from({ length: 8 }, (_, index) => (
              <option key={index} value={index + 1}>
                Round {index + 1}
              </option>
            ))}
          </select>
          <button type="submit" className="btn" aria-busy={busy === "search"}>
            Search
          </button>
        </div>
      </form>

      {found !== null && (
        <section className="results">
          <table role="table" aria-label="Search results" className="answers" onKeyDown={fromResults}>
            <Heads />
            <AnswerRows
              rows={found}
              results
              register={(id, element) => {
                if (element === null) resultRows.current.delete(id);
                else resultRows.current.set(id, element);
              }}
            />
          </table>
          {found.length === 0 && <Empty size={56}>Nothing matched that spelling.</Empty>}
        </section>
      )}

      {rows !== null && (
        <>
          <table role="table" aria-label="Answer archive" className="answers">
            <Heads />
            <AnswerRows
              rows={rows}
              register={(id, element) => {
                if (element === null) archiveRows.current.delete(id);
                else archiveRows.current.set(id, element);
              }}
            />
          </table>
          {rows.length === 0 && <Empty size={56}>No answers have been sent yet tonight.</Empty>}
          <button type="button" className="btn more" onClick={() => void nextPage()} aria-busy={busy === "more"}>
            More answers
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
              <path d="M3 6l5 5 5-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </>
      )}
    </Page>
  );
}
