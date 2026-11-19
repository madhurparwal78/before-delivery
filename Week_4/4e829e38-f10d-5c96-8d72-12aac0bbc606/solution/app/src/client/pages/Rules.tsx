import { useRef, useState } from "preact/hooks";
import { api, get } from "../api";
import { useMount, useResource } from "../hooks";
import { Icon } from "../icons";
import { announce, openModal } from "../store";
import type { ProjectInfo, Rule } from "../types";
import { Dialog, FieldError, Pill, Status, useBusy } from "../ui";
import { EmptyState, LoadingBlock } from "./NotFound";
import { navigate } from "../router";

const TRIGGERS = [["task_added", "Task added"], ["field_changed", "Field changed"], ["moved_to_section", "Moved to section"], ["due_date_arrives", "Due date arrives"], ["approval_decided", "Approval decided"]];
const CONDITIONS = [["", "Always"], ["is", "is"], ["is_not", "is not"], ["is_blank", "is blank"], ["is_greater_than", "is greater than"]];
const ACTIONS = [["set_field", "Set field"], ["move_to_section", "Move to section"], ["assign_to", "Assign to"], ["add_subtask", "Add subtask"], ["send_to_inbox", "Send to inbox"]];
const BUILT_IN = [["assignee", "Assignee"], ["start", "Start"], ["due", "Due"], ["effort", "Effort"]];

interface Answers {
  name: string; when: string; field: string; value: string; condition: string; conditionField: string; conditionValue: string;
  then: string; target: string; actionValue: string;
}
const EMPTY: Answers = { name: "", when: "", field: "", value: "", condition: "", conditionField: "", conditionValue: "", then: "", target: "", actionValue: "" };

interface Recipe { name: string; value: string; example: string; hue: string; answers: (p: ProjectInfo) => Partial<Answers> }

const sectionNamed = (p: ProjectInfo, name: string) => p.sections.find((s) => s.name === name)?.id ?? "";
const fieldNamed = (p: ProjectInfo, name: string) => p.fields.find((f) => f.name === name)?.id ?? "";

const RECIPES: Recipe[] = [
  { name: "Welcome every new task", value: "Tell the right person about each task the moment it is added.", example: "Task added, send to inbox", hue: "#FFC7F2",
    answers: () => ({ name: "Welcome every new task", when: "task_added", then: "send_to_inbox" }) },
  { name: "Ready moves to review", value: "Move a task to review as soon as its stage says Ready.", example: "Stage changes to Ready, move to Review", hue: "#F95A4E",
    answers: (p) => ({ name: "Ready moves to review", when: "field_changed", field: fieldNamed(p, "Stage"), value: "Ready", then: "move_to_section", target: sectionNamed(p, "Review") }) },
  { name: "High priority notice", value: "Raise a flag when priority turns High.", example: "Priority changes to High, send to inbox", hue: "#C9B6FF",
    answers: (p) => ({ name: "High priority notice", when: "field_changed", field: fieldNamed(p, "Priority"), value: "High", then: "send_to_inbox" }) },
  { name: "Doing needs an owner", value: "Ask for an owner whenever work starts.", example: "Moved to Doing, send to inbox", hue: "#FFD9A0",
    answers: (p) => ({ name: "Doing needs an owner", when: "moved_to_section", value: sectionNamed(p, "Doing"), then: "send_to_inbox" }) },
  { name: "Due day checklist", value: "Add a checklist subtask when a task's due day arrives.", example: "Due date arrives, add subtask Check supplies", hue: "#A6E3E9",
    answers: () => ({ name: "Due day checklist", when: "due_date_arrives", then: "add_subtask", actionValue: "Check supplies" }) },
  { name: "Decision follow-up", value: "Move decided tasks to Done.", example: "Approval decided, move to Done", hue: "#B8F0C2",
    answers: (p) => ({ name: "Decision follow-up", when: "approval_decided", then: "move_to_section", target: sectionNamed(p, "Done") }) },
];

function Blob({ hue }: { hue: string }) {
  return (
    <svg class="blob" width="96" height="96" viewBox="0 0 96 96" aria-hidden="true" focusable="false">
      <defs>
        <radialGradient id={`blob-${hue.slice(1)}`} cx="35%" cy="30%" r="75%">
          <stop offset="0" stop-color="#fff" stop-opacity=".95" />
          <stop offset=".35" stop-color={hue} />
          <stop offset="1" stop-color="#0D0D0D" stop-opacity=".35" />
        </radialGradient>
      </defs>
      <ellipse cx="48" cy="86" rx="26" ry="5" fill="#0D0D0D" opacity=".12" />
      <path d="M48 10c20 0 36 14 36 34s-14 38-36 38S12 66 12 46 28 10 48 10Z" fill={`url(#blob-${hue.slice(1)})`} />
      <circle cx="38" cy="46" r="3" fill="#0D0D0D" /><circle cx="58" cy="46" r="3" fill="#0D0D0D" />
      <path d="M40 58q8 7 16 0" stroke="#0D0D0D" stroke-width="2.5" fill="none" stroke-linecap="round" />
    </svg>
  );
}

