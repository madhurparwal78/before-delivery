import { api, ApiCallError } from '../api.ts';
import { clear, h, statusRegion } from '../dom.ts';
import { subscribe, type LiveSubscription } from '../live.ts';
import { openDialog } from '../ui/dialog.ts';
import { navigate } from '../router.ts';
import { GENERIC_ERROR, VALIDATION } from '../../shared/copy.ts';
import type { Role, TemplateJson } from '../../shared/types.ts';
import type { Frame } from '../frame.ts';
import type { Screen } from './documents.ts';

const STATE_WORD: Record<TemplateJson['status'], string> = {
  draft: 'Draft',
  shared: 'Shared',
  retired: 'Retired',
};

export const templatesScreen = (frame: Frame, initialRole: Role): Screen => {
  let role: Role = initialRole;
  let live: LiveSubscription | null = null;
  const list = h('ul', { 'aria-label': 'Templates', class: 'templates-list' });
  const region = statusRegion('Document updates');

  const root = h(
    'div',
    { class: 'templates-screen' },
    h('h1', { class: 'page-heading' }, 'Templates'),
    region,
    list,
  );

  const openUseDialog = (template: TemplateJson, opener: HTMLElement): void => {
    openDialog(
      'Use template',
      (handle) => {
        const error = h('p', { class: 'field-error', role: 'alert' });
        const rows: Array<{ name: HTMLInputElement; email: HTMLInputElement }> = [];
        const fields: HTMLElement[] = [];
        for (let signer = 1; signer <= template.signerCount; signer += 1) {
          const name = h('input', { type: 'text', id: `tpl-name-${signer}` });
          const email = h('input', { type: 'email', id: `tpl-email-${signer}` });
          rows.push({ name, email });
          fields.push(
            h(
              'div',
              { class: 'field' },
              h('label', { for: `tpl-name-${signer}` }, `Name for Signer ${signer}`),
              name,
            ),
            h(
              'div',
              { class: 'field' },
              h('label', { for: `tpl-email-${signer}` }, `Email for Signer ${signer}`),
              email,
            ),
          );
        }
        const create = h('button', { type: 'button', class: 'button' }, 'Create draft');
        const cancel = h('button', { type: 'button', class: 'button quiet' }, 'Cancel');
        create.addEventListener('click', () => {
          error.textContent = '';
          void (async () => {
            try {
              const draft = await api.useTemplate(
                template.id,
                rows.map((row) => ({ name: row.name.value.trim(), email: row.email.value.trim() })),
              );
              handle.close();
              navigate(`/documents/${draft.id}`);
            } catch (failure) {
              error.textContent =
                failure instanceof ApiCallError && failure.failure.fields['signers'] !== undefined
                  ? VALIDATION.signers
                  : GENERIC_ERROR;
            }
          })();
        });
        cancel.addEventListener('click', () => handle.close());
        handle.body.append(...fields, error, h('div', { class: 'dialog-actions' }, create, cancel));
      },
      opener,
    );
  };

  const render = (templates: readonly TemplateJson[]): void => {
    clear(list);
    for (const template of templates) {
      const use = h('button', { type: 'button', class: 'button' }, 'Use template');
      use.addEventListener('click', () => openUseDialog(template, use));
      const item = h(
        'li',
        { class: 'template-item' },
        h('span', { class: 'template-name' }, template.name),
        h(
          'span',
          { class: 'template-counts' },
          `${template.signerCount} signers, ${template.fields.length} fields`,
        ),
        role === 'owner' ? h('span', { class: 'template-state' }, STATE_WORD[template.status]) : null,
        use,
      );
      if (role === 'owner' && template.status === 'draft') {
        const share = h('button', { type: 'button', class: 'button' }, `Share ${template.name}`);
        share.addEventListener('click', () => {
          void (async () => {
            await api.shareTemplate(template.id);
            await refresh();
          })();
        });
        item.appendChild(share);
      }
      if (role === 'owner' && template.status === 'shared') {
        const retire = h('button', { type: 'button', class: 'button' }, `Retire ${template.name}`);
        retire.addEventListener('click', () => {
          void (async () => {
            await api.retireTemplate(template.id);
            await refresh();
          })();
        });
        item.appendChild(retire);
      }
      list.appendChild(item);
    }
  };

  const refresh = async (): Promise<void> => {
    try {
      render(await api.templates());
    } catch {
      region.textContent = GENERIC_ERROR;
    }
  };

  void refresh();
  live = subscribe({ scope: 'templates' }, (payload) => {
    if (payload.role !== undefined && payload.role !== role) {
      role = payload.role;
      frame.setRole(role);
    }
    if (payload.notice !== undefined) frame.setNotice(payload.notice);
    if (payload.templates !== undefined) render(payload.templates);
  });

  return { root, destroy: () => live?.close() };
};
