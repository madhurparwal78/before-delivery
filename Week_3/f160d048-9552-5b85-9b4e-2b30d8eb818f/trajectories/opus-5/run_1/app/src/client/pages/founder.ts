import { CITIES, cityName, COMPANY_SIZES, roleFamilyName } from '../../shared/reference';
import { announce } from '../core/announce';
import { failureOf, get, post } from '../core/api';
import { el, on } from '../core/dom';
import type { Cleanup } from '../core/router';
import { clearFieldErrors, fieldError, pageAlert, working } from '../core/shell';

interface Health {
  database: string;
  search: string;
  storage: string;
  mail: string;
  outbox_pending: number;
  search_sync_pending: number;
}

interface MemberRow {
  id: string;
  display_name: string;
  email: string;
  role: string;
  company_slug: string | null;
}

interface CompanyHit {
  slug: string;
  name: string;
  city_name: string;
  verified: boolean;
  review_count: number;
}

interface ThresholdRow {
  company_slug: string;
  role_family: string;
  city: string;
  report_count: number;
  threshold: number;
  shown: boolean;
}

function table(
  name: string,
  headers: ReadonlyArray<string>,
  rows: ReadonlyArray<ReadonlyArray<Node | string>>,
): HTMLElement {
  return el('table', { 'aria-label': name, class: 'console-table' }, [
    el('thead', {}, [
      el(
        'tr',
        {},
        headers.map((header) => el('th', { scope: 'col', text: header })),
      ),
    ]),
    el(
      'tbody',
      {},
      rows.map((cells) =>
        el(
          'tr',
          {},
          cells.map((cell) => el('td', {}, [cell as Node | string])),
        ),
      ),
    ),
  ]);
}

