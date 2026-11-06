// Project page: tabs and the stage, drawing, variation, certificate,
// shop-drawing and finishes panels.

import { api, ApiError, fieldErrorCopy, refusalCopy, uploadCopy } from './api.js';
import {
  amountText,
  announce,
  clear,
  dateText,
  h,
  hkToday,
  icon,
  instantText,
  openDialog,
  reportProblem,
  setFocusTarget,
  showFieldErrors,
} from './ui.js';
import { STUDIO_ROLES, currentMember, panelTitleBlock } from './office.js';

interface ProjectData {
  id: string;
  reference: string;
  name: string;
  brand: { id: string; name: string };
  region: 'HK' | 'SG' | 'MO';
  currency: 'HKD' | 'SGD';
  stores: { id: string; code: string; name: string; weight: number }[];
  practicalCompletionOn: string | null;
  defectsEndOn: string | null;
  contract: { companyName: string; contractSumCents: number } | null;
}

export async function projectScreen(projectId: string, section: string): Promise<HTMLElement> {
  const main = h('main', { id: 'main-content', class: 'office-main' });
  let project: ProjectData;
  try {
    const body = await api(`/api/projects/${projectId}`);
    project = body.project as ProjectData;
  } catch {
    main.append(notFound());
    return main;
  }
  document.title = `${project.name} · Plumbline`;
  const sections: { key: string; label: string; show: boolean }[] = [
    { key: 'stages', label: 'Stages', show: currentMember!.role !== 'contractor' },
    { key: 'drawings', label: 'Drawings', show: true },
    { key: 'tenders', label: 'Tenders', show: true },
    { key: 'variations', label: 'Variations', show: true },
    { key: 'certificates', label: 'Certificates', show: currentMember!.role !== 'contractor' },
    { key: 'shop-drawings', label: 'Shop drawings', show: currentMember!.role !== 'client_approver' },
    { key: 'site-walk', label: 'Site walk', show: true },
    { key: 'finishes', label: 'Finishes', show: currentMember!.role === 'contractor' ? false : STUDIO_ROLES.includes(currentMember!.role) },
  ];
  const visible = sections.filter((s) => s.show);
  const tablist = h('div', { class: 'tab-strip', role: 'tablist', 'aria-label': 'Project sections' });
  for (const tab of visible) {
    const button = h('button', {
      role: 'tab',
      class: tab.key === section ? 'tab active' : 'tab',
      'aria-selected': tab.key === section ? 'true' : 'false',
      text: tab.label,
      onclick: () => {
        window.history.pushState({}, '', `/office/projects/${projectId}/${tab.key}`);
        window.dispatchEvent(new PopStateEvent('popstate'));
      },
    });
    tablist.append(button);
  }
  main.append(
    h('div', { class: 'project-head' }, h('h1', { class: 'project-title', text: `${project.reference} ${project.name}` }), tablist),
  );
  const panel = h('div', { class: 'panel' });
  main.append(panel);
  switch (section) {
    case 'stages':
      await stagesPanel(panel, project);
      break;
    case 'drawings':
      await drawingsPanel(panel, project);
      break;
    case 'tenders':
      await tendersListPanel(panel, project);
      break;
    case 'variations':
      await variationsPanel(panel, project);
      break;
    case 'certificates':
      await certificatesPanel(panel, project);
      break;
    case 'shop-drawings':
      await shopDrawingsPanel(panel, project);
      break;
    case 'site-walk':
      const { siteWalkPanel } = await import('./sitewalk.js');
      await siteWalkPanel(panel, project);
      break;
    case 'finishes':
      await finishesPanel(panel, project);
      break;
    default:
      panel.append(notFound());
  }
  return main;
}

function notFound(): HTMLElement {
  return h('section', { class: 'not-found' }, h('h1', { text: "We couldn't find that. It may have been removed, or you may not have access." }));
}

// ---------- Stages ----------

