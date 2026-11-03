// Requester screens: the requests table, the request detail with prep files
// and cancellation, and the new request form.
import { api, isFailure, newIdempotencyKey } from '../lib/api.js';
import { h, clear, statusRegion, openDialog } from '../lib/dom.js';
import { copy, statusLabel } from '../lib/copy.js';
import { agencyStamp, cardDate, agencyTime, typedToInstant } from '../lib/time.js';
import type { RequestView, Quote } from '../lib/types.js';
import { navigate, setFlash, takeFlash, state } from '../main.js';

export async function renderRequests(): Promise<HTMLElement> {
  const wrap = h('div', { class: 'column' });
  wrap.appendChild(h('h1', {}, 'Requests'));
  wrap.appendChild(h('div', { class: 'btn-row', style: 'margin-top:0' },
    h('a', { href: '/requests/new', class: 'btn', role: 'link', style: 'display:inline-flex;align-items:center;text-decoration:none' }, 'New request')));
  const table = h('table', { class: 'data', 'aria-label': 'Requests' });
  table.appendChild(h('thead', {}, h('tr', {},
    h('th', {}, 'Ref'), h('th', {}, 'Title'), h('th', {}, 'Setting'),
    h('th', {}, 'Start'), h('th', {}, 'Status'), h('th', {}, 'Seats'),
  )));
  const tbody = h('tbody', {});
  table.appendChild(tbody);
  wrap.appendChild(table);
  try {
    const res = await api.get<{ requests: RequestView[] }>('/requests');
    for (const r of res.requests) {
      const seats = `${r.seats_accepted}/${r.seats_total}`;
      tbody.appendChild(h('tr', {},
        h('td', { class: 'mono', 'data-label': 'Ref' }, h('a', { href: `/requests/${r.id}` }, r.ref)),
        h('td', { 'data-label': 'Title' }, r.title),
        h('td', { 'data-label': 'Setting' }, statusLabel(r.setting)),
        h('td', { class: 'mono', 'data-label': 'Start' }, `${cardDate(new Date(r.start))} ${agencyTime(new Date(r.start))}`),
        h('td', { 'data-label': 'Status' }, statusLabel(r.status)),
        h('td', { class: 'mono', 'data-label': 'Seats' }, seats),
      ));
    }
  } catch (err) {
    wrap.appendChild(h('p', { class: 'muted' }, 'Could not load requests.'));
  }
  return wrap;
}

interface FormValues {
  title: string;
  setting: string;
  location: string;
  start: string;
  end: string;
  consumer_id: string;
  notes: string;
}

function collectForm(values: FormValues): Record<string, string> {
  return {
    title: values.title,
    setting: values.setting,
    location: values.location,
    start: typedToInstant(values.start) ?? values.start,
    end: typedToInstant(values.end) ?? values.end,
    consumer_id: values.consumer_id,
    notes: values.notes,
  };
}

