import { useRef, useState } from "preact/hooks";
import { api, get } from "../api";
import { useMount, useResource } from "../hooks";
import { Icon } from "../icons";
import { reducedMotion, tween } from "../motion";
import { configStore, openModal } from "../store";
import type { Goal, Me } from "../types";
import { Dialog, FieldError, Pill, useBusy } from "../ui";
import { EmptyState, LoadingBlock } from "./NotFound";

function Progress({ goal }: { goal: Goal }) {
  const bar = useRef<HTMLDivElement>(null);
  const shown = useRef<number | null>(null);
  useMount(() => {
    const el = bar.current!;
    const paint = (value: number) => {
      shown.current = value;
      el.dataset.shownPercent = value.toFixed(2);
      el.style.setProperty("--shown", `${value}%`);
    };
    if (shown.current === null || reducedMotion()) return void paint(goal.progress);
    const from = shown.current;
    const running = tween(configStore.get().progressMs, (eased) => paint(from + (goal.progress - from) * eased), () => undefined);
    return () => running.cancel();
  }, [goal.progress]);
  return (
    <div ref={bar} class="progress" role="progressbar" aria-label={`${goal.name} progress`} aria-valuemin={0} aria-valuemax={100}
      aria-valuenow={goal.percent} aria-valuetext={`${goal.percent}% complete`}>
      <div class="progress-fill" />
    </div>
  );
}

function GoalDialog({ goal, hasChildren, close, reload }: { goal: Goal; hasChildren: boolean; close: () => void; reload: () => void }) {
  const [weight, setWeight] = useState(String(goal.weight));
  const [manual, setManual] = useState(String(goal.manualValue));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, run] = useBusy();
  const save = (event: Event) => {
    event.preventDefault();
    void run(async () => {
      const result = await api("PATCH", `/api/goals/${goal.id}`, { weight: Number(weight), ...(hasChildren ? {} : { manualValue: Number(manual) }) });
      setErrors(result.errors);
      if (result.ok) {
        reload();
        close();
      }
    });
  };
  return (
    <Dialog label={`Goal: ${goal.name}`} onClose={close}>
      <form onSubmit={save} noValidate>
        <h2>{goal.name}</h2>
        <p class="muted num">{`${goal.percent}% complete`}</p>
        <div class="field">
          <label for="goal-weight">Weight</label>
          <input id="goal-weight" type="number" min={1} max={10} step={1} data-autofocus value={weight} aria-invalid={errors.weight ? "true" : undefined}
            aria-describedby={errors.weight ? "goal-weight-error" : undefined} onInput={(e) => setWeight((e.target as HTMLInputElement).value)} />
          <FieldError id="goal-weight-error" text={errors.weight} />
        </div>
        <div class="field">
          <label for="goal-manual">Manual value</label>
          <input id="goal-manual" type="number" min={0} max={100} step="any" value={manual} disabled={hasChildren} aria-invalid={errors.manualValue ? "true" : undefined}
            aria-describedby={errors.manualValue ? "goal-manual-error" : hasChildren ? "goal-manual-hint" : undefined} onInput={(e) => setManual((e.target as HTMLInputElement).value)} />
          {hasChildren && <p id="goal-manual-hint" class="muted">Progress comes from its sub-goals and linked projects.</p>}
          <FieldError id="goal-manual-error" text={errors.manualValue} />
        </div>
        {goal.projects.length > 0 && (
          <ul class="plain-list muted">{goal.projects.map((p) => <li key={p.projectId}>{`${p.name}, weight ${p.weight}`}</li>)}</ul>
        )}
        <div class="dialog-actions">
          <Pill type="submit" busy={busy} onClick={save}>Save goal</Pill>
          <Pill kind="outline" onClick={close}>Close goal</Pill>
        </div>
      </form>
    </Dialog>
  );
}

function NewGoalDialog({ teamId, goals, close, reload }: { teamId: string; goals: Goal[]; close: () => void; reload: () => void }) {
  const [name, setName] = useState("");
  const [parent, setParent] = useState("");
  const [weight, setWeight] = useState("1");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, run] = useBusy();
  const create = (event: Event) => {
    event.preventDefault();
    void run(async () => {
      const result = await api("POST", `/api/teams/${teamId}/goals`, { name, weight: Number(weight), ...(parent ? { parentId: parent } : {}) });
      setErrors(result.errors);
      if (result.ok) {
        reload();
        close();
      }
    });
  };
  return (
    <Dialog label="New goal" onClose={close}>
      <form onSubmit={create} noValidate>
        <h2>New goal</h2>
        <div class="field">
          <label for="new-goal-name">Goal name</label>
          <input id="new-goal-name" data-autofocus value={name} aria-invalid={errors.name ? "true" : undefined}
            aria-describedby={errors.name ? "new-goal-name-error" : undefined} onInput={(e) => setName((e.target as HTMLInputElement).value)} />
          <FieldError id="new-goal-name-error" text={errors.name} />
        </div>
        <div class="field">
          <label for="new-goal-parent">Parent goal</label>
          <select id="new-goal-parent" value={parent} onChange={(e) => setParent((e.target as HTMLSelectElement).value)}>
            <option value="">No parent</option>
            {goals.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        </div>
        <div class="field">
          <label for="new-goal-weight">Weight</label>
          <input id="new-goal-weight" type="number" min={1} max={10} step={1} value={weight} aria-invalid={errors.weight ? "true" : undefined}
            aria-describedby={errors.weight ? "new-goal-weight-error" : undefined} onInput={(e) => setWeight((e.target as HTMLInputElement).value)} />
          <FieldError id="new-goal-weight-error" text={errors.weight} />
        </div>
        <div class="dialog-actions">
          <Pill type="submit" busy={busy} onClick={create}>Create goal</Pill>
          <Pill kind="outline" onClick={close}>Cancel</Pill>
        </div>
      </form>
    </Dialog>
  );
}