async function stagesPanel(panel: HTMLElement, project: ProjectData): Promise<void> {
  const titleBlock = panelTitleBlock('PL-01', 'Stages');
  panel.append(titleBlock);
  let stages: Record<string, unknown>[] = [];
  try {
    const body = await api(`/api/projects/${project.id}/stages`);
    stages = (body.stages ?? []) as Record<string, unknown>[];
  } catch (error) {
    if (error instanceof ApiError) reportProblem(refusalCopy(error));
    return;
  }
  const stickyBar = h('div', { class: 'sticky-action-bar' });
  const stageState: Record<string, string> = {
    not_started: 'Not started',
    requested: 'Requested',
    signed_off: 'Signed off',
    returned: 'Returned',
  };
  for (const stage of stages) {
    const key = String(stage.key);
    if (key === 'aftercare') continue;
    const stageName = String(stage.name);
    const heading = h('h2', { class: 'stage-heading', text: stageName, tabindex: '-1' });
    heading.setAttribute('data-stage-heading', key);
    const stateText = h('p', { class: 'stage-state', text: stageState[String(stage.state)] ?? '' });
    const fee = stage.feeCents === null ? '' : amountText(project.currency, Number(stage.feeCents));
    const facts = h('p', { class: 'stage-facts', text: stage.feeCents ? `Stage fee ${fee}` : '' });
    const actions = h('div', { class: 'row-actions' });
    const isStudioLead = currentMember!.role === 'director' || currentMember!.role === 'project_lead';
    const isApprover = currentMember!.role === 'client_approver';
    if (isStudioLead && (stage.state === 'not_started' || stage.state === 'returned')) {
      actions.append(
        h('button', {
          class: 'button-secondary',
          text: `Request sign-off for ${stageName}`,
          onclick: () => requestDialog(stage, stageName),
        }),
      );
    }
    if (isApprover && stage.state === 'requested') {
      actions.append(
        h('button', {
          class: 'button-primary',
          text: `Sign off ${stageName}`,
          onclick: () => signOffDialog(stage, stageName),
        }),
        h('button', { class: 'button-secondary', text: `Return ${stageName}`, onclick: () => returnDialog(stage, stageName) }),
      );
    }
    const card = h('section', { class: 'stage-card', 'aria-labelledby': heading.id || undefined }, heading, stateText, facts, actions);
    if (STUDIO_ROLES.includes(currentMember!.role)) {
      const note = h('textarea', { id: `field-internalNote-${key}`, class: 'input', rows: '2' }) as HTMLTextAreaElement;
      note.value = String(stage.internalNote ?? '');
      const saveNote = h('button', {
        class: 'button-quiet',
        text: 'Save note',
        onclick: async () => {
          saveNote.disabled = true;
          saveNote.textContent = 'Saving…';
          try {
            await api(`/api/projects/${project.id}/stages/${key}`, { method: 'PATCH', body: JSON.stringify({ internalNote: note.value }) });
            announce('Internal note saved.');
          } catch (error) {
            if (error instanceof ApiError) reportProblem(refusalCopy(error));
          } finally {
            saveNote.disabled = false;
            saveNote.textContent = 'Save note';
          }
        },
      });
      card.append(h('div', { class: 'field' }, h('label', { for: note.id, text: 'Internal note' }), note, saveNote));
    }
    panel.append(card);
  }
  // Sticky bar: the project's current stage primary action.
  const requested = stages.find((stage) => stage.state === 'requested' && stage.key !== 'aftercare');
  if (requested) {
    const stageName = String(requested.name);
    if (currentMember!.role === 'client_approver') {
      stickyBar.append(
        h('button', { class: 'button-primary', text: `Sign off ${stageName}`, onclick: () => signOffDialog(requested, stageName) }),
      );
      panel.append(stickyBar);
    } else if (currentMember!.role === 'director' || currentMember!.role === 'project_lead') {
      stickyBar.append(
        h('button', {
          class: 'button-secondary',
          text: `Request sign-off for ${stageName}`,
          onclick: () => requestDialog(requested, stageName),
        }),
      );
      panel.append(stickyBar);
    }
  }

  function requestDialog(stage: Record<string, unknown>, stageName: string): void {
    const message = h('textarea', { id: 'field-message', class: 'input', rows: '3' }) as HTMLTextAreaElement;
    const send = h('button', { class: 'button-primary', type: 'submit', text: 'Send request' });
    const form = h('form', {
      onsubmit: async (event: Event) => {
        event.preventDefault();
        send.disabled = true;
        send.textContent = 'Requesting sign-off…';
        try {
          await api(`/api/projects/${project.id}/stages/${stage.key}/request`, { method: 'POST', body: JSON.stringify({ message: message.value }) });
          announce(`Sign-off requested for ${stageName}.`);
          dialogHandle.close();
          rerender();
          focusStageHeading(String(stage.key));
        } catch (error) {
          send.disabled = false;
          send.textContent = 'Send request';
          if (error instanceof ApiError) reportProblem(refusalCopy(error, { stage: stageName }));
        }
      },
    });
    const dialogHandle = openDialog(`Request sign-off for ${stageName}`, (container) => {
      form.append(h('div', { class: 'field' }, h('label', { for: 'field-message', text: 'Message to approvers' }), message), h('div', { class: 'form-actions' }, send));
      container.append(form);
    });
  }

  function signOffDialog(stage: Record<string, unknown>, stageName: string): void {
    const fee = stage.feeCents === null ? '—' : amountText(project.currency, Number(stage.feeCents));
    const confirm = h('button', { class: 'button-primary', text: 'Confirm sign-off' });
    const dialogHandle = openDialog(`Sign off ${stageName}`, (container) => {
      confirm.addEventListener('click', async () => {
        confirm.disabled = true;
        confirm.textContent = `Signing off ${stageName}…`;
        try {
          await api(`/api/projects/${project.id}/stages/${stage.key}/sign-off`, { method: 'POST', body: '{}' });
          const invoice = stage.invoice as { invoiceNumber?: string } | null;
          void invoice;
          const freshBody = await api(`/api/projects/${project.id}/stages/${stage.key}`);
          const freshStage = freshBody.stage as Record<string, unknown>;
          const invoiceNumber = String((freshStage.invoice as Record<string, unknown> | null)?.invoiceNumber ?? '');
          announce(`${stageName} signed off. Invoice ${invoiceNumber} raised; a receipt is on its way to ${currentMember!.name}.`);
          dialogHandle.close();
          rerender();
          focusStageHeading(String(stage.key));
        } catch (error) {
          confirm.disabled = false;
          confirm.textContent = 'Confirm sign-off';
          if (error instanceof ApiError) reportProblem(refusalCopy(error, { stage: stageName, kind: 'stage' }));
        }
      });
      container.append(h('p', { text: `Stage fee ${fee}` }), confirm);
    });
  }

  function returnDialog(stage: Record<string, unknown>, stageName: string): void {
    const reason = h('textarea', { id: 'field-reason', class: 'input', rows: '3' }) as HTMLTextAreaElement;
    const send = h('button', { class: 'button-secondary', type: 'submit', text: 'Return to studio' });
    const form = h('form', {
      onsubmit: async (event: Event) => {
        event.preventDefault();
        if (!reason.value.trim()) {
          showFieldErrors(form, { reason: 'Reason is required.' });
          return;
        }
        send.disabled = true;
        send.textContent = 'Returning…';
        try {
          await api(`/api/projects/${project.id}/stages/${stage.key}/return`, { method: 'POST', body: JSON.stringify({ reason: reason.value }) });
          announce(`${stageName} returned to the studio.`);
          dialogHandle.close();
          rerender();
          focusStageHeading(String(stage.key));
        } catch (error) {
          send.disabled = false;
          send.textContent = 'Return to studio';
          if (error instanceof ApiError) reportProblem(refusalCopy(error, { stage: stageName }));
        }
      },
    });
    const dialogHandle = openDialog(`Return ${stageName}`, (container) => {
      form.append(h('div', { class: 'field' }, h('label', { for: 'field-reason', text: 'Reason' }), reason), h('div', { class: 'form-actions' }, send));
      container.append(form);
    });
  }

  function focusStageHeading(key: string): void {
    const heading = panel.querySelector<HTMLElement>(`[data-stage-heading="${key}"]`);
    setFocusTarget(heading);
  }

  function rerender(): void {
    window.dispatchEvent(new PopStateEvent('popstate'));
  }
}

// ---------- Drawings ----------

