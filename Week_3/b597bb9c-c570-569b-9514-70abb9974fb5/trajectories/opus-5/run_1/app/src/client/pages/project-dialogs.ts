/** The project page's dialogs. Each is modal and returns focus to its opener. */
import { ApiCallError, call, get, newOpId, post, put, remove } from '../api.js';
import { fieldValue, openDialog, selectField, textField, type DialogHandle } from '../dialog.js';
import { clear, el, find } from '../dom.js';
import { notice } from '../shell.js';
import { ASPECT_RATIOS, type CutRecord } from '../../shared/types.js';
import { rateOf, type PageState, type Redraw } from './project-state.js';
import { timecode } from '../../domain/rate.js';
import { codePoints } from '../../domain/validate.js';

const LINK_CHOICES: [string, number][] = [
  ['1 hour', 3600],
  ['1 day', 86400],
  ['7 days', 604800],
  ['30 days', 2592000],
];

export function nameCutDialog(state: PageState, redraw: Redraw, opener: HTMLElement | null): void {
  const handle = openDialog(
    'Name cut',
    [
      textField('cut-name', 'Cut name'),
      el('div', { class: 'dialog-actions' }, [
        el('button', { type: 'button', class: 'primary', 'data-save': '', text: 'Save cut' }),
      ]),
    ],
    opener,
  );
  find<HTMLButtonElement>('[data-save]', handle.dialog)?.addEventListener('click', () => {
    const name = fieldValue(handle.dialog, 'cut-name');
    notice('Saving cut…');
    void post<CutRecord>(`/api/projects/${state.projectId}/cuts`, { name })
      .then((cut) => {
        state.cuts = [...state.cuts, cut];
        notice(`${cut.name} saved.`);
        handle.close();
        redraw();
      })
      .catch((error: unknown) => {
        if (error instanceof ApiCallError) {
          handle.errorSummary(error.failure.errors ?? { 'cut-name': error.failure.message });
          notice(error.failure.message);
        }
      });
  });
}

interface LinkRecord {
  id: string;
  token?: string;
  url: string | null;
  cut_id: string;
  expires_at: string;
  state: string;
}

export function shareDialog(state: PageState, redraw: Redraw, opener: HTMLElement | null): void {
  const cutSelect = el(
    'select',
    { id: 'field-cut', 'aria-label': 'Cut' },
    state.cuts.map((cut) => el('option', { value: cut.id, text: cut.name })),
  );
  const lasts = el(
    'select',
    { id: 'field-lasts', 'aria-label': 'Link lasts' },
    LINK_CHOICES.map(([label]) => el('option', { value: label, text: label })),
  );
  const linkField = el('input', { type: 'text', id: 'field-review-link', 'aria-label': 'Review link', readonly: true });
  const handle: DialogHandle = openDialog(
    'Share for review',
    [
      el('div', { class: 'field' }, [el('label', { for: 'field-cut', text: 'Cut' }), cutSelect]),
      el('div', { class: 'field' }, [el('label', { for: 'field-lasts', text: 'Link lasts' }), lasts]),
      el('div', { class: 'field' }, [el('label', { for: 'field-review-link', text: 'Review link' }), linkField]),
      el('div', { class: 'dialog-actions' }, [
        el('button', { type: 'button', class: 'primary', 'data-create': '', text: 'Create link' }),
        el('button', { type: 'button', 'data-share': '', text: 'Share this cut' }),
        el('button', { type: 'button', 'data-regenerate': '', text: 'Regenerate link' }),
        el('button', { type: 'button', 'data-revoke': '', text: 'Revoke link' }),
      ]),
    ],
    opener,
  );
  let current: LinkRecord | null = null;
  const show = (link: LinkRecord): void => {
    current = link;
    linkField.value = link.url ?? '';
  };
  void get<{ items: LinkRecord[] }>(`/api/projects/${state.projectId}/review-links`).then((page) => {
    const active = page.items.find((item) => item.state === 'active');
    if (active !== undefined) {
      show(active);
      cutSelect.value = active.cut_id;
    }
  });
  const seconds = (): number => LINK_CHOICES.find(([label]) => label === lasts.value)?.[1] ?? 86400;
  find<HTMLButtonElement>('[data-create]', handle.dialog)?.addEventListener('click', () => {
    notice('Making link…');
    void post<LinkRecord>(`/api/projects/${state.projectId}/review-links`, {
      cut_id: cutSelect.value,
      expires_in_seconds: seconds(),
    })
      .then((link) => {
        show(link);
        notice(`Review link ready. It works until ${new Date(link.expires_at).toLocaleString()}.`);
        redraw();
      })
      .catch((error: unknown) => {
        if (error instanceof ApiCallError) notice(error.failure.message);
      });
  });
  find<HTMLButtonElement>('[data-share]', handle.dialog)?.addEventListener('click', () => {
    if (current === null) return;
    void put<LinkRecord>(`/api/review-links/${current.id}`, { cut_id: cutSelect.value })
      .then((link) => {
        show(link);
        const cut = state.cuts.find((candidate) => candidate.id === link.cut_id);
        notice(`${cut?.name ?? 'That cut'} is now shared for review.`);
        redraw();
      })
      .catch((error: unknown) => {
        if (error instanceof ApiCallError) notice(error.failure.message);
      });
  });
  find<HTMLButtonElement>('[data-regenerate]', handle.dialog)?.addEventListener('click', () => {
    if (current === null) return;
    notice('Making link…');
    void post<LinkRecord>(`/api/review-links/${current.id}/regenerate`)
      .then((link) => {
        show(link);
        notice(`Review link ready. It works until ${new Date(link.expires_at).toLocaleString()}.`);
      })
      .catch((error: unknown) => {
        if (error instanceof ApiCallError) notice(error.failure.message);
      });
  });
  find<HTMLButtonElement>('[data-revoke]', handle.dialog)?.addEventListener('click', () => {
    if (current === null) return;
    notice('Turning off link…');
    void remove(`/api/review-links/${current.id}`)
      .then(() => {
        linkField.value = '';
        notice('Review link turned off.');
      })
      .catch((error: unknown) => {
        if (error instanceof ApiCallError) notice(error.failure.message);
      });
  });
}