function sentence(a: Answers, p: ProjectInfo): string {
  const label = (key: string) => BUILT_IN.find(([k]) => k === key)?.[1] ?? p.fields.find((f) => f.id === key)?.name ?? "a field";
  const section = (id: string) => p.sections.find((s) => s.id === id)?.name ?? "a section";
  const when = a.when === "task_added" ? "a task is added" : a.when === "field_changed" ? `${a.field ? label(a.field) : "a field"} changes${a.value ? ` to ${a.value}` : ""}`
    : a.when === "moved_to_section" ? `a task moves to ${a.value ? section(a.value) : "a section"}` : a.when === "due_date_arrives" ? "a due date arrives"
    : a.when === "approval_decided" ? "an approval is decided" : "…";
  const cond = a.condition ? `, and ${label(a.conditionField)} ${CONDITIONS.find(([k]) => k === a.condition)?.[1]}${a.condition === "is_blank" ? "" : ` ${a.conditionValue || "…"}`}` : "";
  const then = a.then === "set_field" ? `set ${a.target ? label(a.target) : "a field"} to ${a.actionValue || "…"}` : a.then === "move_to_section" ? `move it to ${a.target ? section(a.target) : "a section"}`
    : a.then === "assign_to" ? `assign it to ${p.members.find((m) => m.id === a.target)?.name ?? "someone"}` : a.then === "add_subtask" ? `add the subtask ${a.actionValue || "…"}`
    : a.then === "send_to_inbox" ? "send a message to the inbox" : "…";
  return `When ${when}${cond}, ${then}.`;
}

function toRule(a: Answers): { trigger: unknown; condition: unknown; action: unknown } {
  const trigger = a.when === "field_changed" ? { type: a.when, field: a.field, ...(a.value ? { value: a.value } : {}) }
    : a.when === "moved_to_section" ? { type: a.when, section: a.value } : a.when ? { type: a.when } : null;
  const condition = a.condition ? { field: a.conditionField, op: a.condition, ...(a.condition === "is_blank" ? {} : { value: a.conditionValue }) } : undefined;
  const action = a.then === "set_field" ? { type: a.then, target: a.target, value: a.actionValue }
    : a.then === "move_to_section" || a.then === "assign_to" ? { type: a.then, target: a.target }
    : a.then === "add_subtask" ? { type: a.then, value: a.actionValue }
    : a.then === "send_to_inbox" ? { type: a.then, ...(a.actionValue ? { value: a.actionValue } : {}) } : null;
  return { trigger, condition, action };
}

function Select({ id, label, value, onChange, options, placeholder, error }: {
  id: string; label: string; value: string; onChange: (v: string) => void; options: string[][]; placeholder?: string; error?: string;
}) {
  return (
    <div class="field">
      <label for={id}>{label}</label>
      <select id={id} value={value} aria-invalid={error ? "true" : undefined} aria-describedby={error ? `${id}-error` : undefined}
        onChange={(e) => onChange((e.target as HTMLSelectElement).value)}>
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
      <FieldError id={`${id}-error`} text={error} />
    </div>
  );
}