async function drawingsPanel(panel: HTMLElement, project: ProjectData): Promise<void> {
  panel.append(panelTitleBlock('PL-02', 'Drawings'));
  const uploadButton = h('button', { class: 'button-primary', text: 'Upload sheets' });
  const fileInput = h('input', { type: 'file', id: 'sheet-files', class: 'visually-hidden', accept: '.pdf,.png,.jpg,.jpeg,.svg', multiple: true }) as HTMLInputElement;
  fileInput.setAttribute('aria-label', 'Sheet files');
  uploadButton.addEventListener('click', () => fileInput.click());
  const issueButton = h('button', { class: 'button-secondary', text: 'Issue set', onclick: () => issueDialog() });
  const table = h('table', { class: 'data-table', 'aria-label': 'Drawing register' }) as HTMLTableElement;
  const headRow = table.insertRow();
  for (const column of ['Sheet', 'Title', 'Revision', 'State', 'Bytes', 'Uploaded', 'Actions']) {
    headRow.append(h('th', { scope: 'col', text: column }));
  }
  const tbody = h('tbody');
  table.append(tbody);
  const transmittalList = h('ul', { class: 'transmittal-list' });

  async function render(): Promise<void> {
    clear(tbody);
    const body = await api(`/api/projects/${project.id}/sheets`);
    const sheets = (body.sheets ?? []) as Record<string, unknown>[];
    for (const sheet of sheets) {
      const revisions = (sheet.revisions ?? []) as Record<string, unknown>[];
      const current = revisions.find((r) => r.state === 'current');
      if (!current) continue;
      const row = h('tr');
      row.append(
        h('td', { text: String(sheet.code) }),
        h('td', { text: String(sheet.title) }),
        h('td', { text: String(current.revision) }),
        h('td', { text: String(current.state) }),
        h('td', { text: String(current.bytes) }),
        h('td', { text: String((current.uploadedAt as string | undefined ?? '').slice(0, 10)) }),
      );
      const actions = h('td', { class: 'row-actions' });
      actions.append(
        h('button', {
          class: 'button-quiet',
          text: `Download ${sheet.code} rev ${current.revision}`,
          onclick: async () => {
            try {
              const response = await fetch(`/api/sheets/${sheet.id}/revisions/${current.revision}/file`);
              if (!response.ok) {
                reportProblem('File storage is unreachable. Try the download again in a few minutes.');
                return;
              }
              const blob = await response.blob();
              const url = URL.createObjectURL(blob);
              const link = h('a', { href: url, download: `${sheet.code}.${(current.contentType as string).split('/')[1] ?? 'pdf' }` });
              link.click();
              URL.revokeObjectURL(url);
            } catch {
              reportProblem('File storage is unreachable. Try the download again in a few minutes.');
            }
          },
        }),
        h('button', {
          class: 'button-quiet',
          text: `History of ${sheet.code}`,
          onclick: () => historyDialog(sheet, revisions),
        }),
      );
      row.append(actions);
      tbody.append(row);
    }
    const transmittalsBody = await api(`/api/projects/${project.id}/transmittals`);
    const transmittals = (transmittalsBody.transmittals ?? []) as Record<string, unknown>[];
    clear(transmittalList);
    for (const transmittal of transmittals) {
      transmittalList.append(
        h('li', {}, h('a', { class: 'transmittal-link', href: `/api/transmittals/${transmittal.id}/zip`, text: `Download ${String(transmittal.number)}` })),
      );
    }
  }

  function historyDialog(sheet: Record<string, unknown>, revisions: Record<string, unknown>[]): void {
    openDialog(`History of ${String(sheet.code)}`, (container) => {
      const list = h('ul', { class: 'history-list' });
      for (const revision of revisions) {
        list.append(
          h('li', { text: `${String(revision.revision)} — ${String(revision.state)} — ${String(revision.bytes)} bytes — ${String((revision.uploadedAt as string | undefined ?? '').slice(0, 10))}` }),
        );
      }
      container.append(list);
    });
  }

  function issueDialog(): void {
    void api(`/api/projects/${project.id}/sheets`).then((body) => {
      const sheets = (body.sheets ?? []) as Record<string, unknown>[];
      const checkboxes: { checkbox: HTMLInputElement; sheetId: string; revision: string; label: string }[] = [];
      const purpose = h('select', { id: 'field-purpose', class: 'input' }) as HTMLSelectElement;
      for (const option of ['For construction', 'For tender', 'For information']) {
        purpose.append(h('option', { value: option.toLowerCase().replace(/\s+/g, '_'), text: option }));
      }
      const issue = h('button', { class: 'button-primary', type: 'submit', text: 'Issue transmittal' });
      const form = h('form', {
        onsubmit: async (event: Event) => {
          event.preventDefault();
          const selected = checkboxes.filter((entry) => entry.checkbox.checked);
          if (selected.length === 0) {
            showFieldErrors(form, { sheetRevisions: 'Only current revisions can be issued.' });
            return;
          }
          issue.disabled = true;
          issue.textContent = 'Building transmittal…';
          try {
            const result = await api(`/api/projects/${project.id}/transmittals`, {
              method: 'POST',
              headers: { 'Idempotency-Key': crypto.randomUUID() },
              body: JSON.stringify({
                purpose: purpose.value === 'for_information' ? 'for_information' : purpose.value === 'for_tender' ? 'for_tender' : 'for_construction',
                sheetRevisions: selected.map((entry) => ({ sheetId: entry.sheetId, revision: entry.revision })),
              }),
            });
            const transmittal = result.transmittal as { number: string; sheets: unknown[] };
            announce(`Transmittal ${transmittal.number} issued with ${transmittal.sheets.length} sheets.`);
            dialogHandle.close();
            await render();
            const link = document.querySelector<HTMLElement>(`.transmittal-link`);
            setFocusTarget(link);
          } catch (error) {
            issue.disabled = false;
            issue.textContent = 'Issue transmittal';
            if (error instanceof ApiError) {
              if (error.status === 422) {
                showFieldErrors(form, fieldErrorCopy(error));
                return;
              }
              reportProblem(refusalCopy(error));
            }
          }
        },
      });
      const dialogHandle = openDialog('Issue set', (container) => {
        for (const sheet of sheets) {
          const current = ((sheet.revisions ?? []) as Record<string, unknown>[]).find((r) => r.state === 'current');
          if (!current) continue;
          const checkbox = h('input', { type: 'checkbox', id: `sheet-${sheet.id}` }) as HTMLInputElement;
          checkbox.setAttribute('aria-label', `${String(sheet.code)} rev ${String(current.revision)}`);
          form.append(h('div', { class: 'field checkbox-field' }, checkbox, h('label', { for: checkbox.id, text: `${String(sheet.code)} rev ${String(current.revision)}` })));
          checkboxes.push({ checkbox, sheetId: String(sheet.id), revision: String(current.revision), label: String(sheet.code) });
        }
        form.append(h('div', { class: 'field' }, h('label', { for: 'field-purpose', text: 'Purpose' }), purpose), h('div', { class: 'form-actions' }, issue));
        container.append(form);
      });
    });
  }

  fileInput.addEventListener('change', async () => {
    const files = Array.from(fileInput.files ?? []);
    if (files.length === 0) return;
    let uploaded = 0;
    for (const [index, file] of files.entries()) {
      announce(`Uploading ${index + 1} of ${files.length}: ${file.name}`);
      const data = new FormData();
      const code = file.name.replace(/\.[^.]*$/, '').toUpperCase();
      data.append('sheetCode', code);
      const existing = await api(`/api/projects/${project.id}/sheets`).then((body) =>
        ((body.sheets ?? []) as Record<string, unknown>[]).find((sheet) => String(sheet.code) === code),
      );
      if (!existing) data.append('title', code);
      data.append('file', file);
      try {
        const result = await api(`/api/projects/${project.id}/sheet-revisions`, { method: 'POST', body: data });
        const revision = result.revision as { revision: string };
        announce(`${file.name} added as ${code} revision ${revision.revision}.`);
        uploaded += 1;
      } catch (error) {
        if (error instanceof ApiError) {
          reportProblem(uploadCopy(file.name, error));
        }
      }
    }
    announce(`${uploaded} of ${files.length} files uploaded.`);
    fileInput.value = '';
    await render();
  });

  panel.append(h('div', { class: 'panel-actions' }, uploadButton, fileInput, issueButton), table, transmittalList);
  await render();
}

// ---------- Tenders list ----------

async function tendersListPanel(panel: HTMLElement, project: ProjectData): Promise<void> {
  panel.append(panelTitleBlock('PL-03', 'Tenders'));
  const canCreate = currentMember!.role === 'director' || currentMember!.role === 'project_lead';
  const newButton = h('button', { class: 'button-primary', text: 'New tender', onclick: () => window.location.assign(`/office/projects/${project.id}/stages`) });
  const tendersModule = await import('./tenders.js');
  void newButton;
  await tendersModule.tendersListPanel(panel, project, canCreate);
}

// ---------- Variations ----------

