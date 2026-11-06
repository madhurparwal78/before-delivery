// Office screens: sign-in, join, rollouts, members and project panels.

import { api, ApiError, fieldErrorCopy, refusalCopy } from './api.js';
import {
  amountText,
  announce,
  clear,
  dateText,
  h,
  hkToday,
  icon,
  initLiveRegions,
  instantText,
  openDialog,
  reducedMotion,
  reportProblem,
  setFocusTarget,
  showFieldErrors,
  type DialogHandle,
} from './ui.js';

export interface SessionMember {
  id: string;
  name: string;
  role: 'director' | 'project_lead' | 'designer' | 'finance' | 'client_approver' | 'contractor';
  organisation: string;
}

export const STUDIO_ROLES = ['director', 'project_lead', 'designer', 'finance'];
export const STAGE_KEYS = ['groundwork', 'scheme', 'detailing', 'tender_award', 'build', 'handover', 'aftercare'];
export const STAGE_NAMES: Record<string, string> = {
  groundwork: 'Groundwork',
  scheme: 'Scheme',
  detailing: 'Detailing',
  tender_award: 'Tender & Award',
  build: 'Build',
  handover: 'Handover',
  aftercare: 'Aftercare',
};

export let currentMember: SessionMember | null = null;

export async function loadSession(): Promise<SessionMember | null> {
  try {
    const body = await api('/api/session');
    currentMember = body.member as SessionMember;
    return currentMember;
  } catch {
    currentMember = null;
    return null;
  }
}

// ---------- Shell ----------

export function skipLink(): HTMLElement {
  const link = h('a', { href: '#main-content', class: 'skip-link', text: 'Skip to content' });
  link.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      const main = document.getElementById('main-content');
      if (main) {
        main.setAttribute('tabindex', '-1');
        main.focus();
      }
    }
  });
  return link;
}

export function officeHeader(active: string): HTMLElement {
  const nav = h(
    'nav',
    { 'aria-label': 'Workspace', class: 'workspace-nav' },
    navLink('/office', 'Rollouts', active === 'rollouts'),
    ...(currentMember && STUDIO_ROLES.includes(currentMember.role)
      ? [
          navLink('/office/members', 'Members', active === 'members'),
          navLink('/office/case-studies', 'Case studies', active === 'case-studies'),
          navLink('/office/enquiries', 'Enquiries', active === 'enquiries'),
        ]
      : []),
  );
  const signOut = h(
    'button',
    {
      class: 'button-quiet',
      onclick: async () => {
        await api('/api/session', { method: 'DELETE' });
        window.location.href = '/sign-in';
      },
    },
    'Sign out',
  );
  const header = h('header', { class: 'office-header' }, h('a', { href: '/office', class: 'brand', text: 'Plumbline' }), nav, signOut);
  return header;
}

function navLink(href: string, text: string, active: boolean): HTMLElement {
  return h('a', { href, class: active ? 'nav-link active' : 'nav-link', 'aria-current': active ? 'page' : null, text });
}

// ---------- Sign in ----------

export function signInScreen(next: string | null): HTMLElement {
  const main = h('main', { id: 'main-content', class: 'auth-screen' });
  const errorSummary = h('div', { 'data-error-summary': true, class: 'error-summary', role: 'alert' });
  const email = h('input', { type: 'email', id: 'field-email', class: 'input', autocomplete: 'email' }) as HTMLInputElement;
  const password = h('input', { type: 'password', id: 'field-password', class: 'input', autocomplete: 'current-password' }) as HTMLInputElement;
  const submit = h('button', { class: 'button-primary', type: 'submit', text: 'Sign in' });
  const form = h(
    'form',
    {
      onsubmit: async (event: Event) => {
        event.preventDefault();
        clearErrors(form);
        submit.disabled = true;
        submit.textContent = 'Signing in…';
        try {
          await api('/api/session', { method: 'POST', body: JSON.stringify({ email: email.value, password: password.value }) });
          window.location.href = next && next.startsWith('/') ? next : '/office';
        } catch (error) {
          submit.disabled = false;
          submit.textContent = 'Sign in';
          if (error instanceof ApiError) {
            if (error.status === 422) {
              showFieldErrors(form, fieldErrorCopy(error));
              return;
            }
            reportProblem(refusalCopy(error));
            return;
          }
          reportProblem("We couldn't reach Plumbline. Check your connection; nothing was saved. Try again and we'll make sure it only happens once.");
        }
      },
    },
    errorSummary,
    fieldRow('Email', email),
    fieldRow('Password', password),
    h('div', { class: 'form-actions' }, submit),
  );
  const card = h('div', { class: 'auth-card title-block' }, h('p', { class: 'title-block-line', text: 'Marrow Hall Interiors · Plumbline' }), h('h1', { text: 'Sign in' }), form);
  main.append(card);
  return main;
}

