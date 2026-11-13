// The Findings listbox (DP-67): one single-select listbox walked by arrows, Home, End and type-ahead, with focus kept on the list.
import { useRef, useState, type KeyboardEvent } from "react";
import { SeverityIcon } from "./icons";

export interface FindingOption {
  key: string;
  severity: "Blocking" | "Advisory" | "Pass";
  message: string;
  parameters: string[];
  /** A finding of a stale report: muted text and hollow icon, still selectable. */
  dim?: boolean;
}

const optionName = (option: FindingOption): string => `${option.severity}: ${option.message}`;

interface Props {
  options: FindingOption[];
  selectedKey: string | null;
  labels: Record<string, string>;
  onSelect: (option: FindingOption) => void;
  onGoTo: (parameter: string) => void;
}

const SEARCH_MS = 500;

export function Findings({ options, selectedKey, labels, onSelect, onGoTo }: Props) {
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const search = useRef({ text: "", at: 0 });
  const active = options.find((o) => o.key === activeKey) ?? null;
  const selected = options.find((o) => o.key === selectedKey) ?? null;

  const move = (index: number) => {
    const target = options[Math.max(0, Math.min(options.length - 1, index))];
    if (target) setActiveKey(target.key);
  };

  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = active ? options.indexOf(active) : -1;
    if (event.key === "ArrowDown") move(index + 1);
    else if (event.key === "ArrowUp") move(index < 0 ? 0 : index - 1);
    else if (event.key === "Home") move(0);
    else if (event.key === "End") move(options.length - 1);
    else if ((event.key === "Enter" || event.key === " ") && active) onSelect(active);
    else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const now = performance.now();
      search.current.text = now - search.current.at < SEARCH_MS ? search.current.text + event.key : event.key;
      search.current.at = now;
      const text = search.current.text.toLowerCase();
      const ordered = [...options.slice(index + 1), ...options.slice(0, index + 1)];
      const hit = ordered.find((o) => optionName(o).toLowerCase().startsWith(text));
      if (hit) setActiveKey(hit.key);
      return;
    } else return;
    event.preventDefault();
  };

  if (options.length === 0) {
    return <p className="muted findings-empty">Nothing to report. Run pre-flight to check this part against a process.</p>;
  }

  return (
    <>
      <div
        className="findings"
        role="listbox"
        aria-label="Findings"
        tabIndex={0}
        aria-activedescendant={active ? `finding-${active.key}` : undefined}
        onKeyDown={onKey}
      >
        {options.map((option) => (
          <div
            key={option.key}
            id={`finding-${option.key}`}
            role="option"
            aria-label={optionName(option)}
            aria-selected={option.key === selectedKey}
            className={`finding sev-${option.severity.toLowerCase()}${option.dim ? " dim" : ""}${option.key === activeKey ? " active" : ""}`}
            onClick={() => {
              setActiveKey(option.key);
              onSelect(option);
            }}
          >
            <span className="sev-icon">
              <SeverityIcon severity={option.severity} hollow={option.dim} />
            </span>
            <span className="sev-word">{option.severity}</span>
            <span className="sev-text">{option.message}</span>
          </div>
        ))}
      </div>
      {selected && selected.parameters.length > 0 ? (
        <div className="go-to">
          {selected.parameters.map((name) => (
            <button key={name} type="button" onClick={() => onGoTo(name)}>
              Go to {labels[name] ?? name}
            </button>
          ))}
        </div>
      ) : null}
    </>
  );
}
