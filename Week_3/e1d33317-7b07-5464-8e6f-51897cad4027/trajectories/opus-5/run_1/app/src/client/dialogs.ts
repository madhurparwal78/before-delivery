import { filterText } from '../shared/text.js';
import type { Clef, Collaborator, Staff, Transpose, VoiceEvent } from '../shared/types.js';
import { RequestFailed, request } from './api.js';
import { button, clear, el, errorSummary, openDialog, whilePending } from './dom.js';
import type { Regions } from './regions.js';
import type { ScoreState } from './score-state.js';

const CLEF_OPTIONS: { value: Clef; label: string }[] = [
  { value: 'treble', label: 'Treble' },
  { value: 'alto', label: 'Alto' },
  { value: 'tenor', label: 'Tenor' },
  { value: 'bass', label: 'Bass' },
  { value: 'percussion', label: 'Percussion' },
];

const TRANSPOSE_OPTIONS: { label: string; value: Transpose }[] = [
  { label: 'Concert pitch', value: { diatonic: 0, chromatic: 0 } },
  { label: 'B\u266D (sounds a major second lower)', value: { diatonic: -1, chromatic: -2 } },
  { label: 'A (sounds a minor third lower)', value: { diatonic: -2, chromatic: -3 } },
  { label: 'F (sounds a perfect fifth lower)', value: { diatonic: -4, chromatic: -7 } },
  { label: 'E\u266D (sounds a major sixth lower)', value: { diatonic: -5, chromatic: -9 } },
  { label: 'Octave lower', value: { diatonic: -7, chromatic: -12 } },
];

const TIME_SIGNATURE_OPTIONS = [
  { label: 'Same as last', value: null },
  { label: '2/4', value: { beats: 2, beatType: 4 } },
  { label: '3/4', value: { beats: 3, beatType: 4 } },
  { label: '4/4', value: { beats: 4, beatType: 4 } },
  { label: '5/4', value: { beats: 5, beatType: 4 } },
  { label: '6/8', value: { beats: 6, beatType: 8 } },
];

function field(labelText: string, control: HTMLElement): HTMLElement {
  const id = `field-${Math.random().toString(36).slice(2)}`;
  control.id = id;
  return el('div', { class: 'field' }, [
    el('label', { for: id }, [labelText]),
    control,
  ]);
}

function select(
  label: string,
  options: { label: string; value: string }[],
  key: string,
): HTMLSelectElement {
  const control = el('select', { 'aria-label': label, 'data-field': key });
  for (const option of options) {
    control.append(el('option', { value: option.value }, [option.label]));
  }
  return control;
}

function fieldErrorsOf(cause: unknown): Record<string, string> {
  if (cause instanceof RequestFailed) {
    return cause.failure.errors ?? { form: cause.failure.message };
  }
  return { form: 'The score service did not answer.' };
}

function staffListbox(staves: Staff[], chosen: string[]): HTMLSelectElement {
  const control = el('select', {
    multiple: true,
    'aria-label': 'Staves they can edit',
    'data-field': 'staffIds',
  });
  for (const staff of staves) {
    const option = el('option', { value: staff.id }, [staff.name]);
    if (chosen.includes(staff.id)) option.selected = true;
    control.append(option);
  }
  return control;
}

function chosenValues(control: HTMLSelectElement): string[] {
  return [...control.selectedOptions].map((option) => option.value);
}

export function openAddStaffDialog(state: ScoreState, regions: Regions): void {
  const handle = openDialog('Add staff', (close) => {
    const name = el('input', { type: 'text', 'aria-label': 'Staff name', 'data-field': 'name' });
    const clef = select(
      'Clef',
      CLEF_OPTIONS.map((option) => ({ label: option.label, value: option.value })),
      'clef',
    );
    const transposition = select(
      'Transposition',
      TRANSPOSE_OPTIONS.map((option, index) => ({ label: option.label, value: String(index) })),
      'transpose',
    );
    const part = select(
      'Part',
      [
        { label: 'New part', value: '' },
        ...state.head.parts.map((item) => ({ label: item.name, value: item.id })),
      ],
      'partId',
    );
    const create = button('Create staff', { 'data-primary': 'true' });
    const body = el('div', {}, [
      field('Staff name', name),
      field('Clef', clef),
      field('Transposition', transposition),
      field('Part', part),
      el('div', { class: 'actions' }, [create, button('Cancel', {}, close)]),
    ]);
    const summary = errorSummary(body);
    body.prepend(summary.summary);
    create.addEventListener('click', () => {
      void whilePending(create, async () => {
        try {
          const payload = await request<{ staff: Staff }>(
            `/api/scores/${state.scoreId}/staves`,
            {
              method: 'POST',
              body: {
                name: name.value,
                clef: clef.value,
                transpose: TRANSPOSE_OPTIONS[Number(transposition.value)]!.value,
                partId: part.value === '' ? null : part.value,
                afterStaffId: null,
              },
            },
          );
          regions.say('Score changes', `${payload.staff.name} added.`);
          close();
        } catch (cause) {
          summary.show(fieldErrorsOf(cause));
        }
      });
    });
    return [body];
  });
  handle.root.querySelector('input')?.focus();
}

