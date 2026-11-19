import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import type { WorkflowJson } from "../../../server/workflows.js";
import { ApiFailure, failureText, get, post, put } from "../../lib/api.js";
import { useAnnounce } from "../../lib/announce.js";
import { Link } from "../../lib/router.js";
import { useSession } from "../../lib/session.js";
import { animate, Button, loadingScreen, Page, Rest, StatusBlock, useLoad } from "../../lib/ui.js";
import { AddStepDialog, DeleteStepDialog, EditStepDialog } from "./StepDialogs.js";
import {
  detailRows,
  findStep,
  flatten,
  insertStep,
  LANE_LABELS,
  laneKey,
  lanesOf,
  laneSteps,
  listAt,
  moveStep,
  newStep,
  removeStep,
  replaceStep,
  stepKey,
  TYPE_LABELS,
  type LaneName,
  type Step,
  type StepType,
  type TreeItem,
} from "./tree.js";

const TRIGGER_STAYS_FIRST = "The trigger stays first.";

type Dialog = { kind: "add"; at: string } | { kind: "delete"; id: string } | { kind: "edit"; id: string } | null;

export function Designer({ id }: { id: string }): JSX.Element {
  const session = useSession();
  const { state, reload } = useLoad(async () => {
    const found = (await get<{ workflows: WorkflowJson[] }>("/api/workflows")).workflows.find((flow) => String(flow.id) === id);
    if (!found) throw new ApiFailure(404, "not_found", "No such record.", undefined, {});
    return found;
  }, [id, session.workspace]);
  const pending = loadingScreen(state, "workflow", reload);
  if (pending || state.status !== "ready") return pending ?? <></>;
  return <DesignerBody key={`${state.data.id}:${session.workspace}`} flow={state.data} />;
}

