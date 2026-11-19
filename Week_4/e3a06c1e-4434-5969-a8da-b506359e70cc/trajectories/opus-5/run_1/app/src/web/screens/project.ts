import { ApiFailure, newIdempotencyKey, request } from '../api.js';
import { clear, el, field, setText, showFieldError } from '../dom.js';
import { BINS } from '../field/scene.js';
import { setPendingMorph } from '../field/morph.js';
import { takeFlash } from '../flash.js';
import { navigate, type Screen } from '../router.js';
import { landingRoute, may, serviceStatus, type Identity } from '../state.js';
import { openDialog } from '../ui/dialog.js';
import { StatusRegion } from '../ui/status.js';
import { billableMinutesText, quotaMeterPercent, quotaMeterText } from '../../shared/billing.js';
import {
  fieldCopy,
  genericFailure,
  keysCopy,
  quotaHaltBanner,
  serviceCopy,
  settingsCopy,
  synthesisCopy,
  uploadCopy,
} from '../../shared/copy.js';
import type {
  CorrectionView,
  KeyView,
  ProjectView,
  SessionView,
  SpectrumView,
  SynthesisJobView,
} from '../../shared/types.js';

export type ProjectTab = 'keys' | 'sessions' | 'review' | 'synthesis' | 'settings';

const tabOrder: readonly ProjectTab[] = ['keys', 'sessions', 'review', 'synthesis', 'settings'];
const tabLabels: Record<ProjectTab, string> = {
  keys: 'Keys',
  sessions: 'Sessions',
  review: 'Review',
  synthesis: 'Synthesis',
  settings: 'Settings',
};

const utcStamp = (iso: string): string => `${iso.slice(0, 10)} ${iso.slice(11, 19)}`;

const secondsText = (audioMs: number): string => `${(audioMs / 1000).toFixed(3)} s`;

interface TabView {
  readonly node: HTMLElement;
  destroy?(): void;
}

const activeKeys = (keys: readonly KeyView[]): KeyView[] => keys.filter((key) => key.revoked_at === null);

const keySelect = (keys: readonly KeyView[], id: string): HTMLSelectElement =>
  el(
    'select',
    { id, 'aria-label': 'API key', class: 'input' },
    activeKeys(keys).map((key) => el('option', { value: key.id, text: `${key.name} (${key.prefix})` })),
  );

