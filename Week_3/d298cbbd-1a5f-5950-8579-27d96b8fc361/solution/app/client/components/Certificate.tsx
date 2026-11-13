import type { ComponentChildren, JSX } from "preact";
import { useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import { TypingEngine } from "../../shared/engine";
import type { EngineRules, LogEntry, RunScore } from "../../shared/engine";
import { twoDecimals } from "../../shared/format";
import { fromHundredths, ratioHundredths } from "../../shared/numbers";
import { reducedMotion, tween } from "../motion";
import type { Seal } from "../testSession";
import { ErrorKeyboard } from "./ErrorKeyboard";
import { ReplaySlider } from "./ReplaySlider";
import { SpeedChart } from "./SpeedChart";

const RISE_MS = 480;
const RISE_PX = 24;
const STAMP_MS = 240;
const STAMP_SCALE = 1.2;
const INK_IN_MS = 120;

export interface Figures {
  readonly speed: string;
  readonly raw: string;
  readonly accuracy: string;
  readonly consistency: string;
  readonly characters: string;
  readonly duration: string;
}

/** What a certificate shows: the figures, and for a run that was replayed, the log to replay on the carbon. */
export interface CertificateInput {
  readonly figures: Figures;
  readonly replay: { readonly words: readonly string[]; readonly log: readonly LogEntry[]; readonly rules: EngineRules; readonly score: RunScore } | null;
  readonly seal: Seal;
  readonly proofKey: string | null;
  readonly finishedAt: string | null;
}

function sealText(seal: Seal): string[] {
  switch (seal.kind) {
    case "held":
      return ["Held: replay in progress"];
    case "counted":
      return seal.personalBest ? ["Counted", "New personal best"] : ["Counted"];
    case "refused":
      return [`Not counted: ${seal.reason}`];
    case "guest":
      return ["Not filed: sign in to keep your runs."];
    case "unverified":
      return ["Not filed: verify your email to keep your runs."];
  }
}

export function figuresOf(score: RunScore, consistency: string): Figures {
  const hundredths = (ratio: { num: number; den: number }): string => twoDecimals(fromHundredths(ratioHundredths(ratio)));
  const { correct, incorrect, extra, missed } = score.characters;
  return {
    speed: hundredths(score.speed),
    raw: hundredths(score.raw),
    accuracy: `${hundredths(score.accuracy)}%`,
    consistency: `${consistency}%`,
    characters: `${correct}/${incorrect}/${extra}/${missed}`,
    duration: `${twoDecimals(score.duration / 1000)} s`,
  };
}

function replayAt(replay: NonNullable<CertificateInput["replay"]>, second: number, last: number): TypingEngine {
  const engine = new TypingEngine(replay.words, replay.rules);
  for (const entry of replay.log) if (second === last || entry.t < second * 1000) engine.apply(entry);
  return engine;
}

/** The carbon copy of the passage: the same word and letter elements as the sheet, struck as far as the playhead. */
function Carbon({ engine, reached, second }: { engine: TypingEngine; reached: number; second: number }): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const caretRef = useRef<HTMLDivElement>(null);
  const before = useRef<{ second: number; states: string[] }>({ second, states: [] });

  useLayoutEffect(() => {
    const root = ref.current;
    const caret = caretRef.current;
    if (!root || !caret) return;
    const letters = [...root.querySelectorAll<HTMLElement>(".letter")];
    const states = letters.map((letter) => letter.dataset.state ?? "");
    const forward = second > before.current.second;
    if (!forward || reducedMotion()) for (const animation of root.getAnimations({ subtree: true })) animation.cancel();
    else {
      letters.forEach((letter, i) => {
        if (states[i] !== before.current.states[i] && states[i] !== "untyped") {
          letter.animate([{ opacity: 0.2 }, { opacity: 1 }], { duration: INK_IN_MS, easing: "ease-out" });
        }
      });
    }
    before.current = { second, states };
    const word = root.querySelectorAll<HTMLElement>(".word")[engine.currentWord];
    if (!word) return;
    const own = [...word.querySelectorAll<HTMLElement>(".letter")];
    const next = own[engine.currentLetter];
    const reference = next ?? own[own.length - 1];
    const left = reference ? word.offsetLeft + reference.offsetLeft + (next ? 0 : reference.offsetWidth) : word.offsetLeft;
    caret.style.transform = `translate(${left}px, ${word.offsetTop}px)`;
  });

  return (
    <div id="carbon" class="carbon" ref={ref}>
      {Array.from({ length: reached + 1 }, (_, index) => {
        const word = engine.words[index] ?? "";
        const states = engine.letterStates(index, false);
        return (
          <div class="word" data-index={index} key={index}>
            {states.map((state, position) => (
              <span class="letter" data-state={state} key={position}>
                {position < word.length ? word.charAt(position) : engine.typedLetters(index)[position]}
              </span>
            ))}
          </div>
        );
      })}
      <div id="carbon-caret" class="caret" ref={caretRef} data-word={engine.currentWord} data-letter={engine.currentLetter} data-style="line" />
    </div>
  );
}

interface Props {
  readonly input: CertificateInput;
  /** Where the slider starts; the end of the run when null. */
  readonly initialAt: number | null;
  readonly onPosition?: (second: number) => void;
  readonly animate: boolean;
  readonly actions?: ComponentChildren;
}