export function renderNewRequest(): HTMLElement {
  const wrap = h('div', { class: 'column' });
  wrap.appendChild(h('h1', {}, 'New request'));
  const status = statusRegion('Request status');
  const title = h('input', { type: 'text', id: 'f-title' });
  const setting = h('select', { id: 'f-setting' },
    h('option', { value: 'medical' }, 'Medical'),
    h('option', { value: 'legal' }, 'Legal'),
    h('option', { value: 'education' }, 'Education'),
    h('option', { value: 'community' }, 'Community'),
  );
  const location = h('input', { type: 'text', id: 'f-location' });
  const start = h('input', { type: 'text', class: 'mono', id: 'f-start', placeholder: '2026-10-27T14:00' });
  const end = h('input', { type: 'text', class: 'mono', id: 'f-end', placeholder: '2026-10-27T15:00' });
  const consumer = h('select', { id: 'f-consumer' });
  const notes = h('textarea', { id: 'f-notes', rows: '4' });
  const errors: Record<string, HTMLElement> = {};
  const fields = ['title', 'setting', 'location', 'start', 'end', 'consumer_id', 'notes'];
  const row = (label: string, key: string, input: HTMLElement, span = true) => {
    errors[key] = h('p', { class: 'field-error', 'aria-live': 'polite' });
    return h('div', { class: span ? 'span2' : '' },
      h('label', { for: input.id }, label), input, errors[key]);
  };

  const form = h('form', { class: 'form-grid two', 'aria-label': 'New request', onsubmit: async (e: Event) => {
    e.preventDefault();
    for (const key of fields) clear(errors[key]!);
    status.set(copy.saveDraft.pending, 'pending');
    try {
      const body = collectForm({
        title: (title as HTMLInputElement).value,
        setting: (setting as HTMLSelectElement).value,
        location: (location as HTMLInputElement).value,
        start: (start as HTMLInputElement).value,
        end: (end as HTMLInputElement).value,
        consumer_id: (consumer as HTMLSelectElement).value,
        notes: (notes as HTMLTextAreaElement).value,
      });
      const res = await api.post<{ request: RequestView }>('/requests', body);
      setFlash(copy.saveDraft.success(res.request.ref));
      navigate(`/requests/${res.request.id}`);
    } catch (err) {
      if (isFailure(err) && err.code === 'validation' && err.body.fields) {
        for (const [key, message] of Object.entries(err.body.fields)) errors[key]?.appendChild(document.createTextNode(message));
        status.set(copy.saveDraft.validation, 'error');
      } else if (isFailure(err)) {
        status.set(err.message, 'error');
      }
    }
  } });

  form.appendChild(row('Title', 'title', title));
  form.appendChild(row('Setting', 'setting', setting));
  form.appendChild(row('Location', 'location', location));
  form.appendChild(row('Start', 'start', start, false));
  form.appendChild(row('End', 'end', end, false));
  form.appendChild(row('Deaf consumer', 'consumer_id', consumer));
  form.appendChild(row('Notes', 'notes', notes));

  form.id = 'new-request-form';
  form.appendChild(h('div', { class: 'btn-row' },
    h('button', { type: 'submit', class: 'primary' }, 'Save draft'),
  ));
  wrap.appendChild(form);
  wrap.appendChild(status.el);

  void api.get<{ consumers: Array<{ id: string; name: string }> }>('/consumers').then((res) => {
    for (const c of res.consumers) {
      (consumer as HTMLSelectElement).appendChild(h('option', { value: c.id }, c.name));
    }
  });

  return wrap;
}

