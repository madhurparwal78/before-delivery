/**
 * Car page — bay and bay billing, belongings, condition report, photos, care
 * history and releases. Bay billing updates in place on re-reads.
 */
import { api, ApiFailure, NoAnswer } from '../api.ts';
import { state } from '../state.ts';
import { announce, h, patchText, reconcile } from '../ui.ts';
import { openDialog } from '../dialog.ts';
import { Reread } from '../reread.ts';
import { registerReread, navigate } from '../app.ts';
import { buildFloorPlan, type BayData } from '../components/floorplan.ts';
import { pressureDisplay, distanceDisplay } from '../../shared/units.ts';
import {
  assignedBayCopy, assigningBay, bayBillingLabel, bayClassChangeCopy, bayOccupiedCopy,
  bayTooSmallCopy, carReleasedCopy, insufficientItemsCopy, photoAttachedCopy,
  reportStoredCopy, SAVING, STORAGE_DOWN_UPLOAD, UPLOAD_CUT_OFF, UPLOAD_TOO_LARGE,
  uploadingPhotoPending, uploadingReportPending,
} from '../../shared/copy.ts';
import { zurichSlotLabel } from '../../shared/dates.ts';
import { buildFieldSummary } from './bays.ts';
import type { Screen } from './screen.ts';

interface BelongingItem {
  id: string;
  kind: string;
  label: string;
  count_in: number;
}

interface CarDetail {
  id: string;
  name: string;
  year: number;
  make: string;
  model: string;
  registration: string;
  colour: string;
  status: string;
  bay: { id: string; code: string; class: string } | null;
  bay_billing: { status: string; charged_through_date: string | null; billing_end_date: string | null; cancel_requested: boolean };
  startup: { status: string; next_due: string | null };
  odometer_km: number;
  tyre_spec_bar: string;
  belongings: BelongingItem[];
  condition_report: { id: string; sha256: string; uploaded_at: string; uploaded_by: { name: string } | null } | null;
  photos: { id: string; kind: string; content_type: string }[];
  care_entries: {
    id: string; at: string; by: { name: string } | null; started: boolean;
    battery_v: string | null; tyres_bar: { fl: string; fr: string; rl: string; rr: string } | null;
    note: string; flags: string[];
  }[];
  jobs: { id: string; number: string; title: string; status: string }[];
  releases: { id: string; status: string; slot_label: string }[];
}

