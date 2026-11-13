import type { JSX } from "preact";
import { memo } from "preact/compat";
import { useLayoutEffect, useRef } from "preact/hooks";
import type { LetterState, TypingEngine } from "../../shared/engine";
import type { Settings } from "../../shared/protocol";
import { reducedMotion, tween } from "../motion";

const VISIBLE_LINES = 3;
const GLIDE_MS = 100;

interface WordProps {
  readonly index: number;
  readonly word: string;
  readonly states: readonly LetterState[];
  readonly typed: string;
  readonly current: boolean;
}

/** One word: its own letters, then any extra letters the typist added. */
const WordView = memo(
  function WordView({ index, word, states, typed, current }: WordProps): JSX.Element {
  return (
    <div class="word" data-index={index} data-current={current ? "true" : undefined}>
      {states.slice(0, word.length).map((state, position) => (
        <span class="letter" data-state={state} key={position}>
          {word.charAt(position)}
        </span>
      ))}
      {states.length > word.length && (
        <span class="extras">
          {states.slice(word.length).map((state, position) => (
            <span class="letter" data-state={state} key={position}>
              {typed.charAt(word.length + position)}
            </span>
          ))}
        </span>
      )}
    </div>
  );
  },
  (before, after) => before.index === after.index && before.current === after.current && before.typed === after.typed && before.states.join() === after.states.join(),
);

interface Props {
  readonly id: string;
  readonly engine: TypingEngine | null;
  /** Changes whenever the engine's state does. */
  readonly version: number;
  readonly settings: Pick<Settings, "caret" | "smoothCaret" | "blindMode">;
  readonly busy: boolean;
  readonly blurred: boolean;
  readonly onFocusRequest: () => void;
  readonly caretId: string;
}

/** Positions the words in the visible rows and the caret on the current letter; line numbers are measured from the real layout. */
export function WordsArea({ id, engine, version, settings, busy, blurred, onFocusRequest, caretId }: Props): JSX.Element {
  const areaRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const caretRef = useRef<HTMLDivElement>(null);
  const topRow = useRef(0);
  const shown = useRef({ x: 0, y: 0 });
  const stopGlide = useRef<(() => void) | null>(null);
  const lastLine = useRef(1);
  const blind = settings.blindMode;
  const currentWord = engine?.currentWord ?? 0;

  /** Moves the caret: a jump, or with smooth caret on a 100 ms glide from where it is drawn now. */
  const placeCaret = (caret: HTMLElement, x: number, y: number): void => {
    stopGlide.current?.();
    stopGlide.current = null;
    const from = shown.current;
    const draw = (px: number, py: number): void => {
      shown.current = { x: px, y: py };
      caret.style.transform = `translate(${px}px, ${py}px)`;
    };
    if (!settings.smoothCaret || reducedMotion() || (from.x === x && from.y === y)) return draw(x, y);
    stopGlide.current = tween(GLIDE_MS, (eased) => draw(from.x + (x - from.x) * eased, from.y + (y - from.y) * eased));
  };

  const layout = (resized: boolean): void => {
    const area = areaRef.current;
    const inner = innerRef.current;
    const caret = caretRef.current;
    if (!area || !inner || !caret || !engine) return;
    const words = [...inner.querySelectorAll<HTMLElement>(".word")];
    const lineHeight = area.clientHeight / VISIBLE_LINES;
    if (lineHeight === 0 || words.length === 0) return;
    const rowOf = (word: HTMLElement): number => Math.round(word.offsetTop / lineHeight);
    const current = words[currentWord];
    if (!current) return;
    const currentRow = rowOf(current);
    if (resized) topRow.current = Math.max(0, lastLine.current === 1 ? currentRow : currentRow - 1);
    else if (currentRow < topRow.current) topRow.current = currentRow;
    else if (currentRow - topRow.current >= VISIBLE_LINES - 1) topRow.current = currentRow - (VISIBLE_LINES - 2);
    for (const word of words) word.dataset.line = String(Math.max(0, rowOf(word) - topRow.current + 1));
    lastLine.current = currentRow - topRow.current + 1;
    inner.style.transform = `translateY(${-topRow.current * lineHeight}px)`;

    const letters = [...current.querySelectorAll<HTMLElement>(".letter")];
    const typedCount = engine.currentLetter;
    const next = letters[typedCount];
    const reference = next ?? letters[letters.length - 1];
    const left = reference ? current.offsetLeft + reference.offsetLeft + (next ? 0 : reference.offsetWidth) : current.offsetLeft;
    const width = next ? next.offsetWidth : lineHeight / 3;
    placeCaret(caret, left, current.offsetTop);
    caret.style.setProperty("--caret-width", `${width}px`);
    caret.style.setProperty("--caret-height", `${lineHeight}px`);
    for (const letter of inner.querySelectorAll(".under-caret")) letter.classList.remove("under-caret");
    if (next && settings.caret === "block") next.classList.add("under-caret");
  };

  useLayoutEffect(() => layout(false));
  useLayoutEffect(() => () => stopGlide.current?.(), []);
  const latestLayout = useRef(layout);
  latestLayout.current = layout;

  useLayoutEffect(() => {
    const area = areaRef.current;
    if (!area) return;
    let width = area.clientWidth;
    let height = area.clientHeight;
    const observer = new ResizeObserver(() => {
      if (area.clientWidth === width && area.clientHeight === height) return;
      width = area.clientWidth;
      height = area.clientHeight;
      latestLayout.current(true);
    });
    observer.observe(area);
    return () => observer.disconnect();
  }, []);

  return (
    <div class="words-frame">
      <div
        id={id}
        class="words"
        ref={areaRef}
        aria-busy={busy ? "true" : "false"}
        data-blurred={blurred ? "true" : undefined}
        data-caret={settings.caret}
      >
        <div class="words-inner" ref={innerRef} data-version={version}>
          {engine?.words.map((word, index) => (
            <WordView
              key={index}
              index={index}
              word={word}
              states={engine.letterStates(index, blind)}
              typed={engine.typedLetters(index).join("")}
              current={index === currentWord}
            />
          ))}
          <div id={caretId} class="caret" ref={caretRef} data-word={currentWord} data-letter={engine?.currentLetter ?? 0} data-style={settings.caret} />
        </div>
      </div>
      {blurred && (
        <button type="button" class="focus-button" onClick={onFocusRequest}>
          Click or press any key to focus
        </button>
      )}
    </div>
  );
}
