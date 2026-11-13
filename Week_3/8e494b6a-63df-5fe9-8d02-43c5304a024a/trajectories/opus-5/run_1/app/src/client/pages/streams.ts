import { clear, el } from '../dom.js';
import { displayTime } from '../format.js';
import { refreshIngest, navigate } from '../main.js';
import {
  announce,
  ApiFailure,
  get,
  roleAllows,
  setLiveHandler,
  state,
  write,
  zone,
  type LiveMessage,
} from '../state.js';
import { emptyBand, loadFailed, openDialog, showFormError } from '../widgets.js';

type StreamSummary = { name: string; write_generation: number; events: number; failures: number };

type Generation = {
  number: number;
  phase: string;
  created_at: string;
  rolled_over_at: string | null;
  events: number;
  next: { step: string; at: string | null } | null;
  segment: { key: string; bytes: number } | null;
  timeline: string;
  archive_failed: boolean;
  delete_failed: boolean;
};

type StreamDetail = {
  name: string;
  mapping: { field: string; type: string; generation: number; explicit: boolean }[];
  generations: Generation[];
};

type Upload = {
  id: number;
  file: string;
  bytes: number;
  status: string;
  done_lines: number;
  total_lines: number;
  created: number;
  duplicates: number;
  dropped: number;
  failed: number;
};

export async function renderStreams(main: HTMLElement): Promise<void> {
  let data: { streams: StreamSummary[] };
  try {
    data = await get<{ streams: StreamSummary[] }>('/api/streams');
  } catch {
    main.append(loadFailed(() => void renderStreams(main)));
    return;
  }
  const newStream = el('button', {
    type: 'button',
    'aria-label': 'New stream',
    text: 'New stream',
    class: 'primary',
  });
  newStream.addEventListener('click', () => openNewStream(newStream, main));
  main.append(el('h1', { class: 'view-title', text: 'Streams' }));
  if (data.streams.length === 0) {
    main.append(emptyBand('No streams in this space yet.', newStream));
    return;
  }
  main.append(
    newStream,
    el('table', { 'aria-label': 'Streams', class: 'data-table' }, [
      el('thead', {}, [
        el('tr', {}, [
          el('th', { scope: 'col', text: 'Stream' }),
          el('th', { scope: 'col', text: 'Write generation' }),
          el('th', { scope: 'col', text: 'Events' }),
          el('th', { scope: 'col', text: 'Failures' }),
        ]),
      ]),
      el(
        'tbody',
        {},
        data.streams.map((stream) =>
          el('tr', {}, [
            el('td', {}, [el('a', { href: `/streams/${stream.name}`, text: stream.name })]),
            el('td', { class: 'mono', text: String(stream.write_generation) }),
            el('td', { class: 'mono', text: String(stream.events) }),
            el('td', { class: 'mono', text: String(stream.failures) }),
          ]),
        ),
      ),
    ]),
  );
}

function openNewStream(opener: HTMLButtonElement, main: HTMLElement): void {
  openDialog({
    label: 'New stream',
    opener,
    content: (dialog) => {
      const name = el('input', { type: 'text', 'aria-label': 'Stream name', 'data-field': 'name' });
      const create = el('button', {
        type: 'button',
        'aria-label': 'Create stream',
        text: 'Create stream',
        class: 'primary',
      });
      const host = el('div', {});
      create.addEventListener('click', () => {
        create.setAttribute('aria-busy', 'true');
        void (async () => {
          try {
            await write('POST', '/api/streams', { name: name.value });
            dialog.close();
            announce(`Stream ${name.value} created.`);
            clear(main);
            await renderStreams(main);
          } catch (cause) {
            if (cause instanceof ApiFailure) showFormError(host, cause);
          } finally {
            create.removeAttribute('aria-busy');
          }
        })();
      });
      return [el('h2', { text: 'New stream' }), host, name, create];
    },
  });
}