export function exportDialog(state: PageState, redraw: Redraw, opener: HTMLElement | null): void {
  const cutSelect = el(
    'select',
    { id: 'field-cut', 'aria-label': 'Cut' },
    state.cuts.map((cut) => el('option', { value: cut.id, text: cut.name })),
  );
  const sizes = el(
    'div',
    { role: 'radiogroup', 'aria-label': 'Size', class: 'radiogroup' },
    ['2160', '1080', '720'].map((size) =>
      el('button', {
        type: 'button',
        role: 'radio',
        'aria-checked': size === '1080' ? 'true' : 'false',
        'data-size': size,
        text: `${size}p`,
      }),
    ),
  );
  const handle = openDialog(
    'Export cut',
    [
      el('div', { class: 'field' }, [el('label', { for: 'field-cut', text: 'Cut' }), cutSelect]),
      sizes,
      el('div', { class: 'dialog-actions' }, [
        el('button', { type: 'button', class: 'primary', 'data-start': '', text: 'Start export' }),
      ]),
    ],
    opener,
  );
  let size = 1080;
  for (const radio of sizes.querySelectorAll<HTMLElement>('[data-size]')) {
    radio.addEventListener('click', () => {
      size = Number(radio.dataset.size);
      for (const other of sizes.querySelectorAll<HTMLElement>('[data-size]')) {
        other.setAttribute('aria-checked', other === radio ? 'true' : 'false');
      }
    });
  }
  find<HTMLButtonElement>('[data-start]', handle.dialog)?.addEventListener('click', () => {
    notice('Starting export…');
    void post(`/api/projects/${state.projectId}/exports`, { cut_id: cutSelect.value, size })
      .then((payload) => {
        const record = payload as (typeof state.exports)[number];
        const cut = state.cuts.find((candidate) => candidate.id === cutSelect.value);
        notice(`Export of ${cut?.name ?? 'the cut'} at ${size}p queued.`);
        if (!state.exports.some((candidate) => candidate.id === record.id)) {
          state.exports = [record, ...state.exports];
        }
        handle.close();
        redraw();
      })
      .catch((error: unknown) => {
        if (error instanceof ApiCallError) notice(error.failure.message);
      });
  });
}

