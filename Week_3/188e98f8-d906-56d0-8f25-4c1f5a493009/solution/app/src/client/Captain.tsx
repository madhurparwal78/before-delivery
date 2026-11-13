import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";
import type { Answer, Dispute, Round } from "../shared/api-types";
import { normalizeText } from "../shared/text";
import { Unreachable, fieldError, get, patch, post } from "./api";
import { COPY, answersIn, roundClosed, tooManySubmits, windowClosed } from "./copy";
import { Dialog } from "./dialog";
import { useDisputes } from "./disputes";
import { RescuingButton, focusQuietly, freshKey } from "./focus";
import { useLeague, usePolling } from "./league";
import { useMessages } from "./messages";
import { fade } from "./motion";
import { useLandAtTop } from "./router";
import { useSession } from "./session";
import { Empty, LimitedField, Page } from "./ui";

const QUESTIONS = [1, 2, 3, 4, 5, 6, 7, 8];
const announcedClosed = new Set<number>();

/**
 * The round whose form the desk shows: the round this screen last saw open. It stays after the round
 * closes, until a poll reports a different round open.
 */
function useFormRound(rounds: Round[] | null): Round | null {
  const [chosen, setChosen] = useState<number | null>(null);
  useLayoutEffect(() => {
    if (rounds === null) return;
    const open = rounds.find((round) => round.status === "open");
    if (open !== undefined && open.number !== chosen) setChosen(open.number);
  }, [rounds, chosen]);
  return rounds?.find((round) => round.number === chosen) ?? null;
}