function RuleDialog({ project, initial, close, onSaved }: { project: ProjectInfo; initial: Partial<Answers>; close: () => void; onSaved: (name: string) => void }) {
  const [a, setA] = useState<Answers>({ ...EMPTY, ...initial });
  const [open, setOpen] = useState<1 | 2 | 3>(1);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, run] = useBusy();
  const set = (patch: Partial<Answers>) => setA({ ...a, ...patch });
  const fieldChoices = [...BUILT_IN, ...project.fields.filter((f) => f.type !== "formula").map((f): string[] => [f.id, f.name])];
  const chosenField = project.fields.find((f) => f.id === a.field);
  const valueChoices: string[][] = a.when === "moved_to_section" ? project.sections.map((s) => [s.id, s.name])
    : a.field === "assignee" ? project.members.map((m) => [m.id, m.name]) : (chosenField?.options ?? []).map((o) => [o, o]);
  const targetChoices: string[][] = a.then === "move_to_section" ? project.sections.map((s) => [s.id, s.name])
    : a.then === "assign_to" ? project.members.map((m) => [m.id, m.name]) : fieldChoices;
  const showTarget = ["set_field", "move_to_section", "assign_to"].includes(a.then);
  const showActionValue = ["set_field", "add_subtask", "send_to_inbox"].includes(a.then);

  const save = (event: Event) => {
    event.preventDefault();
    void run(async () => {
      const found: Record<string, string> = {};
      if (!a.name.trim()) found.name = "Enter a rule name";
      const body = toRule(a);
      if (!body.trigger) found.trigger = "Choose when the rule runs";
      if (!body.action) found.action = "Choose what happens";
      if (Object.keys(found).length) return setErrors(found);
      const result = await api("POST", `/api/projects/${project.id}/rules`, { name: a.name, ...body });
      setErrors(result.errors);
      if (result.ok) {
        close();
        onSaved(a.name.trim());
      }
    });
  };

  const step = (n: 1 | 2 | 3, title: string, children: preact.ComponentChildren) => (
    <section class={`step${open === n ? " is-open" : ""}`}>
      <h3 class="step-head">
        <button type="button" id={`step-button-${n}`} aria-expanded={open === n} aria-controls={`step-body-${n}`} onClick={() => setOpen(n)}>
          <span>{`Step ${n}: ${title}`}</span><Icon name="chevron-down" size={22} />
        </button>
      </h3>
      <div id={`step-body-${n}`} class="step-body" role="region" aria-labelledby={`step-button-${n}`}>
        <div class="step-inner">{children}</div>
      </div>
    </section>
  );

  return (
    <Dialog label="New rule" onClose={close} class="rule-dialog">
      <form onSubmit={save} noValidate>
        <h2>New rule</h2>
        <div class="field">
          <label for="rule-name">Rule name</label>
          <input id="rule-name" value={a.name} aria-invalid={errors.name ? "true" : undefined} aria-describedby={errors.name ? "rule-name-error" : undefined}
            onInput={(e) => set({ name: (e.target as HTMLInputElement).value })} />
          <FieldError id="rule-name-error" text={errors.name} />
        </div>
        <div class="rule-layout">
          <div class="steps">
            {step(1, "When", <>
              <Select id="rule-when" label="When" value={a.when} placeholder="Pick a trigger" options={TRIGGERS} error={errors.trigger}
                onChange={(v) => set({ when: v, field: "", value: "" })} />
              {a.when === "field_changed" && <Select id="rule-field" label="Field" value={a.field} placeholder="Choose a field" options={fieldChoices} onChange={(v) => set({ field: v, value: "" })} />}
              {(a.when === "field_changed" || a.when === "moved_to_section") && (
                <Select id="rule-value" label="Value" value={a.value} placeholder={a.when === "field_changed" ? "Any value" : "Choose a section"} options={valueChoices} onChange={(v) => set({ value: v })} />
              )}
            </>)}
            {step(2, "Condition", <>
              <Select id="rule-condition" label="Condition" value={a.condition} options={CONDITIONS} onChange={(v) => set({ condition: v })} />
              {a.condition !== "" && <>
                <Select id="rule-condition-field" label="Condition field" value={a.conditionField} placeholder="Choose a field" options={fieldChoices} onChange={(v) => set({ conditionField: v })} />
                <div class="field">
                  <label for="rule-condition-value">Condition value</label>
                  <input id="rule-condition-value" value={a.conditionValue} onInput={(e) => set({ conditionValue: (e.target as HTMLInputElement).value })} />
                </div>
              </>}
            </>)}
            {step(3, "Then", <>
              <Select id="rule-then" label="Then" value={a.then} placeholder="Pick an action" options={ACTIONS} error={errors.action} onChange={(v) => set({ then: v, target: "" })} />
              {showTarget && <Select id="rule-target" label="Target" value={a.target} placeholder="Choose a target" options={targetChoices} onChange={(v) => set({ target: v })} />}
              {showActionValue && (
                <div class="field">
                  <label for="rule-action-value">Action value</label>
                  <input id="rule-action-value" value={a.actionValue} onInput={(e) => set({ actionValue: (e.target as HTMLInputElement).value })} />
                </div>
              )}
            </>)}
          </div>
          <aside class="rule-preview" aria-label="Rule preview"><p class="preview-label">In plain words</p><p class="preview-text">{sentence(a, project)}</p></aside>
        </div>
        <div class="dialog-actions">
          <Pill kind="light" type="submit" busy={busy} onClick={save}>Save rule</Pill>
          <Pill kind="darkoutline" onClick={close}>Cancel</Pill>
        </div>
      </form>
    </Dialog>
  );
}

