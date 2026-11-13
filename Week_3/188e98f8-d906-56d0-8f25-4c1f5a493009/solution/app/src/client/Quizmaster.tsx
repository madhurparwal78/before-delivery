import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import type { Dispute, Round, Table } from "../shared/api-types";
import { Unreachable, errorCode, get, post, request } from "./api";
import type { Reply } from "./api";
import {
  COPY,
  closingRound,
  disputesOpen,
  openingRound,
  publishing,
  roundClosedByQuizmaster,
  roundOpen,
  sheetMissing,
  sheetStored,
} from "./copy";
import { Dialog } from "./dialog";
import { RescuingButton, focusQuietly } from "./focus";
import { useLeague, usePolling } from "./league";
import { useMessages } from "./messages";
import { Link, useLandAtTop } from "./router";
import { Empty, Page } from "./ui";

function RoundCard({ round }: { round: Round }) {
  const messages = useMessages();
  const { takeRound, takeTable, refresh } = useLeague();
  const article = useRef<HTMLElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const [line, setLine] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const { number, status } = round;
  const picture = round.kind === "picture";

  const act = async (label: string, pending: string, run: () => Promise<Reply<unknown>>, done: (reply: Reply<unknown>) => void) => {
    messages.pending(pending);
    setBusy(label);
    try {
      done(await run());
    } catch (error) {
      if (!(error instanceof Unreachable)) throw error;
      messages.say(COPY.unreachable, "error");
    } finally {
      setBusy(null);
    }
  };

  const unexpected = (reply: Reply<unknown>) => {
    if (reply.status >= 500 && errorCode(reply) !== "storage_unavailable") messages.say(COPY.unreachable, "error");
    else void refresh();
  };

  const open = () =>
    act(
      "open",
      openingRound(number),
      () => post(`/api/rounds/${number}/open`),
      (reply) => {
        const code = errorCode(reply);
        if (reply.ok) {
          setLine(null);
          takeRound((reply.data as { round: Round }).round);
          messages.say(roundOpen(number));
        } else if (code === "sheet_not_stored") {
          setLine(sheetMissing(number));
          messages.say(sheetMissing(number), "error");
        } else if (code === "another_round_open") {
          messages.say(COPY.anotherOpen, "error");
        } else if (code === "storage_unavailable") {
          setLine(COPY.sheetOutage);
          messages.say(COPY.sheetOutage, "error");
        } else unexpected(reply);
      },
    );

  const close = () =>
    act(
      "close",
      closingRound(number),
      () => post(`/api/rounds/${number}/close`),
      (reply) => {
        if (reply.ok) {
          takeRound((reply.data as { round: Round }).round);
          messages.say(roundClosedByQuizmaster(number));
        } else unexpected(reply);
      },
    );

  const publish = () =>
    act(
      "publish",
      publishing(number),
      () => post(`/api/rounds/${number}/publish`),
      (reply) => {
        if (reply.ok) {
          const done = reply.data as { round: Round; table: Table };
          takeRound(done.round);
          takeTable(done.table);
          messages.clear();
        } else if (errorCode(reply) === "disputes_pending") {
          messages.say(disputesOpen(number, (reply.data as { count: number }).count), "error");
        } else unexpected(reply);
      },
    );

  const upload = () => {
    const chosen = file.current?.files?.[0];
    if (chosen === undefined) {
      messages.say(COPY.noFile, "error");
      return Promise.resolve();
    }
    return act(
      "upload",
      COPY.storingSheet,
      () => request("PUT", `/api/rounds/${number}/sheet`, { file: chosen }),
      (reply) => {
        if (file.current !== null) file.current.value = "";
        if (reply.ok) {
          setLine(null);
          takeRound((reply.data as { round: Round }).round);
          messages.say(sheetStored(number));
          return;
        }
        const code = errorCode(reply);
        if (code === "storage_unavailable") {
          setLine(COPY.sheetOutage);
          messages.say(COPY.sheetOutage, "error");
        } else if (reply.status === 413) messages.say(COPY.sheetSize, "error");
        else if (reply.status === 415) messages.say(COPY.sheetType, "error");
        else if (reply.status === 422) messages.say(COPY.sheetDimensions, "error");
        else unexpected(reply);
      },
    );
  };

  const card = () => article.current;
  const closeButton = () => article.current?.querySelector<HTMLElement>(`button[data-action="close"]`) ?? article.current ?? null;

  return (
    <article className="mat round-card" aria-label={`Round ${number}`} tabIndex={-1} ref={article}>
      <h3>{round.title}</h3>
      <p className="round-status">
        <span className="state-word">{status[0]?.toUpperCase()}{status.slice(1)}</span>
      </p>
      {picture && round.sheet !== null && (
        <p className="sheet-state">{round.sheet.status === "stored" ? "Sheet stored" : "Sheet not stored"}</p>
      )}
      {line !== null && (
        <p className="card-line" data-testid="card-line">
          {line}
        </p>
      )}
      <div className="card-controls">
        {status === "drafted" && (
          <RescuingButton
            className="btn"
            data-action="open"
            aria-busy={busy === "open"}
            rescue={closeButton}
            onClick={() => void open()}
          >
            Open round {number}
          </RescuingButton>
        )}
        {status === "drafted" && picture && (
          <>
            <label className="file-field">
              <span>Picture sheet for round {number}</span>
              <input type="file" accept="image/png,image/jpeg" ref={file} />
            </label>
            <button
              type="button"
              className="btn"
              aria-label={`Upload sheet for round ${number}`}
              aria-busy={busy === "upload"}
              onClick={() => void upload()}
            >
              Upload
            </button>
          </>
        )}
        {status === "open" && (
          <RescuingButton className="btn" data-action="close" aria-busy={busy === "close"} rescue={card} onClick={() => void close()}>
            Close round {number}
          </RescuingButton>
        )}
        {status === "marked" && (
          <RescuingButton className="btn" data-action="publish" aria-busy={busy === "publish"} rescue={card} onClick={() => void publish()}>
            Publish round {number}
          </RescuingButton>
        )}
      </div>
    </article>
  );
}