export async function renderRequestDetail(requestId: string): Promise<HTMLElement> {
  const wrap = h('div', { class: 'column' });
  const status = statusRegion('Request status');
  let request: RequestView;
  try {
    const res = await api.get<{ request: RequestView }>(`/requests/${requestId}`);
    request = res.request;
  } catch {
    wrap.appendChild(h('h1', {}, 'Request'));
    wrap.appendChild(h('p', { class: 'muted' }, 'Nothing was found here.'));
    return wrap;
  }

  const start = new Date(request.start);
  const end = new Date(request.end);

  wrap.appendChild(h('h1', {}, `${request.ref} ${request.title}`));

  const fields = h('dl', { class: 'kv' });
  fields.appendChild(h('dt', {}, 'Status'));
  fields.appendChild(h('dd', { id: 'detail-status' }, statusLabel(request.status)));
  fields.appendChild(h('dt', {}, 'Setting'));
  fields.appendChild(h('dd', {}, statusLabel(request.setting)));
  fields.appendChild(h('dt', {}, 'Organisation'));
  fields.appendChild(h('dd', {}, request.org_name));
  fields.appendChild(h('dt', {}, 'Location'));
  fields.appendChild(h('dd', {}, request.location));
  fields.appendChild(h('dt', {}, 'Start'));
  fields.appendChild(h('dd', { class: 'mono' }, `${cardDate(start)} ${agencyTime(start)}`));
  fields.appendChild(h('dt', {}, 'End'));
  fields.appendChild(h('dd', { class: 'mono' }, `${cardDate(end)} ${agencyTime(end)}`));
  fields.appendChild(h('dt', {}, 'Deaf consumer'));
  fields.appendChild(h('dd', {}, request.consumer.name));
  fields.appendChild(h('dt', {}, 'Notes'));
  fields.appendChild(h('dd', {}, request.notes || '—'));
  if (request.in_cancellation_window) {
    fields.appendChild(h('dt', {}, 'Cancellation window'));
    fields.appendChild(h('dd', { class: 'in-window-marker' }, 'In cancellation window'));
  }
  if (request.cancellation_fee !== null) {
    fields.appendChild(h('dt', {}, 'Cancellation charge'));
    fields.appendChild(h('dd', { class: 'mono' }, `$${request.cancellation_fee}`));
  }
  wrap.appendChild(fields);

  const seats = h('ul', { 'aria-label': 'Seats', role: 'list', class: 'stack' });
  for (const seat of request.seats) {
    const li = h('li', { role: 'listitem' });
    li.appendChild(h('div', {}, h('strong', {}, `Seat ${seat.position}`), ` — ${statusLabel(seat.status)}`));
    if (seat.interpreter) li.appendChild(h('div', { class: 'small' }, `Interpreter: ${seat.interpreter.name}`));
    if (seat.held_by) li.appendChild(h('div', { class: 'small muted' }, `Held by ${seat.held_by.name}`));
    if (seat.offer) li.appendChild(h('div', { class: 'small muted' }, `Offer ${statusLabel(seat.offer.status)} · expires ${agencyStamp(new Date(seat.offer.expires_at))}`));
    if (seat.timesheet) li.appendChild(h('div', { class: 'small muted' }, `Timesheet ${statusLabel(seat.timesheet.status)}: ${seat.timesheet.billed_hours} h${seat.timesheet.amount ? ` · $${seat.timesheet.amount}` : ''}`));
    seats.appendChild(li);
  }
  const seatsHeading = h('h3', { style: 'font-size:1.15rem' }, 'Seats');
  wrap.appendChild(seatsHeading);
  wrap.appendChild(seats);

  const prep = h('ul', { 'aria-label': 'Prep materials', role: 'list', class: 'stack' });
  for (const file of request.prep_files) {
    prep.appendChild(h('li', { role: 'listitem' }, h('a', { href: `/api/prep/${file.id}` }, file.filename)));
  }
  if (request.prep_files.length === 0) prep.appendChild(h('li', { role: 'listitem', class: 'muted' }, 'No prep materials yet.'));
  wrap.appendChild(h('h3', { style: 'font-size:1.15rem' }, 'Prep materials'));
  wrap.appendChild(prep);

  // ----- actions -----

  const actions = h('div', { class: 'btn-row' });
  const isRequester = state.user?.role === 'requester';
  const canUpload = isRequester && ['draft', 'submitted', 'partially_staffed', 'staffed'].includes(request.status);
  const canSubmit = isRequester && request.status === 'draft';
  const canCancel = ['draft', 'submitted', 'partially_staffed', 'staffed'].includes(request.status)
    && (isRequester || state.user?.role === 'coordinator');

  if (canUpload) {
    const fileInput = h('input', { type: 'file', id: 'prep-input', style: 'position:absolute;left:-9999px;width:1px;height:1px' });
    const addPrep = h('button', { onclick: () => fileInput.click() }, 'Add prep file');
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      status.set(copy.upload.pending(file.name), 'pending');
      const form = new FormData();
      form.append('file', file);
      try {
        await api.postForm(`/requests/${request.id}/prep`, form);
        fileInput.value = '';
        setFlash(copy.upload.success(file.name));
        navigate(`/requests/${request.id}`, true);
      } catch (err) {
        if (isFailure(err)) {
          if (err.code === 'payload_too_large') status.set(copy.upload.tooLarge(file.name), 'error');
          else if (err.code === 'unsupported_media_type') status.set(copy.upload.unsupported(file.name), 'error');
          else if (err.code === 'storage_unavailable') status.set(copy.upload.storage, 'error');
          else status.set(err.message, 'error');
        }
        fileInput.value = '';
      }
    });
    actions.appendChild(fileInput);
    actions.appendChild(addPrep);
  }

  if (canSubmit) {
    actions.appendChild(h('button', { class: 'primary', onclick: async () => {
      status.set(copy.submit.pending, 'pending');
      try {
        await api.post(`/requests/${request.id}/submit`, {});
        setFlash(copy.submit.success(request.ref));
        navigate(`/requests/${request.id}`, true);
      } catch (err) {
        if (isFailure(err)) {
          if (err.code === 'validation') status.set(copy.submit.validation, 'error');
          else if (err.code === 'invalid_transition') status.set(copy.submit.invalidTransition, 'error');
          else status.set(err.message, 'error');
        }
      }
    } }, 'Submit request'));
  }

  if (canCancel) {
    actions.appendChild(h('button', { class: 'danger-outline', onclick: async () => {
      openCancelDialog(request, status);
    } }, 'Cancel request'));
  }

  wrap.appendChild(actions);
  wrap.appendChild(status.el);

  const flashed = takeFlash();
  if (flashed) status.set(flashed.text, flashed.kind);

  return wrap;
}