async function variationsPanel(panel: HTMLElement, project: ProjectData): Promise<void> {
  panel.append(panelTitleBlock('PL-04', 'Variations'));
  const list = h('ul', { class: 'variation-list', role: 'list', 'aria-label': 'Variations' });
  const raiseButton = h('button', { class: 'button-primary', text: 'Raise variation' });
  const canRaise =
    STUDIO_ROLES.includes(currentMember!.role) ||
    (currentMember!.role === 'contractor' && project.contract !== null);

  async function render(): Promise<void> {
    clear(list);
    const body = await api(`/api/projects/${project.id}/variations`);
    const variations = (body.variations ?? []) as Record<string, unknown>[];
    for (const variation of variations) {
      const number = String(variation.number);
      const heading = h('h3', { class: 'variation-heading', text: number, tabindex: '-1', 'data-variation-heading': variation.id });
      const card = h(
        'li',
        { class: 'variation-card' },
        heading,
        h('p', { text: String(variation.title) }),
        h('p', { text: amountText(project.currency, Number(variation.amountCents)) }),
        h('p', { class: 'small-caps', text: String(variation.state).replace(/_/g, ' ') }),
      );
      const actions = h('div', { class: 'row-actions' });
      const canDecide = currentMember!.role === 'director' || currentMember!.role === 'project_lead';
      if (variation.state === 'raised' && canDecide) {
        actions.append(
          h('button', {
            class: 'button-secondary',
            text: `Start review of ${number}`,
            onclick: () => transition(variation, 'start_review', 'start review'),
          }),
        );
      }
      if (variation.state === 'under_review' && canDecide) {
        actions.append(
          h('button', { class: 'button-primary', text: `Approve ${number}`, onclick: () => transition(variation, 'approve', 'approve') }),
          h('button', { class: 'button-secondary', text: `Reject ${number}`, onclick: () => transition(variation, 'reject', 'reject') }),
        );
      }
      if ((variation.state === 'raised' || variation.state === 'under_review') && String((variation.raisedBy as Record<string, unknown>)?.id) === currentMember!.id) {
        actions.append(
          h('button', { class: 'button-quiet', text: `Withdraw ${number}`, onclick: () => transition(variation, 'withdraw', 'withdraw') }),
        );
      }
      if (variation.state === 'raised' || variation.state === 'under_review') {
        const canEdit = canDecide || String((variation.raisedBy as Record<string, unknown>)?.id) === currentMember!.id;
        if (canEdit) {
          actions.append(
            h('button', { class: 'button-quiet', text: `Edit ${number}`, onclick: () => editDialog(variation) }),
          );
        }
      }
      card.append(actions);
      const commentInput = h('input', { type: 'text', class: 'input', id: `comment-${variation.id}`, placeholder: '' }) as HTMLInputElement;
      commentInput.setAttribute('aria-label', 'Comment');
      const postComment = h('button', {
        class: 'button-quiet',
        text: 'Post comment',
        onclick: async () => {
          if (!commentInput.value.trim()) return;
          postComment.disabled = true;
          postComment.textContent = 'Posting…';
          try {
            await api(`/api/variations/${variation.id}/comments`, { method: 'POST', body: JSON.stringify({ body: commentInput.value }) });
            announce('Comment posted.');
            commentInput.value = '';
          } catch (error) {
            if (error instanceof ApiError) reportProblem(refusalCopy(error));
          } finally {
            postComment.disabled = false;
            postComment.textContent = 'Post comment';
          }
        },
      });
      card.append(h('div', { class: 'comment-row' }, commentInput, postComment));
      list.append(card);
    }
  }

  async function transition(variation: Record<string, unknown>, action: string, verb: string): Promise<void> {
    const body: Record<string, unknown> = { action };
    if (action === 'reject') {
      const reason = window.prompt('Reason for rejection') ?? '';
      if (!reason) return;
      body.reason = reason;
    }
    try {
      await api(`/api/variations/${variation.id}/transitions`, { method: 'POST', body: JSON.stringify(body) });
      const stateWord = { start_review: 'under review', approve: 'approved', reject: 'rejected', withdraw: 'withdrawn' }[action] ?? action;
      announce(`Variation ${String(variation.number)} ${stateWord}.`);
      await render();
      const heading = document.querySelector<HTMLElement>(`[data-variation-heading="${variation.id}"]`);
      setFocusTarget(heading);
    } catch (error) {
      if (error instanceof ApiError) {
        reportProblem(refusalCopy(error, { kind: 'variation', number: String(variation.number) }));
      }
    }
  }

  function variationFormFields(values: { title?: string; description?: string; amountCents?: number; storeCode?: string | null } = {}): {
    form: HTMLElement;
    title: HTMLInputElement;
    description: HTMLTextAreaElement;
    amount: HTMLInputElement;
    store: HTMLSelectElement;
  } {
    const title = h('input', { type: 'text', id: 'field-title', class: 'input', value: values.title ?? '' }) as HTMLInputElement;
    const description = h('textarea', { id: 'field-description', class: 'input', rows: '4' }) as HTMLTextAreaElement;
    description.value = values.description ?? '';
    const amount = h('input', { type: 'text', id: 'field-amountCents', class: 'input', value: values.amountCents ? (values.amountCents / 100).toFixed(2) : '' }) as HTMLInputElement;
    const store = h('select', { id: 'field-storeCode', class: 'input' }) as HTMLSelectElement;
    store.append(h('option', { value: '', text: '—' }));
    for (const projectStore of project.stores) {
      const option = h('option', { value: projectStore.code, text: `${projectStore.code} ${projectStore.name}` });
      if (values.storeCode === projectStore.code) option.setAttribute('selected', 'true');
      store.append(option);
    }
    const form = h(
      'div',
      { class: 'variation-fields' },
      h('div', { class: 'field' }, h('label', { for: 'field-title', text: 'Title' }), title),
      h('div', { class: 'field' }, h('label', { for: 'field-description', text: 'Description' }), description),
      h('div', { class: 'field' }, h('label', { for: 'field-amountCents', text: 'Amount' }), amount),
      h('div', { class: 'field' }, h('label', { for: 'field-storeCode', text: 'Store' }), store),
    );
    return { form, title, description, amount, store };
  }

  if (canRaise) {
    raiseButton.addEventListener('click', () => {
      const fields = variationFormFields();
      const submit = h('button', { class: 'button-primary', type: 'submit', text: 'Submit variation' });
      const form = h('form', {
        onsubmit: async (event: Event) => {
          event.preventDefault();
          submit.disabled = true;
          submit.textContent = 'Sending variation…';
          try {
            const payload: Record<string, unknown> = {
              title: fields.title.value,
              description: fields.description.value,
              amountCents: Math.round(parseFloat(fields.amount.value || '0') * 100),
            };
            if (fields.store.value) payload.storeCode = fields.store.value;
            const result = await api(`/api/projects/${project.id}/variations`, {
              method: 'POST',
              headers: { 'Idempotency-Key': idempotencyKey() },
              body: JSON.stringify(payload),
            });
            const variation = result.variation as Record<string, unknown>;
            announce(`Variation ${String(variation.number)} raised.`);
            dialogHandle.close();
            await render();
            const heading = document.querySelector<HTMLElement>(`[data-variation-heading="${variation.id}"]`);
            setFocusTarget(heading);
          } catch (error) {
            submit.disabled = false;
            submit.textContent = 'Submit variation';
            if (error instanceof ApiError) reportProblem(refusalCopy(error, { kind: 'variation' }));
          }
        },
      });
      const dialogHandle = openDialog('Raise variation', (container) => {
        form.append(fields.form, h('div', { class: 'form-actions' }, submit));
        container.append(form);
      });
    });
  } else {
    raiseButton.style.display = 'none';
  }

  function editDialog(variation: Record<string, unknown>): void {
    const fields = variationFormFields({
      title: String(variation.title),
      description: String(variation.description),
      amountCents: Number(variation.amountCents),
      storeCode: variation.storeCode as string | null,
    });
    const submit = h('button', { class: 'button-primary', type: 'submit', text: 'Save changes' });
    const form = h('form', {
      onsubmit: async (event: Event) => {
        event.preventDefault();
        submit.disabled = true;
        submit.textContent = 'Saving…';
        try {
          await api(`/api/variations/${variation.id}`, {
            method: 'PATCH',
            body: JSON.stringify({
              version: variation.version,
              title: fields.title.value,
              description: fields.description.value,
              amountCents: Math.round(parseFloat(fields.amount.value || '0') * 100),
              storeCode: fields.store.value || null,
            }),
          });
          announce(`Variation ${String(variation.number)} saved.`);
          dialogHandle.close();
          await render();
          const heading = document.querySelector<HTMLElement>(`[data-variation-heading="${variation.id}"]`);
          setFocusTarget(heading);
        } catch (error) {
          submit.disabled = false;
          submit.textContent = 'Save changes';
          if (error instanceof ApiError) reportProblem(refusalCopy(error, { kind: 'variation', number: String(variation.number) }));
        }
      },
    });
    const dialogHandle = openDialog(`Edit ${String(variation.number)}`, (container) => {
      form.append(fields.form, h('div', { class: 'form-actions' }, submit));
      container.append(form);
    });
  }

  panel.append(raiseButton, list);
  await render();
}

