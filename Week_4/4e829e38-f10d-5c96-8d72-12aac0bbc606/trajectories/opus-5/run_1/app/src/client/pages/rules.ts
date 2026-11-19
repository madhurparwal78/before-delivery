import { api, ApiCallError, type Project, type Rule } from '../api.js';
import { openDialog } from '../dialog.js';
import { clear, el, on } from '../dom.js';
import { animate } from '../motion.js';
import { announce, statusRegion } from '../status.js';
import { chevron } from '../topbar.js';
import { projectNotFound } from './project.js';

const TRIGGERS = [
  { value: 'task_added', label: 'Task added' },
  { value: 'field_changed', label: 'Field changed' },
  { value: 'moved_to_section', label: 'Moved to section' },
  { value: 'due_date_arrives', label: 'Due date arrives' },
  { value: 'approval_decided', label: 'Approval decided' },
];

const CONDITIONS = [
  { value: '', label: 'Always' },
  { value: 'is', label: 'is' },
  { value: 'is_not', label: 'is not' },
  { value: 'is_blank', label: 'is blank' },
  { value: 'is_greater_than', label: 'is greater than' },
];

const ACTIONS = [
  { value: 'set_field', label: 'Set field' },
  { value: 'move_to_section', label: 'Move to section' },
  { value: 'assign_to', label: 'Assign to' },
  { value: 'add_subtask', label: 'Add subtask' },
  { value: 'send_to_inbox', label: 'Send to inbox' },
];

const BUILT_IN_FIELDS = [
  { value: 'assignee', label: 'Assignee' },
  { value: 'start', label: 'Start' },
  { value: 'due', label: 'Due' },
  { value: 'effort', label: 'Effort' },
];

interface Recipe {
  name: string;
  value: string;
  example: string;
  answers: Partial<{
    trigger: string;
    field: string;
    value: string;
    action: string;
    target: string;
    actionValue: string;
  }>;
}

const RECIPES: Recipe[] = [
  {
    name: 'Ready to review',
    value: 'Move work on as soon as it is marked ready.',
    example: 'When Stage becomes Ready, move the task to Review.',
    answers: {
      trigger: 'field_changed',
      field: 'Stage',
      value: 'Ready',
      action: 'move_to_section',
      target: 'Review',
    },
  },
  {
    name: 'Review sets owner',
    value: 'Give every review a named owner.',
    example: 'When a task lands in Review, assign it to the reviewer on duty.',
    answers: { trigger: 'moved_to_section', value: 'Review', action: 'assign_to' },
  },
  {
    name: 'Owner flags',
    value: 'Raise priority the moment an owner changes.',
    example: 'When Assignee changes, set Priority to High.',
    answers: {
      trigger: 'field_changed',
      field: 'Assignee',
      action: 'set_field',
      target: 'Priority',
      actionValue: 'High',
    },
  },
  {
    name: 'Late order nudge',
    value: 'Tell the right person before a date slips.',
    example: 'When the due date arrives, send the task to the assignee inbox.',
    answers: { trigger: 'due_date_arrives', action: 'send_to_inbox' },
  },
  {
    name: 'Checklist starter',
    value: 'Add the first step for every new job.',
    example: 'When a task is added, add the subtask Check the order sheet.',
    answers: {
      trigger: 'task_added',
      action: 'add_subtask',
      actionValue: 'Check the order sheet',
    },
  },
];

function combo(name: string, options: { value: string; label: string }[]): HTMLSelectElement {
  const select = el('select', {
    class: 'input',
    role: 'combobox',
    'aria-label': name,
  }) as HTMLSelectElement;
  for (const option of options) {
    select.appendChild(el('option', { value: option.value }, option.label));
  }
  return select;
}

function textbox(name: string): HTMLInputElement {
  return el('input', { class: 'input', type: 'text', 'aria-label': name }) as HTMLInputElement;
}