export function renderCar(main: HTMLElement, carId: string): Screen {
  const reread = new Reread(async () => {
    const detail = await fetchDetail(carId);
    if (detail) patch(detail);
  }, 10_000);

  let destroyed = false;
  const bayRegion = h('p', { class: 'status-region', role: 'status', 'data-region': 'bay-updates' });
  const belongingsRegion = h('p', { class: 'status-region', role: 'status', 'data-region': 'belongings-updates' });
  const uploadRegion = h('p', { class: 'status-region', role: 'status', 'data-region': 'upload-updates' });

  const identity = h('div', { class: 'car-identity' });
  const specs = h('p', { class: 'specs' });
  const bayLine = h('p', { 'data-line': 'bay' });
  const billingLine = h('p', { 'data-line': 'billing' });
  const belongingsBody = h('tbody');
  const reportArea = h('div', { 'data-area': 'report' });
  const photosArea = h('div', { class: 'photo-grid', 'data-area': 'photos', 'aria-label': 'Photos' });
  const historyBody = h('tbody');
  const releasesBody = h('tbody');
  const jobsArea = h('div', { 'data-area': 'jobs' });
  const progress = h('div', { class: 'progress', 'aria-label': 'Upload progress', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100' });
  const progressBar = h('div');
  progress.append(progressBar);

  const baySection = h('section', { class: 'panel', 'aria-label': 'Bay and bay billing' },
    h('h2', { text: 'Bay and bay billing' }),
    bayLine, billingLine,
    h('div', { class: 'row-flex' },
      h('button', { text: 'Choose bay', onclick: (event: Event) => openBayPicker(event.currentTarget as HTMLElement, carId, bayRegion) })),
    bayRegion);

  const belongingsSection = h('section', { class: 'panel', 'aria-label': 'Belongings' },
    h('div', { class: 'row-flex', style: 'justify-content:space-between;' },
      h('h2', { text: 'Belongings' }),
      h('button', { text: 'Add item', onclick: (event: Event) => openAddItem(event.currentTarget as HTMLElement, carId, belongingsRegion) })),
    h('table', { class: 'sheet', 'aria-label': 'Belongings' },
      h('thead', null, h('tr', null, h('th', { text: 'Item' }), h('th', { class: 'num', text: 'In' }), h('th', { text: 'Movements' }))),
      belongingsBody),
    belongingsRegion);

  const reportSection = h('section', { class: 'panel', 'aria-label': 'Condition report' },
    h('h2', { text: 'Condition report' }),
    reportArea,
    uploadRegion);

  const photoSection = h('section', { class: 'panel', 'aria-label': 'Photos' },
    h('h2', { text: 'Photos' }),
    photosArea,
    h('div', { class: 'stack' },
      h('div', null, h('label', { text: 'Intake photo' }), h('input', {
        type: 'file', accept: 'image/jpeg,image/png',
        onchange: (event: Event) => { void uploadPhoto(event.currentTarget as HTMLInputElement, carId, 'intake', null); },
      })),
      h('button', { text: 'Upload photo', onclick: () => {
        const input = photoSection.querySelector('input[type="file"]') as HTMLInputElement;
        void uploadPhoto(input, carId, 'intake', null);
      } }),
      progress));

  const historySection = h('section', { class: 'panel', 'aria-label': 'Care history' },
    h('h2', { text: 'Care history' }),
    h('table', { class: 'sheet', 'aria-label': 'Care history' },
      h('thead', null, h('tr', null,
        h('th', { text: 'When' }), h('th', { text: 'By' }), h('th', { text: 'Entry' }))),
      historyBody));

  const releasesSection = h('section', { class: 'panel', 'aria-label': 'Releases' },
    h('h2', { text: 'Releases' }),
    h('table', { class: 'sheet', 'aria-label': 'Car releases' },
      h('thead', null, h('tr', null, h('th', { text: 'Status' }), h('th', { text: 'Slot' }))),
      releasesBody));

  const render = async (): Promise<void> => {
    main.replaceChildren(
      h('header', null, identity, specs),
      h('div', { class: 'two-col' },
        h('div', { class: 'stack' }, baySection, belongingsSection, reportSection),
        h('div', { class: 'stack' }, photoSection, historySection, releasesSection)),
      jobsArea,
    );
    const detail = await fetchDetail(carId);
    if (!detail) {
      main.replaceChildren(h('div', { class: 'not-found' }, h('h1', { text: "We couldn't find that page" })));
      return;
    }
    if (destroyed) return;
    patch(detail);
    const needsWatch = needsReread(detail);
    if (needsWatch) {
      registerReread(reread);
      reread.start();
    }
  };

  const patch = (detail: CarDetail): void => {
    identity.textContent = detail.name;
    specs.textContent = `${detail.registration} · ${detail.colour} · ${distanceDisplay(detail.odometer_km, state.units.distance)} · spec ${pressureDisplay(detail.tyre_spec_bar, state.units.pressure)}`;
    patchText(bayLine, detail.bay ? `Bay ${detail.bay.code}` : 'No bay');
    patchText(billingLine, bayBillingLabel(detail.bay_billing));
    reconcile(belongingsBody, detail.belongings, (item) => item.id,
      (item) => belongingsRow(item, carId, belongingsRegion),
      (row, item) => {
        const countCell = row.querySelector('td.num') as HTMLElement;
        patchText(countCell, String(item.count_in));
      });
    renderReport(detail);
    renderPhotos(detail);
    renderHistory(detail);
    releasesBody.replaceChildren(...detail.releases.map((release) =>
      h('tr', null, h('td', { text: release.status }), h('td', { text: release.slot_label }))));
    jobsArea.replaceChildren(h('h2', { text: 'Jobs' }),
      h('ul', null, ...detail.jobs.map((job) =>
        h('li', null, h('a', {
          href: state.me?.role === 'owner' ? `/portal/jobs/${job.id}` : `/jobs/${job.id}`,
          text: `${job.number} ${job.title} — ${job.status}`,
          onclick: (event: Event) => {
            event.preventDefault();
            void navigate(state.me?.role === 'owner' ? `/portal/jobs/${job.id}` : `/jobs/${job.id}`);
          },
        })))));
  };

  const renderReport = (detail: CarDetail): void => {
    const existing = detail.condition_report;
    const current = reportArea.firstElementChild as HTMLElement | null;
    if (existing) {
      const download = h('a', {
        href: `/api/condition-reports/${existing.id}/file`,
        text: 'Download signed report',
        onclick: (event: Event) => event.preventDefault(),
      });
      download.addEventListener('click', () => {
        window.open(`/api/condition-reports/${existing.id}/file`, '_self');
      });
      const content = h('div', null, download, h('p', { class: 'mono small', text: existing.sha256 }));
      if (current) current.replaceWith(content);
      else reportArea.append(content);
    }
  };

  const renderPhotos = (detail: CarDetail): void => {
    const desired = detail.photos.map((photo) => `/api/photos/${photo.id}/content`);
    const current = Array.from(photosArea.querySelectorAll('img')).map((img) => img.getAttribute('src'));
    if (JSON.stringify(desired) === JSON.stringify(current)) return;
    photosArea.replaceChildren(...detail.photos.map((photo) =>
      h('img', { src: `/api/photos/${photo.id}/content`, alt: `${detail.name} photo` })));
  };

  const renderHistory = (detail: CarDetail): void => {
    const rows = detail.care_entries.map((entry) => {
      const parts: string[] = [];
      if (entry.started) parts.push('started');
      if (entry.battery_v) parts.push(`${entry.battery_v} V`);
      if (entry.tyres_bar) parts.push(`tyres ${entry.tyres_bar.fl}/${entry.tyres_bar.fr}/${entry.tyres_bar.rl}/${entry.tyres_bar.rr} bar`);
      if (entry.flags.length > 0) parts.push(`flagged: ${entry.flags.join(', ')}`);
      if (entry.note) parts.push(entry.note);
      return h('tr', null,
        h('td', { text: zurichShort(entry.at) }),
        h('td', { text: entry.by?.name ?? '' }),
        h('td', { text: parts.join(' · ') }));
    });
    historyBody.replaceChildren(...rows);
  };

  const uploadPhoto = async (input: HTMLInputElement, car: string, kind: 'intake', jobId: string | null): Promise<void> => {
    void jobId;
    const file = input.files?.[0];
    if (!file) return;
    const form = new FormData();
    form.append('kind', kind);
    form.append('file', file);
    announce(uploadRegion, uploadingPhotoPending(file.name));
    setProgress(5);
    try {
      await api.postForm(`/api/cars/${car}/photos`, form);
      setProgress(100);
      window.setTimeout(() => hideProgress(), 400);
      announce(uploadRegion, photoAttachedCopy(carNameOf(car)));
      const detail = await fetchDetail(car);
      if (detail) renderPhotos(detail);
    } catch (err) {
      hideProgress();
      if (err instanceof NoAnswer) announce(uploadRegion, UPLOAD_CUT_OFF);
      else if (err instanceof ApiFailure) {
        if (err.detail.status === 413) announce(uploadRegion, UPLOAD_TOO_LARGE);
        else if (err.detail.code === 'storage_unavailable') announce(uploadRegion, STORAGE_DOWN_UPLOAD);
        else announce(uploadRegion, err.detail.fields?.['file'] ?? err.detail.code ?? 'Upload failed.');
      }
    }
  };

  const setProgress = (percent: number): void => {
    progressBar.style.width = `${percent}%`;
    progress.setAttribute('aria-valuenow', String(percent));
  };
  const hideProgress = (): void => {
    progressBar.style.width = '0%';
  };

  const carNameOf = (car: string): string => identity.textContent || car;

  const openBayPicker = (opener: HTMLElement, car: string, region: HTMLElement): void => {
    openDialog({
      name: 'Choose bay',
      opener,
      build: (dialog, close) => {
        const area = h('div');
        dialog.append(h('h2', { text: 'Choose bay' }), area);
        const assignRegion = h('p', { class: 'status-region', role: 'status' });
        let selectedBay: BayData | null = null;
        let assignButton: HTMLButtonElement | null = null;
        void api.get(`/api/bays?fits=${car}`).then((response) => {
          const data = response as { bays: BayData[] };
          const plan = buildFloorPlan({
            bays: data.bays,
            picker: true,
            onActivate: (bay) => {
              if (!bay.eligible) return;
              selectedBay = bay;
              assignButton?.remove();
              assignButton = h('button', {
                class: 'primary',
                text: `Assign bay ${bay.code}`,
                onclick: async () => {
                  announce(region, assigningBay(bay.code));
                  try {
                    const answer = (await api.post(`/api/cars/${car}/bay`, { bay_id: bay.id })) as { car: CarDetail };
                    announce(region, assignedBayCopy(answer.car.name, bay.code));
                    close('submit');
                    void routeRefresh(car);
                  } catch (err) {
                    if (err instanceof ApiFailure) {
                      const code = err.detail.code;
                      if (code === 'bay_occupied') announce(assignRegion, bayOccupiedCopy(bay.code));
                      else if (code === 'bay_too_small') announce(assignRegion, bayTooSmallCopy(bay.code));
                      else if (code === 'bay_class_change') announce(assignRegion, bayClassChangeCopy(bay.code));
                      else if (code === 'car_released') announce(assignRegion, carReleasedCopy());
                      else announce(assignRegion, code ?? 'Saving failed.');
                    }
                  }
                },
              });
              dialog.append(assignButton);
              assignButton.focus();
            },
          });
          area.replaceChildren(plan.root, assignRegion);
        });
      },
    });
  };

  const routeRefresh = async (car: string): Promise<void> => {
    const detail = await fetchDetail(car);
    if (detail) patch(detail);
  };

  const openAddItem = (opener: HTMLElement, car: string, region: HTMLElement): void => {
    openDialog({
      name: 'Add item',
      opener,
      build: (dialog, close) => {
        const summary = h('div');
        const kind = h('select', { 'data-field': 'kind' },
          h('option', { value: 'key_set', text: 'Key set' }),
          h('option', { value: 'cover', text: 'Cover' }),
          h('option', { value: 'spare_wheel', text: 'Spare wheel' }),
          h('option', { value: 'document', text: 'Document' }));
        const label = h('input', { type: 'text', 'data-field': 'label' });
        const count = h('input', { type: 'number', value: '1', min: '0', max: '20', 'data-field': 'count', class: 'mono' });
        const add = h('button', { class: 'primary', text: 'Add' });
        add.addEventListener('click', async () => {
          announce(region, SAVING);
          summary.replaceChildren();
          try {
            const answer = (await api.post(`/api/cars/${car}/belongings`, {
              kind: kind.value, label: label.value, count: count.value,
            })) as { item: BelongingItem };
            announce(region, `${answer.item.label}: ${answer.item.count_in} checked in.`);
            close('submit');
            void routeRefresh(car);
          } catch (err) {
            if (err instanceof ApiFailure) {
              if (err.detail.fields) summary.replaceChildren(buildFieldSummary(err.detail.fields, dialog));
              else if (err.detail.code === 'car_released') announce(region, carReleasedCopy());
              else announce(region, err.detail.code ?? 'Saving failed.');
            }
          }
        });
        dialog.append(
          h('h2', { text: 'Add item' }),
          summary,
          h('div', { class: 'field' }, h('label', { text: 'Item kind' }), kind),
          h('div', { class: 'field' }, h('label', { text: 'Item label' }), label),
          h('div', { class: 'field' }, h('label', { text: 'Count' }), count),
          h('div', { class: 'actions' }, add, h('button', { text: 'Close', onclick: () => close('cancel') })),
        );
      },
    });
  };

  const belongingsRow = (item: BelongingItem, car: string, region: HTMLElement): HTMLElement => {
    const countCell = h('td', { class: 'num', text: String(item.count_in) });
    const row = h('tr', null,
      h('td', { text: item.label }),
      countCell,
      h('td', null,
        h('div', { class: 'row-flex' },
          h('button', { text: `Check in ${item.label}`, onclick: async (event: Event) => {
            await movement(event, item, 'in', 1, car, region);
          } }),
          h('button', { text: `Check out ${item.label}`, onclick: async (event: Event) => {
            await movement(event, item, 'out', 1, car, region);
          } }))));
    return row;
  };

  const movement = async (event: Event, item: BelongingItem, direction: 'in' | 'out', count: number, car: string, region: HTMLElement): Promise<void> => {
    const button = event.currentTarget as HTMLElement;
    announce(region, SAVING);
    try {
      const answer = (await api.post(`/api/belongings/${item.id}/movements`, { direction, count })) as {
        item: BelongingItem;
      };
      announce(region, direction === 'in'
        ? `${answer.item.label}: ${answer.item.count_in} checked in.`
        : `${answer.item.label} checked out.`);
      void routeRefresh(car);
    } catch (err) {
      if (err instanceof ApiFailure) {
        const code = err.detail.code;
        if (code === 'insufficient_items') announce(region, insufficientItemsCopy(item.label));
        else if (code === 'car_released') announce(region, carReleasedCopy());
        else announce(region, code ?? 'Saving failed.');
      }
      void button.focus();
    }
  };

  return {
    render,
    destroy() {
      destroyed = true;
      reread.stop();
    },
  };
}

function needsReread(detail: CarDetail): boolean {
  return Boolean(
    detail.releases.some((release) => ['requested', 'booked', 'staged'].includes(release.status)) ||
    detail.bay_billing.status === 'pending' ||
    (detail.bay_billing.cancel_requested && detail.bay_billing.status !== 'ending'),
  );
}

async function fetchDetail(carId: string): Promise<CarDetail | null> {
  try {
    const response = (await api.get(`/api/cars/${carId}`)) as { car: CarDetail };
    return response.car;
  } catch {
    return null;
  }
}

function zurichShort(ts: string): string {
  return zurichSlotLabel(ts);
}
