import { VNode, render } from './jsx/jsx-runtime.js';
import { Score, Part, Collaborator } from './api.js';

export interface DialogParams {
  score: Score | null;
  parts: Part[];
  me: Collaborator | null;
  entryStaffId: string | null;
  selectedStaves: string[];
  canEditLayout: boolean;
  partId?: string;
  targetIndex?: number;
  collaborator?: Collaborator;
  onAnnounce(region: string, text: string): void;
  onExtractPart(partId: string): void;
  onAddStaff(payload: { name: string; clef: string; transpose: { diatonic: number; chromatic: number }; partId: string | null }): void;
  onAddMeasures(payload: { count: number; timeSignature: { beats: number; beatType: number } | null }): void;
  onSaveStaff(payload: { name: string; clef: string; transpose: { diatonic: number; chromatic: number } }): void;
  onInvite(payload: { name: string; role: string; staffIds: string[] }): Promise<void> | void;
  onRemoveCollaborator(collaboratorId: string): void;
  onChangeStaves(collaboratorId: string, staffIds: string[]): void;
  onSetText(text: string): void;
  onSaved(): void;
}

export interface DialogHandle {
  open(opener: HTMLElement | null): void;
}

interface FieldErrors {
  [key: string]: string;
}

const CLEF_OPTIONS = ['Treble', 'Alto', 'Tenor', 'Bass', 'Percussion'];
const TRANSPOSE_OPTIONS: [string, { diatonic: number; chromatic: number }][] = [
  ['Concert pitch', { diatonic: 0, chromatic: 0 }],
  ['B♭ (sounds a major second lower)', { diatonic: -1, chromatic: -2 }],
  ['A (sounds a minor third lower)', { diatonic: -2, chromatic: -3 }],
  ['F (sounds a perfect fifth lower)', { diatonic: -4, chromatic: -7 }],
  ['E♭ (sounds a major sixth lower)', { diatonic: -5, chromatic: -9 }],
  ['Octave lower', { diatonic: -7, chromatic: -12 }],
];