function openCancelDialog(request: RequestView, status: ReturnType<typeof statusRegion>): void {
  let idemKey = newIdempotencyKey();
  let expectedFee: string | null = null;

  openDialog({
    label: 'Cancel request',
    build: (root, close) => {
      const statusLine = statusRegion('Cancellation status');
      const body = h('p', {}, copy.quote.pending);
      statusLine.set(copy.quote.pending, 'pending');
      const confirmBtn = h('button', { class: 'primary', disabled: true }, 'Confirm cancellation');
      const keepBtn = h('button', {}, 'Keep request');

      root.appendChild(h('h2', {}, 'Cancel request'));
      root.appendChild(body);
      root.appendChild(statusLine.el);
      root.appendChild(h('div', { class: 'btn-row' }, confirmBtn, keepBtn));

      keepBtn.addEventListener('click', close);

      const loadQuote = async (): Promise<void> => {
        try {
          const res = await api.get<{ quote: Quote }>(`/requests/${request.id}/cancellation-quote`);
          expectedFee = res.quote.fee;
          body.textContent = res.quote.late
            ? copy.quote.late(res.quote.fee, res.quote.seated)
            : copy.quote.onTime;
          statusLine.set('', undefined);
          confirmBtn.removeAttribute('disabled');
        } catch (err) {
          if (isFailure(err)) {
            if (err.code === 'already_started') {
              statusLine.set(copy.quote.started, 'error');
            } else {
              statusLine.set(err.message, 'error');
            }
          }
        }
      };
      void loadQuote();

      confirmBtn.addEventListener('click', async () => {
        if (expectedFee === null) return;
        confirmBtn.setAttribute('disabled', 'true');
        keepBtn.setAttribute('disabled', 'true');
        statusLine.set(copy.cancel.pending(request.ref), 'pending');
        try {
          const res = await api.post<{ request: RequestView; quote: Quote }>(
            `/requests/${request.id}/cancel`,
            { expected_fee: expectedFee, reason: '' },
            { 'Idempotency-Key': idemKey },
          );
          close();
          setFlash(copy.cancel.success(request.ref, res.request.cancellation_fee ?? '0.00'));
          navigate(`/requests/${request.id}`, true);
        } catch (err) {
          if (isFailure(err) && err.code === 'fee_changed' && err.body.quote) {
            expectedFee = err.body.quote.fee;
            body.textContent = err.body.quote.late
              ? copy.quote.late(err.body.quote.fee, err.body.quote.seated)
              : copy.quote.onTime;
            statusLine.set(copy.cancel.feeChanged(err.body.quote.fee), 'error');
            confirmBtn.removeAttribute('disabled');
            keepBtn.removeAttribute('disabled');
            return;
          }
          if (isFailure(err) && err.code === 'billing_unavailable') {
            statusLine.set(copy.cancel.billing, 'error');
          } else if (isFailure(err)) {
            statusLine.set(err.message, 'error');
          }
          confirmBtn.removeAttribute('disabled');
          keepBtn.removeAttribute('disabled');
        }
      });
    },
  });
}