function Recipes({ onUse }: { onUse: (recipe: Recipe) => void }) {
  const [index, setIndex] = useState(0);
  const track = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(3);
  useMount(() => {
    const measure = () => {
      const width = track.current?.parentElement?.clientWidth ?? 0;
      setVisible(Math.max(1, Math.floor((width + 24) / (304 + 24))));
    };
    measure();
    addEventListener("resize", measure);
    return () => removeEventListener("resize", measure);
  }, []);
  const last = Math.max(0, RECIPES.length - visible);
  return (
    <section class="recipes" role="region" aria-label="Rule recipes">
      <div class="recipes-head">
        <h2>Start from a recipe</h2>
        <div class="round-pair">
          <button type="button" class="round-button" aria-label="Previous recipes" disabled={index === 0} onClick={() => setIndex(Math.max(0, index - 1))}><Icon name="arrow-right" size={20} /></button>
          <button type="button" class="round-button" aria-label="Next recipes" disabled={index >= last} onClick={() => setIndex(Math.min(last, index + 1))}><Icon name="arrow-right" size={20} /></button>
        </div>
      </div>
      <div class="recipe-viewport">
        <div class="recipe-track" ref={track} style={{ transform: `translateX(${-index * (304 + 24)}px)` }}>
          {RECIPES.map((recipe) => (
            <article class="recipe-card" key={recipe.name}>
              <Blob hue={recipe.hue} />
              <h3>{recipe.name}</h3>
              <p>{recipe.value}</p>
              <p class="muted">{recipe.example}</p>
              <Pill kind="outline" onClick={() => onUse(recipe)}>{`Use recipe: ${recipe.name}`}</Pill>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function describe(rule: Rule, p: ProjectInfo): string {
  const a: Answers = {
    ...EMPTY, when: rule.trigger.type, field: rule.trigger.field ?? "", value: String(rule.trigger.type === "moved_to_section" ? rule.trigger.section ?? "" : rule.trigger.value ?? ""),
    condition: rule.condition?.op ?? "", conditionField: rule.condition?.field ?? "", conditionValue: String(rule.condition?.value ?? ""),
    then: rule.action.type, target: rule.action.target ?? "", actionValue: String(rule.action.value ?? ""),
  };
  return sentence(a, p);
}

export function RulesPage({ projectId }: { projectId: string }) {
  const project = useResource<ProjectInfo | "missing">(async () => {
    const r = await get<ProjectInfo>(`/api/projects/${projectId}`);
    return r.status === 404 ? "missing" : r.ok ? r.data : undefined;
  }, [projectId], (e) => e.t === "structure" && e.project === projectId);
  const rules = useResource<Rule[]>(async () => {
    const r = await get<{ rules: Rule[] }>(`/api/projects/${projectId}/rules`);
    return r.ok ? r.data.rules : undefined;
  }, [projectId], (e) => e.t === "rules" && e.project === projectId);
  const newRule = useRef<HTMLButtonElement>(null);

  if (project.data === "missing") {
    return <div class="page narrow"><EmptyState level={1} title="Project not found" action="Back to My work" onAction={() => navigate("/")} /></div>;
  }
  if (!project.data) return <div class="page"><LoadingBlock reload={project.reload} /></div>;
  const p = project.data;
  const openDialog = (initial: Partial<Answers>) => openModal((close) => (
    <RuleDialog project={p} initial={initial} close={close} onSaved={(name) => { announce("Rules status", `Rule saved: ${name}`); rules.reload(); }} />
  ));
  return (
    <div class="page rules-page">
      <div class="section-head">
        <h1>{`${p.name} rules`}</h1>
        <button ref={newRule} type="button" class="pill pill-ink" onClick={() => openDialog({})}>New rule</button>
      </div>
      <nav class="chip-row" aria-label="Project navigation">
        {[["List", `/projects/${projectId}`], ["Board", `/projects/${projectId}?view=board`], ["Timeline", `/projects/${projectId}?view=timeline`], ["Workload", `/workload/${p.teamId}`]].map(([label, href]) => (
          <a key={label} class="chip chip-link" href={href}>{label}</a>
        ))}
        <a class="chip chip-link is-active" href={`/projects/${projectId}/rules`} aria-current="page">Rules</a>
      </nav>
      <Status name="Rules status" />
      <Recipes onUse={(recipe) => openDialog(recipe.answers(p))} />
      <section aria-labelledby="rule-list-title">
        <h2 id="rule-list-title">Rules in firing order</h2>
        {rules.data && rules.data.length === 0 ? (
          <EmptyState title="No rules yet. Start from a recipe or press New rule." />
        ) : (
          <ol class="rule-list">
            {rules.data?.map((rule) => (
              <li key={rule.id} class="rule-item card">
                <span class="rule-position num">{rule.position}</span>
                <div><p class="strong">{rule.name}</p><p class="muted">{describe(rule, p)}</p></div>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