function idempotencyKey(): string {
  const existing = sessionStorage.getItem('plumbline:variation-key');
  if (existing) {
    sessionStorage.removeItem('plumbline:variation-key');
    return existing;
  }
  return crypto.randomUUID();
}

// ---------- Certificates ----------

async function certificatesPanel(panel: HTMLElement, project: ProjectData): Promise<void> {
  panel.append(panelTitleBlock('PL-05', 'Certificates'));
  const canIssue = currentMember!.role === 'director' || currentMember!.role === 'project_lead';
  const actions = h('div', { class: 'panel-actions' });
  const issueButton = h('button', { class: 'button-primary', text: 'Issue certificate' });
  const pcButton = h('button', { class: 'button-secondary', text: 'Record practical completion' });
  const releaseButton = h('button', { class: 'button-secondary', text: 'Release final retention' });
  const certificatesTable = h('table', { class: 'data-table', 'aria-label': 'Certificates' }) as HTMLTableElement;
  certificatesTable.insertRow();
  for (const column of ['Number', 'Kind', 'Period ending', 'Amount due', 'Retention held']) {
    certificatesTable.tHead!.insertRow().append(h('th', { scope: 'col', text: column }));
  }
  const certificatesBody = h('tbody');
  certificatesTable.append(certificatesBody);
  const splitContainer = h('div', { class: 'split-container' });
  const ledgerTable = h('table', { class: 'data-table', 'aria-label': 'Retention ledger' }) as HTMLTableElement;
  for (const column of ['Certificate', 'Kind', 'Account', 'Side', 'Amount']) {
    ledgerTable.tHead!.insertRow().append(h('th', { scope: 'col', text: column }));
  }
  const ledgerBody = h('tbody');
  ledgerTable.append(ledgerBody);

  if (canIssue) {
    issueButton.addEventListener('click', () => issueCertificateDialog());
    pcButton.addEventListener('click', () => practicalCompletionDialog());
    releaseButton.addEventListener('click', () => releaseDialog());
    actions.append(issueButton, pcButton, releaseButton);
  } else {
    issueButton.style.display = 'none';
    pcButton.style.display = 'none';
    releaseButton.style.display = 'none';
  }

  async function render(): Promise<void> {
    clear(certificatesBody);
    clear(splitContainer);
    clear(ledgerBody);
    const body = await api(`/api/projects/${project.id}/certificates`);
    const certificates = (body.certificates ?? []) as Record<string, unknown>[];
    for (const certificate of certificates) {
      const number = String(certificate.number);
      const row = h('tr');
      row.append(
        h('td', {}, h('a', { class: 'certificate-link', href: `/api/certificates/${certificate.id}`, text: number, 'data-certificate-link': certificate.id })),
        h('td', { text: String(certificate.kind).replace(/_/g, ' ') }),
        h('td', { text: certificate.periodEnding ? dateText(String(certificate.periodEnding)) : '—' }),
        h('td', { text: amountText(project.currency, Number(certificate.amountDueCents)) }),
        h('td', { text: amountText(project.currency, Number(certificate.retentionHeldCents)) }),
      );
      certificatesBody.append(row);
      const splitTable = h('table', { class: 'data-table split-table', 'aria-label': `Store split ${number}` }) as HTMLTableElement;
      for (const column of ['Store', 'Name', 'Weight', 'Amount']) {
        splitTable.tHead!.insertRow().append(h('th', { scope: 'col', text: column }));
      }
      const splitBody = h('tbody');
      for (const part of (certificate.storeSplit ?? []) as Record<string, unknown>[]) {
        const splitRow = h('tr');
        splitRow.append(
          h('td', { text: String(part.storeCode) }),
          h('td', { text: String(part.storeName) }),
          h('td', { text: String(part.weight) }),
          h('td', { text: amountText(project.currency, Number(part.amountCents)) }),
        );
        splitBody.append(splitRow);
      }
      splitTable.append(splitBody);
      splitContainer.append(
        h('div', { class: 'split-block' }, splitTable, h('a', { class: 'button-quiet', href: `/api/certificates/${certificate.id}/split.csv`, text: `Export split ${number}` })),
      );
    }
    if (STUDIO_ROLES.includes(currentMember!.role)) {
      try {
        const ledger = await api(`/api/projects/${project.id}/retention-ledger`);
        for (const entry of (ledger.entries ?? []) as Record<string, unknown>[]) {
          const row = h('tr');
          row.append(
            h('td', { text: String(entry.certificateNumber) }),
            h('td', { text: String(entry.kind).replace(/_/g, ' ') }),
            h('td', { text: String(entry.account).replace(/_/g, ' ') }),
            h('td', { text: String(entry.side) }),
            h('td', { text: amountText(project.currency, Number(entry.amountCents)) }),
          );
          ledgerBody.append(row);
        }
      } catch {
        // Only director, project lead and finance see the ledger.
      }
    }
  }

  function issueCertificateDialog(): void {
    const periodEnding = h('input', { type: 'date', id: 'field-periodEnding', class: 'input' }) as HTMLInputElement;
    const gross = h('input', { type: 'text', id: 'field-grossValuationCents', class: 'input', inputmode: 'decimal' }) as HTMLInputElement;
    const submit = h('button', { class: 'button-primary', type: 'submit', text: 'Confirm and issue' });
    const form = h('form', {
      onsubmit: async (event: Event) => {
        event.preventDefault();
        submit.disabled = true;
        submit.textContent = 'Issuing…';
        try {
          const result = await api(`/api/projects/${project.id}/certificates`, {
            method: 'POST',
            body: JSON.stringify({
              periodEnding: periodEnding.value,
              grossValuationCents: Math.round(parseFloat(gross.value || '0') * 100),
            }),
          });
          const certificate = result.certificate as Record<string, unknown>;
          announce(
            `Certificate ${String(certificate.number)} issued: ${amountText(project.currency, Number(certificate.amountDueCents))} due.`,
          );
          dialogHandle.close();
          await render();
          const link = document.querySelector<HTMLElement>(`[data-certificate-link="${certificate.id}"]`);
          setFocusTarget(link);
        } catch (error) {
          submit.disabled = false;
          submit.textContent = 'Confirm and issue';
          if (error instanceof ApiError) {
            if (error.status === 422) {
              showFieldErrors(form, fieldErrorCopy(error));
              return;
            }
            reportProblem(refusalCopy(error));
          }
        }
      },
    });
    const dialogHandle = openDialog('Issue payment certificate', (container) => {
      form.append(
        h('div', { class: 'field' }, h('label', { for: 'field-periodEnding', text: 'Period ending' }), periodEnding),
        h('div', { class: 'field' }, h('label', { for: 'field-grossValuationCents', text: 'Gross valuation to date' }), gross),
        h('div', { class: 'form-actions' }, submit),
      );
      container.append(form);
    });
  }

  function practicalCompletionDialog(): void {
    const date = h('input', { type: 'date', id: 'field-date', class: 'input', value: hkToday() }) as HTMLInputElement;
    const submit = h('button', { class: 'button-primary', type: 'submit', text: 'Record and release half' });
    const form = h('form', {
      onsubmit: async (event: Event) => {
        event.preventDefault();
        submit.disabled = true;
        submit.textContent = 'Recording…';
        try {
          const result = await api(`/api/projects/${project.id}/practical-completion`, {
            method: 'POST',
            body: JSON.stringify({ date: date.value }),
          });
          const certificate = result.certificate as Record<string, unknown>;
          announce(
            `Practical completion recorded. Retention release ${String(certificate.number)} issued for ${amountText(project.currency, Number(certificate.amountDueCents))}.`,
          );
          dialogHandle.close();
          await render();
          const link = document.querySelector<HTMLElement>(`[data-certificate-link="${certificate.id}"]`);
          setFocusTarget(link);
        } catch (error) {
          submit.disabled = false;
          submit.textContent = 'Record and release half';
          if (error instanceof ApiError) {
            if (error.status === 422) {
              showFieldErrors(form, fieldErrorCopy(error));
              return;
            }
            reportProblem(refusalCopy(error));
          }
        }
      },
    });
    const dialogHandle = openDialog('Record practical completion', (container) => {
      form.append(h('div', { class: 'field' }, h('label', { for: 'field-date', text: 'Practical completion date' }), date), h('div', { class: 'form-actions' }, submit));
      container.append(form);
    });
  }

  function releaseDialog(): void {
    const confirm = h('button', { class: 'button-primary', text: 'Confirm final release' });
    const dialogHandle = openDialog('Release final retention', (container) => {
      confirm.addEventListener('click', async () => {
        confirm.disabled = true;
        confirm.textContent = 'Releasing…';
        try {
          const result = await api(`/api/projects/${project.id}/retention/final-release`, { method: 'POST', body: '{}' });
          const certificate = result.certificate as Record<string, unknown>;
          announce(`Final retention release ${String(certificate.number)} issued for ${amountText(project.currency, Number(certificate.amountDueCents))}.`);
          dialogHandle.close();
          await render();
          const link = document.querySelector<HTMLElement>(`[data-certificate-link="${certificate.id}"]`);
          setFocusTarget(link);
        } catch (error) {
          confirm.disabled = false;
          confirm.textContent = 'Confirm final release';
          if (error instanceof ApiError) reportProblem(refusalCopy(error));
        }
      });
      container.append(h('p', { text: 'The final release pays out all retention still held after the defects period.' }), confirm);
    });
  }

  panel.append(actions, certificatesTable, splitContainer, h('h2', { text: 'Retention ledger' }), ledgerTable);
  await render();
}

