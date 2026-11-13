import type { JSX } from "preact";
import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { twoDecimals } from "../../shared/format";
import { fromHundredths, numberHundredths } from "../../shared/numbers";
import type { Mode } from "../../shared/protocol";
import { QUOTES } from "../../shared/texts";
import { Certificate, figuresOf } from "../components/Certificate";
import type { CertificateInput } from "../components/Certificate";
import { Checkbox, RadioGroup } from "../components/Choices";
import { CommandLine } from "../components/CommandLine";
import { CustomTextDialog } from "../components/CustomTextDialog";
import { TypingSurface, useCapsLock } from "../components/TypingSurface";
import { WordsArea } from "../components/WordsArea";
import type { Command } from "../commands";
import { MODE_LENGTHS, currentLength, loadChoice, saveChoice, ticketRequest } from "../testConfig";
import type { LengthChoice, TestChoice } from "../testConfig";
import { TestSession } from "../testSession";
import type { FocusAfter } from "../testSession";
import { useStore } from "../store";
import { viewer } from "../viewer";

type DialogState =
  | { readonly kind: "command"; readonly abandoned: boolean }
  | { readonly kind: "custom"; readonly from: "radio" | "command"; readonly modeBefore: Mode };

const MODES: readonly Mode[] = ["time", "words", "quote", "custom"];

export function Hero(): JSX.Element {
  return (
    <section class="hero">
      <h1 class="hero-headline">
        <span>TYPE IT.</span> <span>PROVE IT.</span>
      </h1>
      <p class="hero-line">Timed tests whose every keystroke is replayed before it counts.</p>
    </section>
  );
}