const keysTab = (projectId: string): TabView => {
  const status = new StatusRegion('Keys status');
  const body = el('tbody');
  const table = el('table', { 'aria-label': 'API keys', class: 'table', tabindex: '-1' }, [
    el('thead', {}, [
      el('tr', {}, [
        el('th', { scope: 'col', text: 'Name' }),
        el('th', { scope: 'col', text: 'Prefix' }),
        el('th', { scope: 'col', text: 'Created' }),
        el('th', { scope: 'col', text: 'State' }),
        el('th', { scope: 'col', text: 'Action' }),
      ]),
    ]),
    body,
  ]);

  const load = async (): Promise<void> => {
    const reply = await request<{ keys: KeyView[] }>(`/api/projects/${projectId}/keys`);
    clear(body);
    for (const key of reply.keys) {
      const action = el('td');
      if (key.revoked_at === null) {
        const revoke = el('button', { type: 'button', class: 'button', text: `Revoke ${key.name}` });
        revoke.setAttribute('aria-label', `Revoke ${key.name}`);
        revoke.addEventListener('click', () => confirmRevoke(key));
        action.append(revoke);
      }
      body.append(
        el('tr', {}, [
          el('th', { scope: 'row', text: key.name }),
          el('td', { class: 'numeric', text: key.prefix }),
          el('td', { class: 'numeric', text: utcStamp(key.created_at) }),
          el('td', { text: key.revoked_at === null ? 'Active' : 'Revoked' }),
          action,
        ]),
      );
    }
  };

  const confirmRevoke = (key: KeyView): void => {
    openDialog('Revoke key', (handle) => {
      const confirm = el('button', { type: 'button', class: 'button button-primary', text: 'Revoke key' });
      const cancel = el('button', { type: 'button', class: 'button', text: 'Cancel' });
      cancel.addEventListener('click', () => handle.close());
      confirm.addEventListener('click', () => {
        confirm.disabled = true;
        void request<{ closed_sessions: string[] }>(`/api/projects/${projectId}/keys/${key.id}`, {
          method: 'DELETE',
        })
          .then((reply) => {
            handle.close();
            table.focus();
            status.set(keysCopy.keyRevoked(reply.closed_sessions.length));
            void load();
          })
          .catch(() => {
            confirm.disabled = false;
            status.set(genericFailure);
          });
      });
      handle.body.append(
        el('div', { class: 'dialog-form' }, [
          el('h2', { class: 'dialog-title', text: 'Revoke key' }),
          el('p', { text: `${key.name} will stop working at once, and its live sessions will end.` }),
          el('div', { class: 'dialog-actions' }, [confirm, cancel]),
        ]),
      );
    });
  };

  const issue = el('button', { type: 'button', class: 'button button-primary', text: 'Issue key' });
  issue.addEventListener('click', () => {
    openDialog('Issue key', (handle) => {
      const name = el('input', { type: 'text', id: 'key-name', 'aria-label': 'Key name', class: 'input' });
      const nameField = field('Key name', name, 'key-name-error');
      const create = el('button', { type: 'submit', class: 'button button-primary', text: 'Create key' });
      const form = el('form', { class: 'dialog-form', novalidate: true }, [
        el('h2', { class: 'dialog-title', text: 'Issue key' }),
        nameField.row,
        el('div', { class: 'dialog-actions' }, [create]),
      ]);
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        create.disabled = true;
        showFieldError(name, nameField.error, null);
        void request<{ key: KeyView; secret: string }>(`/api/projects/${projectId}/keys`, {
          method: 'POST',
          json: { name: name.value },
        })
          .then((reply) => {
            status.set(keysCopy.keyIssued);
            const secret = el('input', {
              type: 'text',
              id: 'new-key-secret',
              'aria-label': 'New key',
              class: 'input numeric',
              readonly: true,
              value: reply.secret,
            });
            secret.value = reply.secret;
            const copy = el('button', { type: 'button', class: 'button', text: 'Copy key' });
            copy.addEventListener('click', () => {
              secret.select();
              void navigator.clipboard?.writeText(reply.secret).catch(() => undefined);
            });
            clear(form);
            form.append(
              el('h2', { class: 'dialog-title', text: 'Issue key' }),
              field('New key', secret, 'new-key-error').row,
              el('div', { class: 'dialog-actions' }, [copy]),
            );
            secret.focus();
            void load();
          })
          .catch((error: unknown) => {
            create.disabled = false;
            const message = error instanceof ApiFailure ? error.fields.name : undefined;
            showFieldError(name, nameField.error, message ?? null);
            status.set(message ?? genericFailure);
          });
      });
      handle.body.append(form);
    });
  });

  const flash = takeFlash();
  if (flash !== null) status.set(flash);
  void load();

  return {
    node: el('div', { class: 'tab-panel' }, [
      el('div', { class: 'tab-actions' }, [issue]),
      status.node,
      table,
    ]),
  };
};

const drawThumbnail = (canvas: HTMLCanvasElement, mean: readonly number[]): void => {
  const context = canvas.getContext('2d');
  if (context === null) return;
  const width = canvas.width;
  const height = canvas.height;
  context.fillStyle = '#08090b';
  context.fillRect(0, 0, width, height);
  context.fillStyle = '#3ddc97';
  for (let i = 0; i < BINS; i += 1) {
    const from = Math.floor((i * width) / BINS);
    const to = Math.floor(((i + 1) * width) / BINS) - 1;
    const lit = Math.round((mean[i] ?? 0) * height);
    if (lit <= 0 || to < from) continue;
    context.fillRect(from, height - lit, to - from + 1, lit);
  }
};

