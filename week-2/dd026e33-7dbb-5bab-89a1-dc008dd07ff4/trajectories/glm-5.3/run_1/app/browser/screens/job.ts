/**
 * Job page (staff and portal) — the three-pane coat stack with the stage and
 * panel in the address, and the job ledger with the legal actions.
 */
import { api, ApiFailure, KeyHolder, NoAnswer, randomKey } from '../api.ts';
import { state, replaceHistory } from '../state.ts';
import { announce, h, patchText } from '../ui.ts';
import { openDialog } from '../dialog.ts';
import { Reread } from '../reread.ts';
import { registerReread, markInterrupted } from '../app.ts';
import { buildCoatStack, PANELS, type CoatData } from '../components/coatstack.ts';
import { STAGE_NAMES } from '../../shared/coat.ts';
import { filmDisplay } from '../../shared/units.ts';
import {
  approvedAnnouncement, declinedAnnouncement, estimateExpiredAnnouncement, estimateLabel,
  invoiceIssuedCopy, issuingInvoicePending, NO_ANSWER_COPY, SAVING, stageAlreadyLoggedCopy,
  stageLoggedCopy, stageOutOfOrderCopy, invalidTransitionCopy, estimateChangedCopy,
  finishedCopy, readingSavedCopy, estimateSavedCopy, estimateSentCopy, estimateRevisedCopy,
  billingDownInvoiceCopy,
} from '../../shared/copy.ts';
import { fieldSummary, openEstimateDialog, type EstimateDraft } from './jobs.ts';

import type { Screen } from './screen.ts';

interface JobData {
  id: string;
  number: string;
  version: number;
  car: { id: string; name: string };
  owner: { id: string; name: string };
  title: string;
  status: string;
  lines: { id: string; kind: string; description: string; quantity: string; unit_price: string | null; net: string; vat: string }[];
  net_total: string;
  vat_total: string;
  rounding: string;
  total: string;
  sent_at: string | null;
  expires_at: string | null;
  approved_at: string | null;
  declined_at: string | null;
  finished_at: string | null;
  stages: { id: string; index: number; name: string; logged_at: string; readings_count: number }[];
  invoice_id: string | null;
}

interface InvoiceData {
  id: string;
  number: string;
  status: string;
  balance: string;
  balance_live: boolean;
  status_confirmed_at: string | null;
  total: string;
}