export function TestPage(): JSX.Element {
  const settings = useStore(viewer.settings);
  const config = useStore(viewer.config);
  const [choice, setChoice] = useState<TestChoice>(loadChoice);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [pendingCustom, setPendingCustom] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const [radioFocus, setRadioFocus] = useState(0);
  const session = useRef<TestSession | null>(null);
  if (!session.current) session.current = new TestSession(config);
  const test = session.current;
  useStore(test.changes);
  const inputRef = useRef<HTMLInputElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const capsLock = useCapsLock();
  const latest = useRef({ choice, dialog, settings, test });
  latest.current = { choice, dialog, settings, test };
  const attempt = test.attempt;

  function commit(next: TestChoice, focusAfter: FocusAfter): void {
    saveChoice(next);
    setChoice(next);
    test.request(ticketRequest(next), focusAfter);
  }

  useLayoutEffect(() => {
    test.request(ticketRequest(choice), "input");
    return () => test.dispose();
  }, []);

  useLayoutEffect(() => {
    if (attempt?.focusAfter === "input") inputRef.current?.focus({ preventScroll: true });
  }, [attempt]);

  useLayoutEffect(() => {
    if (radioFocus > 0) document.querySelector<HTMLInputElement>('[role="radiogroup"][aria-label="Mode"] input:checked')?.focus({ preventScroll: true });
  }, [radioFocus]);

  useLayoutEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const { dialog: open, settings: current, test: running } = latest.current;
      if (open) return;
      if (event.key === "Escape") {
        event.preventDefault();
        const abandoned = running.phase === "running";
        if (abandoned) running.abandon();
        setDialog({ kind: "command", abandoned });
      } else if (event.key === "Enter" && current.quickRestart === "enter") {
        const target = event.target instanceof HTMLElement ? event.target : null;
        if (target?.closest("a[href], button")) return;
        event.preventDefault();
        restart();
      } else if (running.attempt?.blurred && document.activeElement === document.body && [...event.key].length === 1 && !event.ctrlKey && !event.metaKey) {
        event.preventDefault();
        inputRef.current?.focus({ preventScroll: true });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function restart(): void {
    const { choice: now } = latest.current;
    test.request(ticketRequest(now), "input");
  }

  function chooseMode(mode: Mode): void {
    if (mode === "custom") {
      test.abandon();
      setPendingCustom(true);
      setDialog({ kind: "custom", from: "radio", modeBefore: choice.mode });
    } else commit({ ...choice, mode }, "input");
  }

  function chooseLength(length: LengthChoice): void {
    if (choice.mode !== "custom") commit({ ...choice, lengths: { ...choice.lengths, [choice.mode]: length } }, "input");
  }

  function useCustomText(text: string): void {
    const state = dialog;
    if (state?.kind !== "custom") return;
    setDialog(null);
    setPendingCustom(false);
    commit({ ...choice, mode: "custom", customText: text }, state.from === "radio" ? "none" : "input");
    if (state.from === "radio") setRadioFocus((n) => n + 1);
  }

  function cancelCustomText(): void {
    const state = dialog;
    if (state?.kind !== "custom") return;
    setDialog(null);
    setPendingCustom(false);
    const next = choice.customText ? { ...choice, mode: "custom" as const } : { ...choice, mode: state.modeBefore };
    commit(next, state.from === "radio" ? "none" : "input");
    if (state.from === "radio") setRadioFocus((n) => n + 1);
    else inputRef.current?.focus({ preventScroll: true });
  }

  function closeCommandLine(command: Command | null): void {
    const state = dialog;
    if (state?.kind !== "command") return;
    setDialog(null);
    let next = choice;
    if (command) {
      setAnnouncement(`${command.label} applied.`);
      if (command.kind === "mode") {
        if (command.mode === "custom") {
          setPendingCustom(true);
          setDialog({ kind: "custom", from: "command", modeBefore: choice.mode });
          return;
        }
        next = { ...choice, mode: command.mode };
      } else if (command.kind === "length") next = { ...choice, mode: command.mode, lengths: { ...choice.lengths, [command.mode]: command.length } };
      else if (command.kind === "toggle") {
        next = { ...choice, [command.field]: command.on, mode: choice.mode === "quote" || choice.mode === "custom" ? "time" : choice.mode };
      } else viewer.change(command.patch);
    }
    inputRef.current?.focus({ preventScroll: true });
    if (state.abandoned || JSON.stringify(next) !== JSON.stringify(choice)) commit(next, "input");
  }

  const mode = pendingCustom ? "custom" : choice.mode;
  const length = currentLength(choice);
  const finished = test.phase === "finished" ? attempt?.finished ?? null : null;
  const decorated = mode === "time" || mode === "words";
  const quote = attempt?.ticket.quoteId ? QUOTES.find((candidate) => candidate.id === attempt.ticket.quoteId) : undefined;
  const timeLimit = attempt?.timeLimitMs ?? null;
  const timer = !attempt
    ? choice.mode === "time" ? String(length) : "0/-"
    : timeLimit !== null
      ? String(timeLimit / 1000 - attempt.seconds)
      : `${attempt.engine.currentWord}/${attempt.ticket.words.length}`;

  let certificate: CertificateInput | null = null;
  if (finished) {
    certificate = {
      figures: figuresOf(finished.score, twoDecimals(fromHundredths(numberHundredths(finished.score.consistency)))),
      replay: { words: finished.words, log: finished.log, rules: finished.rules, score: finished.score },
      seal: finished.seal,
      proofKey: finished.proofKey,
      finishedAt: null,
    };
  }

  return (
    <>
      <div class="mode-row">
        <div class="mode-controls">
          <RadioGroup label="Mode" name="mode" value={mode} options={MODES} onChange={chooseMode} />
          {mode !== "custom" && <RadioGroup label="Length" name="length" value={length as LengthChoice} options={MODE_LENGTHS[mode]} onChange={chooseLength} />}
          {decorated && <Checkbox label="Punctuation" checked={choice.punctuation} onChange={(checked) => commit({ ...choice, punctuation: checked }, "input")} />}
          {decorated && <Checkbox label="Numbers" checked={choice.numbers} onChange={(checked) => commit({ ...choice, numbers: checked }, "input")} />}
        </div>
        <button
          type="button"
          class="button begin"
          onClick={() => {
            sheetRef.current?.scrollIntoView({ block: "center" });
            inputRef.current?.focus({ preventScroll: true });
          }}
        >
          Begin test
        </button>
      </div>
      <p class="status-note" role="status" aria-label="Settings updates">{announcement}</p>
      <p class="sr-only" role="status" aria-label="Test result">{test.resultAnnouncement}</p>
      {certificate ? (
        <Certificate
          key={attempt?.ticket.ticketId}
          input={certificate}
          initialAt={null}
          animate
          actions={<button type="button" class="button next-test" onClick={restart}>Next test</button>}
        />
      ) : (
        <div class="sheet" ref={sheetRef}>
          <div class="readouts">
            <p class="readout"><span class="readout-label">{timeLimit !== null || choice.mode === "time" ? "Seconds left" : "Words"}</span><span id="timer" class="readout-value">{timer}</span></p>
            <p class="readout"><span class="readout-label">Speed</span><span id="live-speed" class="readout-value">{attempt?.liveSpeed ?? "0"}</span></p>
            <p class="readout"><span class="readout-label">Accuracy</span><span id="live-accuracy" class="readout-value">{attempt?.liveAccuracy ?? "100%"}</span></p>
          </div>
          <WordsArea
            id="words"
            caretId="caret"
            engine={attempt?.engine ?? null}
            version={test.changes.get()}
            settings={settings}
            busy={test.phase === "loading" || test.phase === "abandoned"}
            blurred={attempt?.blurred ?? false}
            onFocusRequest={() => inputRef.current?.focus({ preventScroll: true })}
          />
          {quote && <p id="quote-source" class="quote-source">{quote.source}</p>}
          {test.phase === "failed" && <p class="alert" role="alert">Could not start a test. Check your connection and try again.</p>}
          <TypingSurface inputRef={inputRef} onKey={(key) => test.type(key)} onFocus={() => test.inputFocused()} onBlur={() => test.inputBlurred()} />
          <p class="caps-lock" role="status" aria-label="Caps Lock">{capsLock ? "Caps Lock is on" : ""}</p>
          <button type="button" class="button restart" onClick={restart}>Restart test</button>
        </div>
      )}
      {dialog?.kind === "command" && <CommandLine onChoose={closeCommandLine} onCancel={() => closeCommandLine(null)} />}
      {dialog?.kind === "custom" && <CustomTextDialog initialText={choice.customText} onUse={useCustomText} onCancel={cancelCustomText} />}
    </>
  );
}