const byName = (a: Goal, b: Goal) => a.name.localeCompare(b.name);

export function Goals({ me }: { me: Me }) {
  const goals = useResource<Goal[]>(async () => {
    const all: Goal[] = [];
    for (const team of me.teams) {
      const result = await get<{ goals: Goal[] }>(`/api/teams/${team.id}/goals`);
      if (!result.ok) return undefined;
      all.push(...result.data.goals);
    }
    return all;
  }, [me.id], (e) => ["goals", "tasks", "structure"].includes(e.t));
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const tree = useRef<HTMLUListElement>(null);

  if (!goals.data) return <div class="page"><h1>Goals</h1><LoadingBlock reload={goals.reload} /></div>;
  const all = goals.data;
  const childrenOf = (id: string | null) => all.filter((g) => g.parentId === id).sort(byName);
  const tops = childrenOf(null);
  const team = me.teams[0];

  const visible = (): Goal[] => {
    const walk = (list: Goal[]): Goal[] => list.flatMap((g) => [g, ...(collapsed.includes(g.id) ? [] : walk(childrenOf(g.id)))]);
    return walk(tops);
  };
  const focusGoal = (id: string) => tree.current?.querySelector<HTMLElement>(`[data-goal="${id}"]`)?.focus();
  const openGoal = (goal: Goal) => {
    openModal((close) => <GoalDialog goal={goal} hasChildren={childrenOf(goal.id).length > 0 || goal.projects.length > 0} close={close} reload={goals.reload} />);
  };

  const keydown = (event: KeyboardEvent) => {
    const el = (event.target as HTMLElement).closest<HTMLElement>('[role="treeitem"]');
    if (!el || event.target !== el) return;
    const goal = all.find((g) => g.id === el.dataset.goal)!;
    const list = visible();
    const at = list.findIndex((g) => g.id === goal.id);
    const kids = childrenOf(goal.id);
    const handled = () => event.preventDefault();
    if (event.key === "ArrowDown" && list[at + 1]) { handled(); focusGoal(list[at + 1].id); }
    else if (event.key === "ArrowUp" && list[at - 1]) { handled(); focusGoal(list[at - 1].id); }
    else if (event.key === "ArrowRight" && kids.length) {
      handled();
      if (collapsed.includes(goal.id)) setCollapsed(collapsed.filter((c) => c !== goal.id));
      else focusGoal(kids[0].id);
    } else if (event.key === "ArrowLeft") {
      handled();
      if (kids.length && !collapsed.includes(goal.id)) setCollapsed([...collapsed, goal.id]);
      else if (goal.parentId) focusGoal(goal.parentId);
    } else if (event.key === "Enter" || event.key === " ") { handled(); openGoal(goal); }
    else if (event.key === "Home") { handled(); focusGoal(list[0].id); }
    else if (event.key === "End") { handled(); focusGoal(list[list.length - 1].id); }
  };

  const node = (goal: Goal, level: number) => {
    const kids = childrenOf(goal.id);
    const open = !collapsed.includes(goal.id);
    const current = (active ?? tops[0]?.id) === goal.id;
    return (
      <li key={goal.id} role="none">
        <div role="treeitem" data-goal={goal.id} aria-level={level} aria-label={`${goal.name}, ${goal.percent}% complete`}
          aria-expanded={kids.length ? open : undefined} aria-owns={kids.length > 0 && open ? `goal-group-${goal.id}` : undefined}
          tabIndex={current ? 0 : -1} onFocus={(e) => { if (e.target === e.currentTarget) setActive(goal.id); }}>
          <div class="node-row" onClick={(e) => { e.stopPropagation(); openGoal(goal); }}>
            <span class="node-name">{goal.name}</span>{" "}
            <span class="muted num">{`${goal.percent}%`}</span>
            <Progress goal={goal} />
          </div>
        </div>
        {kids.length > 0 && open && <ul role="group" id={`goal-group-${goal.id}`}>{kids.map((k) => node(k, level + 1))}</ul>}
      </li>
    );
  };

  return (
    <div class="page goals-page">
      <div class="section-head">
        <h1>Goals</h1>
        <Pill onClick={() => openModal((close) => <NewGoalDialog teamId={team.id} goals={all} close={close} reload={goals.reload} />)}>New goal</Pill>
      </div>
      {tops.length === 0 ? (
        <EmptyState title="No goals yet. Press New goal to add the first." />
      ) : (
        <>
          <div class="link-stack">
            {tops.map((goal) => (
              <a key={goal.id} class="link-card" href={`/goals?goal=${goal.id}`} aria-label={`Open ${goal.name}`}
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); openGoal(goal); }}>
                <span class="link-text"><span class="link-title">{goal.name}</span><span class="link-sub muted num" data-text={`${goal.percent}% complete`} /></span>
                <span class="round-arrow" aria-hidden="true"><Icon name="arrow-right" size={22} /></span>
              </a>
            ))}
          </div>
          <h2 class="tree-title">Goal tree</h2>
          <ul role="tree" aria-label="Goals" class="goal-tree" ref={tree} onKeyDown={keydown}>{tops.map((g) => node(g, 1))}</ul>
        </>
      )}
    </div>
  );
}