function RulingDialog({
  dispute,
  open,
  onClose,
  onRuled,
  closeFocus,
}: {
  dispute: Dispute | null;
  open: boolean;
  onClose: () => void;
  onRuled: (ruled: Dispute) => void;
  closeFocus: () => HTMLElement | null;
}) {
  const messages = useMessages();
  const [ruling, setRuling] = useState<"upheld" | "dismissed" | null>(null);
  const [refusal, setRefusal] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const wasOpen = useRef(false);

  useLayoutEffect(() => {
    if (open && !wasOpen.current) {
      setRuling(null);
      setRefusal(undefined);
    }
    wasOpen.current = open;
  }, [open]);

  const save = async () => {
    if (dispute === null) return;
    messages.pending(COPY.savingRuling);
    setBusy(true);
    try {
      const reply = await post<{ dispute: Dispute }>(`/api/disputes/${dispute.id}/ruling`, { ruling });
      if (reply.ok) {
        messages.say(COPY.rulingSaved);
        onRuled(reply.data.dispute);
      } else if (errorCode(reply) === "dispute_already_ruled") {
        messages.say(COPY.alreadyRuled, "error");
      } else if (reply.status === 422) {
        setRefusal(COPY.rulingMissing);
        messages.say(COPY.rulingMissing, "error");
      } else {
        messages.say(COPY.unreachable, "error");
      }
    } catch (error) {
      if (!(error instanceof Unreachable)) throw error;
      messages.say(COPY.unreachable, "error");
    } finally {
      setBusy(false);
    }
  };

  const shortcut = (event: KeyboardEvent<HTMLElement>) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const key = event.key.toLowerCase();
    if (key === "u") setRuling("upheld");
    else if (key === "d") setRuling("dismissed");
    else return;
    setRefusal(undefined);
    event.preventDefault();
  };

  return (
    <Dialog
      open={open}
      label="Rule on dispute"
      onRequestClose={onClose}
      onShortcut={shortcut}
      closeFocus={closeFocus}
      initialFocus={(panel) => panel.querySelector<HTMLElement>("input[type=radio]")}
    >
      <div className="panel-body">
        {dispute !== null && (
          <dl className="ruling-facts">
            <dt>Round {dispute.round}, question {dispute.question}</dt>
            <dd className="mark-answer">{dispute.answer_text}</dd>
            <dt>Captain's reason</dt>
            <dd className="mark-answer">{dispute.reason}</dd>
          </dl>
        )}
        <div role="radiogroup" aria-label="Ruling" className="choices ruling-choices">
          <label className="choice">
            <input type="radio" name="ruling" checked={ruling === "upheld"} onChange={() => setRuling("upheld")} />
            <span>Uphold</span>
          </label>
          <label className="choice">
            <input type="radio" name="ruling" checked={ruling === "dismissed"} onChange={() => setRuling("dismissed")} />
            <span>Dismiss</span>
          </label>
        </div>
        <p className="field-error" aria-live="polite">
          {refusal}
        </p>
      </div>
      <div className="panel-actions">
        <button type="button" className="btn" onClick={() => void save()} aria-busy={busy}>
          Save ruling
        </button>
        <button type="button" className="btn quiet" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Dialog>
  );
}