const startSessionDialog = (projectId: string, keys: readonly KeyView[]): void => {
  const idempotencyKey = newIdempotencyKey();
  openDialog('Start session', (handle) => {
    const status = new StatusRegion('Upload status');
    const key = keySelect(keys, 'start-key');
    const tone = el('input', { type: 'radio', name: 'source', id: 'source-tone', value: 'tone', checked: true });
    const upload = el('input', { type: 'radio', name: 'source', id: 'source-upload', value: 'upload' });
    const source = el('fieldset', { role: 'radiogroup', 'aria-label': 'Source', class: 'radio-group' }, [
      el('legend', { class: 'field-label', text: 'Source' }),
      el('div', { class: 'radio-row' }, [
        el('label', { class: 'radio', for: 'source-tone' }, [tone, el('span', { text: 'Test tone (1 kHz)' })]),
        el('label', { class: 'radio', for: 'source-upload' }, [upload, el('span', { text: 'Upload recording' })]),
      ]),
    ]);
    const audio = el('input', { type: 'file', id: 'start-audio', accept: '.wav,audio/wav', class: 'input' });
    const sidecar = el('input', { type: 'file', id: 'start-sidecar', accept: '.vtt,text/vtt', class: 'input' });
    const label = el('input', { type: 'text', id: 'start-label', 'aria-label': 'Label', class: 'input' });
    const keyField = field('API key', key, 'start-key-error');
    const audioField = field('Audio file', audio, 'start-audio-error');
    const sidecarField = field('Sidecar (WebVTT)', sidecar, 'start-sidecar-error');
    const labelField = field('Label', label, 'start-label-error');
    const start = el('button', { type: 'submit', class: 'button button-primary', text: 'Start' });

    const form = el('form', { class: 'dialog-form', novalidate: true }, [
      el('h2', { class: 'dialog-title', text: 'Start session' }),
      keyField.row,
      source,
      audioField.row,
      sidecarField.row,
      labelField.row,
      el('div', { class: 'dialog-actions' }, [start]),
      status.node,
    ]);

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      start.disabled = true;
      status.set(uploadCopy.pending);
      for (const entry of [
        [key, keyField.error],
        [audio, audioField.error],
        [sidecar, sidecarField.error],
        [label, labelField.error],
      ] as const)
        showFieldError(entry[0], entry[1], null);

      const data = new FormData();
      data.set('key_id', key.value);
      data.set('source', tone.checked ? 'tone' : 'upload');
      data.set('label', label.value);
      const audioFile = audio.files?.[0];
      if (audioFile !== undefined) data.set('audio', audioFile);
      const sidecarFile = sidecar.files?.[0];
      if (sidecarFile !== undefined) data.set('sidecar', sidecarFile);

      void request<{ session: SessionView }>(`/api/projects/${projectId}/sessions`, {
        method: 'POST',
        form: data,
        idempotencyKey,
      })
        .then((reply) => {
          serviceStatus.noteStorageSuccess();
          handle.close();
          navigate(`/console/sessions/${reply.session.id}`);
        })
        .catch((error: unknown) => {
          start.disabled = false;
          if (!(error instanceof ApiFailure)) {
            status.set(genericFailure);
            return;
          }
          if (error.code === 'storage_unavailable') {
            serviceStatus.noteStorageFailure();
            status.set(serviceCopy.storageOutage);
            return;
          }
          if (error.code === 'quota_exhausted') {
            void request<{ project: ProjectView }>(`/api/projects/${projectId}`).then((reply) =>
              status.set(
                quotaHaltBanner(
                  reply.project.quota.limit_minutes,
                  reply.project.quota.period_start,
                  reply.project.quota.resets_at,
                ),
              ),
            );
            return;
          }
          if (error.status === 413) {
            showFieldError(audio, audioField.error, fieldCopy.audioTooLarge);
            status.set(fieldCopy.audioTooLarge);
            return;
          }
          const fields = error.fields;
          showFieldError(key, keyField.error, fields.key_id ?? null);
          showFieldError(audio, audioField.error, fields.audio ?? null);
          showFieldError(sidecar, sidecarField.error, fields.sidecar ?? null);
          showFieldError(label, labelField.error, fields.label ?? null);
          const first = fields.audio ?? fields.sidecar ?? fields.key_id ?? fields.label ?? fields.source;
          status.set(first ?? genericFailure);
        });
    });
    handle.body.append(form);
  });
};