export function openAddMeasuresDialog(state: ScoreState, regions: Regions): void {
  openDialog('Add measures', (close) => {
    const count = el('input', {
      type: 'number',
      min: '1',
      max: '2000',
      value: '8',
      'aria-label': 'Measures to add',
      'data-field': 'count',
    });
    const signature = select(
      'Time signature',
      TIME_SIGNATURE_OPTIONS.map((option, index) => ({
        label: option.label,
        value: String(index),
      })),
      'timeSignature',
    );
    const append = button('Append', { 'data-primary': 'true' });
    const body = el('div', {}, [
      field('Measures to add', count),
      field('Time signature', signature),
      el('div', { class: 'actions' }, [append, button('Cancel', {}, close)]),
    ]);
    const summary = errorSummary(body);
    body.prepend(summary.summary);
    const submit = (): void => {
      void whilePending(append, async () => {
        try {
          const option = TIME_SIGNATURE_OPTIONS[Number(signature.value)]!;
          const payload = await request<{ measureCount: number }>(
            `/api/scores/${state.scoreId}/measures`,
            {
              method: 'POST',
              body: {
                count: Number(count.value),
                ...(option.value ? { timeSignature: option.value } : {}),
              },
            },
          );
          regions.say(
            'Score changes',
            `${Number(count.value)} measures added. The score now has ${payload.measureCount} measures.`,
          );
          close();
        } catch (cause) {
          summary.show(fieldErrorsOf(cause));
        }
      });
    };
    append.addEventListener('click', submit);
    signature.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') submit();
    });
    return [body];
  });
}

export function openStaffSettingsDialog(
  state: ScoreState,
  regions: Regions,
  staff: Staff,
): void {
  openDialog('Staff settings', (close) => {
    const name = el('input', {
      type: 'text',
      value: staff.name,
      'aria-label': 'Staff name',
      'data-field': 'name',
    });
    const clef = select(
      'Clef',
      CLEF_OPTIONS.map((option) => ({ label: option.label, value: option.value })),
      'clef',
    );
    clef.value = staff.clef;
    const transposition = select(
      'Transposition',
      TRANSPOSE_OPTIONS.map((option, index) => ({ label: option.label, value: String(index) })),
      'transpose',
    );
    const here = TRANSPOSE_OPTIONS.findIndex(
      (option) =>
        option.value.diatonic === staff.transpose.diatonic &&
        option.value.chromatic === staff.transpose.chromatic,
    );
    transposition.value = String(here === -1 ? 0 : here);
    const save = button('Save staff', { 'data-primary': 'true' });
    const body = el('div', {}, [
      field('Staff name', name),
      field('Clef', clef),
      field('Transposition', transposition),
      el('div', { class: 'actions' }, [save, button('Cancel', {}, close)]),
    ]);
    const summary = errorSummary(body);
    body.prepend(summary.summary);
    save.addEventListener('click', () => {
      void whilePending(save, async () => {
        try {
          const payload = await request<{ staff: Staff }>(
            `/api/scores/${state.scoreId}/staves/${staff.id}`,
            {
              method: 'PATCH',
              body: {
                name: name.value,
                clef: clef.value,
                transpose: TRANSPOSE_OPTIONS[Number(transposition.value)]!.value,
              },
            },
          );
          regions.say('Score changes', `${payload.staff.name} saved.`);
          close();
        } catch (cause) {
          if (cause instanceof RequestFailed && cause.status !== 422) {
            summary.show({ form: cause.failure.message });
          } else {
            summary.show(fieldErrorsOf(cause));
          }
        }
      });
    });
    return [body];
  });
}

export function openExtractDialog(
  state: ScoreState,
  regions: Regions,
  preselectPartId: string | null,
  onExtract: (partId: string) => Promise<void>,
): void {
  openDialog('Extract part', (close) => {
    const part = select(
      'Part',
      state.head.parts.map((item) => ({ label: item.name, value: item.id })),
      'partId',
    );
    if (preselectPartId !== null) part.value = preselectPartId;
    const extract = button('Extract', { 'data-primary': 'true' });
    const body = el('div', {}, [
      field('Part', part),
      el('div', { class: 'actions' }, [extract, button('Cancel', {}, close)]),
    ]);
    const summary = errorSummary(body);
    body.prepend(summary.summary);
    extract.addEventListener('click', () => {
      void whilePending(extract, async () => {
        try {
          await onExtract(part.value);
          const chosen = state.head.parts.find((item) => item.id === part.value)!;
          regions.say('Parts', `Engraving ${chosen.name}\u2026`);
          close();
        } catch (cause) {
          summary.show(fieldErrorsOf(cause));
        }
      });
    });
    return [body];
  });
}