export function Quizmaster() {
  useLandAtTop();
  const heading = useRef<HTMLHeadingElement>(null);
  const disputesHeading = useRef<HTMLHeadingElement>(null);
  const region = useRef<HTMLElement>(null);
  const { rounds, table } = useLeague();
  const [disputes, setDisputes] = useState<Dispute[] | null>(null);
  const [ruling, setRuling] = useState<Dispute | null>(null);
  const [ruleOpen, setRuleOpen] = useState(false);
  const queueAtOpen = useRef<number[]>([]);
  const opener = useRef<HTMLElement | null>(null);

  useLayoutEffect(() => focusQuietly(heading.current), []);

  const readDisputes = useCallback(async () => {
    const reply = await get<{ disputes: Dispute[] }>("/api/disputes");
    if (reply.ok) setDisputes(reply.data.disputes);
  }, []);
  usePolling(readDisputes, [readDisputes]);

  const queue = (disputes ?? []).filter((dispute) => dispute.status === "raised");
  const names = new Map((table?.teams ?? []).map((team) => [team.team_id, team.name]));
  const labelOf = (dispute: Dispute) => `Rule on ${names.get(dispute.team_id) ?? "team"}, round ${dispute.round}, question ${dispute.question}`;

  const buttonFor = (id: number) => region.current?.querySelector<HTMLElement>(`button[data-dispute="${id}"]`) ?? null;
  const queueNext = () => {
    if (ruling === null) return disputesHeading.current;
    const ids = queueAtOpen.current;
    const later = ids.slice(ids.indexOf(ruling.id) + 1).find((id) => buttonFor(id) !== null);
    const first = region.current?.querySelector<HTMLElement>("button[data-dispute]") ?? null;
    return (later === undefined ? first : buttonFor(later)) ?? disputesHeading.current;
  };
  const ruledRef = useRef(false);
  const afterRuling = () => {
    if (ruledRef.current) return queueNext();
    return opener.current?.isConnected ? opener.current : queueNext();
  };

  return (
    <Page level={2}>
      <h1 tabIndex={-1} ref={heading}>
        Quizmaster's desk
      </h1>
      <p>
        <Link to="/archive" className="back-link">
          Answer archive
        </Link>
      </p>
      <div className="desk-layout">
        <div className="round-cards">
          {rounds === null
            ? Array.from({ length: 8 }, (_, index) => <div key={index} className="mat round-card placeholder" aria-hidden="true" />)
            : rounds.map((round) => <RoundCard key={round.number} round={round} />)}
        </div>
        <section className="mat disputes" aria-label="Disputes" tabIndex={-1} ref={region}>
          <h2 tabIndex={-1} ref={disputesHeading}>
            Disputes
          </h2>
          {disputes === null ? (
            // Holds the empty state's height until the first read lands, so the desk below does not move.
            <div style={{ visibility: "hidden" }} aria-hidden="true">
              <Empty size={56}>No disputes are waiting for a ruling.</Empty>
            </div>
          ) : (
            queue.length === 0 && <Empty size={56}>No disputes are waiting for a ruling.</Empty>
          )}
          <ul>
            {queue.map((dispute) => (
              <li key={dispute.id}>
                <RescuingButton
                  className="btn"
                  data-dispute={dispute.id}
                  rescue={() => region.current?.querySelector<HTMLElement>("button[data-dispute]") ?? disputesHeading.current}
                  onClick={(event) => {
                    opener.current = event.currentTarget;
                    queueAtOpen.current = queue.map((entry) => entry.id);
                    ruledRef.current = false;
                    setRuling(dispute);
                    setRuleOpen(true);
                  }}
                >
                  {labelOf(dispute)}
                </RescuingButton>
                <p className="dispute-answer">
                  <q>{dispute.answer_text}</q>
                </p>
              </li>
            ))}
          </ul>
        </section>
      </div>
      <RulingDialog
        dispute={ruling}
        open={ruleOpen}
        onClose={() => setRuleOpen(false)}
        onRuled={(ruled) => {
          ruledRef.current = true;
          setDisputes((existing) => (existing ?? []).map((entry) => (entry.id === ruled.id ? ruled : entry)));
          setRuleOpen(false);
          void readDisputes();
        }}
        closeFocus={afterRuling}
      />
    </Page>
  );
}