export function Certificate({ input, initialAt, onPosition, animate, actions }: Props): JSX.Element {
  const { replay, figures, seal } = input;
  const max = replay?.score.perSecond.length ?? 0;
  const [second, setSecond] = useState(initialAt ?? max);
  const regionRef = useRef<HTMLElement>(null);
  const sealRef = useRef<HTMLDivElement>(null);
  const sealKind = useRef<string | null>(null);
  const engine = useMemo(() => (replay ? replayAt(replay, second, max) : null), [replay, second, max]);
  const reached = useMemo(() => (replay ? replayAt(replay, max, max).currentWord : 0), [replay, max]);

  useLayoutEffect(() => {
    if (animate && !reducedMotion()) {
      regionRef.current?.animate([{ transform: `translateY(${RISE_PX}px)`, opacity: 0 }, { transform: "translateY(0)", opacity: 1 }], { duration: RISE_MS, easing: "cubic-bezier(0.2, 0.7, 0.2, 1)", fill: "both" });
    }
  }, []);

  useLayoutEffect(() => {
    const stamp = sealRef.current;
    const stamping = animate && stamp && !reducedMotion() && sealKind.current !== seal.kind && seal.kind !== "held";
    sealKind.current = seal.kind;
    if (!stamping) return;
    return tween(STAMP_MS, (eased) => {
      stamp.style.transform = eased === 1 ? "" : `scale(${STAMP_SCALE - (STAMP_SCALE - 1) * eased})`;
    });
  }, [seal.kind]);

  function move(next: number): void {
    setSecond(next);
    onPosition?.(next);
  }

  const speeds = replay ? replay.score.perSecond.map((row) => fromHundredths(ratioHundredths(row.speed))) : [];
  const replaySpeed = second === 0 || !replay ? "0.00" : twoDecimals(speeds[second - 1] ?? 0);

  return (
    <section class="certificate" role="region" aria-label="Certificate" ref={regionRef}>
      <div class="certificate-column">
        <article class="card">
          <header class="card-head">
            <h2 class="card-title">Certificate of Proficiency</h2>
            <p class="card-kicker">Holloway Carriage Co. Typing School</p>
          </header>
          <p class="speed-line">
            <span id="result-speed" class="speed-figure">{figures.speed}</span>
            <span class="speed-unit">wpm</span>
          </p>
          <dl class="figures">
            <div><dt>Raw speed</dt><dd id="result-raw">{figures.raw}</dd></div>
            <div><dt>Accuracy</dt><dd id="result-accuracy">{figures.accuracy}</dd></div>
            <div><dt>Consistency</dt><dd id="result-consistency">{figures.consistency}</dd></div>
            <div><dt>Characters</dt><dd id="result-characters">{figures.characters}</dd></div>
            <div><dt>Duration</dt><dd id="result-duration">{figures.duration}</dd></div>
            {input.finishedAt && <div><dt>Finished</dt><dd id="result-finished">{`${input.finishedAt.slice(0, 10)} ${input.finishedAt.slice(11, 16)} UTC`}</dd></div>}
          </dl>
          {replay && <ErrorKeyboard errors={replay.score.errorsByKey} />}
          <footer class="stub">
            <div class="perforation" aria-hidden="true" />
            <div id="seal" class="seal" role="status" aria-label="Seal" ref={sealRef}>
              {sealText(seal).map((line) => (
                <span class="seal-line" key={line}>{line}</span>
              ))}
            </div>
            <p id="proof-key" class="proof-key">{input.proofKey ? `Proof ${input.proofKey.slice(0, 16)}` : ""}</p>
          </footer>
        </article>
        {actions}
      </div>
      {replay && engine && (
        <div class="carbon-panel">
          <h2 class="panel-title">Carbon replay</h2>
          <Carbon engine={engine} reached={reached} second={second} />
          <div class="replay-controls">
            <ReplaySlider value={second} max={max} text={`${second} seconds, speed ${replaySpeed}`} onChange={move} />
            <p class="replay-readout">
              <span id="replay-speed" class="replay-speed">{replaySpeed}</span>
              <span class="speed-unit">wpm at second {second} of {max}</span>
            </p>
          </div>
          <SpeedChart speeds={speeds} current={second} />
          <table class="data-table" aria-label="Speed over time">
            <thead>
              <tr><th scope="col">Second</th><th scope="col">Speed</th><th scope="col">Raw</th><th scope="col">Errors</th></tr>
            </thead>
            <tbody>
              {replay.score.perSecond.map((row) => (
                <tr key={row.second} aria-current={row.second === second ? "true" : undefined}>
                  <td>{row.second}</td>
                  <td>{twoDecimals(fromHundredths(ratioHundredths(row.speed)))}</td>
                  <td>{twoDecimals(fromHundredths(ratioHundredths(row.raw)))}</td>
                  <td>{row.errors}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {replay.score.errorsByKey.length === 0 ? (
            <p class="no-errors">No errors.</p>
          ) : (
            <table class="data-table" aria-label="Errors by key">
              <thead>
                <tr><th scope="col">Key</th><th scope="col">Errors</th></tr>
              </thead>
              <tbody>
                {replay.score.errorsByKey.map(([key, count]) => (
                  <tr key={key}><td>{key}</td><td>{count}</td></tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </section>
  );
}