export function openExpressionTextDialog(
  event: VoiceEvent,
  onSave: (text: string) => void,
): void {
  openDialog('Expression text', (close) => {
    const text = el('textarea', { 'aria-label': 'Text', 'data-field': 'value' });
    text.value = event.text;
    const preview = el('div', {
      class: 'preview-box',
      role: 'region',
      'aria-label': 'Preview',
    });
    const paint = (): void => {
      preview.innerHTML = filterText(text.value);
    };
    paint();
    text.addEventListener('input', paint);
    const save = button('Save text', { 'data-primary': 'true' });
    save.addEventListener('click', () => {
      onSave(text.value);
      close();
    });
    return [
      field('Text', text),
      preview,
      el('div', { class: 'actions' }, [save, button('Cancel', {}, close)]),
    ];
  });
}

export function openInviteDialog(state: ScoreState, regions: Regions): void {
  openDialog('Invite collaborator', (close) => {
    const name = el('input', { type: 'text', 'aria-label': 'Name', 'data-field': 'name' });
    const role = select(
      'Role',
      [
        { label: 'Copyist', value: 'copyist' },
        { label: 'Section player', value: 'player' },
      ],
      'role',
    );
    const staves = staffListbox(state.head.staves, []);
    const create = button('Create invite', { 'data-primary': 'true' });
    const body = el('div', {}, [
      field('Name', name),
      field('Role', role),
      field('Staves they can edit', staves),
      el('div', { class: 'actions' }, [create, button('Cancel', {}, close)]),
    ]);
    const summary = errorSummary(body);
    body.prepend(summary.summary);
    create.addEventListener('click', () => {
      void whilePending(create, async () => {
        try {
          const payload = await request<{
            collaborator: Collaborator;
            inviteUrl: string;
          }>(`/api/scores/${state.scoreId}/invites`, {
            method: 'POST',
            body: { name: name.value, role: role.value, staffIds: chosenValues(staves) },
          });
          regions.say('Team', `Invite created for ${payload.collaborator.name}.`);
          await state.reloadCollaborators();
          const link = el('input', {
            type: 'text',
            readonly: true,
            'aria-label': 'Invite link',
            value: `${window.location.origin}${payload.inviteUrl}`,
          });
          clear(body);
          body.append(
            field('Invite link', link),
            el('div', { class: 'actions' }, [
              button('Copy link', {}, () => {
                link.select();
                void navigator.clipboard?.writeText(link.value);
              }),
              button('Done', { 'data-primary': 'true' }, close),
            ]),
          );
          link.focus();
        } catch (cause) {
          summary.show(fieldErrorsOf(cause));
        }
      });
    });
    return [body];
  });
}

export function openStavesDialog(
  state: ScoreState,
  regions: Regions,
  collaborator: Collaborator,
): void {
  openDialog(`Staves for ${collaborator.name}`, (close) => {
    const staves = staffListbox(state.head.staves, collaborator.staffIds);
    const save = button('Save staves', { 'data-primary': 'true' });
    const body = el('div', {}, [
      field('Staves they can edit', staves),
      el('div', { class: 'actions' }, [save, button('Cancel', {}, close)]),
    ]);
    const summary = errorSummary(body);
    body.prepend(summary.summary);
    save.addEventListener('click', () => {
      void whilePending(save, async () => {
        try {
          await request(
            `/api/scores/${state.scoreId}/collaborators/${collaborator.id}`,
            { method: 'PATCH', body: { staffIds: chosenValues(staves) } },
          );
          regions.say('Team', `Staves updated for ${collaborator.name}.`);
          await state.reloadCollaborators();
          close();
        } catch (cause) {
          summary.show(fieldErrorsOf(cause));
        }
      });
    });
    return [body];
  });
}

export function openRemoveDialog(
  state: ScoreState,
  regions: Regions,
  collaborator: Collaborator,
): void {
  openDialog(
    `Remove ${collaborator.name}?`,
    (close) => {
      const remove = button('Remove', { 'data-primary': 'true' });
      const body = el('div', {}, [
        el('p', {}, ['They lose access at once and their holds are released.']),
        el('div', { class: 'actions' }, [remove, button('Cancel', {}, close)]),
      ]);
      const summary = errorSummary(body);
      body.prepend(summary.summary);
      remove.addEventListener('click', () => {
        void whilePending(remove, async () => {
          try {
            await request(
              `/api/scores/${state.scoreId}/collaborators/${collaborator.id}`,
              { method: 'DELETE' },
            );
            regions.say('Team', `${collaborator.name} removed.`);
            await state.reloadCollaborators();
            close();
          } catch (cause) {
            summary.show(fieldErrorsOf(cause));
          }
        });
      });
      return [body];
    },
    'alertdialog',
  );
}