export async function renderRules(main: HTMLElement, projectId: string): Promise<void> {
  let project: Project;
  try {
    project = await api.get<Project>(`/api/projects/${projectId}`);
  } catch (err) {
    if (err instanceof ApiCallError && err.failure.status === 404) {
      projectNotFound(main);
      return;
    }
    throw err;
  }

  main.className = 'page page--rules';
  const status = statusRegion('Rules status');
  const list = el('ol', { class: 'rule-list' });
  const newRule = el('button', { type: 'button', class: 'pill pill--dark' }, 'New rule');

  const sectionName = (id: string): string =>
    project.sections.find((section) => section.id === id)?.name ?? id;
  const fieldLabel = (key: string): string => {
    const builtIn = BUILT_IN_FIELDS.find((candidate) => candidate.value === key);
    if (builtIn) return builtIn.label;
    return project.fields.find((field) => field.id === key)?.name ?? key;
  };
  const personName = (id: string): string =>
    project.members.find((member) => member.id === id)?.name ?? id;

  const triggerSentence = (rule: Rule): string => {
    const trigger = rule.trigger as { type: string; field?: string; value?: string; section?: string };
    switch (trigger.type) {
      case 'task_added':
        return 'Task added';
      case 'field_changed':
        return trigger.value
          ? `Field changed ${fieldLabel(trigger.field ?? '')} to ${trigger.value}`
          : `Field changed ${fieldLabel(trigger.field ?? '')}`;
      case 'moved_to_section':
        return `Moved to section ${sectionName(trigger.section ?? '')}`;
      case 'due_date_arrives':
        return 'Due date arrives';
      default:
        return 'Approval decided';
    }
  };

  const actionSentence = (rule: Rule): string => {
    const action = rule.action as { type: string; target?: string; value?: string };
    switch (action.type) {
      case 'set_field':
        return `set ${fieldLabel(action.target ?? '')} to ${action.value ?? ''}`;
      case 'move_to_section':
        return `move to ${sectionName(action.target ?? '')}`;
      case 'assign_to':
        return `assign to ${personName(action.target ?? '')}`;
      case 'add_subtask':
        return `add subtask ${action.value ?? ''}`;
      default:
        return 'send to inbox';
    }
  };

  const drawRules = async () => {
    const data = await api.get<{ rules: Rule[] }>(`/api/projects/${project.id}/rules`);
    clear(list);
    for (const rule of data.rules) {
      list.appendChild(
        el('li', { class: 'rule-list__item', 'data-rule': rule.id }, [
          el('p', { class: 'rule-list__name' }, rule.name),
          el(
            'p',
            { class: 'rule-list__sentence' },
            `When ${triggerSentence(rule)}, ${actionSentence(rule)}.`,
          ),
          el('span', { class: 'rule-list__position tabular' }, String(rule.position)),
        ]),
      );
    }
  };

  const openRuleDialog = (recipe: Recipe | null, opener: HTMLElement) => {
    openDialog({
      name: 'New rule',
      opener,
      build: (handle) => {
        const ruleName = textbox('Rule name');
        if (recipe) ruleName.value = recipe.name;

        const when = combo('When', TRIGGERS);
        const field = combo('Field', [
          ...BUILT_IN_FIELDS,
          ...project.fields.map((item) => ({ value: item.id, label: item.name })),
        ]);
        const value = combo('Value', [{ value: '', label: 'Any value' }]);
        const condition = combo('Condition', CONDITIONS);
        const conditionField = combo('Condition field', [
          ...BUILT_IN_FIELDS,
          ...project.fields.map((item) => ({ value: item.id, label: item.name })),
        ]);
        const conditionValue = textbox('Condition value');
        const then = combo('Then', ACTIONS);
        const target = combo('Target', []);
        const actionValue = textbox('Action value');
        const preview = el('p', { class: 'rule-preview' });

        const fieldWrap = el('div', { class: 'field' }, [
          el('span', { class: 'field__label' }, 'Field'),
          field,
        ]);
        const valueWrap = el('div', { class: 'field' }, [
          el('span', { class: 'field__label' }, 'Value'),
          value,
        ]);
        const conditionFieldWrap = el('div', { class: 'field' }, [
          el('span', { class: 'field__label' }, 'Condition field'),
          conditionField,
        ]);
        const conditionValueWrap = el('div', { class: 'field' }, [
          el('span', { class: 'field__label' }, 'Condition value'),
          conditionValue,
        ]);
        const targetWrap = el('div', { class: 'field' }, [
          el('span', { class: 'field__label' }, 'Target'),
          target,
        ]);
        const actionValueWrap = el('div', { class: 'field' }, [
          el('span', { class: 'field__label' }, 'Action value'),
          actionValue,
        ]);

        const refreshValue = () => {
          clear(value);
          if (when.value === 'field_changed') {
            value.appendChild(el('option', { value: '' }, 'Any value'));
            const chosen = project.fields.find((item) => item.id === field.value);
            for (const option of chosen?.options ?? []) {
              value.appendChild(el('option', { value: option }, option));
            }
          } else if (when.value === 'moved_to_section') {
            for (const section of project.sections) {
              value.appendChild(el('option', { value: section.id }, section.name));
            }
          }
        };

        const refreshTarget = () => {
          clear(target);
          if (then.value === 'move_to_section') {
            for (const section of project.sections) {
              target.appendChild(el('option', { value: section.id }, section.name));
            }
          } else if (then.value === 'assign_to') {
            for (const member of project.members) {
              target.appendChild(el('option', { value: member.id }, member.name));
            }
          } else if (then.value === 'set_field') {
            for (const option of [
              ...BUILT_IN_FIELDS,
              ...project.fields.map((item) => ({ value: item.id, label: item.name })),
            ]) {
              target.appendChild(el('option', { value: option.value }, option.label));
            }
          }
        };

        const refreshVisibility = () => {
          fieldWrap.hidden = when.value !== 'field_changed';
          valueWrap.hidden = !['field_changed', 'moved_to_section'].includes(when.value);
          conditionFieldWrap.hidden = condition.value === '';
          conditionValueWrap.hidden =
            condition.value === '' || condition.value === 'is_blank';
          targetWrap.hidden = !['set_field', 'move_to_section', 'assign_to'].includes(then.value);
          actionValueWrap.hidden = !['set_field', 'add_subtask', 'send_to_inbox'].includes(
            then.value,
          );
          preview.textContent = `When ${
            TRIGGERS.find((item) => item.value === when.value)?.label ?? ''
          }${fieldWrap.hidden ? '' : ` ${field.options[field.selectedIndex]?.text ?? ''}`}${
            valueWrap.hidden || value.value === '' ? '' : ` to ${value.options[value.selectedIndex]?.text ?? ''}`
          }, ${ACTIONS.find((item) => item.value === then.value)?.label.toLowerCase() ?? ''}${
            targetWrap.hidden ? '' : ` ${target.options[target.selectedIndex]?.text ?? ''}`
          }${actionValueWrap.hidden || actionValue.value === '' ? '' : ` ${actionValue.value}`}.`;
        };

        for (const control of [when, field, condition, then]) {
          on(control, 'change', () => {
            refreshValue();
            refreshTarget();
            refreshVisibility();
          });
        }
        on(value, 'change', refreshVisibility);
        on(target, 'change', refreshVisibility);
        on(actionValue, 'input', refreshVisibility);

        const steps = [
          { label: 'Step 1: When', content: [fieldWrap, valueWrap] },
          {
            label: 'Step 2: Condition',
            content: [
              el('div', { class: 'field' }, [
                el('span', { class: 'field__label' }, 'Condition'),
                condition,
              ]),
              conditionFieldWrap,
              conditionValueWrap,
            ],
          },
          { label: 'Step 3: Then', content: [targetWrap, actionValueWrap] },
        ];

        const stepNodes = steps.map((step, index) => {
          const button = el(
            'button',
            { type: 'button', class: 'step__button', 'aria-expanded': index === 0 ? 'true' : 'false' },
            [el('span', {}, step.label), chevron()],
          );
          const body = el('div', { class: 'step__body' }, [
            index === 0
              ? el('div', { class: 'field' }, [
                  el('span', { class: 'field__label' }, 'When'),
                  when,
                ])
              : index === 2
                ? el('div', { class: 'field' }, [
                    el('span', { class: 'field__label' }, 'Then'),
                    then,
                  ])
                : null,
            ...step.content,
          ]);
          body.hidden = index !== 0;
          const card = el('div', { class: 'step' }, [button, body]);
          return { button, body, card };
        });

        const openStep = (index: number) => {
          stepNodes.forEach((step, i) => {
            const open = i === index;
            step.button.setAttribute('aria-expanded', open ? 'true' : 'false');
            step.body.hidden = !open;
            step.card.classList.toggle('is-open', open);
          });
          animate(
            330,
            () => undefined,
            () => undefined,
          );
        };
        stepNodes.forEach((step, index) => {
          on(step.button, 'click', () => openStep(index));
          on(step.button, 'keydown', (event) => {
            if (event.key === ' ' || event.key === 'Enter') {
              event.preventDefault();
              openStep(index);
            }
          });
        });

        const save = el('button', { type: 'submit', class: 'pill pill--light' }, 'Save rule');
        const cancel = el('button', { type: 'button', class: 'pill pill--ghost' }, 'Cancel');
        on(cancel, 'click', handle.close);
        const nameError = el('p', { class: 'field__error', hidden: true });

        const form = el('form', { class: 'dialog-body rule-builder stack' }, [
          el('h2', { class: 'dialog-title' }, 'New rule'),
          el('div', { class: 'field' }, [
            el('span', { class: 'field__label' }, 'Rule name'),
            ruleName,
            nameError,
          ]),
          el('div', { class: 'rule-builder__grid' }, [
            el(
              'div',
              { class: 'rule-builder__steps' },
              stepNodes.map((step) => step.card),
            ),
            preview,
          ]),
          el('div', { class: 'dialog-actions' }, [save, cancel]),
        ]) as HTMLFormElement;

        refreshValue();
        refreshTarget();
        if (recipe) {
          if (recipe.answers.trigger) when.value = recipe.answers.trigger;
          refreshValue();
          if (recipe.answers.field) {
            const match = project.fields.find((item) => item.name === recipe.answers.field);
            field.value = match
              ? match.id
              : (BUILT_IN_FIELDS.find(
                  (item) => item.label === recipe.answers.field,
                )?.value ?? field.value);
            refreshValue();
          }
          if (recipe.answers.value) {
            const section = project.sections.find((item) => item.name === recipe.answers.value);
            value.value = section ? section.id : recipe.answers.value;
          }
          if (recipe.answers.action) then.value = recipe.answers.action;
          refreshTarget();
          if (recipe.answers.target) {
            const section = project.sections.find((item) => item.name === recipe.answers.target);
            const matchField = project.fields.find((item) => item.name === recipe.answers.target);
            target.value = section ? section.id : matchField ? matchField.id : recipe.answers.target;
          }
          if (recipe.answers.actionValue) actionValue.value = recipe.answers.actionValue;
        }
        refreshVisibility();

        on(form, 'submit', (event) => {
          event.preventDefault();
          if (save.getAttribute('aria-busy') === 'true') return;
          if (ruleName.value.trim() === '') {
            nameError.hidden = false;
            nameError.textContent = 'Enter a rule name';
            ruleName.setAttribute('aria-invalid', 'true');
            ruleName.focus();
            return;
          }
          save.setAttribute('aria-busy', 'true');
          const trigger: Record<string, unknown> = { type: when.value };
          if (when.value === 'field_changed') {
            trigger.field = field.value;
            if (value.value !== '') trigger.value = value.value;
          }
          if (when.value === 'moved_to_section') trigger.section = value.value;
          const action: Record<string, unknown> = { type: then.value };
          if (!targetWrap.hidden) action.target = target.value;
          if (!actionValueWrap.hidden) action.value = actionValue.value;
          void api
            .post(`/api/projects/${project.id}/rules`, {
              name: ruleName.value.trim(),
              trigger,
              condition:
                condition.value === ''
                  ? null
                  : {
                      field: conditionField.value,
                      op: condition.value,
                      value: conditionValue.value,
                    },
              action,
            })
            .then(() => {
              announce('Rules status', `Rule saved: ${ruleName.value.trim()}`);
              handle.close();
              void drawRules();
            })
            .catch((err) => {
              if (err instanceof ApiCallError && err.failure.errors) {
                nameError.hidden = !err.failure.errors.name;
                nameError.textContent = err.failure.errors.name ?? '';
              }
              save.removeAttribute('aria-busy');
            });
        });
        return form;
      },
    });
  };

  on(newRule, 'click', () => openRuleDialog(null, newRule));

  const cards = RECIPES.map((recipe) => {
    const use = el(
      'button',
      { type: 'button', class: 'pill pill--ghost', 'aria-label': `Use recipe: ${recipe.name}` },
      'Use recipe',
    );
    on(use, 'click', () => openRuleDialog(recipe, use));
    return el('article', { class: 'recipe-card' }, [
      el('span', { class: 'blob', 'aria-hidden': 'true' }),
      el('h3', { class: 'recipe-card__title' }, recipe.name),
      el('p', { class: 'recipe-card__value' }, recipe.value),
      el('p', { class: 'recipe-card__example' }, recipe.example),
      use,
    ]);
  });
  const track = el('div', { class: 'recipes__track' }, cards);
  let index = 0;
  const previous = el(
    'button',
    { type: 'button', class: 'round-button', 'aria-label': 'Previous recipes' },
    chevron(),
  );
  const next = el(
    'button',
    { type: 'button', class: 'round-button', 'aria-label': 'Next recipes' },
    chevron(),
  );
  const step = () => {
    previous.disabled = index === 0;
    next.disabled = index >= cards.length - 1;
    animate(
      330,
      (eased) => track.style.setProperty('--shift', `${-index * 320 * eased}px`),
      () => track.setAttribute('data-motion', 'settled'),
    );
  };
  on(previous, 'click', () => {
    index = Math.max(0, index - 1);
    step();
  });
  on(next, 'click', () => {
    index = Math.min(cards.length - 1, index + 1);
    step();
  });
  step();

  main.append(
    el('h1', { class: 'page__title' }, `${project.name} rules`),
    status,
    el('div', { class: 'recipes', role: 'region', 'aria-label': 'Rule recipes' }, [
      el('div', { class: 'recipes__viewport' }, track),
      el('div', { class: 'recipes__arrows' }, [previous, next]),
    ]),
    newRule,
    list,
  );
  await drawRules();
}
