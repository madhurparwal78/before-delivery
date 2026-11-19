import { Eraser, FolderOpen, Plus, Sparkles } from "lucide-react";
import { useMemo, useRef } from "react";
import type { ChangeEvent, DragEvent, KeyboardEvent } from "react";
import { countLines, decodeBytes, firstUnencodable, INPUT_ENCODINGS, unencodableMessage } from "../../shared/bytes";
import type { InputEncoding } from "../../shared/bytes";
import { useStore } from "../store";
import { IconButton, TitleBar } from "../ui/Pane";
import {
  addStep, addTab, clearInput, MAX_TABS, requireSignIn, selectTab, setEncoding, setSelection, setText, takeFile,
} from "./actions";
import { suggestOperation } from "./suggest";
import { activeTab, inputBytes, workbench } from "./state";

export const pluralize = (count: number, noun: string): string => `${count} ${noun}${count === 1 ? "" : "s"}`;

/** "<bytes> bytes · <lines> lines", the way both status strips write it. */
export const sizeLabel = (bytes: Uint8Array): string => `${pluralize(bytes.length, "byte")} · ${pluralize(countLines(bytes), "line")}`;

export function InputTabs() {
  const tabs = useStore(workbench, (state) => state.tabs);
  const selected = useStore(workbench, (state) => state.activeTab);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const keys: Record<string, number> = { ArrowRight: selected + 1, ArrowLeft: selected - 1, Home: 0, End: tabs.length - 1 };
    const to = keys[event.key];
    if (to === undefined || to < 0 || to >= tabs.length) return;
    event.preventDefault();
    selectTab(to);
    (event.currentTarget.children[to] as HTMLElement).focus();
  };
  return (
    <div className="inputs-strip">
      <div role="tablist" aria-label="Inputs" className="input-tabs" onKeyDown={onKeyDown}>
        {tabs.map((tab, index) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={index === selected}
            tabIndex={index === selected ? 0 : -1}
            className="input-tab"
            onClick={() => selectTab(index)}
          >
            Input {index + 1}
          </button>
        ))}
      </div>
      <IconButton label="New input" disabled={tabs.length >= MAX_TABS} onClick={addTab}>
        <Plus size={22} aria-hidden="true" />
      </IconButton>
    </div>
  );
}

export function InputPane() {
  const tab = useStore(workbench, activeTab);
  const alertText = useStore(workbench, (state) => state.inputAlert);
  const chooser = useRef<HTMLInputElement>(null);
  const bytes = useMemo(() => inputBytes(tab), [tab.text, tab.encoding, tab.file]);
  const suggestion = useMemo(() => (bytes ? suggestOperation(bytes) : null), [bytes]);
  const unencodable = tab.file ? null : firstUnencodable(tab.text, tab.encoding);
  const encodingProblem = unencodable === null ? null : unencodableMessage(unencodable, tab.encoding);
  const shown = tab.file ? decodeBytes(tab.file.bytes, tab.encoding) : tab.text;
  const message = alertText ?? encodingProblem;

  const openChooser = (): void => {
    if (requireSignIn()) chooser.current?.click();
  };
  const onDrop = (event: DragEvent<HTMLElement>): void => {
    event.preventDefault();
    const file = event.dataTransfer.files[0];
    if (file) void takeFile(file);
  };

  return (
    <section
      role="region"
      aria-label="Input"
      tabIndex={-1}
      className="pane input"
      onDragOver={(event) => event.preventDefault()}
      onDrop={onDrop}
    >
      <TitleBar title="Input">
        <IconButton label="Open file" onClick={openChooser}>
          <FolderOpen size={22} aria-hidden="true" />
        </IconButton>
        <IconButton label="Clear input" onClick={clearInput}>
          <Eraser size={22} aria-hidden="true" />
        </IconButton>
        <select
          aria-label="Input encoding"
          className="title-select"
          value={tab.encoding}
          onChange={(event: ChangeEvent<HTMLSelectElement>) => setEncoding(event.target.value as InputEncoding)}
        >
          {INPUT_ENCODINGS.map((encoding) => (
            <option key={encoding} value={encoding}>{encoding}</option>
          ))}
        </select>
      </TitleBar>
      <input
        ref={chooser}
        type="file"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void takeFile(file);
        }}
      />
      <div className="editor">
        <textarea
          aria-label="Input"
          className="mono"
          spellCheck={false}
          autoComplete="off"
          placeholder="Type or paste text, or drop a file here."
          readOnly={tab.file !== null}
          value={shown}
          onChange={(event) => setText(event.target.value)}
          onSelect={(event) => setSelection(event.currentTarget.selectionStart, event.currentTarget.selectionEnd)}
        />
      </div>
      {message && (
        <p role="alert" className="pane-alert">{message}</p>
      )}
      {suggestion && (
        <button type="button" className="suggestion" onClick={() => addStep(suggestion)}>
          <Sparkles size={16} aria-hidden="true" />
          <span>Suggested: {suggestion}</span>
        </button>
      )}
      <div className="status-strip">
        <div role="status" aria-label="Input status" aria-live="off">{bytes ? sizeLabel(bytes) : "Not encodable"}</div>
      </div>
    </section>
  );
}