function fieldRow(label: string, control: HTMLElement, hint?: string): HTMLElement {
  const id = control.getAttribute('id') ?? `field-${label.replace(/\s+/g, '-')}`;
  const labelElement = h('label', { for: id, text: label });
  const field = h('div', { class: 'field' }, labelElement, control);
  if (hint) field.append(h('p', { class: 'field-hint', text: hint }));
  return field;
}

function clearErrors(form: HTMLElement): void {
  form.querySelectorAll('[data-error-for]').forEach((el) => el.remove());
  const summary = form.querySelector('[data-error-summary]');
  if (summary) clear(summary as HTMLElement);
}

// ---------- Join (invite) ----------

export async function joinScreen(token: string): Promise<HTMLElement> {
  const main = h('main', { id: 'main-content', class: 'auth-screen' });
  let invitation: Record<string, unknown> | null = null;
  try {
    const body = await api(`/api/invitations/${token}`);
    invitation = body.invitation as Record<string, unknown>;
  } catch {
    main.append(notFoundCard());
    return main;
  }
  const nameInput = h('input', { type: 'text', id: 'field-name', class: 'input' }) as HTMLInputElement;
  const passwordInput = h('input', { type: 'password', id: 'field-password', class: 'input' }) as HTMLInputElement;
  const submit = h('button', { class: 'button-primary', type: 'submit', text: 'Join workspace' });
  const errorSummary = h('div', { 'data-error-summary': true, class: 'error-summary', role: 'alert' });
  const form = h(
    'form',
    {
      onsubmit: async (event: Event) => {
        event.preventDefault();
        clearErrors(form);
        submit.disabled = true;
        submit.textContent = 'Joining…';
        try {
          await api(`/api/invitations/${token}/accept`, {
            method: 'POST',
            body: JSON.stringify({ name: nameInput.value, password: passwordInput.value }),
          });
          announce(`Welcome to Marrow Hall Interiors, ${nameInput.value}.`);
          window.location.href = '/office';
        } catch (error) {
          submit.disabled = false;
          submit.textContent = 'Join workspace';
          if (error instanceof ApiError) {
            if (error.status === 422) {
              showFieldErrors(form, fieldErrorCopy(error));
              return;
            }
            reportProblem(refusalCopy(error));
          }
        }
      },
    },
    errorSummary,
    h('p', { class: 'invite-summary', text: `${String(invitation!.email)} — ${String(invitation!.role).replace('_', ' ')} at ${String(invitation!.organisation)}` }),
    fieldRow('Your name', nameInput),
    fieldRow('Choose a password', passwordInput),
    h('div', { class: 'form-actions' }, submit),
  );
  main.append(h('div', { class: 'auth-card title-block' }, h('h1', { text: 'Join the workspace' }), form));
  return main;
}

// ---------- Tender sign-in ----------

export function tenderSignInScreen(token: string): HTMLElement {
  const main = h('main', { id: 'main-content', class: 'auth-screen' });
  const button = h('button', { class: 'button-primary', text: 'Continue to tender' });
  button.addEventListener('click', async () => {
    button.disabled = true;
    button.textContent = 'Signing you in…';
    try {
      const body = await api('/api/tender-links/consume', { method: 'POST', body: JSON.stringify({ token }) });
      window.location.href = `/office/tenders/${String(body.tenderId)}`;
    } catch (error) {
      button.disabled = false;
      button.textContent = 'Continue to tender';
      if (error instanceof ApiError) {
        reportProblem('This sign-in link has expired or has already been used.');
      }
    }
  });
  main.append(h('div', { class: 'auth-card title-block' }, h('h1', { text: 'Tender sign-in' }), h('p', { text: 'Use the button below to open the tender. The link works once.' }), button));
  return main;
}

// ---------- Rollouts ----------