function DesignerBody({ flow }: { flow: WorkflowJson }): JSX.Element {
  const announce = useAnnounce();
  const [steps, setSteps] = useState<Step[]>(flow.draft);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [versions, setVersions] = useState<number[]>(flow.versions);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [publishText, setPublishText] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [testRecord, setTestRecord] = useState("");
  const [testRun, setTestRun] = useState<{ id: number } | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);

  const itemRefs = useRef(new Map<string, HTMLElement>());
  const pendingFocus = useRef<string | null>(null);
  const pendingMove = useRef<{ key: string; top: number } | null>(null);
  const saveChain = useRef<Promise<string | null>>(Promise.resolve(null));

  const items = useMemo(() => flatten(steps, expanded), [steps, expanded]);
  const tabKey = focusKey !== null && items.some((item) => item.key === focusKey) ? focusKey : (items[0]?.key ?? null);
  const current = items.find((item) => item.key === tabKey) ?? null;

  useLayoutEffect(() => {
    const move = pendingMove.current;
    pendingMove.current = null;
    const element = move ? itemRefs.current.get(move.key) : undefined;
    if (!move || !element) return;
    const shift = move.top - element.getBoundingClientRect().top;
    if (shift !== 0) animate(element, [{ transform: `translateY(${shift}px)` }, { transform: "translateY(0)" }], 180);
  }, [steps]);

  useEffect(() => {
    const key = pendingFocus.current;
    if (key === null) return;
    pendingFocus.current = null;
    (itemRefs.current.get(key) ?? document.querySelector<HTMLElement>("[data-publish]"))?.focus();
  });

  /** Saves the draft after every earlier save, so the server always ends on the latest steps. */
  const persist = (next: Step[]): Promise<string | null> => {
    const saved = saveChain.current
      .then(() => put(`/api/workflows/${flow.id}/draft`, { steps: next }))
      .then(
        () => null,
        (error: unknown) => failureText(error),
      );
    saveChain.current = saved;
    return saved;
  };

  const commit = (next: Step[], focus: string | null, moved: { key: string; top: number } | null = null): void => {
    setSteps(next);
    pendingFocus.current = focus ?? "";
    pendingMove.current = moved;
    void persist(next).then((failure) => {
      setDraftError(failure);
      if (failure !== null) announce(failure);
    });
  };

  const focusItem = (item: TreeItem | undefined): void => {
    if (item) itemRefs.current.get(item.key)?.focus();
  };

  const moveFocused = (item: TreeItem, delta: -1 | 1): void => {
    if (item.kind !== "step" || !item.step) return;
    const target = item.index + delta;
    const siblings = listAt(steps, item.home);
    if (item.isTrigger || (target >= 0 && target < siblings.length && siblings[target]?.type === "trigger")) {
      announce(TRIGGER_STAYS_FIRST);
      return;
    }
    if (target < 0 || target >= siblings.length) return;
    const element = itemRefs.current.get(item.key);
    commit(moveStep(steps, item.step.id, delta), item.key, element ? { key: item.key, top: element.getBoundingClientRect().top } : null);
  };

  const askDelete = (item: TreeItem): void => {
    if (item.kind !== "step" || !item.step) return;
    if (item.isTrigger) announce(TRIGGER_STAYS_FIRST);
    else setDialog({ kind: "delete", id: item.step.id });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLUListElement>): void => {
    const holder = (event.target as HTMLElement).closest<HTMLElement>("[data-key]");
    if (!holder || event.ctrlKey || event.metaKey) return;
    const index = items.findIndex((item) => item.key === holder.dataset.key);
    const item = items[index];
    if (!item) return;
    const handled = (): void => event.preventDefault();
    if (event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
      handled();
      moveFocused(item, event.key === "ArrowUp" ? -1 : 1);
      return;
    }
    if (event.altKey || event.shiftKey) return;
    switch (event.key) {
      case "ArrowDown":
        handled();
        focusItem(items[index + 1]);
        break;
      case "ArrowUp":
        handled();
        focusItem(items[index - 1]);
        break;
      case "Home":
        handled();
        focusItem(items[0]);
        break;
      case "End":
        handled();
        focusItem(items[items.length - 1]);
        break;
      case "ArrowRight": {
        handled();
        const next = items[index + 1];
        if (item.kind === "step" && item.expandable && !item.expanded) setExpanded(new Set([...expanded, item.step!.id]));
        else if (next && next.parentKey === item.key) focusItem(next);
        break;
      }
      case "ArrowLeft":
        handled();
        if (item.parentKey !== null) focusItem(items.find((candidate) => candidate.key === item.parentKey));
        else if (item.expanded) setExpanded(new Set([...expanded].filter((open) => open !== item.step!.id)));
        break;
      case "Insert":
        handled();
        setDialog({ kind: "add", at: item.key });
        break;
      case "Delete":
        handled();
        askDelete(item);
        break;
      case "Enter":
        if (item.kind === "step" && item.step) {
          handled();
          setDialog({ kind: "edit", id: item.step.id });
        }
        break;
      default:
        break;
    }
  };

  const addStep = (type: StepType, name: string, at: string): void => {
    const target = items.find((item) => item.key === at);
    const added = newStep(steps, type, name);
    setDialog(null);
    if (!target) return;
    if (target.kind === "lane") commit(insertStep(steps, target.home, 0, added), stepKey(added.id));
    else commit(insertStep(steps, target.home, target.index + 1, added), stepKey(added.id));
  };

  const deleteStep = (stepId: string): void => {
    const found = findStep(steps, stepId);
    setDialog(null);
    if (!found) return;
    const neighbour = found.siblings[found.index - 1] ?? found.siblings[found.index + 1];
    const fallback = found.home.parent !== null && found.home.lane !== null ? laneKey(found.home.parent, found.home.lane) : null;
    commit(removeStep(steps, stepId), neighbour ? stepKey(neighbour.id) : fallback);
  };

  const saveEdit = async (next: Step): Promise<string | null> => {
    const updated = replaceStep(steps, next);
    const failure = await persist(updated);
    if (failure !== null) return failure;
    setDraftError(null);
    setSteps(updated);
    setDialog(null);
    return null;
  };

  const say = (text: string): void => {
    setPublishText(text);
    announce(text);
  };

  const publish = async (): Promise<void> => {
    if (publishing) return;
    setPublishing(true);
    say("Publishing...");
    const unsaved = await saveChain.current;
    if (unsaved !== null) {
      say(unsaved);
      setPublishing(false);
      return;
    }
    try {
      const { version } = await post<{ version: number }>(`/api/workflows/${flow.id}/publish`);
      setVersions((known) => [...known, version]);
      say(`Version ${version} published.`);
    } catch (error) {
      say(failureText(error));
    }
    setPublishing(false);
  };

  const startTestRun = async (): Promise<void> => {
    setTesting(true);
    setTestError(null);
    setTestRun(null);
    try {
      const { run } = await post<{ run: { id: number } }>(`/api/workflows/${flow.id}/test-run`, { record: testRecord.trim() });
      setTestRun({ id: run.id });
    } catch (error) {
      const message = failureText(error);
      setTestError(message);
      announce(message);
    }
    setTesting(false);
  };

  const dialogStep = dialog && dialog.kind !== "add" ? findStep(steps, dialog.id)?.step : undefined;

  return (
    <Page subject={flow.name} wide>
      <Rest className="flow-bar">
        <div className="flow-meta">
          <StatusBlock outlined>{flow.kind === "subflow" ? "Subflow" : "Flow"}</StatusBlock>
          <p className="muted">{versions.length > 0 ? `Published versions: ${versions.join(", ")}` : "Not published yet"}</p>
        </div>
        <div className="flow-actions">
          <label className="flow-test-record">
            <span className="field-label">Test record</span>
            <input type="text" value={testRecord} onChange={(event) => setTestRecord(event.target.value)} autoComplete="off" />
          </label>
          <Button variant="outline" busy={testing} disabled={testing} onClick={() => void startTestRun()}>
            Test run
          </Button>
          <Button data-publish="" busy={publishing} onClick={() => void publish()}>
            Publish
          </Button>
        </div>
        {testRun ? (
          <p>
            <Link to={`/desk/runs/${testRun.id}`}>Open run {testRun.id}</Link>
          </p>
        ) : null}
        {testError ? <p className="form-error">{testError}</p> : null}
        {publishText ? <p className="flow-status">{publishText}</p> : null}
        {draftError ? <p className="form-error">{draftError}</p> : null}
      </Rest>
      <div className="flow-split">
        <Rest className="flow-canvas">
          {items.length === 0 ? <p className="muted">This flow has no steps yet.</p> : null}
          <TreeView items={items} steps={steps} tabKey={tabKey} itemRefs={itemRefs} onKeyDown={onKeyDown} onFocusKey={setFocusKey} onEdit={(stepId) => setDialog({ kind: "edit", id: stepId })} onToggle={(stepId) => setExpanded((open) => (open.has(stepId) ? new Set([...open].filter((x) => x !== stepId)) : new Set([...open, stepId])))} />
        </Rest>
        <Rest className="flow-detail">
          <StepPanel
            item={current}
            onInsert={() => current && setDialog({ kind: "add", at: current.key })}
            onEdit={() => current?.step && current.kind === "step" && setDialog({ kind: "edit", id: current.step.id })}
            onMove={(delta) => current && moveFocused(current, delta)}
            onDelete={() => current && askDelete(current)}
          />
        </Rest>
      </div>
      {dialog?.kind === "add" ? <AddStepDialog onAdd={(type, name) => addStep(type, name, dialog.at)} onClose={() => setDialog(null)} /> : null}
      {dialog?.kind === "delete" && dialogStep ? <DeleteStepDialog step={dialogStep} onDelete={() => deleteStep(dialogStep.id)} onClose={() => setDialog(null)} /> : null}
      {dialog?.kind === "edit" && dialogStep ? <EditStepDialog step={dialogStep} onSave={saveEdit} onClose={() => setDialog(null)} /> : null}
    </Page>
  );
}