function labelled(labelText: string, input: HTMLElement, prefix: string): HTMLElement {
  input.id = `${prefix}-${labelText.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  return el('div', { class: 'field' }, [el('label', { for: input.id, text: labelText }), input]);
}

export async function renderFounder(container: HTMLElement): Promise<Cleanup> {
  const page = el('div', { class: 'working-screen' }, [el('h1', { text: 'Founder console' })]);
  container.append(page);
  const alert = pageAlert(page);

  const healthHost = el('div');
  const membersHost = el('div');
  const companiesHost = el('div');
  const thresholdsHost = el('div');
  page.append(healthHost, membersHost, companiesHost);

  const loadHealth = async (): Promise<void> => {
    const health = await get<Health>('/api/founder/health');
    healthHost.replaceChildren(
      table(
        'Service health',
        ['Service', 'State'],
        [
          ['Database', health.database],
          ['Search', health.search],
          ['Storage', health.storage],
          ['Mail', health.mail],
          ['Outbox backlog', String(health.outbox_pending)],
          ['Search sync backlog', String(health.search_sync_pending)],
        ],
      ),
    );
  };

  const loadMembers = async (): Promise<void> => {
    const members = (await get<{ members: MemberRow[] }>('/api/founder/members')).members;
    membersHost.replaceChildren(
      table(
        'Members',
        ['Name', 'Email', 'Role', 'Company', 'Action'],
        members.map((member) => {
          const action =
            member.role === 'member'
              ? (() => {
                  const button = el('button', {
                    type: 'button',
                    class: 'nav-action',
                    'aria-label': `Make ${member.display_name} a moderator`,
                    text: 'Make moderator',
                  });
                  on(button, 'click', () => {
                    const done = working(button);
                    void post('/api/founder/moderators', { user_id: member.id })
                      .then(async () => {
                        announce(`${member.display_name} is now a moderator.`);
                        await loadMembers();
                      })
                      .catch((error: unknown) => alert(failureOf(error)?.message ?? 'Something went wrong.'))
                      .finally(done);
                  });
                  return button;
                })()
              : el('span', { text: member.role === 'moderator' ? 'Moderator' : member.role });
          return [member.display_name, member.email, member.role, member.company_slug ?? '', action];
        }),
      ),
    );
  };

  const loadCompanies = async (): Promise<void> => {
    const outcome = await get<{ fallback?: string; hits?: CompanyHit[]; cities?: Array<{ companies: CompanyHit[] }> }>(
      '/api/companies/search?page=1',
    );
    const companies = outcome.hits ?? (outcome.cities ?? []).flatMap((city) => city.companies);
    companiesHost.replaceChildren(
      table(
        'Companies',
        ['Name', 'City', 'Verified', 'Action'],
        companies.map((company) => {
          const action = company.verified
            ? (() => {
                const button = el('button', {
                  type: 'button',
                  class: 'nav-action',
                  'aria-label': `Revoke verification for ${company.name}`,
                  text: 'Revoke',
                });
                on(button, 'click', () => {
                  const done = working(button);
                  void post(`/api/founder/companies/${company.slug}/revoke-verification`)
                    .then(async () => {
                      announce(`Verification revoked for ${company.name}.`);
                      await loadCompanies();
                    })
                    .catch((error: unknown) => alert(failureOf(error)?.message ?? 'Something went wrong.'))
                    .finally(done);
                });
                return button;
              })()
            : el('span', { text: 'Not verified' });
          return [company.name, company.city_name, company.verified ? 'Verified' : 'Not verified', action];
        }),
      ),
    );
    await loadThresholds();
  };

  /** Every threshold row, never a pay figure. */
  const loadThresholds = async (): Promise<void> => {
    const rows = (await get<{ rows: ThresholdRow[] }>('/api/founder/thresholds')).rows;
    thresholdsHost.replaceChildren(
      table(
        'Pay thresholds',
        ['Company', 'Role', 'City', 'Reports', 'Threshold', 'Shown'],
        rows.map((row) => [
          row.company_slug,
          roleFamilyName(row.role_family),
          cityName(row.city),
          String(row.report_count),
          String(row.threshold),
          row.shown ? 'Shown' : 'Hidden',
        ]),
      ),
    );
  };

  const companyName = el('input', { type: 'text', class: 'textbox' });
  const companySlug = el('input', { type: 'text', class: 'textbox' });
  const companyCity = el(
    'select',
    { class: 'textbox' },
    CITIES.map((city) => el('option', { value: city.id, text: city.name })),
  );
  const companySize = el(
    'select',
    { class: 'textbox' },
    COMPANY_SIZES.map((size) => el('option', { value: size, text: size })),
  );
  const companyDomain = el('input', { type: 'text', class: 'textbox' });
  const addCompany = el('button', { type: 'submit', class: 'solid-button', text: 'Add company' });
  const companyForm = el('form', { 'aria-label': 'Add company', class: 'stack' }, [
    labelled('Company name', companyName, 'company'),
    labelled('Slug', companySlug, 'company'),
    labelled('City', companyCity, 'company'),
    labelled('Size', companySize, 'company'),
    labelled('Email domain', companyDomain, 'company'),
    addCompany,
  ]);
  on(companyForm, 'submit', (event) => {
    event.preventDefault();
    const done = working(addCompany);
    clearFieldErrors(companyForm);
    void post('/api/founder/companies', {
      name: companyName.value,
      slug: companySlug.value,
      city: companyCity.value,
      size: companySize.value,
      email_domain: companyDomain.value,
    })
      .then(async () => {
        announce(`${companyName.value} was added.`);
        await loadCompanies();
      })
      .catch((error: unknown) => {
        const failure = failureOf(error);
        const inputs: Record<string, HTMLElement> = {
          name: companyName,
          slug: companySlug,
          city: companyCity,
          size: companySize,
          email_domain: companyDomain,
        };
        if (failure?.fields) {
          for (const [field, message] of Object.entries(failure.fields)) {
            const input = inputs[field];
            if (input) fieldError(input, message);
          }
          return;
        }
        alert(failure?.message ?? 'Something went wrong.');
      })
      .finally(done);
  });

  const userCompany = el('input', { type: 'text', class: 'textbox' });
  const userName = el('input', { type: 'text', class: 'textbox' });
  const userEmail = el('input', { type: 'email', class: 'textbox' });
  const userRole = el('select', { class: 'textbox' }, [
    el('option', { value: 'employer_admin', text: 'Employer admin' }),
    el('option', { value: 'recruiter', text: 'Recruiter' }),
  ]);
  const addUser = el('button', { type: 'submit', class: 'solid-button', text: 'Add user' });
  const userForm = el('form', { 'aria-label': 'Add employer user', class: 'stack' }, [
    labelled('Company slug', userCompany, 'user'),
    labelled('Display name', userName, 'user'),
    labelled('Email', userEmail, 'user'),
    labelled('Team role', userRole, 'user'),
    addUser,
  ]);
  on(userForm, 'submit', (event) => {
    event.preventDefault();
    const done = working(addUser);
    clearFieldErrors(userForm);
    void post('/api/founder/employer-users', {
      company_slug: userCompany.value,
      display_name: userName.value,
      email: userEmail.value,
      role: userRole.value,
    })
      .then(async () => {
        announce(`${userName.value} was added.`);
        await loadMembers();
      })
      .catch((error: unknown) => {
        const failure = failureOf(error);
        const inputs: Record<string, HTMLElement> = {
          company_slug: userCompany,
          display_name: userName,
          email: userEmail,
          role: userRole,
        };
        if (failure?.fields) {
          for (const [field, message] of Object.entries(failure.fields)) {
            const input = inputs[field];
            if (input) fieldError(input, message);
          }
          return;
        }
        alert(failure?.message ?? 'Something went wrong.');
      })
      .finally(done);
  });

  page.append(companyForm, userForm, thresholdsHost);
  await loadHealth();
  await loadMembers();
  await loadCompanies();
  return () => undefined;
}