export async function renderStream(main: HTMLElement, params: Record<string, string>): Promise<void> {
  const name = params.stream;
  let detail: StreamDetail;
  try {
    detail = await get<StreamDetail>(`/api/streams/${encodeURIComponent(name)}`);
  } catch {
    main.append(loadFailed(() => void renderStream(main, params)));
    return;
  }
  const pipelines = await get<{ pipelines: { name: string }[] }>('/api/pipelines');
  const mappingTable = el('div', {});
  const renderMapping = (): void => {
    clear(mappingTable);
    mappingTable.append(
      el('table', { 'aria-label': 'Mapping', class: 'data-table' }, [
        el('thead', {}, [
          el('tr', {}, [
            el('th', { scope: 'col', text: 'Field' }),
            el('th', { scope: 'col', text: 'Type' }),
            el('th', { scope: 'col', text: 'Generation' }),
            el('th', { scope: 'col', text: 'Explicit' }),
          ]),
        ]),
        el(
          'tbody',
          {},
          detail.mapping.map((row) =>
            el('tr', {}, [
              el('td', { class: 'mono', text: row.field }),
              el('td', { class: 'mono', text: row.type }),
              el('td', { class: 'mono', text: String(row.generation) }),
              el('td', { class: 'mono', text: row.explicit ? 'yes' : 'no' }),
            ]),
          ),
        ),
      ]),
    );
  };
  renderMapping();

  const addField = el('button', { type: 'button', 'aria-label': 'Add field', text: 'Add field' });
  addField.addEventListener('click', () => {
    openDialog({
      label: 'Add field',
      opener: addField,
      content: (dialog) => {
        const field = el('input', { type: 'text', 'aria-label': 'Field name', 'data-field': 'field' });
        const type = el(
          'select',
          { 'aria-label': 'Field type' },
          ['number', 'date', 'boolean', 'text', 'keyword'].map((option) =>
            el('option', { value: option, text: option }),
          ),
        );
        const add = el('button', { type: 'button', 'aria-label': 'Add', text: 'Add', class: 'primary' });
        const host = el('div', {});
        add.addEventListener('click', () => {
          void (async () => {
            try {
              await write('POST', `/api/streams/${encodeURIComponent(name)}/mappings`, {
                field: field.value,
                type: type.value,
              });
              dialog.close();
              announce(`Field ${field.value} added as ${type.value}.`);
              detail = await get<StreamDetail>(`/api/streams/${encodeURIComponent(name)}`);
              renderMapping();
            } catch (cause) {
              if (cause instanceof ApiFailure) showFormError(host, cause);
            }
          })();
        });
        return [el('h2', { text: 'Add field' }), host, field, type, add];
      },
    });
  });

  const pipelineSelect = el(
    'select',
    { 'aria-label': 'Pipeline' },
    [
      el('option', { value: '', text: 'None' }),
      ...pipelines.pipelines.map((pipeline) => el('option', { value: pipeline.name, text: pipeline.name })),
    ],
  );
  const fileInput = el('input', { type: 'file', accept: '.ndjson', class: 'file-input' });
  const uploadButton = el('button', {
    type: 'button',
    'aria-label': 'Upload file',
    text: 'Upload file',
    class: 'primary',
  });
  const progress = el('div', {
    role: 'progressbar',
    'aria-label': 'Upload progress',
    'aria-valuenow': '0',
    'aria-valuemax': '0',
    class: 'progress',
  });
  const progressText = el('p', { class: 'mono' });
  const uploadHost = el('div', {});
  const failureHost = el('div', {
    role: 'region',
    'aria-label': 'Failure store',
    class: 'failure-store',
  });

  const renderUploads = (uploads: Upload[]): void => {
    clear(uploadHost);
    uploadHost.append(
      el('table', { 'aria-label': 'Uploads', class: 'data-table' }, [
        el('thead', {}, [
          el('tr', {}, [
            el('th', { scope: 'col', text: 'File' }),
            el('th', { scope: 'col', text: 'Bytes' }),
            el('th', { scope: 'col', text: 'Status' }),
          ]),
        ]),
        el(
          'tbody',
          {},
          uploads.map((upload) =>
            el('tr', {}, [
              el('td', { class: 'mono', text: upload.file }),
              el('td', { class: 'mono', text: String(upload.bytes) }),
              el('td', { class: 'mono', text: upload.status }),
            ]),
          ),
        ),
      ]),
    );
  };

  const refreshUploads = async (): Promise<void> => {
    const data = await get<{ uploads: Upload[] }>(`/api/streams/${encodeURIComponent(name)}/uploads`);
    renderUploads(data.uploads);
    const running = data.uploads.find((upload) => upload.status === 'parsing' || upload.status === 'kept');
    if (running) {
      progress.setAttribute('aria-valuenow', String(running.done_lines));
      progress.setAttribute('aria-valuemax', String(running.total_lines));
      progressText.textContent = `Upload: ${running.done_lines} of ${running.total_lines} lines`;
    }
  };

  const refreshFailures = async (): Promise<void> => {
    const data = await get<{ failures: { id: number; reason: string; raw: string; at: string }[] }>(
      `/api/streams/${encodeURIComponent(name)}/failures`,
    );
    clear(failureHost);
    failureHost.append(el('h2', { text: 'Failure store' }));
    for (const failure of data.failures) {
      failureHost.append(
        el('article', { class: 'failure', 'aria-label': failure.reason }, [
          el('p', { text: failure.reason }),
          el('pre', { class: 'mono', text: failure.raw }),
          el('p', { class: 'mono', text: displayTime(zone(), Date.parse(failure.at)) }),
        ]),
      );
    }
  };

  uploadButton.addEventListener('click', () => {
    const file = fileInput.files?.[0];
    if (!file) {
      fileInput.click();
      return;
    }
    uploadButton.setAttribute('aria-busy', 'true');
    void (async () => {
      const form = new FormData();
      form.append('file', file, file.name);
      if (pipelineSelect.value !== '') form.append('pipeline', pipelineSelect.value);
      try {
        await write('POST', `/api/streams/${encodeURIComponent(name)}/uploads`, undefined, form);
        await refreshUploads();
      } catch (cause) {
        if (cause instanceof ApiFailure) showFormError(uploadHost, cause);
      } finally {
        uploadButton.removeAttribute('aria-busy');
      }
    })();
  });

  const left = el('section', { class: 'card' }, [
    el('h2', { text: 'Mapping' }),
    mappingTable,
    roleAllows('admin') ? addField : null,
  ]);
  const right = el('section', { class: 'card' }, [
    el('h2', { text: 'Uploads' }),
    pipelineSelect,
    fileInput,
    uploadButton,
    progress,
    progressText,
    uploadHost,
  ]);
  main.append(
    el('h1', { class: 'view-title', text: `Stream ${detail.name}` }),
    el('div', { class: 'link-row' }, [
      el('a', { href: `/streams/${name}/analyze`, text: 'Analyze', 'aria-label': 'Analyze' }),
      el('a', { href: `/streams/${name}/lifecycle`, text: 'Lifecycle', 'aria-label': 'Lifecycle' }),
    ]),
    el('div', { class: 'two-column' }, [left, right]),
    failureHost,
  );
  await refreshUploads();
  await refreshFailures();
  setLiveHandler((message: LiveMessage) => {
    if (message.type !== 'upload') return;
    const done = Number(message.done_lines ?? 0);
    const total = Number(message.total_lines ?? 0);
    progress.setAttribute('aria-valuenow', String(done));
    progress.setAttribute('aria-valuemax', String(total));
    progressText.textContent = `Upload: ${done} of ${total} lines`;
    if (message.ended === true) {
      const created = Number(message.created ?? 0);
      const duplicates = Number(message.duplicates ?? 0);
      const failed = Number(message.failed ?? 0);
      const dropped = Number(message.dropped ?? 0);
      const parts = [
        `Upload done: ${created} created`,
        duplicates === 1 ? '1 duplicate' : `${duplicates} duplicates`,
        `${failed} failed`,
      ];
      let sentence = `${parts[0]}, ${parts[1]}, ${parts[2]}`;
      if (dropped > 0) sentence += `, ${dropped} dropped`;
      progressText.textContent = sentence;
      announce(sentence);
    }
    void refreshUploads();
    void refreshFailures();
    void refreshIngest();
  });
}

