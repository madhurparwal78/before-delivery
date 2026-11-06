/** The intake sheet: registration with real progress, and quarantine clearance. */

import { get, post } from './api.js';
import { announce, clear, el, icon, sealMark, takeFocus } from './dom.js';
import { COPY, errorCode, privileged, setStatus, syncRows, table } from './ui.js';
import { state } from './app.js';

const TYPES = [
  ['application/pdf', 'PDF document'],
  ['image/png', 'PNG image'],
  ['image/jpeg', 'JPEG image'],
  ['audio/wav', 'WAV audio'],
  ['audio/mpeg', 'MPEG audio'],
];
const FIELD_ORDER = [
  'compartment_id',
  'name',
  'source',
  'collected_by',
  'collected_on',
  'capture_notes',
  'declared_type',
  'file',
  'submitted_sha256',
  'idempotency_key',
  'body',
];
const LABELS = {
  compartment_id: 'Compartment',
  name: 'Exhibit name',
  source: 'Source',
  collected_by: 'Collected by',
  collected_on: 'Collected on',
  capture_notes: 'Capture notes',
  declared_type: 'Declared type',
  file: 'File',
  submitted_sha256: 'Submitted digest',
  idempotency_key: 'Registration key',
  body: 'Request',
};
const THRESHOLDS = [0, 25, 50, 75, 100];
const LOST =
  'Connection lost. Press Register exhibit to try again; it will not create a second exhibit.';
const TOO_LARGE = 'This file is over the 20,000,000 byte limit.';

