import { Download } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import { decodeUtf8Lenient, hexText, isValidUtf8 } from "../../shared/bytes";
import type { SpanView } from "../../shared/span";
import { config } from "../api";
import { downloadBytes } from "../download";
import { useStore } from "../store";
import { IconButton, TitleBar } from "../ui/Pane";
import { patch, activeTab, workbench } from "./state";
import type { BakeView, OutputView } from "./state";
import { sizeLabel } from "./InputPane";
import { spanOf } from "./spanView";

interface Display {
  text: string;
  notices: string[];
  /** The mapped range in the shown text, in characters. */
  mark: { start: number; end: number } | null;
}

/** Cuts back to the last whole UTF-8 character at or before `limit` bytes. */
function wholeCharacters(bytes: Uint8Array, limit: number): Uint8Array {
  let cut = Math.min(limit, bytes.length);
  while (cut > 0 && cut < bytes.length && ((bytes[cut] as number) & 0xc0) === 0x80) cut--;
  return bytes.subarray(0, cut);
}

function describe(bake: BakeView, view: OutputView, cap: number, span: SpanView | null): Display {
  if (bake.failureText !== null) return { text: bake.failureText, notices: [], mark: null };
  const { output } = bake;
  const valid = isValidUtf8(output);
  const hex = view === "Hex" || !valid;
  const notices: string[] = [];
  if (view === "Text" && !valid) notices.push("Output is not valid UTF-8; showing hex.");
  if (output.length > cap) notices.push(`Showing the first ${cap} of ${output.length} bytes. Download output for all of it.`);
  const range = span?.final ?? null;
  if (hex) {
    const shown = output.subarray(0, cap);
    const mark = range && range.start < shown.length
      ? { start: range.start * 3, end: Math.min(range.end, shown.length) * 3 - 1 }
      : null;
    return { text: spacedHex(shown), notices, mark };
  }
  const shown = wholeCharacters(output, cap);
  const mark = range && range.start < shown.length
    ? { start: decodeUtf8Lenient(shown.subarray(0, range.start)).length, end: decodeUtf8Lenient(shown.subarray(0, Math.min(range.end, shown.length))).length }
    : null;
  return { text: decodeUtf8Lenient(shown), notices, mark };
}

const spacedHex = (bytes: Uint8Array): string => (hexText(bytes).match(/../g) ?? []).join(" ");

export function OutputPane() {
  const bake = useStore(workbench, (state) => state.bake);
  const view = useStore(workbench, (state) => state.outputView);
  const steps = useStore(workbench, (state) => state.steps);
  const tab = useStore(workbench, activeTab);
  const span = useMemo(() => spanOf(steps, bake, tab), [steps, bake, tab]);
  const display = useMemo(() => describe(bake, view, config().outputDisplayBytes, span), [bake, view, span]);
  const editor = useRef<HTMLDivElement>(null);
  const mirror = useRef<HTMLPreElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const previous = useRef(display.text);

  useEffect(() => {
    if (previous.current === display.text) return;
    previous.current = display.text;
    if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      editor.current?.animate([{ opacity: 0.35 }, { opacity: 1 }], { duration: 150, easing: "cubic-bezier(0.4, 0, 0.2, 1)" });
    }
  }, [display.text]);

  const status =
    bake.phase === "error" ? "No output" : `${sizeLabel(bake.output)}${span?.final ? ` · Selection maps to characters ${span.final.start}–${span.final.end - 1}` : ""}`;
  const { mark } = display;

  return (
    <section role="region" aria-label="Output" tabIndex={-1} className="pane output">
      <TitleBar title="Output">
        <select
          aria-label="Output view"
          className="title-select"
          value={view}
          onChange={(event) => patch({ outputView: event.target.value as OutputView })}
        >
          <option value="Text">Text</option>
          <option value="Hex">Hex</option>
        </select>
      </TitleBar>
      {display.notices.map((notice) => (
        <p key={notice} className="notice-text">{notice}</p>
      ))}
      <div className="editor" ref={editor}>
        {mark && (
          <pre className="mirror mono" ref={mirror} aria-hidden="true">
            {display.text.slice(0, mark.start)}
            <mark>{display.text.slice(mark.start, mark.end)}</mark>
            {display.text.slice(mark.end)}
          </pre>
        )}
        <textarea
          ref={field}
          aria-label="Output"
          className="mono"
          readOnly
          spellCheck={false}
          value={display.text}
          onScroll={(event) => {
            if (mirror.current) mirror.current.scrollTop = event.currentTarget.scrollTop;
          }}
        />
      </div>
      <IconButton
        label="Download output"
        className="download-button"
        onClick={() => downloadBytes(bake.output, isValidUtf8(bake.output) ? "output.txt" : "output.bin")}
      >
        <Download size={22} aria-hidden="true" />
      </IconButton>
      <div className="status-strip">
        <div role="status" aria-label="Output status" aria-live="off">{status}</div>
      </div>
    </section>
  );
}