export async function renderAnalyze(main: HTMLElement, params: Record<string, string>): Promise<void> {
  const text = el('input', { type: 'text', 'aria-label': 'Text', class: 'mono', value: 'The servers failed, retrying 2 connections' });
  const analyzer = el(
    'select',
    { 'aria-label': 'Analyzer' },
    ['standard', 'keyword', 'whitespace'].map((option) => el('option', { value: option, text: option })),
  );
  const run = el('button', { type: 'button', 'aria-label': 'Analyze', text: 'Analyze', class: 'primary' });
  const host = el('div', {});
  run.addEventListener('click', () => {
    void (async () => {
      const data = await write<{ tokens: { token: string; position: number; start: number; end: number }[] }>(
        'POST',
        '/api/analyze',
        { analyzer: analyzer.value, text: text.value },
      );
      clear(host);
      host.append(
        el('table', { 'aria-label': 'Tokens', class: 'data-table' }, [
          el('thead', {}, [
            el('tr', {}, [
              el('th', { scope: 'col', text: 'Token' }),
              el('th', { scope: 'col', text: 'Position' }),
              el('th', { scope: 'col', text: 'Start' }),
              el('th', { scope: 'col', text: 'End' }),
            ]),
          ]),
          el(
            'tbody',
            {},
            data.tokens.map((token) =>
              el('tr', {}, [
                el('td', { class: 'mono', text: token.token }),
                el('td', { class: 'mono', text: String(token.position) }),
                el('td', { class: 'mono', text: String(token.start) }),
                el('td', { class: 'mono', text: String(token.end) }),
              ]),
            ),
          ),
        ]),
      );
    })();
  });
  main.append(
    el('h1', { class: 'view-title', text: `Analyze ${params.stream}` }),
    el('div', { class: 'card' }, [text, analyzer, run]),
    host,
  );
}