export default {
  async mount(context) {
    const { docket, inspector, status } = context;
    const figure = el('span', { dataset: { figure: 'true' }, text: '0' });
    const intakeStatus = el('p', {
      role: 'status',
      'aria-label': 'Intake status',
      'aria-live': 'polite',
    });
    const summary = el('div', {
      role: 'alert',
      'aria-label': 'There is a problem',
      hidden: true,
    });
    const progress = el(
      'div',
      {
        role: 'progressbar',
        'aria-label': 'Upload progress',
        'aria-valuemin': '0',
        'aria-valuemax': '100',
        'aria-valuenow': '0',
        hidden: true,
      },
      [el('span')]
    );
    const quarantine = table('Quarantine', [
      'Exhibit',
      'Digest',
      'Seal',
      'Compartment',
      'Decide',
    ]);

    const fields = {};
    const errors = {};

    function textField(key, kind = 'input', attributes = {}) {
      const node =
        kind === 'textarea'
          ? el('textarea', { rows: 3, 'aria-label': LABELS[key], id: `f-${key}` })
          : el('input', {
              type: 'text',
              'aria-label': LABELS[key],
              id: `f-${key}`,
              ...attributes,
            });
      const error = el('p', { class: 'field-error', id: `e-${key}`, hidden: true });
      fields[key] = node;
      errors[key] = error;
      return el('div', {}, [
        el('label', { for: `f-${key}`, text: LABELS[key] }),
        node,
        error,
      ]);
    }

    const compartmentSelect = el('select', {
      'aria-label': 'Compartment',
      id: 'f-compartment_id',
    });
    fields.compartment_id = compartmentSelect;
    errors.compartment_id = el('p', {
      class: 'field-error',
      id: 'e-compartment_id',
      hidden: true,
    });
    const typeSelect = el('select', { 'aria-label': 'Declared type', id: 'f-declared_type' });
    for (const [value, text] of TYPES) {
      typeSelect.append(el('option', { value, text }));
    }
    fields.declared_type = typeSelect;
    errors.declared_type = el('p', {
      class: 'field-error',
      id: 'e-declared_type',
      hidden: true,
    });
    const fileInput = el('input', { type: 'file', 'aria-label': 'File', id: 'f-file' });
    fields.file = fileInput;
    errors.file = el('p', { class: 'field-error', id: 'e-file', hidden: true });

    const submit = el('button', { type: 'submit', text: 'Register exhibit' });
    const form = el('form', { 'aria-label': 'Register exhibit', on: { submit: onSubmit } }, [
      summary,
      el('div', {}, [
        el('label', { for: 'f-compartment_id', text: 'Compartment' }),
        compartmentSelect,
        errors.compartment_id,
      ]),
      textField('name'),
      textField('source'),
      textField('collected_by'),
      textField('collected_on'),
      textField('capture_notes', 'textarea'),
      el('div', {}, [
        el('label', { for: 'f-declared_type', text: 'Declared type' }),
        typeSelect,
        errors.declared_type,
      ]),
      el('div', {}, [
        el('label', { for: 'f-file', text: 'File' }),
        fileInput,
        errors.file,
      ]),
      textField('submitted_sha256'),
      progress,
      el('p', {}, [submit]),
      intakeStatus,
    ]);
    docket.append(
      figure,
      el('span', { dataset: { figureLabel: 'true' }, text: 'In quarantine' }),
      el('h1', { text: 'Intake' }),
      form,
      el('h2', { text: 'Quarantine' }),
      quarantine.node
    );
    inspector.append(el('p', { text: COPY.noRecord }));

    let fullCompartments = [];
    let requestKey = newKey();
    let running = false;
    let resendPending = false;

    function newKey() {
      return 'reg-' + Math.random().toString(36).slice(2) + '-' + Date.now();
    }

    for (const node of Object.values(fields)) {
      node.addEventListener('input', () => {
        requestKey = newKey();
      });
      node.addEventListener('change', () => {
        requestKey = newKey();
      });
    }

    function clearErrors() {
      for (const key of Object.keys(errors)) {
        errors[key].hidden = true;
        errors[key].textContent = '';
        if (fields[key]) fields[key].removeAttribute('aria-invalid');
      }
      summary.hidden = true;
      clear(summary);
    }

    function showErrors(copies) {
      clear(summary);
      const spoken = [];
      summary.append(el('p', { text: 'There is a problem' }));
      for (const key of FIELD_ORDER) {
        const copy = copies[key];
        if (!copy) continue;
        spoken.push(copy);
        if (errors[key]) {
          errors[key].textContent = copy;
          errors[key].hidden = false;
        }
        if (fields[key]) {
          fields[key].setAttribute('aria-invalid', 'true');
          fields[key].setAttribute('aria-describedby', `e-${key}`);
        }
        summary.append(
          el('p', {}, [
            el('a', {
              href: `#f-${key}`,
              text: `${LABELS[key] || key}: ${copy}`,
              on: {
                click: (event) => {
                  event.preventDefault();
                  if (fields[key]) fields[key].focus();
                },
              },
            }),
          ])
        );
      }
      for (const [key, copy] of Object.entries(copies)) {
        if (FIELD_ORDER.includes(key)) continue;
        spoken.push(copy);
        summary.append(el('p', { text: copy }));
      }
      summary.hidden = false;
      announce(intakeStatus, spoken.join(' '));
      intakeStatus.classList.add('refusal');
      takeFocus(summary);
    }

    function onSubmit(event) {
      event.preventDefault();
      send();
    }

    function send() {
      if (running) return;
      const file = fileInput.files && fileInput.files[0];
      const body = new FormData();
      body.append('name', fields.name.value);
      body.append('source', fields.source.value);
      body.append('collected_by', fields.collected_by.value);
      body.append('collected_on', fields.collected_on.value);
      body.append('capture_notes', fields.capture_notes.value);
      body.append('declared_type', typeSelect.value);
      body.append('submitted_sha256', fields.submitted_sha256.value);
      if (file) body.append('file', file, file.name);
      const compartmentId = compartmentSelect.value;
      running = true;
      clearErrors();
      intakeStatus.classList.remove('refusal');
      const announced = new Set();
      progress.hidden = false;
      setProgress(0);
      announceThreshold(0, announced);
      const request = new XMLHttpRequest();
      request.open('POST', `/api/compartments/${encodeURIComponent(compartmentId)}/exhibits`);
      request.setRequestHeader('Idempotency-Key', requestKey);
      request.upload.addEventListener('progress', (progressEvent) => {
        if (!progressEvent.lengthComputable) return;
        const percent = Math.floor((progressEvent.loaded / progressEvent.total) * 100);
        setProgress(progressEvent.loaded >= progressEvent.total ? 100 : Math.min(99, percent));
        for (const mark of THRESHOLDS) {
          if (mark <= percent) announceThreshold(mark, announced);
        }
      });
      request.upload.addEventListener('load', () => {
        setProgress(100);
        announceThreshold(100, announced);
        announce(intakeStatus, 'Confirming storage.');
      });
      request.addEventListener('error', () => {
        running = false;
        progress.hidden = true;
        announce(intakeStatus, LOST);
      });
      request.addEventListener('abort', () => {
        running = false;
        progress.hidden = true;
        announce(intakeStatus, LOST);
      });
      request.addEventListener('load', () => {
        running = false;
        progress.hidden = true;
        let reply = null;
        try {
          reply = JSON.parse(request.responseText);
        } catch (error) {
          reply = null;
        }
        handleReply(request.status, reply);
      });
      request.send(body);
    }

    function handleReply(httpStatus, reply) {
      if (httpStatus === 201) {
        announce(
          intakeStatus,
          `Sealed ${reply.id}. In quarantine until a second officer clears it.`
        );
        requestKey = newKey();
        for (const [key, node] of Object.entries(fields)) {
          if (key === 'compartment_id' || key === 'declared_type') continue;
          node.value = '';
        }
        clearErrors();
        refresh();
        return;
      }
      if (httpStatus === 401) {
        resendPending = true;
        window.dispatchEvent(new CustomEvent('wardline:unauthenticated'));
        return;
      }
      if (httpStatus === 413) {
        showErrors({ file: TOO_LARGE });
        return;
      }
      if (httpStatus === 422 && reply && reply.errors) {
        showErrors(reply.errors);
        return;
      }
      if (httpStatus === 503) {
        intakeStatus.classList.add('refusal');
        announce(
          intakeStatus,
          'Not registered. Exhibit storage is unreachable, and nothing was kept. Try again when the notice clears.'
        );
        return;
      }
      if (httpStatus === 0) {
        announce(intakeStatus, LOST);
        return;
      }
      intakeStatus.classList.add('refusal');
      announce(intakeStatus, COPY.noLonger);
    }

    function setProgress(percent) {
      progress.setAttribute('aria-valuenow', String(percent));
      progress.firstChild.style.width = percent + '%';
    }

    function announceThreshold(mark, announced) {
      if (announced.has(mark)) return;
      for (const earlier of THRESHOLDS) {
        if (earlier < mark && !announced.has(earlier)) {
          announced.add(earlier);
        }
      }
      announced.add(mark);
      announce(intakeStatus, `Uploading ${mark} percent.`);
    }

    async function decide(action, exhibit, opener) {
      setStatus(status, action === 'clear' ? 'Clearing.' : 'Refusing.');
      const reply = await privileged({
        opener,
        needsReason: action === 'refuse',
        run: (proof, reason) =>
          post(
            `/api/exhibits/${exhibit.id}/${action}`,
            action === 'refuse' ? { reason } : {},
            { proof }
          ),
      });
      if (!reply) {
        setStatus(status, '');
        return;
      }
      if (reply.status === 200) {
        setStatus(
          status,
          action === 'clear' ? `Cleared ${exhibit.id}.` : `Refused ${exhibit.id}.`
        );
        await refresh();
        return;
      }
      const code = errorCode(reply);
      if (code === 'seal_mismatch') {
        setStatus(status, COPY.sealFailed, true);
        await refresh();
        return;
      }
      if (code === 'illegal_transition') {
        setStatus(status, COPY.alreadyDecided, true);
        await refresh();
        return;
      }
      if (code === 'separation_of_duties') {
        setStatus(status, COPY.sodExhibit, true);
        return;
      }
      if (code === 'storage_unavailable') {
        setStatus(status, 'Not cleared. Exhibit storage is unreachable.', true);
        return;
      }
      setStatus(status, COPY.noLonger, true);
    }

    function buildRow(exhibit) {
      const clearButton = el('button', {
        type: 'button',
        text: `Clear ${exhibit.id}`,
        on: { click: () => decide('clear', exhibit, clearButton) },
      });
      const refuseButton = el('button', {
        type: 'button',
        text: `Refuse ${exhibit.id}`,
        on: { click: () => decide('refuse', exhibit, refuseButton) },
      });
      return el('tr', {}, [
        el('td', { class: 'mono' }, [
          el('a', {
            class: 'rowlink',
            href: `/exhibits/${exhibit.id}`,
            'data-route': 'true',
            text: exhibit.id,
          }),
        ]),
        el('td', {}, [el('span', { class: 'digest', text: exhibit.sha256 })]),
        el('td', {}, [
          exhibit.seal_check === 'failed'
            ? el('span', { class: 'refusal' }, [icon('\u2717'), ' Seal failed'])
            : sealMark(),
        ]),
        el('td', { class: 'mono', text: exhibit.compartment_id }),
        el('td', {}, [clearButton, refuseButton]),
      ]);
    }

    async function refresh() {
      const compartments = await get('/api/compartments', { background: true });
      if (compartments.status !== 200) return;
      fullCompartments = [];
      const rows = [];
      for (const item of compartments.body.compartments) {
        const docket = await get(`/api/compartments/${item.id}`, { background: true });
        if (docket.status !== 200 || docket.body.caller_scope !== 'full') continue;
        const reply = await get(
          `/api/compartments/${item.id}/exhibits?state=quarantined`,
          { background: true }
        );
        if (reply.status !== 200) continue;
        fullCompartments.push(item);
        rows.push(...reply.body.exhibits);
      }
      const chosen = compartmentSelect.value;
      if (
        compartmentSelect.children.length !== fullCompartments.length ||
        !fullCompartments.some((item) => item.id === chosen)
      ) {
        clear(compartmentSelect);
        for (const item of fullCompartments) {
          compartmentSelect.append(el('option', { value: item.id, text: item.name }));
        }
        if (fullCompartments.some((item) => item.id === chosen)) {
          compartmentSelect.value = chosen;
        }
      }
      figure.textContent = String(rows.length);
      syncRows(quarantine.body, rows, {
        key: (item) => item.id,
        signature: (item) => `${item.sha256}|${item.seal_check}`,
        build: buildRow,
        onVanished: (row, body) => {
          const next = Array.from(body.children);
          const target = next.length
            ? next[next.length - 1].querySelector('button')
            : null;
          takeFocus(target || quarantine.node);
        },
      });
    }

    await refresh();

    return {
      refresh,
      unsavedWork: () =>
        Boolean(
          (fileInput.files && fileInput.files.length) ||
            ['name', 'source', 'collected_by', 'collected_on', 'capture_notes', 'submitted_sha256'].some(
              (key) => fields[key].value.trim() !== ''
            )
        ),
      onResumed: () => {
        if (!resendPending) return;
        resendPending = false;
        send();
      },
    };
  },
};
