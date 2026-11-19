import { type ApiErrorBody, get, send } from '../api.js';
import { el } from '../dom.js';
import { session } from '../session.js';
import { navigate } from '../shell.js';
import { focusFirst, openDialog } from '../ui/dialog.js';
import type { ParameterDoc, SetDoc } from '../../shared/types.js';

interface WorkbookDoc {
  id: string;
  name: string;
  project: string;
  project_name: string;
  source: string;
  state: string;
  version: number;
  certified_by: string | null;
  sheets: { id: string; name: string }[];
  dashboards: { id: string; name: string }[];
  parameters: ParameterDoc[];
  sets: SetDoc[];
}

export async function workbookPage(host: HTMLElement, params: Record<string, string>): Promise<void> {
  document.body.dataset.field = 'ground';
  const res = await get<WorkbookDoc & ApiErrorBody>(`/api/workbooks/${params.id}`);
  if (res.status !== 200) {
    host.append(el('h1', { class: 'empty-headline', text: 'Not found.' }));
    return;
  }
  let workbook = res.data;
  const role = session.me?.projects.find((p) => p.id === workbook.project)?.role ?? null;

  const publishState = el('p', { role: 'status', 'aria-live': 'polite', 'aria-label': 'Publish state', class: 'status' });
  const certified = el('p', { role: 'status', 'aria-live': 'polite', 'aria-label': 'Certified', class: 'status' });
  certified.textContent = workbook.certified_by === null ? '' : `Certified by ${workbook.certified_by}`;

  const sheetList = el('ul', { class: 'plain-list' },
    workbook.sheets.map((sheet) =>
      el('li', {}, [el('a', { href: `/workbooks/${workbook.id}/sheets/${sheet.id}`, text: sheet.name })]),
    ),
  );
  const dashboardList = el('ul', { class: 'plain-list' },
    workbook.dashboards.map((dashboard) =>
      el('li', {}, [el('a', { href: `/dashboards/${dashboard.id}`, text: dashboard.name })]),
    ),
  );

  const newSheet = el('button', { type: 'button', class: 'pill-button primary', text: 'New sheet' });
  newSheet.addEventListener('click', () => {
    void (async () => {
      const created = await send<{ id: string } & ApiErrorBody>(
        'POST',
        `/api/workbooks/${workbook.id}/sheets`,
        { name: `Sheet ${workbook.sheets.length + 1}`, rows: [], columns: [] },
        { 'if-match': String(workbook.version) },
      );
      if (created.status === 201) {
        navigate(`/workbooks/${workbook.id}/sheets/${created.data.id}`);
        return;
      }
      if (created.status === 409) publishState.textContent = 'This workbook changed since you opened it. Reload and publish again.';
    })();
  });

  const newDashboard = el('button', { type: 'button', class: 'pill-button', text: 'New dashboard' });
  newDashboard.addEventListener('click', () => {
    const nameInput = el('input', { type: 'text', id: 'dash-name', class: 'input', value: 'Dashboard' });
    const arrangement = el('select', { id: 'dash-arrangement', class: 'input' }, [
      el('option', { value: 'horizontal', text: 'Horizontal' }),
      el('option', { value: 'vertical', text: 'Vertical' }),
    ]);
    const error = el('p', { class: 'field-error' });
    const boxes: { box: HTMLInputElement; id: string }[] = [];
    const dialog = openDialog({ name: 'New dashboard', opener: newDashboard });
    dialog.body.append(el('label', { for: 'dash-name', text: 'Dashboard name' }), nameInput);
    for (const sheet of workbook.sheets) {
      const box = el('input', { type: 'checkbox', id: `dash-sheet-${sheet.id}` });
      boxes.push({ box, id: sheet.id });
      dialog.body.append(el('div', { class: 'row' }, [box, el('label', { for: `dash-sheet-${sheet.id}`, text: sheet.name })]));
    }
    const create = el('button', { type: 'button', class: 'pill-button primary', text: 'Create dashboard' });
    dialog.body.append(el('label', { for: 'dash-arrangement', text: 'Arrangement' }), arrangement, error, create);
    create.addEventListener('click', () => {
      void (async () => {
        const chosen = boxes.filter((entry) => entry.box.checked).map((entry) => entry.id);
        const created = await send<{ id: string } & ApiErrorBody>(
          'POST',
          `/api/workbooks/${workbook.id}/dashboards`,
          {
            name: nameInput.value,
            layout: { type: arrangement.value, children: chosen.map((id) => ({ sheet: id })) },
            floating: [],
            phone_order: chosen,
            phone_heights: Object.fromEntries(chosen.map((id) => [id, 320])),
            actions: [],
          },
          { 'if-match': String(workbook.version) },
        );
        if (created.status === 201) {
          dialog.close();
          navigate(`/dashboards/${created.data.id}`);
          return;
        }
        const errors = created.data.errors;
        error.textContent =
          errors !== undefined && !Array.isArray(errors)
            ? errors.sheets ?? errors.layout ?? errors.actions ?? 'A dashboard holds 2 to 4 sheets.'
            : 'A dashboard holds 2 to 4 sheets.';
      })();
    });
    focusFirst(dialog);
  });

  const publish = el('button', { type: 'button', class: 'pill-button primary', text: 'Publish' });
  publish.addEventListener('click', () => {
    const projectSelect = el('select', { id: 'publish-project', class: 'input' },
      (session.me?.projects ?? [])
        .filter((p) => p.role === 'creator')
        .map((p) => el('option', { value: p.id, text: p.name })),
    );
    projectSelect.value = workbook.project;
    const confirm = el('button', { type: 'button', class: 'pill-button primary', text: 'Publish workbook' });
    const dialog = openDialog({ name: 'Publish', opener: publish });
    dialog.body.append(el('label', { for: 'publish-project', text: 'Project' }), projectSelect, confirm);
    confirm.addEventListener('click', () => {
      void (async () => {
        publishState.textContent = 'Publishing...';
        const chosen = projectSelect.value;
        const projectName = (session.me?.projects ?? []).find((p) => p.id === chosen)?.name ?? '';
        const done = await send<{ version: number } & ApiErrorBody>(
          'POST',
          `/api/workbooks/${workbook.id}/publish`,
          { project: chosen },
          { 'if-match': String(workbook.version) },
        );
        dialog.close();
        if (done.status === 200) {
          workbook = { ...workbook, state: 'published', project: chosen, version: done.data.version, certified_by: null };
          publishState.textContent = `Published to ${projectName}.`;
          certified.textContent = '';
          return;
        }
        if (done.status === 409) {
          publishState.textContent = 'This workbook changed since you opened it. Reload and publish again.';
          return;
        }
        publishState.textContent = 'Something went wrong. Try again.';
      })();
    });
    focusFirst(dialog);
  });

  const certify = el('button', { type: 'button', class: 'pill-button', text: 'Certify' });
  certify.addEventListener('click', () => {
    void (async () => {
      const done = await send<{ certified_by: string } & ApiErrorBody>('POST', `/api/workbooks/${workbook.id}/certify`);
      if (done.status === 200) {
        certified.textContent = `Certified by ${done.data.certified_by}`;
        return;
      }
      publishState.textContent = done.status === 409 ? 'This workbook changed since you opened it. Reload and publish again.' : '';
    })();
  });

  host.append(
    el('div', { class: 'page workbook-page' }, [
      el('h1', { text: workbook.name }),
      el('p', { class: 'muted', text: `${workbook.project_name} - ${workbook.state === 'published' ? 'Published' : 'Draft'}` }),
      publishState,
      certified,
      el('h2', { text: 'Sheets' }),
      sheetList,
      el('h2', { text: 'Dashboards' }),
      dashboardList,
      role === 'creator'
        ? el('div', { class: 'row' }, [newSheet, newDashboard, publish, certify])
        : null,
    ]),
  );
}