export async function rolloutsScreen(): Promise<HTMLElement> {
  const main = h('main', { id: 'main-content', class: 'office-main' });
  const titleBlock = panelTitleBlock('PL-00', 'Rollouts');
  const table = h('table', { class: 'data-table', 'aria-label': 'Rollouts' }) as HTMLTableElement;
  const headRow = table.insertRow();
  for (const column of ['Reference', 'Name', 'Brand', 'Region', 'Current stage', 'Fee position', 'Retention held']) {
    headRow.append(h('th', { scope: 'col', text: column }));
  }
  const tbody = h('tbody');
  table.append(tbody);
  const body = await api('/api/overview');
  const projects = (body.projects ?? []) as Record<string, unknown>[];
  for (const project of projects) {
    const row = h('tr');
    const link = h('a', { href: `/office/projects/${project.id}/stages`, text: String(project.reference) });
    row.append(h('td', {}, link), h('td', { text: String(project.name) }));
    row.append(
      h('td', { text: String((project.brand as Record<string, unknown> | undefined)?.name ?? '') }),
      h('td', { text: String(project.region) }),
      h('td', { text: STAGE_NAMES[String(project.currentStage)] ?? '—' }),
    );
    if (currentMember && STUDIO_ROLES.includes(currentMember.role)) {
      const fees = project.fees as { signedOffCents: number; requestedCents: number; notYetRequestedCents: number } | undefined;
      const currency = String(project.currency ?? 'HKD');
      row.append(
        h(
          'td',
          {},
          h('div', { class: 'fee-lines' },
            h('span', { text: `Signed off ${amountText(currency, fees?.signedOffCents ?? 0)}` }),
            h('span', { text: `Requested ${amountText(currency, fees?.requestedCents ?? 0)}` }),
            h('span', { text: `Not yet requested ${amountText(currency, fees?.notYetRequestedCents ?? 0)}` }),
          ),
        ),
        h('td', { text: amountText(currency, Number(project.retentionHeldCents ?? 0)) }),
      );
    }
    tbody.append(row);
  }
  main.append(h('div', { class: 'panel' }, titleBlock, table));
  return main;
}

export function panelTitleBlock(sheetCode: string, title: string, revision?: string): HTMLElement {
  const block = h(
    'div',
    { class: 'title-block' },
    h('p', { class: 'small-caps', text: `${sheetCode} · ${revision ?? 'T-000'} · ${dateText(hkToday())}` }),
    h('h1', { text: title }),
  );
  return block;
}

// ---------- Members ----------