function Countdown({ round }: { round: Round }) {
  const { syncs } = useLeague();
  const [left, setLeft] = useState(round.seconds_left ?? 0);
  const open = round.status === "open";
  useLayoutEffect(() => {
    setLeft(open ? (round.seconds_left ?? 0) : 0);
    if (!open) return;
    const timer = window.setInterval(() => setLeft((seconds) => Math.max(0, seconds - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [syncs, open, round.seconds_left]);
  return (
    <div role="timer" aria-label="Time left" className="countdown">
      {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")} left
    </div>
  );
}

interface AnswerFormProps {
  round: Round;
  accepted: Answer[];
  onAccepted: (answers: Answer[]) => void;
}

function AnswerForm({ round, accepted, onAccepted }: AnswerFormProps) {
  const messages = useMessages();
  const [values, setValues] = useState<string[]>(() => QUESTIONS.map(() => ""));
  const [refusals, setRefusals] = useState<Record<number, string>>({});
  const [refusedClosed, setRefusedClosed] = useState(false);
  const [busy, setBusy] = useState(false);
  const key = useRef<string | null>(null);
  const inputs = useRef(new Map<number, HTMLInputElement & HTMLTextAreaElement>());
  const closed = round.status !== "open" || refusedClosed;

  useLayoutEffect(() => {
    if (round.status !== "open" && !announcedClosed.has(round.number)) {
      announcedClosed.add(round.number);
      messages.say(roundClosed(round.number), "error");
    }
  }, [round.status, round.number, messages]);

  const change = (question: number, value: string) => {
    setValues((existing) => existing.map((entry, index) => (index === question - 1 ? value : entry)));
    setRefusals(({ [question]: _gone, ...rest }) => rest);
  };

  const submit = async () => {
    if (closed) return;
    const answers = QUESTIONS.map((question) => ({ question, text: normalizeText(values[question - 1] ?? "") })).filter(
      (entry) => entry.text !== "",
    );
    if (answers.length === 0) {
      inputs.current.get(1)?.focus();
      return;
    }
    key.current ??= freshKey();
    messages.pending(COPY.sendingAnswers);
    setBusy(true);
    try {
      const reply = await post<{ accepted: Answer[] }>(
        `/api/rounds/${round.number}/answers`,
        { answers },
        { headers: { "Idempotency-Key": key.current } },
      );
      key.current = null;
      if (reply.ok) {
        setRefusals({});
        onAccepted(reply.data.accepted);
        setSent((count) => count + 1);
        messages.say(answersIn(round.number));
      } else if (reply.status === 429) {
        messages.say(tooManySubmits(Number(reply.headers.get("Retry-After") ?? "1")), "error");
      } else if (reply.status === 409) {
        setRefusedClosed(true);
        announcedClosed.add(round.number);
        messages.say(roundClosed(round.number), "error");
      } else if (reply.status === 422) {
        const refused: Record<number, string> = {};
        for (const question of QUESTIONS) {
          if (fieldError(reply, `question_${question}`) === "too_long") refused[question] = COPY.answerOver;
        }
        setRefusals(refused);
        messages.say(COPY.answerOver, "error");
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

  const enter = (question: number) => (event: KeyboardEvent<HTMLInputElement & HTMLTextAreaElement>) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    if (question < QUESTIONS.length) inputs.current.get(question + 1)?.focus();
    else void submit();
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void submit();
  };

  const listed = [...accepted].sort((a, b) => a.question - b.question);
  const listRef = useRef<HTMLUListElement>(null);
  const [sent, setSent] = useState(0);
  useLayoutEffect(() => {
    if (sent > 0 && listRef.current !== null) fade(listRef.current);
  }, [sent]);

  return (
    <>
      <form className="mat answer-form" aria-label={`Round ${round.number} answers`} onSubmit={onSubmit} noValidate>
        <Countdown round={round} />
        <h2 className="form-title">
          Round {round.number}: {round.title}
        </h2>
        <div className="answer-grid">
          {QUESTIONS.map((question) => (
            <LimitedField
              key={question}
              label={`Question ${question}`}
              value={values[question - 1] ?? ""}
              onValue={(value) => change(question, value)}
              limit="answer"
              overCopy={COPY.answerOver}
              refusal={refusals[question]}
              readOnly={closed}
              enterKeyHint={question < QUESTIONS.length ? "next" : "go"}
              inputRef={(element) => {
                if (element === null) inputs.current.delete(question);
                else inputs.current.set(question, element);
              }}
              onKeyDown={enter(question)}
            />
          ))}
        </div>
        {round.kind === "picture" && (
          <div className="sheet-box">
            <img src={`/api/rounds/${round.number}/sheet`} alt={`Picture sheet for round ${round.number}`} />
          </div>
        )}
        <button type="submit" className="btn" aria-busy={busy}>
          Submit answers
        </button>
      </form>
      {listed.length > 0 && (
        <ul className="accepted" aria-label="Accepted answers" ref={listRef}>
          {listed.map((answer) => (
            <li key={answer.question}>
              <b>Q{answer.question}</b> <span>{answer.text}</span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function RenameDialog({ open, onClose, teamId, current }: { open: boolean; onClose: () => void; teamId: number; current: string }) {
  const messages = useMessages();
  const { refresh } = useLeague();
  const [name, setName] = useState(current);
  const [refusal, setRefusal] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const wasOpen = useRef(false);

  useLayoutEffect(() => {
    if (open && !wasOpen.current) {
      setName(current);
      setRefusal(undefined);
    }
    wasOpen.current = open;
  }, [open, current]);

  const save = async () => {
    messages.pending(COPY.savingName);
    setBusy(true);
    try {
      const reply = await patch(`/api/teams/${teamId}`, { name });
      if (reply.ok) {
        messages.say(COPY.nameSaved);
        onClose();
        void refresh();
      } else {
        const copy =
          reply.status === 409
            ? COPY.nameTaken
            : fieldError(reply, "name") === "too_long"
              ? COPY.nameOver
              : fieldError(reply, "name") === "required"
                ? COPY.nameEmpty
                : COPY.unreachable;
        if (reply.status === 409 || reply.status === 422) setRefusal(copy);
        messages.say(copy, "error");
      }
    } catch (error) {
      if (!(error instanceof Unreachable)) throw error;
      messages.say(COPY.unreachable, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      label="Rename team"
      onRequestClose={onClose}
      closeFocus={() => document.getElementById("rename-team")}
      initialFocus={(panel) => panel.querySelector<HTMLElement>("input")}
    >
      <form
        className="panel-body"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
        noValidate
      >
        <LimitedField
          label="Team name"
          value={name}
          onValue={(value) => {
            setName(value);
            setRefusal(undefined);
          }}
          limit="name"
          overCopy={COPY.nameOver}
          refusal={refusal}
        />
        <div className="panel-actions">
          <button type="submit" className="btn" aria-busy={busy}>
            Save name
          </button>
          <button type="button" className="btn quiet" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Dialog>
  );
}

interface DisputeTarget {
  answer: Answer;
  opener: HTMLElement;
  /** The Dispute button after this one in Your marks, when there is one. */
  next: HTMLElement | null;
}

interface DisputeSheetProps {
  target: DisputeTarget | null;
  open: boolean;
  onClose: (sent: boolean) => void;
  onSent: (dispute: Dispute) => void;
  closeFocus: () => HTMLElement | null;
}

function DisputeSheet({ target, open, onClose, onSent, closeFocus }: DisputeSheetProps) {
  const messages = useMessages();
  const [reason, setReason] = useState("");
  const [refusal, setRefusal] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const wasOpen = useRef(false);

  useLayoutEffect(() => {
    if (open && !wasOpen.current) {
      setReason("");
      setRefusal(undefined);
    }
    wasOpen.current = open;
  }, [open]);

  const send = async () => {
    if (target === null) return;
    messages.pending(COPY.sendingDispute);
    setBusy(true);
    try {
      const reply = await post<{ dispute: Dispute }>("/api/disputes", { answer_id: target.answer.id, reason });
      if (reply.ok) {
        onSent(reply.data.dispute);
        messages.say(COPY.disputeSent);
        onClose(true);
      } else if (reply.status === 409) {
        messages.say(windowClosed(target.answer.round), "error");
      } else if (reply.status === 422) {
        const copy = fieldError(reply, "reason") === "too_long" ? COPY.reasonOver : COPY.reasonEmpty;
        setRefusal(copy);
        messages.say(copy, "error");
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

  return (
    <Dialog
      open={open}
      label="Raise a dispute"
      onRequestClose={() => onClose(false)}
      initialFocus={(panel) => panel.querySelector<HTMLElement>("textarea")}
      closeFocus={closeFocus}
    >
      <form
        className="panel-body"
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
        noValidate
      >
        {target !== null && (
          <p className="dispute-about">
            Round {target.answer.round}, question {target.answer.question}: <q>{target.answer.text}</q>
          </p>
        )}
        <LimitedField
          label="Reason"
          multiline
          value={reason}
          onValue={(value) => {
            setReason(value);
            setRefusal(undefined);
          }}
          limit="reason"
          overCopy={COPY.reasonOver}
          refusal={refusal}
        />
        <div className="panel-actions">
          <button type="submit" className="btn" aria-busy={busy}>
            Send dispute
          </button>
          <button type="button" className="btn quiet" onClick={() => onClose(false)}>
            Cancel
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export function Captain() {
  useLandAtTop();
  const heading = useRef<HTMLHeadingElement>(null);
  const marks = useRef<HTMLElement>(null);
  const { rounds, table } = useLeague();
  const { state } = useSession();
  const { disputes, take } = useDisputes();
  const form = useFormRound(rounds);
  const [answers, setAnswers] = useState<Record<number, Answer[]>>({});
  const [renaming, setRenaming] = useState(false);
  const [target, setTarget] = useState<DisputeTarget | null>(null);
  const [disputing, setDisputing] = useState(false);

  useLayoutEffect(() => focusQuietly(heading.current), []);

  const teamId = state.status === "in" ? state.info.team_id : null;
  const teamName = table?.teams.find((team) => team.team_id === teamId)?.name ?? (state.status === "in" ? state.info.team_name : null);

  const wanted = useMemo(() => {
    const numbers = new Set<number>();
    for (const round of rounds ?? []) if (round.status === "marked" || round.status === "published") numbers.add(round.number);
    if (form !== null) numbers.add(form.number);
    return [...numbers].sort((a, b) => a - b);
  }, [rounds, form]);
  const wantedKey = wanted.join(",") + (rounds ?? []).map((round) => round.status[0]).join("");
  const wantedRef = useRef(wanted);
  wantedRef.current = wanted;

  const readAnswers = useCallback(async () => {
    const loaded = await Promise.all(
      wantedRef.current.map(async (number) => {
        const reply = await get<{ answers: Answer[] }>(`/api/rounds/${number}/answers`);
        return reply.ok ? ([number, reply.data.answers] as const) : null;
      }),
    );
    setAnswers((existing) => ({ ...existing, ...Object.fromEntries(loaded.filter((entry) => entry !== null)) }));
  }, []);
  usePolling(readAnswers, []);
  useEffect(() => {
    void readAnswers();
  }, [wantedKey, readAnswers]);

  const accepted = (form === null ? undefined : answers[form.number]) ?? [];
  const onAccepted = (fresh: Answer[]) => {
    if (form === null) return;
    setAnswers((existing) => {
      const kept = (existing[form.number] ?? []).filter((old) => !fresh.some((entry) => entry.question === old.question));
      return { ...existing, [form.number]: [...kept, ...fresh] };
    });
  };

  const awaiting = (rounds ?? []).filter((round) => round.status === "marked");
  const settled = (rounds ?? []).filter((round) => round.status === "published").reverse();
  const markedRounds = [...awaiting, ...settled];
  const disputeFor = (answerId: number) => disputes?.find((dispute) => dispute.answer_id === answerId);
  const statusWord = (dispute: Dispute) => (dispute.status === "raised" ? "Raised" : dispute.status === "upheld" ? "Upheld" : "Dismissed");

  const openDispute = (answer: Answer, opener: HTMLElement) => {
    const buttons = [...(marks.current?.querySelectorAll<HTMLElement>("button[data-dispute]") ?? [])];
    setTarget({ answer, opener, next: buttons[buttons.indexOf(opener) + 1] ?? null });
    setDisputing(true);
  };

  const sentRef = useRef(false);
  const closeDispute = (sent: boolean) => {
    sentRef.current = sent;
    setDisputing(false);
  };
  const afterDispute = (): HTMLElement | null => {
    const fallback = sentRef.current ? heading.current : marks.current;
    const wanted = sentRef.current ? target?.next : target?.opener;
    return wanted?.isConnected ? wanted : fallback;
  };

  return (
    <Page level={2}>
      <h1 tabIndex={-1} ref={heading}>
        Answer desk
      </h1>
      <div className="team-bar">
        <p className="team-name">{teamName}</p>
        <button type="button" id="rename-team" className="btn" onClick={() => setRenaming(true)}>
          Rename team
        </button>
      </div>

      {form === null ? (
        rounds !== null &&
        rounds.every((round) => round.status === "drafted") && (
          <section className="mat waiting">
            <Empty size={40}>{COPY.waiting}</Empty>
          </section>
        )
      ) : (
        <AnswerForm key={form.number} round={form} accepted={accepted} onAccepted={onAccepted} />
      )}

      <section className="your-marks" aria-label="Your marks" tabIndex={-1} ref={marks}>
        <h2>Your marks</h2>
        {markedRounds.length === 0 && <p className="quiet-line">Marks appear here once the marker has finished a round.</p>}
        {markedRounds.map((round) => (
          <div key={round.number} className="mat mark-group" role="group" aria-label={`Round ${round.number}`}>
            <h3>
              Round {round.number}: {round.title}
            </h3>
            <ul>
              {(answers[round.number] ?? []).map((answer) => {
                const dispute = disputeFor(answer.id);
                const canDispute = round.status === "marked" && answer.mark === 0 && dispute === undefined;
                return (
                  <li key={answer.id}>
                    <span className="mark-q">Question {answer.question}</span>
                    <span className="mark-text">{answer.text}</span>
                    <span className="mark-score">{answer.ruled}</span>
                    {dispute !== undefined && <span className="mark-status">{statusWord(dispute)}</span>}
                    {canDispute && (
                      <RescuingButton
                        className="btn"
                        data-dispute=""
                        aria-label={`Dispute question ${answer.question}`}
                        rescue={() => marks.current}
                        onClick={(event) => openDispute(answer, event.currentTarget)}
                      >
                        Dispute
                      </RescuingButton>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </section>

      <RenameDialog open={renaming} onClose={() => setRenaming(false)} teamId={teamId ?? 0} current={teamName ?? ""} />
      <DisputeSheet target={target} open={disputing} onClose={closeDispute} onSent={take} closeFocus={afterDispute} />
    </Page>
  );
}

