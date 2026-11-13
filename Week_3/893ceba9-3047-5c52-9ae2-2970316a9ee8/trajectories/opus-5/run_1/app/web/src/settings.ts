// Project settings: reviewers, CI tokens, webhook endpoint, source files and
// the erase action.

import { AuditEntry, DeskError, Project, Reviewer, SourceFile, api } from './api';
import { labelledField, openModal } from './dialog';
import { clear, el, localTime } from './dom';
import { announce, announceAcross, clearProblem, failureCopy, problem, showFieldErrors } from './feedback';
import { navigate } from './router';
import { desk } from './shell';

export async function renderSettings(screen: HTMLElement, project: Project): Promise<void> {
  const column = el('div', { class: 'content-column' }, [el('h1', { text: `${project.name} settings` })]);
  const reviewersCard = el('div', { class: 'card' });
  const tokensCard = el('div', { class: 'card' });
  const webhookCard = el('div', { class: 'card' });
  const filesCard = el('div', { class: 'card' });
  const eraseCard = el('div', { class: 'card' });
  column.append(reviewersCard, tokensCard, webhookCard, filesCard, eraseCard);
  screen.append(column);

  await paintReviewers(project, reviewersCard);
  await paintTokens(project, tokensCard);
  await paintWebhook(project, webhookCard);
  await paintFiles(project, filesCard);
  paintErase(project, eraseCard);
}

async function paintReviewers(project: Project, card: HTMLElement, accessKey?: string): Promise<void> {
  const answer = await api.get<{ reviewers: Reviewer[] }>(`/api/projects/${project.slug}/reviewers`);
  clear(card);
  const keyRegion = el('div', { role: 'region', 'aria-label': 'New access key' });
  if (accessKey) {
    keyRegion.append(el('p', { text: 'New access key' }), el('code', { text: accessKey }));
  }
  const name = el('input', { type: 'text', 'data-field': 'name' });
  const email = el('input', { type: 'email', 'data-field': 'email' });
  const invite = el('button', { type: 'submit', class: 'button primary', text: 'Invite reviewer' });
  const form = el('form', {
    onsubmit: async (event: Event) => {
      event.preventDefault();
      clearProblem();
      invite.disabled = true;
      announce('Inviting reviewer.');
      try {
        const reviewer = await api.post<Reviewer & { access_key: string | null }>(
          `/api/projects/${project.slug}/reviewers`,
          { name: name.value.trim(), email: email.value.trim() },
        );
        if (reviewer.access_key) {
          announce(`Invited ${reviewer.name}. Copy the access key now; it won't be shown again.`);
        } else {
          announce(`Added ${reviewer.name} to this project.`);
        }
        await paintReviewers(project, card, reviewer.access_key ?? undefined);
      } catch (error) {
        invite.disabled = false;
        announce('');
        if (error instanceof DeskError) {
          problem(failureCopy(error));
          showFieldErrors(form, error.info.fields);
        }
      }
    },
  }, [
    labelledField('Reviewer name', name),
    labelledField('Reviewer email', email),
    invite,
  ]);

  card.append(
    el('h2', { text: 'Reviewers' }),
    answer.reviewers.length === 0
      ? el('p', { class: 'muted', text: 'No reviewers invited yet.' })
      : el('ul', {}, answer.reviewers.map((reviewer) =>
          el('li', { text: `${reviewer.name} (${reviewer.email})` }),
        )),
    form,
    keyRegion,
  );
}

async function paintTokens(project: Project, card: HTMLElement, token?: string): Promise<void> {
  const answer = await api.get<{ tokens: { id: string; label: string; created_at: string }[] }>(
    `/api/projects/${project.slug}/tokens`,
  );
  clear(card);
  const tokenRegion = el('div', { role: 'region', 'aria-label': 'New token' });
  if (token) {
    tokenRegion.append(el('p', { text: 'New token' }), el('code', { text: token }));
  }
  const label = el('input', { type: 'text', 'data-field': 'label' });
  const create = el('button', { type: 'submit', class: 'button primary', text: 'Create token' });
  const form = el('form', {
    onsubmit: async (event: Event) => {
      event.preventDefault();
      clearProblem();
      create.disabled = true;
      announce('Creating token.');
      try {
        const token = await api.post<{ id: string; label: string; token: string }>(
          `/api/projects/${project.slug}/tokens`,
          { label: label.value.trim() },
        );
        announce("Token created. Copy it now; it won't be shown again.");
        await paintTokens(project, card, token.token);
      } catch (error) {
        create.disabled = false;
        announce('');
        if (error instanceof DeskError) {
          problem(failureCopy(error));
          showFieldErrors(form, error.info.fields);
        }
      }
    },
  }, [labelledField('Token label', label), create]);

  card.append(
    el('h2', { text: 'CI tokens' }),
    answer.tokens.length === 0
      ? el('p', { class: 'muted', text: 'No tokens yet.' })
      : el('ul', {}, answer.tokens.map((token) =>
          el('li', { text: `${token.label}, created ${localTime(token.created_at)}` }),
        )),
    form,
    tokenRegion,
  );
}

