import { h, clear, api, announce, openDialog, toastHost } from './dom';
import { me } from './live';
import { renderTopbar } from './topbar';
import { ProjectData, RuleRecord } from './types';

interface RuleForm {
  name: string;
  triggerType: string;
  field?: string;
  value?: string;
  section?: string;
  conditionOp?: string;
  conditionField?: string;
  conditionValue?: string;
  actionType: string;
  target?: string;
  actionValue?: string;
}

const RECIPES: { name: string; value: string; example: string; form: RuleForm }[] = [
  { name: 'Ready to review', value: 'Move work along by its stage', example: 'Stage becomes Ready, the task moves to Review',
    form: { name: 'Ready to review', triggerType: 'field_changed', actionType: 'move_to_section' } },
  { name: 'Owner flags', value: 'Flag work by who owns it', example: 'Assignee is set, Priority becomes High',
    form: { name: 'Owner flags', triggerType: 'field_changed', field: 'assignee', actionType: 'set_field', value: 'High' } },
  { name: 'Incoming requests', value: 'Welcome every new task', example: 'Task added in To do, send it to the inbox',
    form: { name: 'Incoming requests', triggerType: 'task_added', actionType: 'send_to_inbox' } },
];

export async function renderRules(root: HTMLElement): Promise<void> {
  const who = await me();
  if (!who) { window.location.href = '/account'; return; }
  const pid = window.location.pathname.split('/').filter(Boolean)[1] ?? '';
  const projRes = await api<ProjectData>('GET', `/api/projects/${pid}`);
  if (projRes.status === 404) {
    clear(root);
    root.append(h('main', { class: 'empty', style: 'margin:60px auto;max-width:560px' }, h('h1', {}, 'Project not found'), h('a', { class: 'pill primary', href: '/' }, 'My work')));
    return;
  }
  const proj = projRes.data;
  const rulesRes = await api<{ rules: RuleRecord[] }>('GET', `/api/projects/${pid}/rules`);
  const rules = (rulesRes.data.rules ?? []).sort((a, b) => a.position - b.position);

  clear(root);
  renderTopbar(root, { personName: who.name, unread: 0, active: null });

  const main = h('main', { class: 'viewbody', style: 'max-width:1100px;margin:0 auto' });
  main.append(h('h1', {}, `Rules for ${proj.name}`));

  /* recipe carousel */
  const recipes = h('div', { class: 'recipes', role: 'region', 'aria-label': 'Rule recipes' });
  let recipeIdx = 0;
  const prev = h('button', { class: 'roundbtn', 'aria-label': 'Previous recipes', onclick: () => step(-1) }, '‹');
  const next = h('button', { class: 'roundbtn', 'aria-label': 'Next recipes', onclick: () => step(1) }, '›');
  const step = (d: number): void => {
    const cards = Array.from(recipes.querySelectorAll('.recipe'));
    const max = Math.max(0, cards.length - 3);
    recipeIdx = Math.max(0, Math.min(max, recipeIdx + d));
    prev.classList.toggle('solid', recipeIdx > 0);
    next.classList.toggle('solid', recipeIdx < max);
    cards.forEach((c, i) => {
      (c as HTMLElement).style.opacity = i >= recipeIdx && i < recipeIdx + 3 ? '1' : '0.25';
    });
    void RECIPES;
  };
  for (const r of RECIPES) {
    recipes.append(h('div', { class: 'recipe' },
      h('div', { class: 'blob', 'aria-hidden': 'true' }),
      h('h3', { class: 'h5' }, r.name),
      h('div', { class: 'one' }, r.value),
      h('div', { class: 'ex' }, r.example),
      h('button', {
        class: 'pill outline', 'aria-label': `Use recipe: ${r.name}`,
        onclick: () => openBuilder(() => r.form),
      }, `Use recipe: ${r.name}`)));
  }
  main.append(h('div', { class: 'row', style: 'gap:12px' }, prev, next), recipes);
  step(0);

  /* rule list */
  const list = h('ul', { style: 'list-style:none;padding:0;display:grid;gap:10px' });
  for (const rule of rules) {
    list.append(h('li', { class: 'card' },
      h('div', { class: 'row' },
        h('span', { class: 'num', style: 'width:28px' }, String(rule.position)),
        h('strong', {}, rule.name),
        h('span', { class: 'muted' }, describe(rule, proj)))));
  }
  main.append(list, h('button', { class: 'pill primary', onclick: () => openBuilder() }, 'New rule'));

  root.append(main);
  const statusEl = h('div', { id: 'rules-status', role: 'status', 'aria-live': 'polite', class: 'visually-hidden' });
  root.append(statusEl);

  function openBuilder(prefill?: () => RuleForm): void {
    const form: RuleForm = prefill?.() ?? { name: '', triggerType: '', actionType: '', conditionOp: 'always' };
    openDialog((container, close) => {
      const overlay = h('div', { class: 'darkband', style: 'padding:20px' });
      const nameIn = h('input', { 'aria-label': 'Rule name', value: form.name }) as HTMLInputElement;
      nameIn.style.minHeight = '44px'; nameIn.style.borderRadius = '12px'; nameIn.style.border = '1px solid rgba(255,255,255,0.4)'; nameIn.style.background = 'rgba(255,255,255,0.08)'; nameIn.style.color = '#fff'; nameIn.style.padding = '8px 12px';
      const errName = h('div', { class: 'err' });
      const errTrigger = h('div', { class: 'err' });
      const errAction = h('div', { class: 'err' });

      const steps: HTMLElement[] = [];
      const bodies: HTMLElement[] = [];
      const mkStep = (title: string): { head: HTMLElement; body: HTMLElement } => {
        const btn = h('button', { class: 'stephead', 'aria-expanded': 'false' }, title, h('span', { class: 'chev' }, '▾'));
        const bd = h('div', { class: 'stepbody', hidden: true });
        const card = h('div', { class: 'stepcard' }, btn, bd);
        btn.addEventListener('click', () => {
          const open = btn.getAttribute('aria-expanded') === 'true';
          for (const b of bodies) b.hidden = true;
          for (const s of steps) s.setAttribute('aria-expanded', 'false');
          if (!open) { btn.setAttribute('aria-expanded', 'true'); bd.hidden = false; }
        });
        steps.push(btn);
        bodies.push(bd);
        return { head: btn, body: bd };
      };

      const s1 = mkStep('Step 1: When');
      const whenSel = h('select', { 'aria-label': 'When' }) as HTMLSelectElement;
      for (const t of ['', 'task_added', 'field_changed', 'moved_to_section', 'due_date_arrives', 'approval_decided']) {
        whenSel.append(h('option', { value: t }, t === '' ? 'Choose a trigger' : t));
      }
      whenSel.value = form.triggerType;
      const fieldSel = h('select', { 'aria-label': 'Field' }) as HTMLSelectElement;
      for (const f of proj.fields) fieldSel.append(h('option', { value: f.id }, f.name));
      fieldSel.append(h('option', { value: 'assignee' }, 'Assignee'), h('option', { value: 'start' }, 'Start'), h('option', { value: 'due' }, 'Due'), h('option', { value: 'effort' }, 'Effort'));
      fieldSel.value = form.field ?? '';
      const valueIn = h('input', { 'aria-label': 'Value' }) as HTMLInputElement;
      valueIn.value = form.value ?? '';
      const sectionSel = h('select', { 'aria-label': 'Value sections' }) as HTMLSelectElement;
      for (const s of proj.sections) sectionSel.append(h('option', { value: s.id }, s.name));
      sectionSel.value = form.section ?? '';
      s1.body.append(whenSel, fieldSel, valueIn, sectionSel, errTrigger);

      const s2 = mkStep('Step 2: Condition');
      const condSel = h('select', { 'aria-label': 'Condition' }) as HTMLSelectElement;
      for (const c of ['always', 'is', 'is_not', 'is_blank', 'is_greater_than']) condSel.append(h('option', { value: c }, c));
      condSel.value = form.conditionOp ?? 'always';
      const condField = h('select', { 'aria-label': 'Condition field' }) as HTMLSelectElement;
      for (const f of proj.fields) condField.append(h('option', { value: f.id }, f.name));
      const condValue = h('input', { 'aria-label': 'Condition value' }) as HTMLInputElement;
      s2.body.append(condSel, condField, condValue);

      const s3 = mkStep('Step 3: Then');
      const thenSel = h('select', { 'aria-label': 'Then' }) as HTMLSelectElement;
      for (const a of ['', 'set_field', 'move_to_section', 'assign_to', 'add_subtask', 'send_to_inbox']) {
        thenSel.append(h('option', { value: a }, a === '' ? 'Choose an action' : a));
      }
      thenSel.value = form.actionType;
      const targetSel = h('select', { 'aria-label': 'Target' }) as HTMLSelectElement;
      for (const f of proj.fields) targetSel.append(h('option', { value: f.id }, f.name));
      for (const s of proj.sections) targetSel.append(h('option', { value: s.id }, s.name));
      for (const m of proj.members) targetSel.append(h('option', { value: m.id }, m.name));
      const actionValue = h('input', { 'aria-label': 'Action value' }) as HTMLInputElement;
      actionValue.value = form.actionValue ?? '';
      s3.body.append(thenSel, targetSel, actionValue, errAction);

      const preview = h('div', { class: 'preview' });
      const refreshPreview = (): void => {
        preview.textContent = `When ${whenSel.value || '...'}, ${condSel.value === 'always' ? 'always' : condSel.value}, ${thenSel.value || '...'} ${targetSel.value}`.trim();
      };
      for (const sel of [whenSel, condSel, thenSel, targetSel]) sel.addEventListener('change', refreshPreview);
      refreshPreview();

      const save = h('button', {
        class: 'pill primary', onclick: async () => {
          errName.textContent = ''; errTrigger.textContent = ''; errAction.textContent = '';
          if (!nameIn.value.trim()) { errName.textContent = 'Enter a rule name'; return; }
          if (!whenSel.value) { errTrigger.textContent = 'Choose when the rule runs'; return; }
          if (!thenSel.value) { errAction.textContent = 'Choose what happens'; return; }
          const trigger: Record<string, string> = { type: whenSel.value };
          if (whenSel.value === 'field_changed') { trigger.field = fieldSel.value; trigger.value = valueIn.value; }
          if (whenSel.value === 'moved_to_section') { trigger.section = sectionSel.value; }
          const action: Record<string, string> = { type: thenSel.value };
          if (['set_field', 'move_to_section', 'assign_to'].includes(thenSel.value)) action.target = targetSel.value;
          if (['set_field', 'add_subtask', 'send_to_inbox'].includes(thenSel.value)) action.value = actionValue.value;
          const body: Record<string, unknown> = { name: nameIn.value.trim(), trigger, action };
          if (condSel.value !== 'always') body.condition = { field: condField.value || '', op: condSel.value, value: condValue.value };
          const r = await api<RuleRecord>('POST', `/api/projects/${pid}/rules`, body);
          if (r.ok) {
            announce('Rules status', `Rule saved: ${r.data.name}`);
            close();
            window.location.reload();
          }
        },
      }, 'Save rule');
      const cancel = h('button', { class: 'pill outline', style: 'border-color:rgba(255,255,255,0.6);color:#fff', onclick: close }, 'Cancel');

      overlay.append(
        h('h2', { style: 'color:#fff' }, 'New rule'),
        h('div', { class: 'field' }, h('label', { style: 'color:rgba(255,255,255,0.7)' }, 'Rule name'), nameIn, errName),
        s1.head.parentElement!, s2.head.parentElement!, s3.head.parentElement!,
        preview,
        h('div', { class: 'actions' }, cancel, save));
      container.style.background = 'var(--ink)';
      container.style.color = 'var(--paper)';
      container.style.maxWidth = '560px';
      clear(container);
      container.append(overlay);
    });
  }

  function describe(rule: RuleRecord, p: ProjectData): string {
    const trig = rule.trigger;
    let text: string = trig.type;
    if (trig.type === 'field_changed') {
      const f = p.fields.find(x => x.id === trig.field);
      text = `Field changed ${f?.name ?? trig.field}${trig.value ? ` to ${trig.value}` : ''}`;
    } else if (trig.type === 'moved_to_section') {
      const s = p.sections.find(x => x.id === trig.section);
      text = `Moved to section ${s?.name ?? ''}`;
    }
    const act = rule.action;
    let atext: string = act.type;
    if (act.type === 'set_field') { const f = p.fields.find(x => x.id === act.target); atext = `Set ${f?.name ?? act.target} to ${act.value}`; }
    if (act.type === 'move_to_section') { const s = p.sections.find(x => x.id === act.target); atext = `Move to ${s?.name ?? ''}`; }
    if (act.type === 'assign_to') { const m = p.members.find(x => x.id === act.target); atext = `Assign to ${m?.name ?? ''}`; }
    if (act.type === 'add_subtask') atext = `Add subtask ${act.value}`;
    if (act.type === 'send_to_inbox') atext = 'Send to inbox';
    return `${text} → ${atext}`;
  }

  void toastHost;
}