export function captionsDialog(state: PageState, redraw: Redraw, opener: HTMLElement | null): void {
  const captionRows = state.detail.rows.filter((row) => row.kind === 'caption');
  const rowSelect = el(
    'select',
    { id: 'field-caption-row', 'aria-label': 'Caption row' },
    captionRows.map((row) => el('option', { value: row.id, text: row.name })),
  );
  const file = el('input', { type: 'file', id: 'field-srt', accept: '.srt' });
  const cues = el('ul', { class: 'cues', 'aria-label': 'Cues', 'data-cues': '' });
  const handle = openDialog(
    'Captions',
    [
      el('div', { class: 'field' }, [el('label', { for: 'field-caption-row', text: 'Caption row' }), rowSelect]),
      el('div', { class: 'field' }, [el('label', { for: 'field-srt', text: 'SRT file' }), file]),
      el('div', { class: 'dialog-actions' }, [
        el('button', { type: 'button', class: 'primary', 'data-import': '', text: 'Import captions' }),
        el('a', { href: '#', 'data-download': '', text: 'Download SRT' }),
      ]),
      cues,
    ],
    opener,
  );
  const rate = rateOf(state);
  const drawCues = (): void => {
    clear(cues);
    const rowId = rowSelect.value;
    const list = state.detail.captions
      .filter((caption) => caption.row_id === rowId)
      .sort((a, b) => a.start_frame - b.start_frame);
    list.forEach((caption, index) => {
      const item = el('li', { class: 'cue', 'data-cue': caption.id }, [
        el('span', { class: 'tabular', text: `${timecode(caption.start_frame, rate)} ${timecode(caption.end_frame, rate)}` }),
        el('span', { class: 'cue-text', text: caption.text }),
        el('button', { type: 'button', 'data-edit-cue': caption.id, text: `Edit cue ${index + 1}` }),
      ]);
      cues.append(item);
      find<HTMLButtonElement>('[data-edit-cue]', item)?.addEventListener('click', () => {
        const editor = el('textarea', { 'aria-label': 'Cue text', rows: '2' });
        editor.value = caption.text;
        const longest = (text: string): number => Math.max(...text.split('\n').map((line) => codePoints(line)));
        const counter = el('span', { class: 'muted tabular', 'data-count': String(42 - longest(caption.text)) });
        const save = el('button', { type: 'button', class: 'primary', 'data-save-cue': '', text: 'Save cue' });
        const cancel = el('button', { type: 'button', 'data-cancel-cue': '', text: 'Cancel cue' });
        const panel = el('div', { class: 'cue-editor' }, [
          editor,
          el('p', { class: 'counter' }, [counter, el('span', { text: ' characters left' })]),
          save,
          cancel,
        ]);
        item.append(panel);
        editor.focus();
        const refreshCounter = (): void => {
          const left = 42 - longest(editor.value);
          counter.dataset.count = String(left);
          counter.textContent = String(left);
          const lines = editor.value.split('\n');
          save.disabled = left < 0 || lines.length > 2 || editor.value.trim() === '';
        };
        refreshCounter();
        editor.addEventListener('input', refreshCounter);
        const closeEditor = (): void => {
          panel.remove();
          find<HTMLButtonElement>(`[data-edit-cue="${caption.id}"]`, item)?.focus();
        };
        cancel.addEventListener('click', closeEditor);
        const commit = (): void => {
          void post(`/api/projects/${state.projectId}/ops`, {
            op_id: newOpId(),
            base_version: state.version,
            type: 'caption_edit',
            caption_id: caption.id,
            start_frame: caption.start_frame,
            end_frame: caption.end_frame,
            text: editor.value,
          })
            .then(() => {
              caption.text = editor.value;
              panel.remove();
              drawCues();
              find<HTMLButtonElement>(`[data-edit-cue="${caption.id}"]`, cues)?.focus();
              redraw();
            })
            .catch((error: unknown) => {
              if (error instanceof ApiCallError) notice(error.failure.errors?.text ?? error.failure.message);
            });
        };
        save.addEventListener('click', commit);
        editor.addEventListener('keydown', (event) => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            commit();
          }
        });
      });
    });
  };
  rowSelect.addEventListener('change', drawCues);
  drawCues();
  const download = find<HTMLAnchorElement>('[data-download]', handle.dialog);
  const setDownload = (): void => {
    if (download !== null) {
      download.href = `/api/projects/${state.projectId}/rows/${rowSelect.value}/captions/export`;
    }
  };
  setDownload();
  rowSelect.addEventListener('change', setDownload);
  find<HTMLButtonElement>('[data-import]', handle.dialog)?.addEventListener('click', () => {
    const chosen = file.files?.[0];
    if (chosen === undefined) return;
    notice(`Reading ${chosen.name}…`);
    void chosen.arrayBuffer().then((buffer) =>
      call<{ cues: number; version: number }>(
        'POST',
        `/api/projects/${state.projectId}/rows/${rowSelect.value}/captions/import`,
        new Uint8Array(buffer),
        { 'content-type': 'application/x-subrip' },
      )
        .then(async (result) => {
          state.version = result.version;
          const row = state.detail.rows.find((candidate) => candidate.id === rowSelect.value);
          notice(`${result.cues} captions imported into ${row?.name ?? 'the row'}.`);
          const detail = await get<typeof state.detail>(`/api/projects/${state.projectId}`);
          state.detail = detail;
          drawCues();
          redraw();
        })
        .catch((error: unknown) => {
          if (error instanceof ApiCallError) {
            handle.errorSummary({ srt: error.failure.errors?.srt ?? error.failure.message });
          }
        }),
    );
  });
}

