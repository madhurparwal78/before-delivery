import { CircleAlert, Trash } from "lucide-react";
import { Fragment, useEffect, useId, useState, type KeyboardEvent } from "react";
import { copy } from "../../shared/copy";
import type { Block } from "../../shared/types";
import { BLOCKS } from "./catalog";
import { DEFAULT_MOVE_MM, DEFAULT_REPEAT_COUNT, isMove, parseCount, parseMove, type BlockPath, type InsertionPoint } from "./program";

export interface ProgramActions {
  /** Moves keyboard focus to the block before or after this head in visual order. */
  moveFocus: (from: HTMLElement, delta: 1 | -1) => void;
  setPoint: (point: InsertionPoint) => void;
  remove: (path: BlockPath) => void;
  setValue: (path: BlockPath, patch: Partial<Block>) => void;
  /** The head that is the tab stop of the list. */
  activate: (key: string) => void;
}

interface ProgramListProps {
  blocks: Block[];
  list: BlockPath;
  point: InsertionPoint;
  drop: InsertionPoint | null;
  locked: boolean;
  activeHead: string;
  actions: ProgramActions;
}

interface ValueFieldProps {
  label: string;
  unit: string;
  value: number;
  parse: (text: string) => number | null;
  error: string;
  disabled: boolean;
  onCommit: (value: number) => void;
}

/** A number box that applies each valid value as it is typed and shows its error, without applying, while the text is invalid. */
function ValueField({ label, unit, value, parse, error, disabled, onCommit }: ValueFieldProps) {
  const [draft, setDraft] = useState(String(value));
  const [invalid, setInvalid] = useState(false);
  const errorId = useId();
  useEffect(() => {
    setDraft((text) => (parse(text) === value ? text : String(value)));
    setInvalid(false);
  }, [value, parse]);
  return (
    <span className="bl-field">
      <input
        type="text"
        inputMode="decimal"
        autoComplete="off"
        spellCheck={false}
        className="input bl-input"
        aria-label={label}
        aria-invalid={invalid}
        aria-describedby={invalid ? errorId : undefined}
        value={draft}
        disabled={disabled}
        onChange={(event) => {
          const parsed = parse(event.target.value);
          setDraft(event.target.value);
          setInvalid(parsed === null);
          if (parsed !== null) onCommit(parsed);
        }}
      />
      <span className="bl-unit">{unit}</span>
      {invalid && (
        <span className="field-error bl-error" id={errorId}>
          <CircleAlert size={16} aria-hidden="true" focusable="false" />
          {error}
        </span>
      )}
    </span>
  );
}

function Gap({ kind }: { kind: "point" | "drop" }) {
  return <li className={`bl-gap bl-gap--${kind}`} role="presentation" aria-hidden="true" />;
}

/** One list of blocks: the program itself, or the body of a Repeat. Draws the insertion point as a highlighted gap. */
export function ProgramList({ blocks, list, point, drop, locked, activeHead, actions }: ProgramListProps) {
  const same = (at: InsertionPoint | null) => at !== null && at.list.length === list.length && at.list.every((value, i) => value === list[i]);
  const gaps = (index: number) => (
    <>
      {same(drop) && drop?.index === index && <Gap kind="drop" />}
      {same(point) && point.index === index && <Gap kind="point" />}
    </>
  );

  const keyDown = (event: KeyboardEvent<HTMLElement>, path: BlockPath, block: Block) => {
    if (event.target !== event.currentTarget || event.ctrlKey || event.metaKey || event.altKey) return;
    switch (event.key) {
      case "ArrowDown": actions.moveFocus(event.currentTarget, 1); break;
      case "ArrowUp": actions.moveFocus(event.currentTarget, -1); break;
      case "ArrowRight":
        if (block.block !== "repeat" || locked) return;
        actions.setPoint({ list: path, index: block.body?.length ?? 0 });
        break;
      case "ArrowLeft":
        if (path.length < 2 || locked) return;
        actions.setPoint({ list: path.slice(0, -2), index: (path[path.length - 2] ?? 0) + 1 });
        break;
      case "Delete":
      case "Backspace":
        if (locked) return;
        actions.remove(path);
        break;
      default: return;
    }
    event.preventDefault();
  };

  return (
    <ul className={`bl-list${blocks.length === 0 ? " bl-list--empty" : ""}`} aria-label={list.length === 0 ? "Program" : "Repeat body"} data-list={list.join(".")}>
      {blocks.map((block, index) => {
        const path = [...list, index];
        const key = path.join(".");
        const { label, icon: Icon, group } = BLOCKS[block.block];
        return (
          <Fragment key={key}>
            {gaps(index)}
            <li className={`bl-block bl-block--${group}`} data-block={key}>
              <div
                className="bl-head"
                role="group"
                aria-label={`${label} block`}
                tabIndex={key === activeHead ? 0 : -1}
                data-head={key}
                onFocus={(event) => { if (event.target === event.currentTarget) actions.activate(key); }}
                onKeyDown={(event) => keyDown(event, path, block)}
                onClick={(event) => {
                  if (locked || (event.target instanceof Element && event.target.closest("button, input"))) return;
                  actions.setPoint({ list, index: index + 1 });
                }}
              >
                <Icon size={20} aria-hidden="true" focusable="false" />
                <span className="bl-name">{label}</span>
                {block.block === "repeat" && (
                  <ValueField label="Repeat count" unit="times" value={block.count ?? DEFAULT_REPEAT_COUNT} parse={parseCount} error={copy.repeatRange} disabled={locked} onCommit={(count) => actions.setValue(path, { count })} />
                )}
                {isMove(block.block) && (
                  <ValueField label={`${label} (mm)`} unit="mm" value={block.mm ?? DEFAULT_MOVE_MM} parse={parseMove} error={copy.moveRange} disabled={locked} onCommit={(mm) => actions.setValue(path, { mm })} />
                )}
                <button type="button" className="pill pill--icon pill--danger-quiet bl-delete" aria-label="Delete block" disabled={locked} onClick={() => actions.remove(path)}>
                  <Trash size={20} aria-hidden="true" focusable="false" />
                </button>
              </div>
              {block.block === "repeat" && (
                <ProgramList blocks={block.body ?? []} list={path} point={point} drop={drop} locked={locked} activeHead={activeHead} actions={actions} />
              )}
            </li>
          </Fragment>
        );
      })}
      {gaps(blocks.length)}
    </ul>
  );
}