interface TreeViewProps {
  items: TreeItem[];
  steps: Step[];
  tabKey: string | null;
  itemRefs: { current: Map<string, HTMLElement> };
  onKeyDown: (event: KeyboardEvent<HTMLUListElement>) => void;
  onFocusKey: (key: string) => void;
  onEdit: (stepId: string) => void;
  onToggle: (stepId: string) => void;
}

function TreeView({ items, steps, tabKey, itemRefs, onKeyDown, onFocusKey, onEdit, onToggle }: TreeViewProps): JSX.Element {
  const byKey = new Map(items.map((item) => [item.key, item]));

  const renderItem = (item: TreeItem): JSX.Element => {
    const step = item.step!;
    const label = item.kind === "lane" ? LANE_LABELS[item.lane!] : `${step.name}, ${TYPE_LABELS[step.type]}`;
    const selected = item.key === tabKey;
    return (
      <div
        ref={(element) => {
          if (element) itemRefs.current.set(item.key, element);
          else itemRefs.current.delete(item.key);
        }}
        role="treeitem"
        data-key={item.key}
        aria-label={label}
        aria-level={item.level}
        aria-setsize={item.size}
        aria-posinset={item.index + 1}
        aria-selected={selected}
        aria-expanded={item.kind === "step" && item.expandable ? item.expanded : undefined}
        tabIndex={selected ? 0 : -1}
        className={`flow-item ${item.kind === "lane" ? "flow-lane-item" : ""} ${selected ? "is-selected" : ""}`}
        onDoubleClick={item.kind === "step" ? () => onEdit(step.id) : undefined}
      >
        {item.kind === "lane" ? (
          <span className="flow-lane-word">{LANE_LABELS[item.lane!]}</span>
        ) : (
          <>
            <span className="flow-type">{TYPE_LABELS[step.type]}</span>
            <span className="flow-name">{step.name}</span>
            {item.expandable ? (
              <span className="flow-toggle" aria-hidden="true" onClick={() => onToggle(step.id)}>
                {item.expanded ? "Hide lanes" : `${lanesOf(step).length} lanes`}
              </span>
            ) : null}
          </>
        )}
      </div>
    );
  };

  const renderList = (list: Step[]): JSX.Element[] =>
    list.map((step) => {
      const item = byKey.get(stepKey(step.id))!;
      return (
        <li key={step.id} role="none" className="flow-step">
          {renderItem(item)}
          {item.expanded ? (
            <ul role="none" className="flow-lanes" style={{ "--lanes": lanesOf(step).length } as CSSProperties}>
              {lanesOf(step).map((lane) => renderLane(step, lane))}
            </ul>
          ) : null}
        </li>
      );
    });

  const renderLane = (step: Step, lane: LaneName): JSX.Element => {
    const item = byKey.get(laneKey(step.id, lane))!;
    const inside = laneSteps(step, lane);
    return (
      <li key={lane} role="none" className="flow-lane">
        {renderItem(item)}
        {inside.length > 0 ? (
          <ul role="none" className="flow-steps">
            {renderList(inside)}
          </ul>
        ) : (
          <p className="flow-empty muted">Empty. Press Insert to add a step.</p>
        )}
      </li>
    );
  };

  return (
    <ul role="tree" aria-label="Flow steps" className="flow-steps flow-tree" onKeyDown={onKeyDown} onFocus={(event) => {
      const holder = (event.target as HTMLElement).closest<HTMLElement>("[data-key]");
      if (holder?.dataset.key) onFocusKey(holder.dataset.key);
    }}>
      {renderList(steps)}
    </ul>
  );
}