export function dialogs(props: { name: string; params: DialogParams }): DialogHandle | null {
  const holder: { current: HTMLDivElement | null } = { current: null };
  const openerRef: { current: HTMLElement | null } = { current: null };
  const errors: FieldErrors = {};
  let busy = false;

  function close(): void {
    holder.current?.removeEventListener('keydown', keyTrap);
    holder.current?.remove();
    holder.current = null;
    openerRef.current?.focus();
    props.params.onSaved();
  }

  function keyTrap(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (event.key === 'Tab') {
      const focusables = holder.current?.querySelectorAll<HTMLElement>(
        'button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])',
      );
      if (!focusables || focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  }

  function show(content: VNode, title: string): void {
    const backdrop = document.createElement('div');
    backdrop.className = 'dialog-backdrop';
    const dialog = document.createElement('div');
    dialog.className = 'dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-label', title);
    dialog.addEventListener('keydown', keyTrap);
    dialog.appendChild(render(content));
    backdrop.appendChild(dialog);
    document.body.appendChild(backdrop);
    holder.current = backdrop;
    const first = dialog.querySelector<HTMLElement>('input, select, textarea, button');
    setTimeout(() => first?.focus(), 30);
  }

  function errorSummary(): VNode | null {
    const keys = Object.keys(errors);
    if (keys.length === 0) return null;
    return {
      type: 'div',
      props: { class: 'error-summary', role: 'alert' },
      children: [
        { type: 'p', props: { class: 'alert-summary' }, children: ['There is a problem'] },
        ...keys.map((key) => ({
          type: 'a',
          props: {
            href: '#',
            onclick: (e: Event) => {
              e.preventDefault();
              const field = holder.current?.querySelector<HTMLElement>(`[data-field="${key}"]`);
              field?.focus();
            },
          },
          children: [errors[key]],
        })),
      ],
    };
  }

  function paperSelect(name: string, id: string, options: { value: string; label: string; selected?: boolean }[], chosen: string, onChoose: (value: string) => void): VNode {
    return {
      type: 'div',
      props: { class: 'paper-field' },
      children: [
        { type: 'label', props: { for: id }, children: [name] },
        {
          type: 'select',
          props: {
            id,
            'data-field': id,
            'aria-label': name,
            onchange: (e: Event) => onChoose((e.target as HTMLSelectElement).value),
          },
          children: options.map((opt) => ({
            type: 'option',
            props: { value: opt.value, selected: opt.value === chosen },
            children: [opt.label],
          })),
        },
      ],
    };
  }

  function paperText(name: string, id: string, value: string, onInput: (value: string) => void, multiline = false): VNode {
    return {
      type: 'div',
      props: { class: 'paper-field' },
      children: [
        { type: 'label', props: { for: id }, children: [name] },
        {
          type: multiline ? 'textarea' : 'input',
          props: {
            id,
            'data-field': id,
            value: multiline ? undefined : value,
            ...(multiline ? {} : {}),
            'aria-label': name,
            oninput: (e: Event) => onInput((e.target as HTMLInputElement).value),
          },
          ...(multiline ? [{ type: '#text', props: {}, children: [value] } as unknown as VNode] : []),
        },
      ],
    };
  }

  const p = props.params;
  let name = '';
  let clef = 'treble';
  let transposeKey = 'Concert pitch';
  let partChoice = 'new';
  let measureCount = '8';
  let timeSig = 'same';
  let role = 'copyist';
  let staffPick: string[] = [];
  let textValue = '';
  let inviteName = '';

  switch (props.name) {
    case 'extract': {
      let chosen = p.partId ?? p.parts[0]?.id ?? '';
      const content = {
        type: 'div',
        props: {},
        children: [
          errorSummary(),
          paperSelect('Part', 'extract-part', p.parts.map((part) => ({ value: part.id, label: part.name })), chosen, (value) => (chosen = value)),
          {
            type: 'div',
            props: { class: 'dialog-actions' },
            children: [
              {
                type: 'button',
                props: {
                  class: 'btn',
                  disabled: busy,
                  onclick: () => {
                    busy = true;
                    p.onExtractPart(chosen);
                    close();
                  },
                },
                children: [busy ? 'Extract…' : 'Extract'],
              },
              { type: 'button', props: { class: 'btn secondary', onclick: () => close() }, children: ['Cancel'] },
            ],
          },
        ],
      };
      return { open: (opener) => { openerRef.current = opener; show(content, 'Extract part'); } };
    }
    case 'add-staff': {
      const content = () => ({
        type: 'div',
        props: {},
        children: [
          errorSummary(),
          paperText('Staff name', 'staff-name', name, (v) => (name = v)),
          paperSelect('Clef', 'staff-clef', CLEF_OPTIONS.map((c, i) => ({ value: ['treble', 'alto', 'tenor', 'bass', 'percussion'][i], label: c })), clef, (v) => (clef = v)),
          paperSelect(
            'Transposition',
            'staff-transpose',
            TRANSPOSE_OPTIONS.map(([label]) => ({ value: label, label })),
            transposeKey,
            (v) => (transposeKey = v),
          ),
          paperSelect(
            'Part',
            'staff-part',
            [{ value: 'new', label: 'New part' }, ...p.parts.map((part) => ({ value: part.id, label: part.name }))],
            partChoice,
            (v) => (partChoice = v),
          ),
          {
            type: 'div',
            props: { class: 'dialog-actions' },
            children: [
              {
                type: 'button',
                props: {
                  class: 'btn',
                  onclick: () => {
                    const transpose = TRANSPOSE_OPTIONS.find(([label]) => label === transposeKey)?.[1] ?? { diatonic: 0, chromatic: 0 };
                    p.onAddStaff({ name, clef, transpose, partId: partChoice === 'new' ? null : partChoice });
                    close();
                  },
                },
                children: ['Create staff'],
              },
              { type: 'button', props: { class: 'btn secondary', onclick: () => close() }, children: ['Cancel'] },
            ],
          },
        ],
      });
      return { open: (opener) => { openerRef.current = opener; show(content(), 'Add staff'); } };
    }
    case 'add-measures': {
      const content = {
        type: 'div',
        props: {},
        children: [
          errorSummary(),
          {
            type: 'div',
            props: { class: 'paper-field' },
            children: [
              { type: 'label', props: { for: 'measures-count' }, children: ['Measures to add'] },
              {
                type: 'input',
                props: {
                  id: 'measures-count',
                  type: 'number',
                  min: '1',
                  max: '2000',
                  value: '8',
                  'aria-label': 'Measures to add',
                  'data-field': 'measures-count',
                  oninput: (e: Event) => (measureCount = (e.target as HTMLInputElement).value),
                },
              },
            ],
          },
          paperSelect(
            'Time signature',
            'measures-time',
            ['Same as last', '2/4', '3/4', '4/4', '5/4', '6/8'].map((label, i) => ({
              value: ['same', '2/4', '3/4', '4/4', '5/4', '6/8'][i],
              label,
            })),
            timeSig,
            (v) => (timeSig = v),
          ),
          {
            type: 'div',
            props: { class: 'dialog-actions' },
            children: [
              {
                type: 'button',
                props: {
                  class: 'btn',
                  onclick: () => {
                    const count = Number(measureCount) || 0;
                    if (count < 1 || count > 2000) {
                      errors['measures-count'] = 'Add 1 to 2000 measures.';
                      holder.current?.querySelector('.dialog')?.replaceChildren(render(content));
                      return;
                    }
                    const sigs: Record<string, { beats: number; beatType: number } | null> = {
                      same: null,
                      '2/4': { beats: 2, beatType: 4 },
                      '3/4': { beats: 3, beatType: 4 },
                      '4/4': { beats: 4, beatType: 4 },
                      '5/4': { beats: 5, beatType: 4 },
                      '6/8': { beats: 6, beatType: 8 },
                    };
                    p.onAddMeasures({ count, timeSignature: sigs[timeSig] ?? null });
                    close();
                  },
                },
                children: ['Append'],
              },
              { type: 'button', props: { class: 'btn secondary', onclick: () => close() }, children: ['Cancel'] },
            ],
          },
        ],
      };
      return { open: (opener) => { openerRef.current = opener; show(content, 'Add measures'); } };
    }
    case 'staff-settings': {
      const staff = p.score?.staves.find((s) => s.id === p.entryStaffId);
      name = staff?.name ?? '';
      clef = staff?.clef ?? 'treble';
      const content = {
        type: 'div',
        props: {},
        children: [
          errorSummary(),
          paperText('Staff name', 'settings-name', name, (v) => (name = v)),
          paperSelect('Clef', 'settings-clef', CLEF_OPTIONS.map((c, i) => ({ value: ['treble', 'alto', 'tenor', 'bass', 'percussion'][i], label: c })), clef, (v) => (clef = v)),
          paperSelect('Transposition', 'settings-transpose', TRANSPOSE_OPTIONS.map(([label]) => ({ value: label, label })), transposeKey, (v) => (transposeKey = v)),
          {
            type: 'div',
            props: { class: 'dialog-actions' },
            children: [
              {
                type: 'button',
                props: {
                  class: 'btn',
                  onclick: () => {
                    const transpose = TRANSPOSE_OPTIONS.find(([label]) => label === transposeKey)?.[1] ?? { diatonic: 0, chromatic: 0 };
                    p.onSaveStaff({ name, clef, transpose });
                    close();
                  },
                },
                children: ['Save staff'],
              },
              { type: 'button', props: { class: 'btn secondary', onclick: () => close() }, children: ['Cancel'] },
            ],
          },
        ],
      };
      return { open: (opener) => { openerRef.current = opener; show(content, 'Staff settings'); } };
    }
    case 'text': {
      const content = () => ({
        type: 'div',
        props: {},
        children: [
          errorSummary(),
          {
            type: 'div',
            props: { class: 'paper-field' },
            children: [
              { type: 'label', props: { for: 'text-value' }, children: ['Text'] },
              {
                type: 'textarea',
                props: {
                  id: 'text-value',
                  'aria-label': 'Text',
                  'data-field': 'text-value',
                  oninput: (e: Event) => {
                    textValue = (e.target as HTMLTextAreaElement).value;
                    const preview = holder.current?.querySelector('#text-preview');
                    if (preview) preview.innerHTML = filteredPreview(textValue);
                  },
                },
                children: [],
              },
            ],
          },
          {
            type: 'div',
            props: { class: 'paper-field' },
            children: [
              { type: 'label', props: {}, children: ['Preview'] },
              { type: 'div', props: { id: 'text-preview', role: 'region', 'aria-label': 'Preview', dangerouslySetInnerHTML: { __html: filteredPreview(textValue) } } },
            ],
          },
          {
            type: 'div',
            props: { class: 'dialog-actions' },
            children: [
              {
                type: 'button',
                props: {
                  class: 'btn',
                  onclick: () => {
                    p.onSetText(textValue);
                    close();
                  },
                },
                children: ['Save text'],
              },
              { type: 'button', props: { class: 'btn secondary', onclick: () => close() }, children: ['Cancel'] },
            ],
          },
        ],
      });
      return { open: (opener) => { openerRef.current = opener; show(content(), 'Expression text'); } };
    }
    case 'invite': {
      const staves = p.score?.staves ?? [];
      const content = () => ({
        type: 'div',
        props: {},
        children: [
          errorSummary(),
          paperText('Name', 'invite-name', inviteName, (v) => (inviteName = v)),
          paperSelect('Role', 'invite-role', [
            { value: 'copyist', label: 'Copyist' },
            { value: 'player', label: 'Section player' },
          ], role, (v) => (role = v)),
          {
            type: 'div',
            props: { class: 'paper-field' },
            children: [
              { type: 'label', props: { for: 'invite-staves' }, children: ['Staves they can edit'] },
              {
                type: 'div',
                props: {
                  id: 'invite-staves',
                  role: 'listbox',
                  'aria-label': 'Staves they can edit',
                  'aria-multiselectable': 'true',
                  style: 'max-height:180px;overflow-y:auto;border:1px solid #b8ad99;border-radius:4px;',
                },
                children: staves.map((staff) => ({
                  type: 'button',
                  props: {
                    role: 'option',
                    'aria-selected': staffPick.includes(staff.id) ? 'true' : 'false',
                    style: `display:block;width:100%;text-align:left;padding:8px 10px;border:none;background:${staffPick.includes(staff.id) ? '#f5d6c8' : 'transparent'};cursor:pointer;font-size:13.5px;`,
                    onclick: () => {
                      if (staffPick.includes(staff.id)) staffPick = staffPick.filter((id) => id !== staff.id);
                      else staffPick = [...staffPick, staff.id];
                      const dialog = holder.current?.querySelector('.dialog');
                      dialog?.replaceChildren(render(content()));
                    },
                  },
                  children: [staff.name],
                })),
              },
            ],
          },
          {
            type: 'div',
            props: { class: 'dialog-actions' },
            children: [
              {
                type: 'button',
                props: {
                  class: 'btn',
                  disabled: busy,
                  onclick: () => {
                    if (inviteName.trim().length < 1) {
                      errors['invite-name'] = 'Use a name of 1 to 60 characters.';
                      holder.current?.querySelector('.dialog')?.replaceChildren(render(content()));
                      return;
                    }
                    busy = true;
                    void Promise.resolve(p.onInvite({ name: inviteName, role, staffIds: staffPick })).then(() => {
                      busy = false;
                      close();
                    });
                  },
                },
                children: [busy ? 'Create invite…' : 'Create invite'],
              },
              { type: 'button', props: { class: 'btn secondary', onclick: () => close() }, children: ['Cancel'] },
            ],
          },
        ],
      });
      return { open: (opener) => { openerRef.current = opener; show(content(), 'Invite collaborator'); } };
    }
    case 'staves-for': {
      const staves = p.score?.staves ?? [];
      staffPick = p.collaborator?.staffIds ?? [];
      const content = () => ({
        type: 'div',
        props: {},
        children: [
          errorSummary(),
          {
            type: 'div',
            props: { class: 'paper-field' },
            children: [
              { type: 'label', props: { for: 'staves-for-list' }, children: ['Staves they can edit'] },
              {
                type: 'div',
                props: {
                  id: 'staves-for-list',
                  role: 'listbox',
                  'aria-label': 'Staves they can edit',
                  'aria-multiselectable': 'true',
                  style: 'max-height:220px;overflow-y:auto;border:1px solid #b8ad99;border-radius:4px;',
                },
                children: staves.map((staff) => ({
                  type: 'button',
                  props: {
                    role: 'option',
                    'aria-selected': staffPick.includes(staff.id) ? 'true' : 'false',
                    style: `display:block;width:100%;text-align:left;padding:8px 10px;border:none;background:${staffPick.includes(staff.id) ? '#f5d6c8' : 'transparent'};cursor:pointer;font-size:13.5px;`,
                    onclick: () => {
                      if (staffPick.includes(staff.id)) staffPick = staffPick.filter((id) => id !== staff.id);
                      else staffPick = [...staffPick, staff.id];
                      holder.current?.querySelector('.dialog')?.replaceChildren(render(content()));
                    },
                  },
                  children: [staff.name],
                })),
              },
            ],
          },
          {
            type: 'div',
            props: { class: 'dialog-actions' },
            children: [
              {
                type: 'button',
                props: {
                  class: 'btn',
                  onclick: () => {
                    if (p.collaborator) p.onChangeStaves(p.collaborator.id, staffPick);
                    close();
                  },
                },
                children: ['Save staves'],
              },
              { type: 'button', props: { class: 'btn secondary', onclick: () => close() }, children: ['Cancel'] },
            ],
          },
        ],
      });
      return { open: (opener) => { openerRef.current = opener; show(content(), `Staves for ${p.collaborator?.name ?? ''}`); } };
    }
    case 'remove': {
      const content = {
        type: 'div',
        props: {},
        children: [
          errorSummary(),
          { type: 'p', props: { class: 'lede' }, children: ['They lose access at once and their holds are released.'] },
          {
            type: 'div',
            props: { class: 'dialog-actions' },
            children: [
              {
                type: 'button',
                props: {
                  class: 'btn danger',
                  onclick: () => {
                    if (p.collaborator) p.onRemoveCollaborator(p.collaborator.id);
                    close();
                  },
                },
                children: ['Remove'],
              },
              { type: 'button', props: { class: 'btn secondary', onclick: () => close() }, children: ['Cancel'] },
            ],
          },
        ],
      };
      return { open: (opener) => { openerRef.current = opener; show(content, `Remove ${p.collaborator?.name ?? ''}?`); } };
    }
    default:
      return null;
  }
}

/** Only italic, bold and line breaks survive in expression text. */
function filteredPreview(text: string): string {
  let out = text
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<style\b[\s\S]*?<\/style\s*>/gi, '');
  out = out.replace(/<(\/?)([a-zA-Z][a-zA-Z0-9:-]*)([^>]*)>/g, (_match, slash, name) => {
    const lower = name.toLowerCase();
    if (lower === 'i' || lower === 'b' || lower === 'br') return `<${slash}${lower}>`;
    return '';
  });
  out = out.replace(/<(?!\/?(i|b|br)>)([^<]*)>/g, '&lt;$1&gt;');
  const openI = (out.match(/<i>/g) ?? []).length - (out.match(/<\/i>/g) ?? []).length;
  const openB = (out.match(/<b>/g) ?? []).length - (out.match(/<\/b>/g) ?? []).length;
  out = out + '<i>'.repeat(Math.max(0, openI)).replace(/<i>/g, '') + '</i>'.repeat(Math.max(0, openI)) + '</b>'.repeat(Math.max(0, openB));
  return out.replace(/&(?!(amp|lt|gt);)/g, '&amp;');
}
