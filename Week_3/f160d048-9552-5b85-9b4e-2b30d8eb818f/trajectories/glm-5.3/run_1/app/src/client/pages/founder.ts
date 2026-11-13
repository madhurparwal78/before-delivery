// The founder console: health, members, companies and pay thresholds.
import { h, clear } from '../dom.js';
import { api, ApiFailure, apiErrorMessage } from '../api.js';
import { alertBand, announce } from '../feedback.js';
import { cityName, roleName } from '../format.js';
import type { FounderMember, ThresholdRow } from '../types.js';
import type { PageContext } from '../app.js';

export function founderPage(ctx: PageContext): HTMLElement {
  const main = h('main', { class: 'full-width' });
  if (!ctx.me || ctx.me.role !== 'founder') {
    main.appendChild(h('h1', {}, 'Page not found'));
    return main;
  }
  void build(main);
  return main;
}

async function build(main: HTMLElement): Promise<void> {
  main.appendChild(h('h1', {}, 'Founder console'));

  const healthTable = h('table', {}, h('caption', { class: 'visually-hidden' }, 'Service health'));
  const membersTable = h('table', {}, h('caption', { class: 'visually-hidden' }, 'Members'));
  const companiesTable = h('table', {}, h('caption', { class: 'visually-hidden' }, 'Companies'));
  const thresholdTable = h('table', {}, h('caption', { class: 'visually-hidden' }, 'Pay thresholds'));

  main.appendChild(healthTable);
  main.appendChild(membersTable);
  main.appendChild(companiesTable);
  main.appendChild(thresholdTable);

  const addCompanyForm = h('form', { 'aria-label': 'Add company' });
  const addCompanyButton = h('button', { class: 'solid-button', type: 'submit' }, 'Add company');
  const addUserForm = h('form', { 'aria-label': 'Add employer user' });
  const addUserButton = h('button', { class: 'solid-button', type: 'submit' }, 'Add user');

  async function reloadHealth(): Promise<void> {
    const health = await api.get<{
      database: string;
      search: string;
      storage: string;
      mail: string;
      outbox_pending: number;
      search_sync_pending: number;
    }>('/api/founder/health');
    clear(healthTable);
    healthTable.appendChild(h('thead', {}, h('tr', {}, h('th', {}, 'Service'), h('th', {}, 'Status'))));
    healthTable.appendChild(
      h('tbody', {},
        h('tr', {}, h('th', { scope: 'row' }, 'Database'), h('td', {}, health.database)),
        h('tr', {}, h('th', { scope: 'row' }, 'Search'), h('td', {}, health.search)),
        h('tr', {}, h('th', { scope: 'row' }, 'Storage'), h('td', {}, health.storage)),
        h('tr', {}, h('th', { scope: 'row' }, 'Mail'), h('td', {}, health.mail)),
        h('tr', {}, h('th', { scope: 'row' }, 'Outbox backlog'), h('td', {}, String(health.outbox_pending))),
        h('tr', {}, h('th', { scope: 'row' }, 'Search sync queue'), h('td', {}, String(health.search_sync_pending))),
      ),
    );
  }

  async function reloadMembers(): Promise<void> {
    const response = await api.get<{ members: FounderMember[] }>('/api/founder/members');
    clear(membersTable);
    membersTable.appendChild(
      h('thead', {}, h('tr', {}, h('th', {}, 'Member'), h('th', {}, 'Role'), h('th', {}, 'Action'))),
    );
    const body = h('tbody', {});
    for (const member of response.members) {
      const row = h('tr', { 'data-id': member.id });
      row.appendChild(h('th', { scope: 'row' }, member.display_name));
      row.appendChild(h('td', { class: 'member-role' }, member.role));
      const cell = h('td', {});
      if (member.role === 'member') {
        const appoint = h('button', { class: 'text-button', type: 'button' }, `Make ${member.display_name} a moderator`);
        appoint.addEventListener('click', async () => {
          try {
            await api.post('/api/founder/moderators', { user_id: member.id });
            announce(`${member.display_name} is now a moderator.`);
            await reloadMembers();
          } catch (err) {
            alertBand(apiErrorMessage(err));
          }
        });
        cell.appendChild(appoint);
      }
      row.appendChild(cell);
      body.appendChild(row);
    }
    membersTable.appendChild(body);
  }

  async function reloadCompanies(): Promise<void> {
    const response = await api.get<{ cities: { companies: { slug: string; name: string; city: string; verified: boolean; city_name: string; size: string }[] }[] } | { total: number; hits: { slug: string; name: string; city: string; verified: boolean; city_name: string; size: string }[]; facets: unknown }>(
      '/api/companies/search?q=',
    );
    const companies: { slug: string; name: string; city: string; verified: boolean; city_name: string; size: string }[] =
      'hits' in response ? response.hits : response.cities.flatMap((city) => city.companies);
    clear(companiesTable);
    companiesTable.appendChild(
      h('thead', {}, h('tr', {}, h('th', {}, 'Company'), h('th', {}, 'City'), h('th', {}, 'Verified'))),
    );
    const body = h('tbody', {});
    for (const company of companies) {
      const row = h('tr', { 'data-id': company.slug });
      row.appendChild(h('th', { scope: 'row' }, company.name));
      row.appendChild(h('td', {}, company.city_name));
      const cell = h('td', { class: 'company-verified' }, company.verified ? 'Verified' : 'Not verified');
      if (company.verified) {
        const revoke = h('button', { class: 'text-button', type: 'button' }, `Revoke verification for ${company.name}`);
        revoke.addEventListener('click', async () => {
          try {
            await api.post(`/api/founder/companies/${company.slug}/revoke-verification`);
            announce(`Verification revoked for ${company.name}.`);
            await reloadCompanies();
          } catch (err) {
            alertBand(apiErrorMessage(err));
          }
        });
        cell.appendChild(document.createTextNode(' '));
        cell.appendChild(revoke);
      }
      row.appendChild(cell);
      body.appendChild(row);
    }
    companiesTable.appendChild(body);
  }

  async function reloadThresholds(): Promise<void> {
    const response = await api.get<{ rows: ThresholdRow[] }>('/api/founder/thresholds');
    clear(thresholdTable);
    thresholdTable.appendChild(
      h('thead', {}, h('tr', {}, h('th', {}, 'Company'), h('th', {}, 'Role'), h('th', {}, 'City'), h('th', {}, 'Reports'))),
    );
    const body = h('tbody', {});
    for (const row of response.rows) {
      const tr = h('tr', { 'data-id': `${row.company_slug}:${row.role_family}:${row.city}` });
      tr.appendChild(h('th', { scope: 'row' }, row.company_slug));
      tr.appendChild(h('td', {}, roleName(row.role_family)));
      tr.appendChild(h('td', {}, cityName(row.city)));
      tr.appendChild(
        h('td', { class: 'figures' }, `${row.report_count} of ${row.threshold} reports. The range opens at ${row.threshold}.`),
      );
      body.appendChild(tr);
    }
    thresholdTable.appendChild(body);
  }

  // Add company form.
  const nameInput = h('input', { type: 'text', 'aria-label': 'Name' }) as HTMLInputElement;
  const slugInput = h('input', { type: 'text', 'aria-label': 'Slug' }) as HTMLInputElement;
  const cityInput = h('input', { type: 'text', 'aria-label': 'City' }) as HTMLInputElement;
  const sizeInput = h('input', { type: 'text', 'aria-label': 'Size' }) as HTMLInputElement;
  const domainInput = h('input', { type: 'text', 'aria-label': 'Email domain' }) as HTMLInputElement;
  addCompanyForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      await api.post('/api/founder/companies', {
        name: nameInput.value,
        slug: slugInput.value,
        city: cityInput.value,
        size: sizeInput.value,
        email_domain: domainInput.value,
      });
      await reloadCompanies();
      await reloadThresholds();
    } catch (err) {
      if (err instanceof ApiFailure) {
        alertBand(err.body.message);
        return;
      }
      alertBand(apiErrorMessage(err));
    }
  });
  addCompanyForm.append(nameInput, slugInput, cityInput, sizeInput, domainInput, addCompanyButton);
  main.appendChild(h('h2', {}, 'Add company'));
  main.appendChild(addCompanyForm);

  // Add employer user form.
  const userCompany = h('input', { type: 'text', 'aria-label': 'Company slug' }) as HTMLInputElement;
  const userName = h('input', { type: 'text', 'aria-label': 'Display name' }) as HTMLInputElement;
  const userEmail = h('input', { type: 'email', 'aria-label': 'Email' }) as HTMLInputElement;
  const userRole = h('select', { 'aria-label': 'Role' }) as HTMLSelectElement;
  userRole.appendChild(h('option', { value: 'recruiter' }, 'recruiter'));
  userRole.appendChild(h('option', { value: 'employer_admin' }, 'employer_admin'));
  addUserForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      await api.post('/api/founder/employer-users', {
        company_slug: userCompany.value,
        display_name: userName.value,
        email: userEmail.value,
        role: userRole.value,
      });
      await reloadMembers();
    } catch (err) {
      alertBand(apiErrorMessage(err));
    }
  });
  addUserForm.append(userCompany, userName, userEmail, userRole, addUserButton);
  main.appendChild(h('h2', {}, 'Add employer user'));
  main.appendChild(addUserForm);

  await Promise.all([reloadHealth(), reloadMembers(), reloadCompanies(), reloadThresholds()]);
}