export async function membersScreen(): Promise<HTMLElement> {
  const main = h('main', { id: 'main-content', class: 'office-main' });
  const titleBlock = panelTitleBlock('PL-MB', 'Members');
  const table = h('table', { class: 'data-table', 'aria-label': 'Members' }) as HTMLTableElement;
  const headRow = table.insertRow();
  for (const column of ['Name', 'Email', 'Phone', 'Role', 'Organisation', 'Status']) {
    headRow.append(h('th', { scope: 'col', text: column }));
  }
  const tbody = h('tbody');
  table.append(tbody);
  const inviteButton = h('button', { class: 'button-primary', text: 'Invite member', onclick: () => inviteDialog() });

  async function render() {
    clear(tbody);
    const body = await api('/api/members');
    const members = (body.members ?? []) as Record<string, unknown>[];
    for (const member of members) {
      const row = h('tr');
      row.append(
        h('td', { text: String(member.name) }),
        h('td', { text: String(member.email ?? '') }),
        h('td', { text: String(member.phone ?? '') }),
        h('td', { text: String(member.role).replace('_', ' ') }),
        h('td', { text: String(member.organisation) }),
        h('td', { text: String(member.status ?? 'active') }),
      );
      if (currentMember?.role === 'director') {
        const edit = h('button', { class: 'button-quiet', text: `Edit ${member.name}`, onclick: () => editDialog(member) });
        const remove = h('button', { class: 'button-quiet', text: `Remove ${member.name}`, onclick: () => removeDialog(member) });
        row.append(h('td', { class: 'row-actions' }, edit, remove));
      }
      tbody.append(row);
    }
  }

  function inviteDialog(): void {
    const email = h('input', { type: 'email', id: 'field-email', class: 'input' }) as HTMLInputElement;
    const name = h('input', { type: 'text', id: 'field-name', class: 'input' }) as HTMLInputElement;
    const role = h('select', { id: 'field-role', class: 'input' }) as HTMLSelectElement;
    for (const value of ['project_lead', 'designer', 'finance', 'client_approver', 'contractor']) {
      role.append(h('option', { value, text: value.replace('_', ' ') }));
    }
    const brandSelect = h('select', { id: 'field-brandId', class: 'input' }) as HTMLSelectElement;
    const companyInput = h('input', { type: 'text', id: 'field-companyName', class: 'input' }) as HTMLInputElement;
    const limitHkd = h('input', { type: 'text', id: 'field-approvalLimits-HKD', class: 'input' }) as HTMLInputElement;
    const limitSgd = h('input', { type: 'text', id: 'field-approvalLimits-SGD', class: 'input' }) as HTMLInputElement;
    const phone = h('input', { type: 'text', id: 'field-phone', class: 'input' }) as HTMLInputElement;
    const send = h('button', { class: 'button-primary', type: 'submit', text: 'Send invitation' });
    const form = h('form', {
      onsubmit: async (event: Event) => {
        event.preventDefault();
        clearErrors(form);
        send.disabled = true;
        send.textContent = 'Sending invitation…';
        try {
          const payload: Record<string, unknown> = {
            email: email.value,
            name: name.value,
            role: role.value,
            phone: phone.value || undefined,
          };
          if (role.value === 'client_approver') payload.brandId = brandSelect.value;
          if (role.value === 'contractor') payload.companyName = companyInput.value;
          if (role.value === 'project_lead') {
            payload.approvalLimits = {
              HKD: Math.round(parseFloat(limitHkd.value || '0') * 100),
              SGD: Math.round(parseFloat(limitSgd.value || '0') * 100),
            };
          }
          await api('/api/invitations', { method: 'POST', body: JSON.stringify(payload) });
          announce(`Invitation sent to ${email.value}.`);
          dialogHandle.close();
          setFocusTarget(inviteButton);
          await render();
        } catch (error) {
          send.disabled = false;
          send.textContent = 'Send invitation';
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
    const dialogHandle = openDialog('Invite member', (container, close) => {
      form.append(
        fieldRow('Email', email),
        fieldRow('Name', name),
        fieldRow('Role', role),
        fieldRow('Brand', brandSelect),
        fieldRow('Company name', companyInput),
        fieldRow('Approval limit HKD', limitHkd),
        fieldRow('Approval limit SGD', limitSgd),
        fieldRow('Phone', phone),
      );
      void close;
      container.append(form);
    }, { returnFocusTo: inviteButton });
  }

  function editDialog(member: Record<string, unknown>): void {
    const role = h('select', { id: 'field-role', class: 'input' }) as HTMLSelectElement;
    for (const value of ['director', 'project_lead', 'designer', 'finance', 'client_approver', 'contractor']) {
      const option = h('option', { value, text: value.replace('_', ' ') });
      if (value === member.role) option.setAttribute('selected', 'true');
      role.append(option);
    }
    const limits = (member.approvalLimits ?? null) as { HKD: number; SGD: number } | null;
    const limitHkd = h('input', { type: 'text', id: 'field-approvalLimits-HKD', class: 'input', value: limits ? (limits.HKD / 100).toFixed(2) : '' }) as HTMLInputElement;
    const limitSgd = h('input', { type: 'text', id: 'field-approvalLimits-SGD', class: 'input', value: limits ? (limits.SGD / 100).toFixed(2) : '' }) as HTMLInputElement;
    const save = h('button', { class: 'button-primary', type: 'submit', text: 'Save member' });
    const form = h('form', {
      onsubmit: async (event: Event) => {
        event.preventDefault();
        clearErrors(form);
        save.disabled = true;
        save.textContent = 'Saving…';
        try {
          await api(`/api/members/${member.id}`, {
            method: 'PATCH',
            body: JSON.stringify({
              version: member.version,
              role: role.value,
              approvalLimits:
                role.value === 'project_lead'
                  ? { HKD: Math.round(parseFloat(limitHkd.value || '0') * 100), SGD: Math.round(parseFloat(limitSgd.value || '0') * 100) }
                  : undefined,
            }),
          });
          announce(`${member.name} updated.`);
          dialogHandle.close();
          setFocusTarget(inviteButton);
          await render();
        } catch (error) {
          save.disabled = false;
          save.textContent = 'Save member';
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
    const dialogHandle = openDialog(`Edit ${member.name}`, (container) => {
      form.append(fieldRow('Role', role), fieldRow('Approval limit HKD', limitHkd), fieldRow('Approval limit SGD', limitSgd));
      container.append(form);
    });
  }

  function removeDialog(member: Record<string, unknown>): void {
    const confirm = h('button', { class: 'button-danger', type: 'button', text: 'Remove from workspace' });
    const dialogHandle = openDialog(`Remove ${member.name}`, (container) => {
      confirm.addEventListener('click', async () => {
        confirm.disabled = true;
        confirm.textContent = 'Removing…';
        try {
          await api(`/api/members/${member.id}`, { method: 'DELETE' });
          announce(`${member.name} no longer has access.`);
          dialogHandle.close();
          setFocusTarget(inviteButton);
          await render();
        } catch (error) {
          confirm.disabled = false;
          confirm.textContent = 'Remove from workspace';
          if (error instanceof ApiError) reportProblem(refusalCopy(error));
        }
      });
      container.append(h('p', { text: `${member.name} will lose access to the workspace. Their sessions end.` }), confirm);
    });
  }

  main.append(h('div', { class: 'panel' }, titleBlock, inviteButton, table));
  await render();
  return main;
}

export function notFoundCard(): HTMLElement {
  return h(
    'section',
    { class: 'panel not-found', 'aria-labelledby': 'not-found-heading' },
    h('h1', { id: 'not-found-heading', text: "We couldn't find that. It may have been removed, or you may not have access." }),
    h('p', {}, h('a', { href: '/', text: 'Back to the Marrow Hall home page' })),
  );
}

export { initLiveRegions, icon, openDialog, reducedMotion, instantText, announce, reportProblem, type DialogHandle };
