// Office case studies, enquiries and the preview page.

import { api, ApiError, refusalCopy } from './api.js';
import { announce, clear, h, instantText, openDialog, reportProblem, setFocusTarget } from './ui.js';
import { currentMember, panelTitleBlock } from './office.js';

export async function caseStudiesScreen(): Promise<HTMLElement> {
  const main = h('main', { id: 'main-content', class: 'office-main' });
  main.append(panelTitleBlock('PL-CS', 'Case studies'));
  const list = h('ul', { class: 'case-study-list' });
  const newButton = h('button', { class: 'button-primary', text: 'New case study' });

  async function render(): Promise<void> {
    clear(list);
    const body = await api('/api/case-studies');
    const studies = (body.caseStudies ?? []) as Record<string, unknown>[];
    for (const study of studies) {
      const stateHeading = h('h2', { class: 'small-caps', text: 'Case study status', tabindex: '-1', 'data-case-status': study.id });
      const item = h(
        'li',
        { class: 'case-study-item' },
        h('h3', { text: String(study.title) }),
        stateHeading,
        h('p', { class: 'small-caps', text: String(study.state).replace(/_/g, ' ') }),
      );
      const actions = h('div', { class: 'row-actions' });
      const sendPreview = h('button', {
        class: 'button-secondary',
        text: 'Send preview',
        onclick: () => previewDialog(study),
      });
      const revoke = h('button', {
        class: 'button-quiet',
        text: 'Revoke preview link',
        onclick: async () => {
          const token = study.activePreviewLink;
          if (!token) return;
          try {
            await api(`/api/preview-links/${token}`, { method: 'DELETE' });
            announce('Preview link revoked.');
            await render();
          } catch (error) {
            if (error instanceof ApiError) reportProblem(refusalCopy(error));
          }
        },
      });
      const publish = h('button', {
        class: 'button-primary',
        text: 'Publish',
        onclick: async () => {
          try {
            await api(`/api/case-studies/${study.id}/publish`, { method: 'POST', body: '{}' });
            announce(`${String(study.title)} is live.`);
            await render();
            setFocusTarget(document.querySelector<HTMLElement>(`[data-case-status="${study.id}"]`));
          } catch (error) {
            if (error instanceof ApiError) reportProblem(refusalCopy(error));
          }
        },
      });
      const withdraw = h('button', {
        class: 'button-secondary',
        text: 'Withdraw',
        onclick: () => {
          openDialog('Withdraw case study', (container, close) => {
            const confirm = h('button', {
              class: 'button-danger',
              text: 'Withdraw from public site',
              onclick: async () => {
                try {
                  await api(`/api/case-studies/${study.id}/withdraw`, { method: 'POST', body: '{}' });
                  announce(`${String(study.title)} withdrawn from the public site.`);
                  close();
                  await render();
                  setFocusTarget(document.querySelector<HTMLElement>(`[data-case-status="${study.id}"]`));
                } catch (error) {
                  if (error instanceof ApiError) reportProblem(refusalCopy(error));
                }
              },
            });
            container.append(confirm);
          });
        },
      });
      if (study.state === 'draft' || study.state === 'preview_sent') actions.append(sendPreview);
      if (study.state === 'preview_sent') actions.append(revoke);
      if (study.state === 'client_approved') actions.append(publish);
      if (study.state === 'published') actions.append(withdraw);
      item.append(actions);
      list.append(item);
    }
  }

  function previewDialog(study: Record<string, unknown>): void {
    const expires = h('input', { type: 'datetime-local', id: 'field-expiresAt', class: 'input', step: '60' }) as HTMLInputElement;
    const send = h('button', { class: 'button-primary', type: 'submit', text: 'Send preview link' });
    const form = h('form', {
      onsubmit: async (event: Event) => {
        event.preventDefault();
        send.disabled = true;
        send.textContent = 'Sending preview…';
        try {
          const result = await api(`/api/case-studies/${study.id}/preview-links`, {
            method: 'POST',
            body: JSON.stringify({ expiresAt: `${expires.value}:00` }),
          });
          const link = result.previewLink as { url: string; expiresAt: string };
          const approverCount = Number(result.approverCount ?? 1);
          announce(`Preview sent to ${approverCount} approvers. The link works until ${instantText(link.expiresAt, 'HK')}.`);
          dialogHandle.close();
          await render();
        } catch (error) {
          send.disabled = false;
          send.textContent = 'Send preview link';
          if (error instanceof ApiError) {
            if (error.status === 422) {
              const errors = (error.body.errors ?? {}) as Record<string, string>;
              reportProblem(Object.values(errors)[0] ?? 'Choose an expiry after now.');
              return;
            }
            reportProblem(refusalCopy(error));
          }
        }
      },
    });
    const dialogHandle = openDialog('Send preview', (container) => {
      form.append(h('div', { class: 'field' }, h('label', { for: 'field-expiresAt', text: 'Link expires at' }), expires), h('div', { class: 'form-actions' }, send));
      container.append(form);
    });
  }

  newButton.addEventListener('click', () => {
    const title = h('input', { type: 'text', id: 'field-title', class: 'input' }) as HTMLInputElement;
    const slug = h('input', { type: 'text', id: 'field-slug', class: 'input' }) as HTMLInputElement;
    const create = h('button', { class: 'button-primary', type: 'submit', text: 'Create draft' });
    const form = h('form', {
      onsubmit: async (event: Event) => {
        event.preventDefault();
        create.disabled = true;
        try {
          const brands = await api('/api/brands');
          const brand = ((brands.brands ?? []) as { id: string }[])[0];
          await api('/api/case-studies', {
            method: 'POST',
            body: JSON.stringify({
              title: title.value,
              slug: slug.value,
              sector: 'retail',
              brandId: brand?.id,
              location: 'Hong Kong',
              summary: `${title.value} summary.`,
              body: `${title.value} body.`,
              featured: false,
            }),
          });
          announce('Draft case study created.');
          dialogHandle.close();
          await render();
        } catch (error) {
          create.disabled = false;
          if (error instanceof ApiError) reportProblem(refusalCopy(error));
        }
      },
    });
    const dialogHandle = openDialog('New case study', (container) => {
      form.append(
        h('div', { class: 'field' }, h('label', { for: 'field-title', text: 'Title' }), title),
        h('div', { class: 'field' }, h('label', { for: 'field-slug', text: 'Slug' }), slug),
        h('div', { class: 'form-actions' }, create),
      );
      container.append(form);
    });
  });

  main.append(newButton, list);
  await render();
  return main;
}