export function compareDialog(state: PageState, redraw: Redraw, opener: HTMLElement | null): void {
  const from = el(
    'select',
    { id: 'field-from-cut', 'aria-label': 'From cut' },
    state.cuts.map((cut) => el('option', { value: cut.id, text: cut.name })),
  );
  const to = el(
    'select',
    { id: 'field-to-cut', 'aria-label': 'To cut' },
    state.cuts.map((cut) => el('option', { value: cut.id, text: cut.name })),
  );
  const table = el('table', { 'aria-label': 'Cut differences' }, [
    el('thead', {}, [
      el('tr', {}, [
        el('th', { text: 'Change' }),
        el('th', { text: 'Clip' }),
        el('th', { text: 'From' }),
        el('th', { text: 'To' }),
      ]),
    ]),
    el('tbody', { 'data-diff-body': '' }),
  ]);
  const restore = el('button', { type: 'button', 'data-restore': '', text: 'Restore cut' });
  const handle = openDialog(
    'Compare cuts',
    [
      el('div', { class: 'field' }, [el('label', { for: 'field-from-cut', text: 'From cut' }), from]),
      el('div', { class: 'field' }, [el('label', { for: 'field-to-cut', text: 'To cut' }), to]),
      table,
      state.detail.project.role === 'owner' ? el('div', { class: 'dialog-actions' }, [restore]) : null,
    ],
    opener,
  );
  if (state.cuts.length > 1) to.value = state.cuts[state.cuts.length - 1].id;
  const rate = rateOf(state);
  const refresh = (): void => {
    const toCut = state.cuts.find((cut) => cut.id === to.value);
    restore.textContent = `Restore cut ${toCut?.name ?? ''}`.trim();
    void get<{
      added: string[];
      removed: string[];
      changed: { clip_id: string; from: { start_frame: number; end_frame: number }; to: { start_frame: number; end_frame: number } }[];
      frame_delta: number;
    }>(`/api/projects/${state.projectId}/cuts/${from.value}/compare/${to.value}`).then((diff) => {
      const body = find<HTMLElement>('[data-diff-body]', handle.dialog);
      if (body === null) return;
      clear(body);
      for (const id of diff.added) {
        body.append(el('tr', {}, [el('td', { text: 'added' }), el('td', { text: id }), el('td'), el('td')]));
      }
      for (const id of diff.removed) {
        body.append(el('tr', {}, [el('td', { text: 'removed' }), el('td', { text: id }), el('td'), el('td')]));
      }
      for (const change of diff.changed) {
        body.append(
          el('tr', {}, [
            el('td', { text: 'changed' }),
            el('td', { text: change.clip_id }),
            el('td', { class: 'tabular', text: timecode(change.from.start_frame, rate) }),
            el('td', { class: 'tabular', text: timecode(change.to.start_frame, rate) }),
          ]),
        );
      }
    });
  };
  from.addEventListener('change', refresh);
  to.addEventListener('change', refresh);
  refresh();
  restore.addEventListener('click', () => {
    notice('Restoring…');
    void post<{ version: number }>(`/api/projects/${state.projectId}/cuts/${to.value}/restore`, {
      op_id: newOpId(),
      base_version: state.version,
    })
      .then(async () => {
        const cut = state.cuts.find((candidate) => candidate.id === to.value);
        notice(`${cut?.name ?? 'That cut'} restored.`);
        const detail = await get<typeof state.detail>(`/api/projects/${state.projectId}`);
        state.detail = detail;
        state.version = detail.project.version;
        handle.close();
        redraw();
      })
      .catch((error: unknown) => {
        if (error instanceof ApiCallError) notice(error.failure.message);
      });
  });
}