const sessionsTab = (projectId: string): TabView => {
  const body = el('tbody');
  const table = el('table', { 'aria-label': 'Sessions', class: 'table' }, [
    el('thead', {}, [
      el('tr', {}, [
        el('th', { scope: 'col', text: 'Field' }),
        el('th', { scope: 'col', text: 'Label' }),
        el('th', { scope: 'col', text: 'Kind' }),
        el('th', { scope: 'col', text: 'State' }),
        el('th', { scope: 'col', text: 'Audio' }),
        el('th', { scope: 'col', text: 'Billable minutes' }),
        el('th', { scope: 'col', text: 'Started' }),
      ]),
    ]),
    body,
  ]);
  const actions = el('div', { class: 'tab-actions' });
  let keys: KeyView[] = [];

  const start = el('button', { type: 'button', class: 'button button-primary', text: 'Start session' });
  start.addEventListener('click', () => startSessionDialog(projectId, keys));
  actions.append(start);

  const load = async (): Promise<void> => {
    const [sessions, keyReply] = await Promise.all([
      request<{ sessions: SessionView[] }>(`/api/projects/${projectId}/sessions`),
      request<{ keys: KeyView[] }>(`/api/projects/${projectId}/keys`).catch(() => ({ keys: [] as KeyView[] })),
    ]);
    keys = keyReply.keys;
    clear(body);
    for (const session of sessions.sessions) {
      const thumbnail = el('canvas', {
        role: 'img',
        'aria-label': 'Spectrum thumbnail',
        class: 'thumbnail',
        'data-morph': session.id,
        width: 96,
        height: 28,
      });
      const link = el('a', {
        href: `/console/sessions/${session.id}`,
        class: 'link',
        text: session.label || 'Untitled session',
      });
      link.addEventListener('click', () => setPendingMorph(session.id, thumbnail));
      body.append(
        el('tr', {}, [
          el('td', {}, [thumbnail]),
          el('th', { scope: 'row' }, [link]),
          el('td', { text: session.kind }),
          el('td', { text: session.state }),
          el('td', { class: 'numeric', text: secondsText(session.audio_ms) }),
          el('td', {
            class: 'numeric',
            text: session.billable_seconds === null ? '—' : billableMinutesText(session.billable_seconds),
          }),
          el('td', { class: 'numeric', text: utcStamp(session.started_at) }),
        ]),
      );
      void request<SpectrumView>(`/api/sessions/${session.id}/spectrum`)
        .then((spectrum) => drawThumbnail(thumbnail, spectrum.mean))
        .catch(() => undefined);
    }
  };
  void load();

  return { node: el('div', { class: 'tab-panel' }, [actions, table]) };
};

const correctionTable = (name: string, rows: readonly CorrectionView[]): HTMLElement => {
  const body = el('tbody');
  for (const correction of rows)
    body.append(
      el('tr', {}, [
        el('th', { scope: 'row', text: correction.author.name }),
        el('td', { text: correction.state }),
        el('td', { text: correction.text }),
        el('td', { class: 'numeric', text: utcStamp(correction.created_at) }),
        el('td', {}, [
          el('a', {
            href: `/console/sessions/${correction.session_id}?segment=${correction.segment_id}`,
            class: 'link',
            text: 'Open correction',
          }),
        ]),
      ]),
    );
  return el('table', { 'aria-label': name, class: 'table' }, [
    el('thead', {}, [
      el('tr', {}, [
        el('th', { scope: 'col', text: 'Author' }),
        el('th', { scope: 'col', text: 'State' }),
        el('th', { scope: 'col', text: 'Correction' }),
        el('th', { scope: 'col', text: 'Created' }),
        el('th', { scope: 'col', text: 'Open' }),
      ]),
    ]),
    body,
  ]);
};