export async function renderLifecycle(main: HTMLElement, params: Record<string, string>): Promise<void> {
  const name = params.stream;
  let detail: StreamDetail;
  try {
    detail = await get<StreamDetail>(`/api/streams/${encodeURIComponent(name)}`);
  } catch {
    main.append(loadFailed(() => void renderLifecycle(main, params)));
    return;
  }
  const inputs: Record<string, HTMLInputElement> = {};
  const labels: [string, string][] = [
    ['rollover_max_age_ms', 'Rollover max age (ms)'],
    ['rollover_max_events', 'Rollover max events'],
    ['warm_after_ms', 'Warm after (ms)'],
    ['archive_after_ms', 'Archive after (ms)'],
    ['delete_after_ms', 'Delete after (ms)'],
  ];
  const form = el('section', { class: 'card' }, [el('h2', { text: 'Lifecycle policy' })]);
  for (const [field, label] of labels) {
    const input = el('input', { type: 'text', 'aria-label': label, 'data-field': field, class: 'mono' });
    inputs[field] = input;
    form.append(el('div', { class: 'field' }, [el('label', { text: label }), input]));
  }
  const save = el('button', {
    type: 'button',
    'aria-label': 'Save policy',
    text: 'Save policy',
    class: 'primary',
  });
  const noticeHost = el('p', { class: 'notice-line' });
  const timeline = el('ul', { role: 'list', 'aria-label': 'Generation timeline', class: 'timeline' });
  const renderTimeline = (generations: Generation[]): void => {
    clear(timeline);
    for (const generation of generations) {
      const item = el('li', { class: `timeline-band phase-${generation.phase}` }, [
        el('span', { class: 'mono', text: generation.timeline }),
      ]);
      if (generation.archive_failed) {
        item.append(el('p', { class: 'failure-line', text: 'Archive failed. It will retry on the next step.' }));
      }
      if (generation.delete_failed) {
        item.append(el('p', { class: 'failure-line', text: 'Delete failed. It will retry on the next step.' }));
      }
      timeline.append(item);
    }
  };
  renderTimeline(detail.generations);
  save.addEventListener('click', () => {
    save.setAttribute('aria-busy', 'true');
    void (async () => {
      const body: Record<string, number | null> = {};
      for (const [field] of labels) {
        const value = inputs[field].value.trim();
        body[field] = value === '' ? null : Number(value);
      }
      try {
        const result = await write<{ message: string }>(
          'PUT',
          `/api/streams/${encodeURIComponent(name)}/lifecycle`,
          body,
        );
        noticeHost.textContent = result.message;
        announce(result.message);
        const fresh = await get<{ generations: Generation[] }>(
          `/api/streams/${encodeURIComponent(name)}/generations`,
        );
        renderTimeline(fresh.generations);
      } catch (cause) {
        if (cause instanceof ApiFailure) showFormError(form, cause, form);
      } finally {
        save.removeAttribute('aria-busy');
      }
    })();
  });
  form.append(save, noticeHost);
  main.append(el('h1', { class: 'view-title', text: `Lifecycle of ${name}` }), form, timeline);
  setLiveHandler((message: LiveMessage) => {
    if (message.type !== 'lifecycle') return;
    if (message.stream !== name) return;
    renderTimeline(message.generations as Generation[]);
  });
  if (!roleAllows('admin')) save.setAttribute('disabled', 'true');
  if (state.me === null) navigate('/signin');
}