export function frameSizeDialog(state: PageState, redraw: Redraw, opener: HTMLElement | null): void {
  const handle = openDialog(
    'Frame size',
    [
      selectField('aspect', 'Aspect ratio', [...ASPECT_RATIOS], state.detail.project.aspect_ratio),
      el('div', { class: 'dialog-actions' }, [
        el('button', { type: 'button', class: 'primary', 'data-change': '', text: 'Change frame' }),
        el('button', { type: 'button', 'data-cancel': '', text: 'Cancel' }),
      ]),
    ],
    opener,
  );
  find<HTMLButtonElement>('[data-cancel]', handle.dialog)?.addEventListener('click', handle.close);
  find<HTMLButtonElement>('[data-change]', handle.dialog)?.addEventListener('click', () => {
    const aspect = fieldValue(handle.dialog, 'aspect');
    notice('Changing frame…');
    void put<{ version: number; project: typeof state.detail.project }>(`/api/projects/${state.projectId}`, {
      op_id: newOpId(),
      base_version: state.version,
      aspect_ratio: aspect,
    })
      .then(async () => {
        const detail = await get<typeof state.detail>(`/api/projects/${state.projectId}`);
        state.detail = detail;
        state.version = detail.project.version;
        notice(`The frame is now ${aspect}.`);
        handle.close();
        redraw();
      })
      .catch((error: unknown) => {
        if (error instanceof ApiCallError) {
          handle.errorSummary(error.failure.errors ?? { aspect: error.failure.message });
          notice(error.failure.message);
        }
      });
  });
}

export function membersDialog(state: PageState, redraw: Redraw, opener: HTMLElement | null): void {
  const rows = el('div', { 'data-members': '' });
  const email = el('input', { type: 'text', id: 'field-email', 'aria-label': 'Email' });
  const role = el('select', { id: 'field-role', 'aria-label': 'Role' }, [
    el('option', { value: 'editor', text: 'editor' }),
    el('option', { value: 'commenter', text: 'commenter' }),
  ]);
  const handle = openDialog(
    'Project members',
    [
      rows,
      el('div', { class: 'field' }, [el('label', { for: 'field-email', text: 'Email' }), email]),
      el('div', { class: 'field' }, [el('label', { for: 'field-role', text: 'Role' }), role]),
      el('div', { class: 'dialog-actions' }, [
        el('button', { type: 'button', class: 'primary', 'data-add': '', text: 'Add member' }),
      ]),
    ],
    opener,
  );
  const draw = (): void => {
    clear(rows);
    for (const member of state.members) {
      const select = el(
        'select',
        { 'aria-label': `Role for ${member.person.name}`, 'data-member-role': member.person.id },
        ['owner', 'editor', 'commenter'].map((option) =>
          el('option', { value: option, text: option, selected: option === member.role }),
        ),
      );
      const row = el('div', { class: 'row' }, [
        el('span', { text: member.person.name }),
        select,
        el('button', { type: 'button', 'data-remove-member': member.person.id, text: `Remove ${member.person.name}` }),
      ]);
      rows.append(row);
      select.addEventListener('change', () => {
        void put(`/api/projects/${state.projectId}/members/${member.person.id}`, { role: select.value })
          .then(() => {
            member.role = select.value as typeof member.role;
            notice(`${member.person.name} is now ${select.value}.`);
          })
          .catch((error: unknown) => {
            if (error instanceof ApiCallError) notice(error.failure.message);
          });
      });
      find<HTMLButtonElement>('[data-remove-member]', row)?.addEventListener('click', () => {
        void remove(`/api/projects/${state.projectId}/members/${member.person.id}`)
          .then(() => {
            state.members = state.members.filter((candidate) => candidate.person.id !== member.person.id);
            draw();
            redraw();
          })
          .catch((error: unknown) => {
            if (error instanceof ApiCallError) notice(error.failure.message);
          });
      });
    }
  };
  draw();
  find<HTMLButtonElement>('[data-add]', handle.dialog)?.addEventListener('click', () => {
    void post<{ person: { id: string; name: string; handle: string; email: string }; role: string }>(
      `/api/projects/${state.projectId}/members`,
      { email: email.value, role: role.value },
    )
      .then((member) => {
        state.members = [...state.members, member as (typeof state.members)[number]];
        notice(`${member.person.name} added as ${member.role}.`);
        email.value = '';
        draw();
        redraw();
      })
      .catch((error: unknown) => {
        if (error instanceof ApiCallError) {
          handle.errorSummary(error.failure.errors ?? { email: error.failure.message });
          notice(error.failure.message);
        }
      });
  });
}