// ---------- Shop drawings ----------

const CODE_LABELS: Record<number, string> = {
  1: 'Code 1 Proceed',
  2: 'Code 2 Proceed with comments',
  3: 'Code 3 Revise and resubmit',
  4: 'Code 4 Rejected',
};

async function shopDrawingsPanel(panel: HTMLElement, project: ProjectData): Promise<void> {
  panel.append(panelTitleBlock('PL-06', 'Shop drawings'));
  const submitButton = h('button', { class: 'button-primary', text: 'Submit shop drawing' });
  const table = h('table', { class: 'data-table', 'aria-label': 'Shop drawings' }) as HTMLTableElement;
  for (const column of ['Reference', 'Title', 'Submission', 'Received', 'Due', 'Status', 'Actions']) {
    table.tHead!.insertRow().append(h('th', { scope: 'col', text: column }));
  }
  const tbody = h('tbody');
  table.append(tbody);
  const studio = STUDIO_ROLES.includes(currentMember!.role);
  const contractorAllowed = currentMember!.role === 'contractor' && project.contract !== null;

  async function render(): Promise<void> {
    clear(tbody);
    const body = await api(`/api/projects/${project.id}/shop-drawings`);
    const drawings = (body.shopDrawings ?? []) as Record<string, unknown>[];
    for (const drawing of drawings) {
      const reference = String(drawing.reference);
      const row = h('tr');
      row.append(
        h('td', { text: reference }),
        h('td', { text: String(drawing.title) }),
        h('td', { text: String(drawing.submission) }),
        h('td', { text: drawing.receivedAt ? instantText(String(drawing.receivedAt), project.region) : '' }),
        h('td', {}, drawing.overdue ? h('span', { class: 'overdue-flag', 'data-shape': 'clock' }, h('span', { class: 'shape-clock', 'aria-hidden': 'true' }), 'Review overdue') : h('span', { text: drawing.reviewDueOn ? `Due ${dateText(String(drawing.reviewDueOn))}` : '' })),
        h('td', { text: drawing.review ? CODE_LABELS[Number((drawing.review as Record<string, unknown>).code)] ?? '' : String(drawing.status) }),
      );
      const actions = h('td', { class: 'row-actions' });
      if (studio && drawing.status === 'received') {
        actions.append(h('button', { class: 'button-secondary', text: `Review ${reference}`, onclick: () => reviewDialog(drawing) }));
      }
      if (drawing.review && [3, 4].includes(Number((drawing.review as Record<string, unknown>).code)) && (studio || contractorAllowed)) {
        actions.append(h('button', { class: 'button-quiet', text: `Resubmit ${reference}`, onclick: () => resubmitDialog(drawing) }));
      }
      row.append(actions);
      tbody.append(row);
    }
  }

  function submitFormFields(receivedAtVisible: boolean) {
    const reference = h('input', { type: 'text', id: 'field-reference', class: 'input' }) as HTMLInputElement;
    const title = h('input', { type: 'text', id: 'field-title', class: 'input' }) as HTMLInputElement;
    const file = h('input', { type: 'file', id: 'field-file', class: 'input' }) as HTMLInputElement;
    file.setAttribute('aria-label', 'Drawing file');
    const receivedAt = h('input', { type: 'datetime-local', id: 'field-receivedAt', class: 'input', step: '1' }) as HTMLInputElement;
    receivedAt.style.display = receivedAtVisible ? '' : 'none';
    return { reference, title, file, receivedAt };
  }

  submitButton.addEventListener('click', () => {
    const fields = submitFormFields(studio);
    const submit = h('button', { class: 'button-primary', type: 'submit', text: 'Send for review' });
    const form = h('form', {
      onsubmit: async (event: Event) => {
        event.preventDefault();
        submit.disabled = true;
        submit.textContent = 'Sending…';
        const data = new FormData();
        data.append('reference', fields.reference.value);
        data.append('title', fields.title.value);
        if (studio && fields.receivedAt.value) data.append('receivedAt', `${fields.receivedAt.value}:00.000Z`);
        if (fields.file.files?.[0]) data.append('file', fields.file.files[0]);
        try {
          const result = await api(`/api/projects/${project.id}/shop-drawings`, { method: 'POST', body: data });
          const drawing = result.shopDrawing as Record<string, unknown>;
          announce(`${String(drawing.reference)} received. Review due ${dateText(String(drawing.reviewDueOn))}.`);
          dialogHandle.close();
          await render();
        } catch (error) {
          submit.disabled = false;
          submit.textContent = 'Send for review';
          if (error instanceof ApiError) {
            if (error.status === 422) {
              showFieldErrors(form, fieldErrorCopy(error));
              return;
            }
            reportProblem(refusalCopy(error));
          }
        }
      },
    });
    const dialogHandle = openDialog('Submit shop drawing', (container) => {
      form.append(
        h('div', { class: 'field' }, h('label', { for: 'field-reference', text: 'Reference' }), fields.reference),
        h('div', { class: 'field' }, h('label', { for: 'field-title', text: 'Title' }), fields.title),
        h('div', { class: 'field' }, h('label', { for: 'field-file', text: 'Drawing file' }), fields.file),
        h('div', { class: 'field', style: studio ? '' : 'display:none' }, h('label', { for: 'field-receivedAt', text: 'Received at' }), fields.receivedAt),
        h('div', { class: 'form-actions' }, submit),
      );
      container.append(form);
    });
  });

  function reviewDialog(drawing: Record<string, unknown>): void {
    const reference = String(drawing.reference);
    const radios: HTMLInputElement[] = [];
    const group = h('div', { class: 'field', role: 'radiogroup', 'aria-label': 'Review code' });
    for (const code of [1, 2, 3, 4]) {
      const radio = h('input', { type: 'radio', name: 'review-code', id: `code-${code}`, value: String(code) }) as HTMLInputElement;
      radios.push(radio);
      group.append(h('div', { class: 'radio-row' }, radio, h('label', { for: `code-${code}`, text: CODE_LABELS[code] })));
    }
    const comments = h('textarea', { id: 'field-comments', class: 'input', rows: '3' }) as HTMLTextAreaElement;
    const submit = h('button', { class: 'button-primary', type: 'submit', text: 'Return drawing' });
    const form = h('form', {
      onsubmit: async (event: Event) => {
        event.preventDefault();
        const checked = radios.find((radio) => radio.checked);
        if (!checked) {
          showFieldErrors(form, { code: 'Review code is required.' });
          return;
        }
        const code = parseInt(checked.value, 10);
        if ([2, 3, 4].includes(code) && !comments.value.trim()) {
          showFieldErrors(form, { comments: `Comments are needed for ${CODE_LABELS[code]}.` });
          return;
        }
        submit.disabled = true;
        submit.textContent = 'Returning drawing…';
        try {
          await api(`/api/shop-drawings/${drawing.id}/review`, {
            method: 'POST',
            body: JSON.stringify({ code, comments: comments.value }),
          });
          announce(`${reference} returned with ${CODE_LABELS[code]}.`);
          dialogHandle.close();
          await render();
        } catch (error) {
          submit.disabled = false;
          submit.textContent = 'Return drawing';
          if (error instanceof ApiError) reportProblem(refusalCopy(error, { reference }));
        }
      },
    });
    const dialogHandle = openDialog(`Review ${reference}`, (container) => {
      form.append(group, h('div', { class: 'field' }, h('label', { for: 'field-comments', text: 'Comments' }), comments), h('div', { class: 'form-actions' }, submit));
      container.append(form);
    });
  }

  function resubmitDialog(drawing: Record<string, unknown>): void {
    const reference = String(drawing.reference);
    const file = h('input', { type: 'file', id: 'field-file', class: 'input' }) as HTMLInputElement;
    file.setAttribute('aria-label', 'Drawing file');
    const submit = h('button', { class: 'button-primary', type: 'submit', text: 'Send for review' });
    const form = h('form', {
      onsubmit: async (event: Event) => {
        event.preventDefault();
        submit.disabled = true;
        submit.textContent = 'Sending…';
        const data = new FormData();
        if (fields.receivedAt.value) data.append('receivedAt', `${fields.receivedAt.value}:00.000Z`);
        if (file.files?.[0]) data.append('file', file.files[0]);
        try {
          const result = await api(`/api/shop-drawings/${drawing.id}/resubmissions`, { method: 'POST', body: data });
          const fresh = result.shopDrawing as Record<string, unknown>;
          announce(`${String(fresh.reference)} received. Review due ${dateText(String(fresh.reviewDueOn))}.`);
          dialogHandle.close();
          await render();
        } catch (error) {
          submit.disabled = false;
          submit.textContent = 'Send for review';
          if (error instanceof ApiError) {
            if (error.status === 422) {
              showFieldErrors(form, fieldErrorCopy(error));
              return;
            }
            reportProblem(refusalCopy(error));
          }
        }
      },
    });
    const receivedAt = h('input', { type: 'datetime-local', id: 'field-receivedAt', class: 'input', step: '1' }) as HTMLInputElement;
    const fields = { receivedAt };
    const dialogHandle = openDialog(`Resubmit ${reference}`, (container) => {
      form.append(
        h('div', { class: 'field' }, h('label', { for: 'field-file', text: 'Drawing file' }), file),
        h('div', { class: 'field', style: studio ? '' : 'display:none' }, h('label', { for: 'field-receivedAt', text: 'Received at' }), receivedAt),
        h('div', { class: 'form-actions' }, submit),
      );
      container.append(form);
    });
  }

  if (studio || contractorAllowed) {
    panel.append(h('div', { class: 'panel-actions' }, submitButton), table);
  } else {
    submitButton.style.display = 'none';
    panel.append(table);
  }
  await render();
}

