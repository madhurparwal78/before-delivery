import { api, isFailure, newIdempotencyKey } from '../lib/api.js';
import { h, clear, statusRegion, openDialog } from '../lib/dom.js';
import { copy, statusLabel } from '../lib/copy.js';
import { cardDate, agencyTime, typedToInstant } from '../lib/time.js';
import type { MyOfferView, RequestView } from '../lib/types.js';

export function renderMyPage(signal: AbortSignal): HTMLElement {
  const wrap = h('div', { class: 'column' });
  wrap.appendChild(h('h1', {}, 'My work'));

  const offersRegion = h('section', { role: 'region', 'aria-label': 'My offers' });
  const assignmentsRegion = h('section', { role: 'region', 'aria-label': 'My assignments' });
  const credentialsRegion = h('section', { role: 'region', 'aria-label': 'My credentials' });

  offersRegion.appendChild(h('h2', { style: 'font-size:1.3rem' }, 'My offers'));
  assignmentsRegion.appendChild(h('h2', { style: 'font-size:1.3rem' }, 'My assignments'));
  credentialsRegion.appendChild(h('h2', { style: 'font-size:1.3rem' }, 'My credentials'));
  wrap.appendChild(offersRegion);
  wrap.appendChild(assignmentsRegion);
  wrap.appendChild(credentialsRegion);

  async function refresh(): Promise<void> {
    try {
      const data = await api.get<{ interpreter_id: string; offers: MyOfferView[]; assignments: RequestView[] }>('/interpreters/me/assignments');
      const creds = await api.get<{ credentials: Array<{ id: string; type: string; number: string; expires_on: string; status: string }> }>('/interpreters/me/credentials');

      clear(offersRegion);
      offersRegion.appendChild(h('h2', { style: 'font-size:1.3rem' }, 'My offers'));
      if (data.offers.length === 0) {
        offersRegion.appendChild(h('p', { class: 'muted' }, 'No active offers.'));
      } else {
        for (const offer of data.offers) {
          const start = new Date(offer.request.start);
          const end = new Date(offer.request.end);
          offersRegion.appendChild(h('p', {},
            h('a', { href: `/offers/${offer.token}` }, `${offer.request.ref} ${offer.request.title}`),
            h('div', { class: 'small muted mono' },
              `${cardDate(start)} ${agencyTime(start)}–${agencyTime(end)} · seat ${offer.seat.position} of ${offer.seat.total}`),
          ));
        }
      }

      clear(assignmentsRegion);
      assignmentsRegion.appendChild(h('h2', { style: 'font-size:1.3rem' }, 'My assignments'));
      if (data.assignments.length === 0) {
        assignmentsRegion.appendChild(h('p', { class: 'muted' }, 'No assignments yet.'));
      }
      for (const assignment of data.assignments) {
        const start = new Date(assignment.start);
        const end = new Date(assignment.end);
        const block = h('div', { style: 'border-top:1px solid var(--hairline);padding:8px 0' });
        block.appendChild(h('div', {}, h('strong', {}, `${assignment.ref}`), ` ${assignment.title} · ${statusLabel(assignment.status)}`));
        block.appendChild(h('div', { class: 'small muted mono' }, `${cardDate(start)} ${agencyTime(start)}–${agencyTime(end)} · ${assignment.location}`));
        const prepLine = h('div', { class: 'small' });
        for (const file of assignment.prep_files) {
          prepLine.appendChild(h('a', { href: `/api/prep/${file.id}` }, file.filename));
          prepLine.appendChild(document.createTextNode(' '));
        }
        if (assignment.prep_files.length > 0) block.appendChild(prepLine);

        const ended = Date.now() > end.getTime();
        const mySeat = assignment.seats.find((s) => s.status === 'accepted' && s.interpreter?.id === data.interpreter_id);
        if (ended && !assignment.status.startsWith('cancelled') && mySeat && !mySeat.timesheet) {
          block.appendChild(h('button', { onclick: () => openTimesheetDialog(assignment, mySeat.id) },
            `Submit timesheet for ${assignment.ref}`));
        }
        assignmentsRegion.appendChild(block);
      }

      clear(credentialsRegion);
      credentialsRegion.appendChild(h('h2', { style: 'font-size:1.3rem' }, 'My credentials'));
      const table = h('table', { class: 'data', 'aria-label': 'My credentials' });
      table.appendChild(h('thead', {}, h('tr', {},
        h('th', {}, 'Type'), h('th', {}, 'Number'), h('th', {}, 'Expires on'), h('th', {}, 'Status'))));
      const tbody = h('tbody', {});
      for (const c of creds.credentials) {
        tbody.appendChild(h('tr', {},
          h('td', { 'data-label': 'Type' }, c.type),
          h('td', { class: 'mono', 'data-label': 'Number' }, c.number),
          h('td', { class: 'mono', 'data-label': 'Expires on' }, c.expires_on),
          h('td', { 'data-label': 'Status' }, statusLabel(c.status)),
        ));
      }
      table.appendChild(tbody);
      credentialsRegion.appendChild(table);
      credentialsRegion.appendChild(h('div', { class: 'btn-row' }, h('button', { onclick: () => openCredentialDialog() }, 'Add credential')));
    } catch {
      // keep last rendered content
    }
  }

  function openTimesheetDialog(assignment: RequestView, seatId: string): void {
    openDialog({
      label: `Timesheet for ${assignment.ref}`,
      build: (root, close) => {
        const status = statusRegion('Timesheet status');
        const actualStart = h('input', { type: 'text', class: 'mono', value: defaultStart(assignment.start) });
        const actualEnd = h('input', { type: 'text', class: 'mono', value: defaultEnd(assignment.end) });
        const signature = h('input', { type: 'text', value: '' });
        const startError = h('p', { class: 'field-error' });
        const endError = h('p', { class: 'field-error' });
        const sigError = h('p', { class: 'field-error' });
        const idemKey = newIdempotencyKey();

        root.appendChild(h('h2', {}, `Timesheet for ${assignment.ref}`));
        root.appendChild(h('label', {}, 'Actual start'));
        root.appendChild(actualStart);
        root.appendChild(startError);
        root.appendChild(h('label', {}, 'Actual end'));
        root.appendChild(actualEnd);
        root.appendChild(endError);
        root.appendChild(h('label', {}, 'Signature name'));
        root.appendChild(signature);
        root.appendChild(sigError);
        root.appendChild(h('div', { class: 'btn-row' },
          h('button', { class: 'primary', onclick: async () => {
            clear(startError); clear(endError); clear(sigError);
            const start = typedToInstant((actualStart as HTMLInputElement).value.trim());
            const end = typedToInstant((actualEnd as HTMLInputElement).value.trim());
            let valid = true;
            if (!start) { startError.textContent = 'Enter a valid date and time.'; valid = false; }
            if (!end) { endError.textContent = 'Enter a valid date and time.'; valid = false; }
            if (valid && (!start || !end || end <= start)) { endError.textContent = 'Actual end must be after actual start.'; valid = false; }
            if ((signature as HTMLInputElement).value.trim().length < 2) { sigError.textContent = 'Enter your signature name.'; valid = false; }
            if (!valid) { status.set(copy.timesheet.validation, 'error'); return; }
            status.set(copy.timesheet.pending, 'pending');
            try {
              const res = await api.post<{ timesheet: { billed_hours: string } }>(
                `/seats/${seatId}/timesheet`,
                { actual_start: start, actual_end: end, signature_name: (signature as HTMLInputElement).value.trim() },
                { 'Idempotency-Key': idemKey },
              );
              status.set(copy.timesheet.success(assignment.ref, res.timesheet.billed_hours), undefined);
              close();
              void refresh();
            } catch (err) {
              if (isFailure(err) && err.code === 'not_yet_ended') status.set(copy.timesheet.notEnded, 'error');
              else if (isFailure(err) && err.code === 'validation') status.set(copy.timesheet.validation, 'error');
              else if (isFailure(err)) status.set(err.message, 'error');
            }
          } }, 'Sign and submit'),
        ));
        root.appendChild(status.el);
      },
    });
  }

  function defaultStart(iso: string): string {
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function defaultEnd(iso: string): string {
    const d = new Date(new Date(iso).getTime() + 5 * 60_000);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function openCredentialDialog(): void {
    openDialog({
      label: 'Add credential',
      build: (root, close) => {
        const status = statusRegion('Credential status');
        const type = h('select', {},
          h('option', { value: 'NIC' }, 'NIC'),
          h('option', { value: 'CDI' }, 'CDI'),
          h('option', { value: 'SC:L' }, 'SC:L'),
          h('option', { value: 'EIPA-4.0' }, 'EIPA-4.0'),
        );
        const number = h('input', { type: 'text' });
        const expiresOn = h('input', { type: 'text', class: 'mono', placeholder: '2027-05-01' });
        const typeError = h('p', { class: 'field-error' });
        const numberError = h('p', { class: 'field-error' });
        const dateError = h('p', { class: 'field-error' });
        const fileError = h('p', { class: 'field-error' });
        let file: File | null = null;
        const fileInput = h('input', { type: 'file', style: 'position:absolute;left:-9999px;width:1px;height:1px' });
        const chooseBtn = h('button', { onclick: () => fileInput.click() }, 'Choose scan');

        root.appendChild(h('h2', {}, 'Add credential'));
        root.appendChild(fileInput);
        root.appendChild(h('label', {}, 'Credential type'));
        root.appendChild(type);
        root.appendChild(typeError);
        root.appendChild(h('label', {}, 'Credential number'));
        root.appendChild(number);
        root.appendChild(numberError);
        root.appendChild(h('label', {}, 'Expires on'));
        root.appendChild(expiresOn);
        root.appendChild(dateError);
        root.appendChild(h('div', { class: 'btn-row', style: 'margin-top:10px' }, chooseBtn));
        root.appendChild(fileError);
        fileInput.addEventListener('change', () => {
          file = fileInput.files?.[0] ?? null;
          fileError.textContent = file ? '' : '';
          if (file) chooseBtn.textContent = `Choose scan (${file.name})`;
        });

        root.appendChild(h('div', { class: 'btn-row' },
          h('button', { class: 'primary', onclick: async () => {
            clear(typeError); clear(numberError); clear(dateError); clear(fileError);
            let valid = true;
            if (!file) { fileError.textContent = 'Choose a scan file.'; valid = false; }
            if ((number as HTMLInputElement).value.trim().length < 1) { numberError.textContent = 'Enter the credential number.'; valid = false; }
            if (!/^\d{4}-\d{2}-\d{2}$/.test((expiresOn as HTMLInputElement).value.trim())) { dateError.textContent = 'Enter a valid date.'; valid = false; }
            if (!valid) { status.set(copy.credential.validation, 'error'); return; }
            const form = new FormData();
            form.append('type', (type as HTMLSelectElement).value);
            form.append('number', (number as HTMLInputElement).value.trim());
            form.append('expires_on', (expiresOn as HTMLInputElement).value.trim());
            form.append('scan', file!);
            status.set(copy.credential.pending, 'pending');
            try {
              const res = await api.postForm<{ credential: { type: string; expires_on: string } }>('/interpreters/me/credentials', form);
              status.set(copy.credential.success(res.credential.type, res.credential.expires_on), undefined);
              close();
              void refresh();
            } catch (err) {
              if (isFailure(err)) {
                if (err.code === 'validation') status.set(copy.credential.validation, 'error');
                else if (err.code === 'storage_unavailable') status.set(copy.credential.storage, 'error');
                else if (err.code === 'unsupported_media_type') status.set('That file is not a supported type.', 'error');
                else status.set(err.message, 'error');
              }
            }
          } }, 'Save credential'),
        ));
        root.appendChild(status.el);
      },
    });
  }

  void refresh();
  return wrap;
}