export function renderJob(main: HTMLElement, jobId: string, portal: boolean): Screen {
  const heading = h('h2', { text: 'Job ledger', tabindex: '-1' });
  const region = h('p', { class: 'status-region', role: 'status', 'data-region': 'job-updates' });
  const ledgerRegion = h('p', { class: 'status-region', role: 'status', 'data-region': 'invoice-updates' });
  const invoiceArea = h('div', { 'data-area': 'invoice' });
  const stageArea = h('div');
  const actionsArea = h('div', { class: 'row-flex', 'data-area': 'actions' });
  const estimateArea = h('div', { 'data-area': 'estimate' });
  const stageLogArea = h('div', { 'data-area': 'stagelog' });
  const photoArea = h('div', { 'data-area': 'photos' });

  let reread: Reread | null = null;
  let destroyed = false;
  let job: JobData | null = null;
  let coat: ReturnType<typeof buildCoatStack> | null = null;
  let coatData: CoatData | null = null;
  let previousStatus: string | null = null;
  let version = 0;
  const issueHolder = new KeyHolder(randomKey);

  const selection = (): { stage: number; panel: string } => {
    const stageParam = Number(state.route.query.get('stage'));
    const panelParam = state.route.query.get('panel');
    const stageCount = coatData?.stages.length ?? 0;
    const validStage = coatData && stageCount > 0 && Number.isInteger(stageParam) && stageParam >= 0 && stageParam < stageCount
      ? stageParam
      : Math.max(0, stageCount - 1);
    const validPanel = PANELS.some((panel) => panel.id === panelParam) ? (panelParam as string) : 'bonnet';
    return { stage: validStage, panel: validPanel };
  };

  const writeAddress = (stage: number, panel: string): void => {
    replaceHistory(portal ? `/portal/jobs/${jobId}` : `/jobs/${jobId}`,
      new URLSearchParams({ stage: String(stage), panel }));
  };

  const onSelection = (stage: number, panel: string): void => {
    writeAddress(stage, panel);
    const current = selection();
    void current;
    if (coat && coatData) {
      const direction = stage >= lastStage ? 1 : -1;
      lastStage = stage;
      coat.update(coatData, stage, panel, direction);
      coat.announceStep(stage, panel);
      updateReadingsAndHistoryButtons(stage, panel);
    }
  };
  let lastStage = 0;

  const updateReadingsAndHistoryButtons = (stage: number, panel: string): void => {
    if (!coat || !coatData) return;
    void stage;
    const historyArea2 = coat.root.querySelector('[data-area="history"]') as HTMLElement | null;
    if (historyArea2) {
      historyArea2.replaceChildren(h('button', {
        text: 'Reading history',
        onclick: (event: Event) => openHistory(event.currentTarget as HTMLElement, panel),
      }));
    }
  };

  const openHistory = (opener: HTMLElement, panel: string): void => {
    const panelName = PANELS.find((candidate) => candidate.id === panel)?.name ?? panel;
    openDialog({
      name: `Reading history: ${panelName}`,
      opener,
      build: (dialog) => {
        void api.get(`/api/jobs/${jobId}/panels/${panel}/readings`).then((response) => {
          const data = response as { readings: { id: string; stage: string; film_um: number; logged_at: string; logged_by: { name: string } | null }[] };
          dialog.append(
            h('h2', { text: `Reading history: ${panelName}` }),
            h('table', { class: 'sheet' },
              h('thead', null, h('tr', null, h('th', { text: 'Stage' }), h('th', { class: 'num', text: 'Reading' }), h('th', { text: 'Logged by' }))),
              h('tbody', null, ...data.readings.map((reading) => h('tr', null,
                h('td', { text: reading.stage }),
                h('td', { class: 'num', text: filmDisplay(reading.film_um, state.units.film) }),
                h('td', { text: reading.logged_by?.name ?? '' }))))),
          );
        });
      },
    });
  };

  const fetchAll = async (): Promise<{ job: JobData; coat: CoatData } | null> => {
    try {
      const [jobResponse, coatResponse] = await Promise.all([
        api.get(`/api/jobs/${jobId}`) as Promise<{ job: JobData }>,
        api.get(`/api/jobs/${jobId}/coat-stack`) as Promise<CoatData>,
      ]);
      return { job: jobResponse.job, coat: coatResponse };
    } catch {
      return null;
    }
  };

  const render = async (): Promise<void> => {
    const planPane = h('section', { class: 'panel', 'aria-label': 'Car plan' },
      h('h2', { class: 'pinned-h', text: 'Car plan' }),
      stageArea);
    const crossPane = h('section', { class: 'panel', 'aria-label': 'Cross-section' },
      h('h2', { class: 'pinned-h', text: 'Cross-section' }));
    crossPane.append(h('div', { 'data-area': 'history' }));
    const ledgerPane = h('section', { class: 'panel', 'aria-label': 'Job ledger' },
      heading, region, estimateArea, stageLogArea, actionsArea, invoiceArea, ledgerRegion, photoArea);
    const paneGrid = h('div', { class: 'panes-3' });
    main.replaceChildren(
      h('h1', { 'data-area': 'identity', class: 'car-identity' }),
      paneGrid,
    );
    paneGrid.replaceChildren(planPane, crossPane, ledgerPane);
    // two panes from 768 (ledger full width below); three from 1200
    const applyLayout = (): void => {
      const wide = window.innerWidth >= 768;
      const threeColumns = window.innerWidth >= 1200;
      ledgerPane.classList.toggle('pane-full', wide && !threeColumns);
    };
    applyLayout();
    window.addEventListener('resize', applyLayout);

    const data = await fetchAll();
    if (!data) {
      main.replaceChildren(h('div', { class: 'not-found' }, h('h1', { text: "We couldn't find that page" })));
      return;
    }
    if (destroyed) return;
    job = data.job;
    version = data.job.version;
    coatData = data.coat;
    const select = selection();
    lastStage = select.stage;
    coat = buildCoatStack({
      data: coatData,
      filmUnit: state.units.film,
      initialStage: select.stage,
      initialPanel: select.panel,
      onSelection,
      onOpenHistory: (panel) => {
        const button = coat?.root.querySelector('[data-area="history"] button') as HTMLElement | null;
        void panel;
        void button;
        openHistory(button ?? stageArea, panel);
      },
    });
    stageArea.replaceChildren(coat.root);
    patchLedger();
    registerHistoryButton();
    previousStatus = job.status;
    if (job.status === 'sent') startReread();
    if (portal && job.status === 'sent') startReread();
  };

  const registerHistoryButton = (): void => {
    const crossPane = main.querySelector('[aria-label="Cross-section"]') as HTMLElement;
    const historyArea2 = crossPane.querySelector('[data-area="history"]') as HTMLElement;
    const select = selection();
    historyArea2.replaceChildren(h('button', {
      text: 'Reading history',
      onclick: (event: Event) => openHistory(event.currentTarget as HTMLElement, select.panel),
    }));
  };

  const startReread = (): void => {
    if (!reread) {
      reread = new Reread(async () => {
        const data = await fetchAll();
        if (!data || destroyed) return;
        const wasStatus = job?.status ?? null;
        job = data.job;
        version = data.job.version;
        coatData = data.coat;
        patchLedger();
        const statusChanged = wasStatus !== null && wasStatus !== data.job.status;
        if (statusChanged) {
          announceStatusChange(wasStatus as string, data.job);
        }
        if (data.job.status !== 'sent' && data.job.status !== 'invoiced' && data.job.status !== 'paid') {
          // stop the sent-driven re-read; invoice reads run their own loop
          if (data.job.status !== 'sent') reread?.stop();
        }
        if (data.job.status === 'invoiced' || data.job.status === 'paid') {
          startInvoiceReread();
        }
      }, 10_000);
      registerReread(reread);
    }
    reread.start();
  };

  let invoiceReread: Reread | null = null;
  const startInvoiceReread = (): void => {
    if (!invoiceReread) {
      invoiceReread = new Reread(async () => {
        if (!job?.invoice_id) return;
        try {
          const response = (await api.get(portal ? `/api/invoices/${job.invoice_id}` : `/api/invoices/${job.invoice_id}`)) as { invoice: InvoiceData };
          patchInvoice(response.invoice);
        } catch {
          // keep the last shown
        }
      }, 10_000);
      registerReread(invoiceReread);
    }
    invoiceReread.start();
  };

  const announceStatusChange = (from: string, fresh: JobData): void => {
    if (portal) {
      // the portal job page announces nothing for changes found by a re-read
      return;
    }
    if (from === 'sent' && fresh.status === 'approved') announce(region, approvedAnnouncement(fresh.owner.name, fresh.number));
    else if (from === 'sent' && fresh.status === 'declined') announce(region, declinedAnnouncement(fresh.owner.name, fresh.number));
    else if (from === 'sent' && fresh.status === 'expired') announce(region, estimateExpiredAnnouncement(fresh.number, fresh.expires_at as string));
  };

  const patchLedger = (): void => {
    if (!job) return;
    const identity = main.querySelector('[data-area="identity"]') as HTMLElement;
    identity.textContent = job.car.name;
    estimateArea.replaceChildren(
      h('p', null, h('strong', { text: `${job.number} ${job.title}` })),
      h('p', null, h('span', { text: 'Estimate ' }), h('strong', { 'data-line': 'estimate', text: estimateLabel(job.status, job.expires_at) })),
      h('table', { class: 'sheet' },
        h('tbody', null,
          ...job.lines.map((line) => h('tr', null,
            h('td', { text: line.description }),
            h('td', { class: 'num', text: line.quantity }),
            h('td', { class: 'num', text: line.unit_price ?? '' }),
            h('td', { class: 'num', text: line.net }))),
          h('tr', null, h('td', { text: 'Net' }), h('td', { colspan: '3', class: 'num', text: `CHF ${job.net_total}` })),
          h('tr', null, h('td', { text: 'VAT 8.1%' }), h('td', { colspan: '3', class: 'num', text: `CHF ${job.vat_total}` })),
          h('tr', null, h('td', { text: 'Rounding' }), h('td', { colspan: '3', class: 'num', text: `CHF ${job.rounding}` })),
          h('tr', null, h('td', { text: 'Total' }), h('td', { colspan: '3', class: 'num', text: `CHF ${job.total}` })))),
    );
    stageLogArea.replaceChildren(
      h('h3', { text: 'Stage log' }),
      h('ul', null, ...job.stages.map((stage) =>
        h('li', { text: `${stage.name} — ${stage.readings_count} readings` }))),
    );
    renderActions();
    if (job.invoice_id) {
      void api.get(`/api/invoices/${job.invoice_id}`).then((response) => {
        const data = response as { invoice: InvoiceData };
        patchInvoice(data.invoice);
        startInvoiceReread();
      }).catch(() => undefined);
    }
  };

  const patchInvoice = (invoice: InvoiceData): void => {
    invoiceArea.replaceChildren(
      h('h3', { text: `Invoice ${invoice.number}` }),
      h('p', { 'data-line': 'invoice-status', text: invoiceLine(invoice) }),
      h('p', { 'data-line': 'outstanding', text: invoice.balance !== '0.00' ? outstandingLine(invoice) : '' }),
    );
  };

  const renderActions = (): void => {
    const currentJob = job;
    if (!currentJob) return;
    const buttons: HTMLElement[] = [];
    const owner = portal;
    if (!owner) {
      if (currentJob.status === 'draft') {
        buttons.push(h('button', {
          text: 'Edit estimate',
          onclick: (event: Event) => {
            const draft: EstimateDraft = {
              id: currentJob.id,
              number: currentJob.number,
              version,
              status: currentJob.status,
              expires_at: currentJob.expires_at,
              owner: currentJob.owner,
              title: currentJob.title,
              lines: currentJob.lines.map((line) => ({ id: line.id, kind: line.kind, description: line.description, quantity: line.quantity, unit_price: line.unit_price })),
            };
            openEstimateDialog(event.currentTarget as HTMLElement, draft, region, async () => {
              const data = await fetchAll();
              if (data) {
                job = data.job;
                version = data.job.version;
                patchLedger();
              }
            });
          },
        }));
        buttons.push(h('button', {
          text: 'Send to owner',
          onclick: async (event: Event) => {
            const opener = event.currentTarget as HTMLElement;
            announce(region, SAVING);
            try {
              const response = (await api.post(`/api/jobs/${currentJob.id}/send`, undefined, { ifMatch: String(version) })) as { job: JobData };
              announce(region, estimateSentCopy(response.job.number, response.job.owner.name));
              job = response.job;
              version = response.job.version;
              patchLedger();
              startReread();
            } catch (err) {
              handleEstimateAnswer(err, opener);
            }
          },
        }));
      }
      if (currentJob.status === 'declined' || currentJob.status === 'expired') {
        buttons.push(h('button', {
          text: 'Revise estimate',
          onclick: async () => {
            announce(region, SAVING);
            try {
              const response = (await api.post(`/api/jobs/${currentJob.id}/revise`)) as { job: JobData };
              announce(region, estimateRevisedCopy(response.job.number));
              job = response.job;
              version = response.job.version;
              patchLedger();
            } catch (err) {
              if (err instanceof ApiFailure) announce(region, invalidTransitionCopy());
            }
          },
        }));
      }
      if (currentJob.status === 'approved' || currentJob.status === 'in_progress') {
        buttons.push(h('button', { text: 'Log stage', onclick: (event: Event) => openLogStage(event.currentTarget as HTMLElement) }));
        buttons.push(h('button', { text: 'Add reading', onclick: (event: Event) => openAddReading(event.currentTarget as HTMLElement) }));
      }
      if (currentJob.status === 'in_progress') {
        buttons.push(h('button', {
          text: 'Mark finished',
          onclick: async () => {
            announce(region, SAVING);
            try {
              const response = (await api.post(`/api/jobs/${currentJob.id}/finish`)) as { job: JobData };
              announce(region, finishedCopy(response.job.number));
              job = response.job;
              version = response.job.version;
              patchLedger();
            } catch (err) {
              if (err instanceof ApiFailure) announce(region, invalidTransitionCopy());
            }
          },
        }));
      }
      if (currentJob.status === 'finished') {
        buttons.push(h('button', {
          text: 'Issue invoice',
          onclick: async (event: Event) => {
            const opener = event.currentTarget as HTMLElement;
            announce(region, issuingInvoicePending());
            try {
              const response = (await api.postWithKey(`/api/jobs/${currentJob.id}/invoice`, {}, issueHolder.current())) as { invoice: InvoiceData; job: JobData };
              issueHolder.discard();
              announce(region, invoiceIssuedCopy(response.invoice.number, response.invoice.total));
              job = response.job;
              version = response.job.version;
              patchLedger();
            } catch (err) {
              if (err instanceof NoAnswer) {
                announce(region, NO_ANSWER_COPY.issueInvoice);
                return;
              }
              if (err instanceof ApiFailure) {
                const code = err.detail.code;
                if (code === 'session_expired') {
                  markInterrupted(issueHolder.peek() ?? '', async () => {
                    announce(region, issuingInvoicePending());
                    const response = (await api.postWithKey(`/api/jobs/${currentJob.id}/invoice`, {}, issueHolder.current())) as { invoice: InvoiceData; job: JobData };
                    issueHolder.discard();
                    announce(region, invoiceIssuedCopy(response.invoice.number, response.invoice.total));
                    job = response.job;
                    version = response.job.version;
                    patchLedger();
                  });
                  return;
                }
                if (code === 'invalid_transition') announce(region, invalidTransitionCopy());
                else if (code === 'billing_unavailable') announce(region, billingDownInvoiceCopy());
                else if (code === 'idempotency_conflict') announce(region, 'This was already sent with different values. Close this form and check the latest record.');
                else announce(region, code ?? 'Issuing failed.');
                void opener;
              }
            }
          },
        }));
      }
      if (currentJob.status === 'in_progress' || currentJob.status === 'approved' || currentJob.status === 'finished') {
        photoArea.replaceChildren(
          h('h3', { text: 'Stage photos' }),
          h('div', null,
            h('label', { text: 'Stage photo' }),
            h('input', { type: 'file', accept: 'image/jpeg,image/png', onchange: (event: Event) => void uploadStagePhoto(event.currentTarget as HTMLInputElement) }),
            h('button', { text: 'Upload stage photo', onclick: () => {
              const input = photoArea.querySelector('input[type="file"]') as HTMLInputElement;
              void uploadStagePhoto(input);
            } })),
        );
      } else {
        photoArea.replaceChildren();
      }
    } else {
      if (currentJob.status === 'sent') {
        buttons.push(h('button', {
          text: 'Approve estimate',
          class: 'primary',
          onclick: async () => {
            announce(region, 'Sending your answer...');
            try {
              const response = (await api.post(`/api/jobs/${currentJob.id}/approve`)) as { job: JobData };
              announce(region, `Estimate approved. Work on your ${currentJob.car.name} can begin.`);
              job = response.job;
              patchLedger();
              reread?.stop();
            } catch (err) {
              if (err instanceof ApiFailure) {
                if (err.detail.code === 'estimate_expired') {
                  announce(region, `This estimate expired on ${shortDate(currentJob.expires_at)} and can no longer be approved.`);
                } else if (err.detail.code === 'invalid_transition') {
                  announce(region, invalidTransitionCopy());
                }
              }
            }
          },
        }));
        buttons.push(h('button', {
          text: 'Decline estimate',
          onclick: (event: Event) => openDeclineDialog(event.currentTarget as HTMLElement),
        }));
      }
    }
    actionsArea.replaceChildren(...buttons);
  };

  const uploadStagePhoto = async (input: HTMLInputElement): Promise<void> => {
    const file = input.files?.[0];
    if (!file || !job) return;
    const form = new FormData();
    form.append('kind', 'stage');
    form.append('job_id', job.id);
    form.append('file', file);
    announce(region, `Uploading ${file.name}...`);
    try {
      await api.postForm(`/api/cars/${job.car.id}/photos`, form);
      announce(region, `Photo attached to ${job.car.name}.`);
    } catch (err) {
      if (err instanceof NoAnswer) announce(region, 'The upload was cut off. Nothing was stored; upload it again.');
      else if (err instanceof ApiFailure) {
        if (err.detail.status === 413) announce(region, 'That file is too large to upload.');
        else if (err.detail.code === 'storage_unavailable') announce(region, "Photo storage is unreachable. Nothing was uploaded; try again when the notice clears.");
        else announce(region, err.detail.fields?.['file'] ?? err.detail.code ?? 'Upload failed.');
      }
    }
  };

  const handleEstimateAnswer = (err: unknown, opener: HTMLElement): void => {
    void opener;
    if (err instanceof ApiFailure) {
      if (err.detail.code === 'estimate_changed') {
        announce(region, estimateChangedCopy(job?.number ?? ''));
        opener.focus();
      } else if (err.detail.code === 'invalid_transition') {
        announce(region, invalidTransitionCopy());
      } else if (err.detail.fields) {
        announce(region, Object.values(err.detail.fields)[0] ?? 'Saving failed.');
      }
    }
  };

  const openLogStage = (opener: HTMLElement): void => {
    if (!job) return;
    const logged = job.stages.map((stage) => stage.name);
    const nextStages = (STAGE_NAMES as readonly string[]).filter((name) => !logged.includes(name));
    openDialog({
      name: 'Log stage',
      opener,
      build: (dialog, close) => {
        const summary = h('div');
        const stageSelect = h('select', { 'data-field': 'name' },
          ...nextStages.map((name) => h('option', { value: name, text: name })));
        const readingInputs: Record<string, HTMLInputElement> = {};
        const readingsArea = h('div');
        for (const panel of PANELS) {
          const input = h('input', { type: 'text', class: 'mono', 'data-field': `reading-${panel.id}`, 'aria-label': `${panel.name} reading` });
          readingInputs[panel.id] = input;
          readingsArea.append(h('div', { class: 'field' }, h('label', { text: `${panel.name} reading` }), input));
        }
        const save = h('button', { class: 'primary', text: 'Save stage' });
        save.addEventListener('click', async () => {
          summary.replaceChildren();
          const name = stageSelect.value;
          const readings: { panel: string; value: string; unit: string }[] = [];
          for (const panel of PANELS) {
            const value = readingInputs[panel.id].value.trim();
            if (value !== '') readings.push({ panel: panel.id, value, unit: state.units.film === 'um' ? 'um' : 'mil' });
          }
          announce(region, 'Saving stage...');
          try {
            const response = (await api.post(`/api/jobs/${job?.id}/stages`, { name, readings })) as {
              stage: { readings_count: number; name: string };
              job: JobData;
            };
            announce(region, stageLoggedCopy(response.stage.name, response.stage.readings_count));
            close('submit');
            const data = await fetchAll();
            if (data) {
              job = data.job;
              version = data.job.version;
              coatData = data.coat;
              const select = selection();
              coat?.update(coatData, Math.max(0, data.coat.stages.length - 1), select.panel, 1);
              patchLedger();
              registerHistoryButton();
            }
          } catch (err) {
            if (err instanceof ApiFailure) {
              const code = err.detail.code;
              if (code === 'stage_already_logged') announce(region, stageAlreadyLoggedCopy(name));
              else if (code === 'stage_out_of_order') announce(region, stageOutOfOrderCopy(name));
              else if (code === 'invalid_transition') announce(region, invalidTransitionCopy());
              else if (err.detail.fields) summary.replaceChildren(fieldSummary(err.detail.fields, dialog));
              else announce(region, code ?? 'Saving failed.');
            }
          }
        });
        dialog.append(
          h('h2', { text: 'Log stage' }),
          summary,
          h('div', { class: 'field' }, h('label', { text: 'Stage' }), stageSelect),
          h('h3', { text: 'Readings' }),
          readingsArea,
          h('div', { class: 'actions' }, save, h('button', { text: 'Cancel', onclick: () => close('cancel') })),
        );
      },
    });
  };

  const openAddReading = (opener: HTMLElement): void => {
    const editingJob = job;
    if (!editingJob) return;
    openDialog({
      name: 'Add reading',
      opener,
      build: (dialog, close) => {
        const summary = h('div');
        const stageSelect = h('select', { 'data-field': 'logged-stage' },
          ...editingJob.stages.map((stage) => h('option', { value: stage.id, text: stage.name })));
        const panelSelect = h('select', { 'data-field': 'panel' },
          ...PANELS.map((panel) => h('option', { value: panel.id, text: panel.name })));
        const value = h('input', { type: 'text', class: 'mono', 'data-field': 'value' });
        const save = h('button', { class: 'primary', text: 'Save reading' });
        save.addEventListener('click', async () => {
          summary.replaceChildren();
          announce(region, 'Saving reading...');
          try {
            const currentJob = job;
            if (!currentJob) return;
            const response = (await api.post(`/api/jobs/${currentJob.id}/stages/${stageSelect.value}/readings`, {
              panel: panelSelect.value,
              value: value.value,
              unit: state.units.film === 'um' ? 'um' : 'mil',
            })) as { reading: { panel: string; film_um: number } };
            const panelName = PANELS.find((panel) => panel.id === response.reading.panel)?.name ?? '';
            announce(region, readingSavedCopy(panelName, filmDisplay(response.reading.film_um, state.units.film)));
            close('submit');
            const data = await fetchAll();
            if (data) {
              job = data.job;
              version = data.job.version;
              coatData = data.coat;
              coat?.update(coatData, selection().stage, selection().panel, 1);
              patchLedger();
            }
          } catch (err) {
            if (err instanceof ApiFailure) {
              if (err.detail.code === 'invalid_transition') announce(region, invalidTransitionCopy());
              else if (err.detail.fields) summary.replaceChildren(fieldSummary(err.detail.fields, dialog));
              else announce(region, err.detail.code ?? 'Saving failed.');
            }
          }
        });
        dialog.append(
          h('h2', { text: 'Add reading' }),
          summary,
          h('div', { class: 'field' }, h('label', { text: 'Logged stage' }), stageSelect),
          h('div', { class: 'field' }, h('label', { text: 'Panel' }), panelSelect),
          h('div', { class: 'field' }, h('label', { text: 'Reading' }), value),
          h('div', { class: 'actions' }, save, h('button', { text: 'Cancel', onclick: () => close('cancel') })),
        );
      },
    });
  };

  const openDeclineDialog = (opener: HTMLElement): void => {
    const declining = job;
    if (!declining) return;
    openDialog({
      name: 'Decline estimate?',
      opener,
      fallback: heading,
      onClose: (result) => {
        if (result === 'submit') {
          // handled inside
        }
      },
      build: (dialog, close) => {
        const decline = h('button', {
          class: 'primary',
          text: 'Decline',
          onclick: async () => {
            announce(region, 'Sending your answer...');
            try {
              const response = (await api.post(`/api/jobs/${declining.id}/decline`)) as { job: JobData };
              announce(region, 'Estimate declined.');
              job = response.job;
              patchLedger();
              close('submit');
            } catch (err) {
              if (err instanceof ApiFailure) {
                if (err.detail.code === 'estimate_expired') {
                  announce(region, `This estimate expired on ${shortDate(declining.expires_at)} and can no longer be answered.`);
                  close('removed-opener');
                  heading.focus();
                } else if (err.detail.code === 'invalid_transition') {
                  announce(region, invalidTransitionCopy());
                }
              }
            }
          },
        });
        dialog.append(
          h('h2', { text: 'Decline estimate?' }),
          h('div', { class: 'actions' },
            decline,
            h('button', { 'data-keep': '', text: 'Keep estimate', onclick: () => close('cancel') })),
        );
      },
    });
  };

  const destroy = (): void => {
    destroyed = true;
    reread?.stop();
    invoiceReread?.stop();
  };

  return { render, destroy };
}

function shortDate(ts: string | null): string {
  if (!ts) return '';
  const { zurichDate } = windowDate();
  return zurichDate(ts);
}

function windowDate(): { zurichDate: (ts: string) => string } {
  // resolved through the shared copy module at bundle time
  const mod = zurichDateRef;
  return { zurichDate: mod };
}

import { zurichDate } from '../../shared/dates.ts';
const zurichDateRef = zurichDate;

function invoiceLine(invoice: InvoiceData): string {
  if (invoice.balance === '0.00') {
    return invoice.balance_live ? 'Paid' : `Paid, last confirmed ${zurichDate(invoice.status_confirmed_at ?? '')}`;
  }
  return 'Awaiting payment';
}

function outstandingLine(invoice: InvoiceData): string {
  if (invoice.balance_live) return `Outstanding: CHF ${invoice.balance}`;
  return `Outstanding: CHF ${invoice.balance}, last confirmed ${zurichDate(invoice.status_confirmed_at ?? '')}`;
}