export async function enquiriesScreen(): Promise<HTMLElement> {
  const main = h('main', { id: 'main-content', class: 'office-main' });
  main.append(panelTitleBlock('PL-EQ', 'Enquiries'));
  const table = h('table', { class: 'data-table', 'aria-label': 'Enquiries' }) as HTMLTableElement;
  for (const column of ['Reference', 'Name', 'Company', 'Email', 'Sector', 'Region', 'Sites', 'Received']) {
    table.tHead!.insertRow().append(h('th', { scope: 'col', text: column }));
  }
  const tbody = h('tbody');
  table.append(tbody);
  const body = await api('/api/enquiries');
  const enquiries = (body.enquiries ?? []) as Record<string, unknown>[];
  for (const enquiry of enquiries) {
    const row = h('tr');
    row.append(
      h('td', { text: String(enquiry.reference) }),
      h('td', { text: String(enquiry.name) }),
      h('td', { text: String(enquiry.company) }),
      h('td', { text: String(enquiry.email) }),
      h('td', { text: String(enquiry.sector).replace(/_/g, ' ') }),
      h('td', { text: String(enquiry.region) }),
      h('td', { text: String(enquiry.sites) }),
      h('td', { text: String((enquiry.createdAt as string | undefined ?? '').slice(0, 10)) }),
    );
    tbody.append(row);
  }
  main.append(table);
  return main;
}

export async function previewScreen(token: string): Promise<HTMLElement> {
  const main = h('main', { id: 'main-content', class: 'office-main preview' });
  let data: Record<string, unknown>;
  try {
    data = await api(`/api/preview/${token}`);
  } catch {
    main.append(h('h1', { text: "We couldn't find that. It may have been removed, or you may not have access." }));
    return main;
  }
  const caseStudy = data.caseStudy as Record<string, unknown>;
  document.title = `${String(caseStudy.title)} · Marrow Hall Interiors`;
  main.append(
    h('article', { class: 'case-study-article' },
      h('h1', { text: String(caseStudy.title) }),
      h('img', { src: String(caseStudy.coverUrl), alt: `Procedural cover for ${String(caseStudy.title)}`, class: 'case-cover' }),
      h('p', { class: 'small-caps', text: `${String(caseStudy.sector).replace(/_/g, ' ')} · ${String(caseStudy.location)}` }),
      h('p', { text: String(caseStudy.summary) }),
      h('div', { class: 'case-body', text: String(caseStudy.body) })),
  );
  if (data.canApprove === true) {
    const approve = h('button', {
      class: 'button-primary',
      text: 'Approve for publishing',
      onclick: async () => {
        approve.disabled = true;
        approve.textContent = 'Approving…';
        try {
          await api(`/api/case-studies/${String(caseStudy.id)}/approve`, { method: 'POST', body: '{}' });
          announce('Approved for publishing.');
        } catch (error) {
          approve.disabled = false;
          approve.textContent = 'Approve for publishing';
          if (error instanceof ApiError) reportProblem(refusalCopy(error));
        }
      },
    });
    main.append(h('div', { class: 'panel-actions' }, approve));
  } else {
    main.append(h('a', { class: 'button-quiet', href: `/sign-in?next=/preview/${token}`, text: 'Sign in to approve' }));
  }
  void currentMember;
  return main;
}