async function paintWebhook(project: Project, card: HTMLElement): Promise<void> {
  let current: { url: string; signing_secret: string } | null = null;
  try {
    current = await api.get<{ url: string; signing_secret: string }>(
      `/api/projects/${project.slug}/webhook`,
    );
  } catch {
    current = null;
  }
  clear(card);
  const url = el('input', { type: 'url', 'data-field': 'url', value: current?.url ?? '' });
  const save = el('button', { type: 'submit', class: 'button primary', text: 'Save endpoint' });
  const form = el('form', {
    onsubmit: async (event: Event) => {
      event.preventDefault();
      clearProblem();
      save.disabled = true;
      announce('Saving endpoint.');
      try {
        await api.put(`/api/projects/${project.slug}/webhook`, { url: url.value.trim() });
        announce('Webhook endpoint saved.');
        await paintWebhook(project, card);
      } catch (error) {
        save.disabled = false;
        announce('');
        if (error instanceof DeskError) {
          problem(failureCopy(error));
          showFieldErrors(form, error.info.fields);
        }
      }
    },
  }, [labelledField('Endpoint URL', url), save]);

  card.append(
    el('h2', { text: 'Webhook endpoint' }),
    form,
    current
      ? el('p', {}, ['Signing secret', ' ', el('code', { text: current.signing_secret })])
      : el('p', { class: 'muted', text: 'No endpoint registered yet.' }),
  );
}

async function paintFiles(project: Project, card: HTMLElement): Promise<void> {
  const answer = await api.get<{ files: SourceFile[] }>(`/api/projects/${project.slug}/source-files`);
  clear(card);
  card.append(el('h2', { text: 'Source files' }));
  if (answer.files.length === 0) {
    card.append(el('p', { class: 'muted', text: 'No source files uploaded yet.' }));
    return;
  }
  for (const file of answer.files) {
    card.append(
      el('div', { class: 'import-row' }, [
        el('span', { text: `${file.filename} on ${file.branch}` }),
        el('a', {
          href: `/api/projects/${project.slug}/source-files/${file.file_id}/original`,
          download: file.filename,
          text: 'Download original',
        }),
      ]),
    );
  }
}

function paintErase(project: Project, card: HTMLElement): void {
  clear(card);
  card.append(
    el('h2', { text: 'Erase project' }),
    el('p', {
      text: 'Erasing removes every row, stored file, token and webhook of this project. It cannot be undone.',
    }),
    el('button', {
      type: 'button',
      class: 'button primary',
      text: 'Erase project',
      onclick: (event: Event) => openErase(project, event.currentTarget as HTMLElement),
    }),
  );
}

function openErase(project: Project, opener: HTMLElement): void {
  openModal({
    name: 'Erase project',
    opener,
    body: (handle) => {
      const confirm = el('input', { type: 'text', 'data-field': 'confirm' });
      const erase = el('button', { type: 'submit', class: 'button primary', text: 'Erase everything' });
      const form = el('form', {
        onsubmit: async (event: Event) => {
          event.preventDefault();
          clearProblem();
          if (confirm.value.trim() !== project.slug) {
            showFieldErrors(form, { confirm: 'Type the project slug exactly to confirm.' });
            return;
          }
          erase.disabled = true;
          announce('Erasing project.');
          try {
            await api.del(`/api/projects/${project.slug}`, { confirm: confirm.value.trim() });
            announceAcross(`Erased ${project.name} and every stored file.`);
            handle.close();
            desk.projects = await api
              .get<{ projects: Project[] }>('/api/projects')
              .then((answer) => answer.projects);
            navigate('/desk');
          } catch (error) {
            erase.disabled = false;
            announce('');
            if (error instanceof DeskError) {
              problem(failureCopy(error));
              showFieldErrors(form, error.info.fields);
            }
          }
        },
      }, [
        el('h2', { text: 'Erase project' }),
        labelledField('Type the project slug to confirm', confirm),
        el('div', { class: 'dialog-actions' }, [
          erase,
          el('button', { type: 'button', class: 'button quiet', text: 'Cancel', onclick: () => handle.close() }),
        ]),
      ]);
      return [form];
    },
  });
}

export async function renderAudit(screen: HTMLElement): Promise<void> {
  const answer = await api.get<{ entries: AuditEntry[] }>('/api/audit');
  const column = el('div', { class: 'content-column' }, [el('h1', { text: 'Audit log' })]);
  if (answer.entries.length === 0) {
    column.append(el('div', { class: 'card' }, [el('h2', { text: 'Nothing in the audit log yet' })]));
    screen.append(column);
    return;
  }
  column.append(
    el('a', { class: 'link-arrow', href: '/api/audit.csv', download: 'audit-log.csv' }, [
      'Download CSV',
      el('span', { class: 'arrow', 'aria-hidden': 'true', text: '\u2192' }),
    ]),
    el('div', { class: 'card' }, [
      el('table', { class: 'plain-table', 'aria-label': 'Audit log' }, [
        el('thead', {}, [
          el('tr', {}, [
            el('th', { text: 'Time' }),
            el('th', { text: 'Actor' }),
            el('th', { text: 'Action' }),
            el('th', { text: 'Project' }),
            el('th', { text: 'Detail' }),
          ]),
        ]),
        el('tbody', {}, answer.entries.map((entry) =>
          el('tr', {}, [
            el('td', { class: 'tabular', text: localTime(entry.at) }),
            el('td', { text: entry.actor }),
            el('td', { text: entry.action }),
            el('td', { text: entry.project }),
            el('td', { text: entry.detail }),
          ]),
        )),
      ]),
    ]),
  );
  screen.append(column);
}