// ---------- Finishes ----------

async function finishesPanel(panel: HTMLElement, project: ProjectData): Promise<void> {
  panel.append(panelTitleBlock('PL-08', 'Finishes'));
  const importButton = h('button', { class: 'button-secondary', text: 'Import CSV' });
  const exportLink = h('a', { class: 'button-quiet', href: `/api/projects/${project.id}/finishes.csv`, text: 'Export finishes CSV' });
  const table = h('table', { class: 'data-table', 'aria-label': 'Finishes schedule' }) as HTMLTableElement;
  for (const column of ['Position', 'Code', 'Name', 'Category', 'Supplier', 'Product ref', 'Location']) {
    table.tHead!.insertRow().append(h('th', { scope: 'col', text: column }));
  }
  const tbody = h('tbody');
  table.append(tbody);
  const reportTable = h('table', { class: 'data-table', 'aria-label': 'Import report' }) as HTMLTableElement;
  for (const column of ['Line', 'Status', 'Code', 'Name', 'Reason']) {
    reportTable.tHead!.insertRow().append(h('th', { scope: 'col', text: column }));
  }
  const reportBody = h('tbody');
  reportTable.append(reportBody);
  reportTable.style.display = 'none';
  let dragState: { index: number; row: HTMLElement } | null = null;
  let keyboardPicked: number | null = null;

  async function render(): Promise<void> {
    clear(tbody);
    const body = await api(`/api/projects/${project.id}/finishes`);
    const finishes = (body.finishes ?? []) as Record<string, unknown>[];
    finishes.forEach((finish, index) => {
      const row = h('tr', { 'data-finish-index': String(index), 'data-finish-id': String(finish.id) });
      const handle = h('button', {
        class: 'button-quiet reorder-handle',
        text: `Reorder ${finish.code ?? finish.name}`,
        draggable: 'true',
        'aria-keyshortcuts': 'Enter Space',
      });
      handle.addEventListener('keydown', (event) => {
        const key = event.key;
        if (key === 'Enter' || key === ' ') {
          event.preventDefault();
          if (keyboardPicked === null) {
            keyboardPicked = index;
            announce(`Picked up ${finishLabel(finish)} . Position ${index + 1} of ${finishes.length}. Use the up and down arrow keys to move, Enter to drop, Escape to cancel.`);
          } else if (keyboardPicked === index) {
            void saveMove(String(finish.id), index + 1);
            announce(`${finishLabel(finish)} dropped at position ${index + 1} of ${finishes.length}.`);
            keyboardPicked = null;
          }
        } else if (key === 'ArrowUp' && keyboardPicked !== null) {
          event.preventDefault();
          moveRow(keyboardPicked, keyboardPicked - 1);
        } else if (key === 'ArrowDown' && keyboardPicked !== null) {
          event.preventDefault();
          moveRow(keyboardPicked, keyboardPicked + 1);
        } else if (key === 'Escape' && keyboardPicked !== null) {
          event.preventDefault();
          announce(`Reorder cancelled. ${finishLabel(finish)} is back at position ${index + 1} of ${finishes.length}.`);
          keyboardPicked = null;
          void render();
        }
      });
      handle.addEventListener('dragstart', () => {
        dragState = { index, row };
      });
      handle.addEventListener('dragend', () => {
        dragState = null;
      });
      row.append(
        h('td', { text: String(finish.position) }),
        h('td', { text: String(finish.code ?? '') }),
        h('td', { text: String(finish.name) }),
        h('td', { text: String(finish.category) }),
        h('td', { text: String(finish.supplier ?? '') }),
        h('td', { text: String(finish.productRef ?? '') }),
        h('td', { text: String(finish.location ?? '') }),
        h('td', {}, handle),
      );
      row.addEventListener('dragover', (event) => event.preventDefault());
      row.addEventListener('drop', (event) => {
        event.preventDefault();
        const state = dragState;
        if (state && state.index !== index) {
          const movingId = String(finishes[state.index].id);
          const targetPosition = index + 1;
          dragState = null;
          void saveMove(movingId, targetPosition);
        }
      });
      tbody.append(row);
    });
  }

  function moveRow(from: number, to: number): void {
    const rows = Array.from(tbody.querySelectorAll('tr'));
    if (to < 0 || to >= rows.length) return;
    const moving = rows[from];
    const target = rows[to];
    tbody.insertBefore(moving, to > from ? target.nextSibling : target);
    keyboardPicked = to;
    const finishName = moving.querySelector('td:nth-child(3)')?.textContent ?? '';
    announce(`${finishName} moved to position ${to + 1} of ${rows.length}.`);
  }

  async function saveMove(finishId: string, position: number): Promise<void> {
    const rows = Array.from(tbody.querySelectorAll('tr'));
    try {
      await api(`/api/finishes/${finishId}/move`, { method: 'POST', body: JSON.stringify({ position }) });
      const finishName = rows[position - 1]?.querySelector('td:nth-child(3)')?.textContent ?? '';
      announce(`${finishName} dropped at position ${position} of ${rows.length}.`);
      await render();
    } catch (error) {
      if (error instanceof ApiError) reportProblem(refusalCopy(error));
      void render();
    }
  }

  function finishLabel(finish: Record<string, unknown>): string {
    return `${String(finish.code ?? '')} ${String(finish.name)}`.trim();
  }

  importButton.addEventListener('click', () => {
    const file = h('input', { type: 'file', id: 'field-file', class: 'input', accept: '.csv,text/csv' }) as HTMLInputElement;
    file.setAttribute('aria-label', 'Legacy CSV file');
    const submit = h('button', { class: 'button-primary', type: 'submit', text: 'Import' });
    const form = h('form', {
      onsubmit: async (event: Event) => {
        event.preventDefault();
        if (!file.files?.[0]) return;
        submit.disabled = true;
        submit.textContent = 'Importing…';
        const text = await file.files[0].text();
        try {
          const result = await api(`/api/projects/${project.id}/finishes/import`, {
            method: 'POST',
            headers: { 'Content-Type': 'text/csv' },
            body: text,
          });
          const summary = result.summary as { created: number; updated: number; unchanged: number; rejected: number };
          announce(`Import finished: ${summary.created} created, ${summary.updated} updated, ${summary.unchanged} unchanged, ${summary.rejected} rejected.`);
          dialogHandle.close();
          await render();
          clear(reportBody);
          for (const row of (result.rows ?? []) as Record<string, unknown>[]) {
            const reportRow = h('tr');
            reportRow.append(
              h('td', { text: String(row.line) }),
              h('td', { text: String(row.status) }),
              h('td', { text: String(row.code ?? '') }),
              h('td', { text: String(row.name) }),
              h('td', { text: String(row.reason ?? '') }),
            );
            reportBody.append(reportRow);
          }
          reportTable.style.display = '';
          setFocusTarget(reportTable.tHead!.rows[0].cells[0] as unknown as HTMLElement);
        } catch (error) {
          submit.disabled = false;
          submit.textContent = 'Import';
          if (error instanceof ApiError) {
            if (error.status === 422) {
              showFieldErrors(form, fieldErrorCopy(error));
              return;
            }
            reportProblem(refusalCopy(error));
          }
        }
      },
    });
    const dialogHandle = openDialog('Import finishes', (container) => {
      form.append(h('div', { class: 'field' }, h('label', { for: 'field-file', text: 'Legacy CSV file' }), file), h('div', { class: 'form-actions' }, submit));
      container.append(form);
    });
  });

  panel.append(h('div', { class: 'panel-actions' }, importButton, exportLink), table, reportTable);
  await render();
}

export { icon };