const reviewTab = (projectId: string, identity: Identity): TabView => {
  const node = el('div', { class: 'tab-panel' });
  void request<{ corrections: CorrectionView[] }>(`/api/projects/${projectId}/corrections`).then((reply) => {
    const submitted = reply.corrections.filter((correction) => correction.state === 'submitted');
    const own = reply.corrections.filter(
      (correction) =>
        correction.author.id === identity.user.id &&
        (correction.state === 'draft' || correction.state === 'returned' || correction.state === 'submitted'),
    );
    clear(node);
    node.append(
      el('h2', { class: 'section-title', text: 'Awaiting approval' }),
      correctionTable('Awaiting approval', submitted),
      el('h2', { class: 'section-title', text: 'Your open corrections' }),
      correctionTable('Your open corrections', own),
    );
  });
  return { node };
};

const synthesisTab = (projectId: string): TabView => {
  const status = new StatusRegion('Synthesis status');
  const player = el('audio', { controls: true, 'aria-label': 'Rendered audio', class: 'audio-player' });
  const node = el('div', { class: 'tab-panel' });

  void request<{ keys: KeyView[] }>(`/api/projects/${projectId}/keys`).then((reply) => {
    const key = keySelect(reply.keys, 'synthesis-key');
    const text = el('textarea', { id: 'synthesis-text', 'aria-label': 'Text to speak', class: 'input textarea' });
    const lumen = el('input', { type: 'radio', name: 'voice', id: 'voice-lumen', value: 'lumen', checked: true });
    const basalt = el('input', { type: 'radio', name: 'voice', id: 'voice-basalt', value: 'basalt' });
    const voice = el('fieldset', { role: 'radiogroup', 'aria-label': 'Voice', class: 'radio-group' }, [
      el('legend', { class: 'field-label', text: 'Voice' }),
      el('div', { class: 'radio-row' }, [
        el('label', { class: 'radio', for: 'voice-lumen' }, [lumen, el('span', { text: 'Lumen' })]),
        el('label', { class: 'radio', for: 'voice-basalt' }, [basalt, el('span', { text: 'Basalt' })]),
      ]),
    ]);
    const render = el('button', { type: 'submit', class: 'button button-primary', text: 'Render' });
    const keyField = field('API key', key, 'synthesis-key-error');
    const textField = field('Text to speak', text, 'synthesis-text-error');

    const form = el('form', { class: 'stack', novalidate: true }, [
      keyField.row,
      textField.row,
      voice,
      el('div', { class: 'dialog-actions' }, [render]),
    ]);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      render.disabled = true;
      status.set(synthesisCopy.pending);
      showFieldError(text, textField.error, null);
      showFieldError(key, keyField.error, null);
      void request<{ job: SynthesisJobView }>(`/api/projects/${projectId}/synthesis`, {
        method: 'POST',
        json: { key_id: key.value, text: text.value, voice: lumen.checked ? 'lumen' : 'basalt' },
      })
        .then(async (reply) => {
          render.disabled = false;
          status.set(synthesisCopy.success((reply.job.duration_ms / 1000).toFixed(3)));
          const response = await fetch(reply.job.console_audio_url, { credentials: 'same-origin' });
          if (!response.ok) {
            serviceStatus.noteStorageFailure();
            return;
          }
          serviceStatus.noteStorageSuccess();
          player.src = URL.createObjectURL(await response.blob());
        })
        .catch((error: unknown) => {
          render.disabled = false;
          if (!(error instanceof ApiFailure)) {
            status.set(genericFailure);
            return;
          }
          if (error.code === 'storage_unavailable') {
            serviceStatus.noteStorageFailure();
            status.set(serviceCopy.storageOutage);
            return;
          }
          showFieldError(text, textField.error, error.fields.text ?? null);
          showFieldError(key, keyField.error, error.fields.key_id ?? null);
          status.set(error.fields.text ?? error.fields.key_id ?? error.fields.voice ?? genericFailure);
        });
    });
    clear(node);
    node.append(form, status.node, el('div', { class: 'stack' }, [player]));
  });

  return { node };
};

