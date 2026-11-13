// One level of the editor: handle, timeout, targets.
import { html, useState } from '../../lib/html.js';
import { FieldError } from '../../lib/ui.js';

const TARGET_LIMIT = 10;

function TargetAdder({ position, id, people, schedules, onAdd }) {
  const [choice, setChoice] = useState('');
  const add = () => {
    if (!choice) return;
    onAdd(choice);
    setChoice('');
  };
  return html`<div class="target-add">
    <select id=${id} aria-label=${'Target to add to level ' + position} value=${choice} onChange=${(e) => setChoice(e.target.value)}>
      <option value="">Pick a target</option>
      <optgroup label="People">${people.map((p) => html`<option key=${p.id} value=${'person:' + p.id}>${p.name}</option>`)}</optgroup>
      <optgroup label="Schedules">${schedules.map((s) => html`<option key=${s.id} value=${'schedule:' + s.id}>${s.name}</option>`)}</optgroup>
    </select>
    <button type="button" class="secondary" onClick=${add}>${'Add target to level ' + position}</button>
  </div>`;
}

export function Level({ level, position, editable, people, schedules, errors, errorSlots, handle, lifted, over, dragging, onChange, onRemove }) {
  const timeoutId = errorSlots.timeout ? 'timeout_minutes' : 'timeout-' + level.cid;
  const targetsId = errorSlots.targets ? 'targets' : 'targets-' + level.cid;
  const addTarget = (value) => {
    const [type, id] = value.split(':');
    if (level.targets.some((t) => t.type === type && t.id === id)) return;
    const pool = type === 'person' ? people : schedules;
    const known = pool.find((x) => x.id === id);
    onChange({ ...level, targets: [...level.targets, { type, id, name: known ? known.name : id }] });
  };
  const removeTarget = (target) =>
    onChange({ ...level, targets: level.targets.filter((t) => !(t.type === target.type && t.id === target.id)) });
  const classes = ['level', editable ? '' : 'is-static', lifted ? 'is-lifted' : '', dragging ? 'is-dragged' : '', over ? 'is-over' : ''].join(' ');
  return html`<li class=${classes} role="listitem" data-level=${position}>
    ${editable && html`<button type="button" class="handle secondary" aria-label=${'Move level ' + position}
      aria-describedby="move-help" ...${handle}><span class="grip" aria-hidden="true"></span></button>`}
    <div class="level-body">
      <h2 class="level-title">${'Level ' + position}</h2>
      <div class="level-timeout">
        <label for=${timeoutId}>${'Timeout for level ' + position}</label>
        <div class="with-unit">
          <input id=${timeoutId} type="number" inputmode="numeric" min="1" step="1" value=${level.timeout} readOnly=${!editable}
            aria-describedby=${errorSlots.timeout ? 'timeout_minutes-error' : undefined}
            onInput=${(e) => onChange({ ...level, timeout: e.target.value })} />
          <span class="unit">minutes</span>
        </div>
        ${errorSlots.timeout && html`<${FieldError} errors=${errors} name="timeout_minutes" />`}
      </div>
      <div class="level-targets">
        <div class="target-list" role="group" aria-label=${'Targets of level ' + position}>
          ${level.targets.map((t) => html`<div key=${t.type + t.id} class="target">
            <span class="target-name">${t.name}</span>
            <span class="target-kind">${t.type === 'schedule' ? 'Schedule' : 'Person'}</span>
            ${editable && html`<button type="button" class="secondary" aria-label=${'Remove ' + t.name + ' from level ' + position}
              onClick=${() => removeTarget(t)}>Remove</button>`}
          </div>`)}
        </div>
        ${editable && level.targets.length < TARGET_LIMIT && html`<${TargetAdder} position=${position} id=${targetsId}
          people=${people} schedules=${schedules} onAdd=${addTarget} />`}
        ${errorSlots.targets && html`<${FieldError} errors=${errors} name="targets" />`}
      </div>
    </div>
    ${editable && html`<button type="button" class="secondary remove-level" onClick=${onRemove}>${'Remove level ' + position}</button>`}
  </li>`;
}