function StepPanel({ item, onInsert, onEdit, onMove, onDelete }: { item: TreeItem | null; onInsert: () => void; onEdit: () => void; onMove: (delta: -1 | 1) => void; onDelete: () => void }): JSX.Element {
  if (!item || !item.step) return <p className="muted">Select a step to see its details.</p>;
  const step = item.step;
  const isLane = item.kind === "lane";
  return (
    <aside aria-label="Step details" className="stack">
      <h2 className="flow-detail-title">{isLane ? LANE_LABELS[item.lane!] : step.name}</h2>
      <div>
        <StatusBlock>{isLane ? `Lane of ${step.name}` : TYPE_LABELS[step.type]}</StatusBlock>
      </div>
      {isLane ? (
        <p className="muted">{laneSteps(step, item.lane!).length} steps in this lane.</p>
      ) : (
        <dl className="flow-rows">
          {detailRows(step).map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      )}
      <div className="row">
        <Button variant="outline" onClick={onInsert}>
          Insert step
        </Button>
        {isLane ? null : (
          <>
            <Button variant="outline" onClick={onEdit}>
              Edit
            </Button>
            <Button variant="outline" onClick={() => onMove(-1)}>
              Move up
            </Button>
            <Button variant="outline" onClick={() => onMove(1)}>
              Move down
            </Button>
            <Button variant="outline" onClick={onDelete}>
              Remove step
            </Button>
          </>
        )}
      </div>
    </aside>
  );
}