const settingsTab = (project: ProjectView, onSaved: () => void): TabView => {
  const status = new StatusRegion('Settings status');
  const quota = el('input', {
    type: 'text',
    inputmode: 'numeric',
    id: 'settings-quota',
    'aria-label': 'Monthly quota (minutes)',
    class: 'input numeric',
  });
  quota.value = String(project.quota.limit_minutes);
  const quotaField = field('Monthly quota (minutes)', quota, 'settings-quota-error');
  const save = el('button', { type: 'submit', class: 'button button-primary', text: 'Save quota' });
  const form = el('form', { class: 'stack', novalidate: true }, [
    quotaField.row,
    el('div', { class: 'dialog-actions' }, [save]),
    status.node,
  ]);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    save.disabled = true;
    showFieldError(quota, quotaField.error, null);
    void request(`/api/projects/${project.id}/quota`, {
      method: 'PATCH',
      json: { monthly_quota_minutes: Number(quota.value.trim()) },
    })
      .then(() => {
        save.disabled = false;
        status.set(settingsCopy.saved);
        onSaved();
      })
      .catch((error: unknown) => {
        save.disabled = false;
        const message = error instanceof ApiFailure ? error.fields.monthly_quota_minutes : undefined;
        showFieldError(quota, quotaField.error, message ?? null);
        status.set(message ?? genericFailure);
      });
  });
  return { node: el('div', { class: 'tab-panel' }, [form]) };
};

export const projectScreen = (identity: Identity, projectId: string, tab: ProjectTab): Screen => {
  const role = identity.user.role;
  if (!may(role, tab)) {
    navigate(landingRoute(role), { replace: true });
    return { node: el('section', { class: 'screen' }) };
  }

  const title = el('h1', { class: 'screen-title', text: 'Project' });
  const meter = el('div', {
    role: 'progressbar',
    'aria-label': 'Quota used',
    'aria-valuemin': '0',
    'aria-valuemax': '100',
    'aria-valuenow': '0',
    class: 'meter',
  });
  const meterFill = el('span', { class: 'meter-fill' });
  const meterText = el('span', { class: 'meter-text numeric' });
  meter.append(meterFill, meterText);
  const quotaStatus = new StatusRegion('Quota status');

  const tabs = el('div', { role: 'tablist', 'aria-label': 'Project', class: 'tablist' });
  for (const name of tabOrder) {
    if (!may(role, name)) continue;
    const link = el('a', {
      role: 'tab',
      href: `/console/projects/${projectId}/${name}`,
      class: 'tab',
      text: tabLabels[name],
      'aria-selected': name === tab ? 'true' : 'false',
    });
    tabs.append(link);
  }

  const panel = el('div', { class: 'tab-holder' });
  const node = el('section', { class: 'screen' }, [
    el('div', { class: 'screen-header' }, [title, meter]),
    quotaStatus.node,
    tabs,
    panel,
  ]);

  let active: TabView | null = null;
  let poll = 0;

  const applyProject = (project: ProjectView): void => {
    setText(title, project.name);
    const percent = quotaMeterPercent(project.quota.used_seconds, project.quota.limit_minutes);
    meter.setAttribute('aria-valuenow', String(percent));
    meterFill.style.width = `${percent}%`;
    setText(meterText, quotaMeterText(project.quota.used_seconds, project.quota.limit_minutes));
    if (project.quota.exhausted)
      quotaStatus.banner(
        quotaHaltBanner(project.quota.limit_minutes, project.quota.period_start, project.quota.resets_at),
        'caution',
      );
    else quotaStatus.clear();
  };

  const mountTab = (project: ProjectView): void => {
    active?.destroy?.();
    clear(panel);
    const view =
      tab === 'keys'
        ? keysTab(projectId)
        : tab === 'sessions'
          ? sessionsTab(projectId)
          : tab === 'review'
            ? reviewTab(projectId, identity)
            : tab === 'synthesis'
              ? synthesisTab(projectId)
              : settingsTab(project, () => void refresh());
    active = view;
    panel.append(view.node);
  };

  const refresh = async (): Promise<ProjectView> => {
    const reply = await request<{ project: ProjectView }>(`/api/projects/${projectId}`);
    applyProject(reply.project);
    return reply.project;
  };

  void refresh()
    .then((project) => {
      mountTab(project);
      poll = window.setInterval(() => void refresh().catch(() => undefined), 2000);
    })
    .catch(() => navigate(landingRoute(role), { replace: true }));

  return {
    node,
    destroy: () => {
      window.clearInterval(poll);
      active?.destroy?.();
    },
  };
};
