import { call, upload } from '../lib/api.js';
import { append, clear, el, focus, setFieldError } from '../lib/dom.js';
import { openDialog, phoneViewport } from '../lib/dialog.js';
import { liveRegion, pending, problemsSummary, radioGroup, select, textbox } from '../lib/forms.js';
import { pageHeading, type RenderContext, type Screen, type ScreenResult } from '../lib/router.js';
import { isSessionError, requireMember, sessionEndedNotice } from '../lib/session.js';
import { officeOf } from '../lib/store.js';
import { copy, errorCopy, officeTime } from '../lib/copy.js';
import { BOARD_TITLES, ROLE_TITLES, formatIsoDateHuman } from '../../shared/format.js';
import type {
  ApplicationReview,
  ImportReport,
  Member,
  OfficeRecord,
  PackageRecord,
  RateCard,
  TalentRecord,
} from '../../shared/types.js';

const STATE_LABELS: Record<string, string> = {
  active: 'Active',
  withdrawn: 'Withdrawn',
  erased: 'Erased',
};

export const packagesScreen: Screen = {
  pattern: '/workspace/packages',
  async render(ctx: RenderContext): Promise<ScreenResult> {
    const member = await requireMember(ctx.path);
    if (!member) return { node: el('main', { class: 'page' }, []), chrome: 'plain' };
    const live = liveRegion('Package announcements');
    const office = await officeOf(member.office);
    const node = el('main', { class: 'page page-workspace' }, []);
    const talentResult = await call<{ talent: TalentRecord[] }>('GET', '/api/talent?state=active');
    const talent = talentResult.body?.talent ?? [];

    const draw = async (focusPackageId: string | null): Promise<void> => {
      const result = await call<{ packages: PackageRecord[] }>('GET', '/api/packages');
      clear(node);
      if (!result.body) {
        append(node, [
          pageHeading('Packages', { display: false }),
          isSessionError(result.error?.error) ? sessionEndedNotice((message) => live.announce(message)) : null,
          live.node,
        ]);
        return;
      }
      const newPackage = el('button', { type: 'button', class: 'button', text: 'New package' });
      newPackage.addEventListener('click', () => openNewDialog(newPackage));
      const list = el('ul', { class: 'package-list' }, result.body.packages.map((entry) => {
        const heading = el('h2', { class: 'card-name', 'data-package-id': entry.id, text: entry.title });
        const revoke = el('button', { type: 'button', class: 'button button-quiet', text: 'Revoke link' });
        const regenerate = el('button', { type: 'button', class: 'button button-quiet', text: 'Regenerate link' });
        revoke.addEventListener('click', async () => {
          const spinner = pending(revoke, 'Revoking…');
          spinner.start();
          const saved = await call<{ package: PackageRecord }>('POST', `/api/packages/${entry.id}/revoke`, { body: {} });
          spinner.stop();
          if (saved.body) {
            live.announce('Package link revoked. It no longer opens.');
            await draw(entry.id);
            return;
          }
          live.announce(
            saved.error?.error === 'already_revoked'
              ? 'That package link was already revoked.'
              : errorCopy(saved.error, office),
          );
        });
        regenerate.addEventListener('click', async () => {
          const spinner = pending(regenerate, 'Creating new link…');
          spinner.start();
          const saved = await call<{ package: PackageRecord }>('POST', `/api/packages/${entry.id}/regenerate`, { body: {} });
          spinner.stop();
          if (saved.body) {
            live.announce(
              `New link sent to ${saved.body.package.recipientName}. The old link no longer opens.`,
            );
            await draw(entry.id);
            return;
          }
          live.announce(errorCopy(saved.error, office));
        });
        return el('li', {}, [
          el('article', { class: 'package-card', 'aria-label': entry.title }, [
            heading,
            el('p', { text: `${entry.recipientName} — ${entry.recipientEmail}` }),
            el('p', { class: 'tabular', text: `${entry.state === 'active' ? 'Active' : 'Revoked'}, link works until ${officeTime(entry.expiresAt, office)}` }),
            el('ul', { class: 'plain-list' }, entry.talent.map((item) =>
              el('li', {
                text: `${item.displayName} — ${item.decision === 'shortlisted' ? 'Shortlisted' : item.decision === 'passed' ? 'Passed' : 'Undecided'}`,
              }))),
            el('div', { class: 'actions' }, [revoke, regenerate]),
          ]),
        ]);
      }));
      node.append(pageHeading('Packages', { display: false }), newPackage, list, live.node);
      if (focusPackageId) focus(node.querySelector<HTMLElement>(`[data-package-id="${focusPackageId}"]`));
    };

    const openNewDialog = (trigger: HTMLElement): void => {
      const dialog = openDialog({ title: 'New package', sheet: phoneViewport(), returnFocusTo: trigger });
      const problems = problemsSummary();
      const title = textbox({ id: 'package-title', label: 'Title' });
      const recipientName = textbox({ id: 'package-recipient', label: 'Recipient name' });
      const recipientEmail = textbox({ id: 'package-email', label: 'Recipient email', type: 'email' });
      const picker = el('div', { role: 'group', 'aria-label': 'Talent', class: 'talent-picker' });
      const checks: Array<{ id: string; input: HTMLInputElement }> = [];
      for (const entry of talent) {
        const id = `package-talent-${entry.id}`;
        const input = el('input', { type: 'checkbox', id, class: 'checkbox' });
        checks.push({ id: entry.id, input });
        picker.append(el('div', { class: 'checkbox-row' }, [input, el('label', { for: id, text: entry.displayName })]));
      }
      const submit = el('button', { type: 'button', class: 'button', text: 'Create package' });
      submit.addEventListener('click', async () => {
        const spinner = pending(submit, 'Creating package…');
        spinner.start();
        const result = await call<{ package: PackageRecord }>('POST', '/api/packages', {
          body: {
            title: title.input.value,
            recipientName: recipientName.input.value,
            recipientEmail: recipientEmail.input.value,
            talentIds: checks.filter((check) => check.input.checked).map((check) => check.id),
          },
        });
        spinner.stop();
        if (result.body) {
          dialog.close();
          live.announce(
            `Package sent to ${result.body.package.recipientName}. The link works until ${officeTime(result.body.package.expiresAt, office)}.`,
          );
          await draw(result.body.package.id);
          return;
        }
        if (result.status === 422 && result.error?.errors) {
          const ids: Record<string, string> = {
            title: 'package-title',
            recipientName: 'package-recipient',
            recipientEmail: 'package-email',
            talentIds: checks[0]?.input.id ?? 'package-title',
          };
          problems.show(result.error.errors, ids, dialog.body);
          live.announce(copy.validation(Object.keys(result.error.errors).length));
          focus(dialog.body.querySelector<HTMLElement>(`#${ids[Object.keys(result.error.errors)[0]]}`));
          return;
        }
        live.announce(errorCopy(result.error, office));
      });
      dialog.body.append(
        problems.node,
        title.field,
        recipientName.field,
        recipientEmail.field,
        el('div', { class: 'field' }, [el('span', { class: 'field-label', text: 'Talent' }), picker]),
        el('div', { class: 'dialog-actions' }, [submit]),
      );
      focus(title.input);
    };

    await draw(null);
    return { node, chrome: 'workspace' };
  },
};

type ApplicationCardTools = {
  live: { announce(message: string): void };
  office: OfficeRecord;
  reload: () => Promise<void>;
};

/** One review card: the four photos, the Minor label and the decisions. */
function applicationCard(application: ApplicationReview, tools: ApplicationCardTools): HTMLElement {
  const approve = el('button', { type: 'button', class: 'button', text: 'Approve' });
  const decline = el('button', { type: 'button', class: 'button button-quiet', text: 'Decline' });
  const sign = el('button', { type: 'button', class: 'button', text: 'Sign' });

  const decide = async (decision: 'approve' | 'decline', button: HTMLButtonElement): Promise<void> => {
    const spinner = pending(button, 'Saving decision…');
    spinner.start();
    const saved = await call<ApplicationReview>('POST', `/api/applications/${application.id}/decision`, {
      body: { decision },
    });
    spinner.stop();
    if (saved.body) {
      tools.live.announce(
        decision === 'approve'
          ? `Approved ${application.applicantName}'s application.`
          : `Declined ${application.applicantName}'s application.`,
      );
      await tools.reload();
      return;
    }
    const code = saved.error?.error;
    tools.live.announce(
      code === 'awaiting_guardian'
        ? 'This applicant is a minor and a guardian has not approved yet.'
        : code === 'already_decided'
          ? `${String(saved.error?.decidedBy ?? '')} already decided this application at ${officeTime(String(saved.error?.decidedAt ?? ''), tools.office)}.`
          : errorCopy(saved.error, tools.office),
    );
  };

  approve.addEventListener('click', () => void decide('approve', approve));
  decline.addEventListener('click', () => void decide('decline', decline));
  sign.addEventListener('click', async () => {
    const spinner = pending(sign, 'Saving decision…');
    spinner.start();
    const saved = await call<{ talent: TalentRecord }>('POST', `/api/applications/${application.id}/sign`, {
      body: {},
    });
    spinner.stop();
    if (saved.body) {
      tools.live.announce(`Signed ${application.applicantName} to the New Faces board.`);
      await tools.reload();
      return;
    }
    tools.live.announce(
      saved.error?.error === 'not_approved'
        ? 'That application is not approved yet.'
        : errorCopy(saved.error, tools.office),
    );
  });

  const statusText = application.status === 'awaiting_guardian'
    ? 'Awaiting guardian'
    : application.status.charAt(0).toUpperCase() + application.status.slice(1);

  return el('article', { class: 'application-card', 'aria-label': application.applicantName }, [
    el('h2', { class: 'card-name' }, [
      el('a', {
        class: 'link',
        href: `/workspace/applications/${application.id}`,
        text: application.applicantName,
      }),
    ]),
    el('p', {
      class: 'tabular',
      text: `${statusText} — ${application.office === 'toronto' ? 'Toronto' : 'Vancouver'}`,
    }),
    application.minor ? el('p', { class: 'minor-flag', text: 'Minor' }) : null,
    el('p', { text: application.bio ?? '' }),
    el('ul', { class: 'photo-row', 'aria-label': 'Photos' }, application.photos.map((photo) =>
      el('li', {}, [
        el('img', {
          class: 'application-photo',
          src: photo.url,
          alt: `${application.applicantName}, ${photo.slot} photo`,
        }),
      ]))),
    el('div', { class: 'actions' }, [approve, decline, sign]),
  ]);
}

export const applicationsScreen: Screen = {
  pattern: '/workspace/applications',
  async render(ctx: RenderContext): Promise<ScreenResult> {
    const member = await requireMember(ctx.path);
    if (!member) return { node: el('main', { class: 'page' }, []), chrome: 'plain' };
    const live = liveRegion('Application announcements');
    const office = await officeOf(member.office);
    const node = el('main', { class: 'page page-workspace' }, []);

    const draw = async (): Promise<void> => {
      const result = await call<{ applications: ApplicationReview[] }>('GET', '/api/applications');
      clear(node);
      if (!result.body) {
        append(node, [
          pageHeading('Applications', { display: false }),
          isSessionError(result.error?.error) ? sessionEndedNotice((message) => live.announce(message)) : null,
          live.node,
        ]);
        return;
      }
      const cards = result.body.applications.map((application) =>
        applicationCard(application, { live, office, reload: draw }));
      append(node, [pageHeading('Applications', { display: false }), ...cards, live.node]);
    };

    await draw();
    return { node, chrome: 'workspace' };
  },
};

export const applicationScreen: Screen = {
  pattern: '/workspace/applications/:id',
  async render(ctx: RenderContext): Promise<ScreenResult> {
    const member = await requireMember(ctx.path);
    if (!member) return { node: el('main', { class: 'page' }, []), chrome: 'plain' };
    const live = liveRegion('Application announcements');
    const office = await officeOf(member.office);
    const node = el('main', { class: 'page page-workspace' }, []);

    const draw = async (): Promise<void> => {
      const result = await call<{ applications: ApplicationReview[] }>('GET', '/api/applications');
      const application = result.body?.applications.find((entry) => entry.id === ctx.params.id) ?? null;
      clear(node);
      if (!application) {
        append(node, [
          pageHeading('Application not found', { display: false }),
          isSessionError(result.error?.error) ? sessionEndedNotice((message) => live.announce(message)) : null,
          live.node,
        ]);
        return;
      }
      append(node, [
        pageHeading(application.applicantName, { display: false }),
        applicationCard(application, { live, office, reload: draw }),
        live.node,
      ]);
    };

    await draw();
    return { node, chrome: 'workspace' };
  },
};

export const rosterScreen: Screen = {
  pattern: '/workspace/roster',
  async render(ctx: RenderContext): Promise<ScreenResult> {
    const member = await requireMember(ctx.path);
    if (!member) return { node: el('main', { class: 'page' }, []), chrome: 'plain' };
    const live = liveRegion('Roster announcements');
    const office = await officeOf(member.office);
    const node = el('main', { class: 'page page-workspace' }, []);
    let report: ImportReport | null = null;

    const draw = async (focusTalentId: string | null): Promise<void> => {
      const result = await call<{ talent: TalentRecord[] }>('GET', '/api/talent');
      clear(node);
      if (!result.body) {
        append(node, [
          pageHeading('Roster', { display: false }),
          isSessionError(result.error?.error) ? sessionEndedNotice((message) => live.announce(message)) : null,
          live.node,
        ]);
        return;
      }
      const importButton = el('button', { type: 'button', class: 'button', text: 'Import roster' });
      importButton.addEventListener('click', () => openImportDialog(importButton));
      const exportLink = el('a', {
        class: 'link',
        href: '/api/roster/export.csv',
        text: 'Export roster',
        download: 'roster.csv',
      });

      const rows = result.body.talent.map((entry) => {
        const stateCell = el('td', { 'data-state-for': entry.id, text: STATE_LABELS[entry.state] });
        const withdraw = el('button', { type: 'button', class: 'button button-quiet', text: 'Withdraw' });
        const restore = el('button', { type: 'button', class: 'button button-quiet', text: 'Restore' });
        const erase = el('button', { type: 'button', class: 'button button-quiet', text: 'Erase' });
        const act = async (
          action: 'withdraw' | 'restore' | 'erase',
          button: HTMLButtonElement,
        ): Promise<void> => {
          const spinner = pending(button, 'Saving…');
          spinner.start();
          const saved = await call<TalentRecord>('POST', `/api/talent/${entry.id}/${action}`, { body: {} });
          spinner.stop();
          if (saved.body) {
            live.announce(
              action === 'withdraw'
                ? `Withdrew ${entry.displayName}. They no longer appear on boards, packages or feeds.`
                : action === 'restore'
                  ? `Restored ${entry.displayName} to their boards, packages and feed.`
                  : `Erased ${entry.displayName}'s personal data. Booking amounts are kept under Erased talent.`,
            );
            await draw(entry.id);
            return;
          }
          const code = saved.error?.error;
          live.announce(
            code === 'already_withdrawn' || code === 'not_withdrawn' || code === 'erased'
              ? copy.recordChangedElsewhere
              : errorCopy(saved.error, office),
          );
        };
        withdraw.addEventListener('click', () => void act('withdraw', withdraw));
        restore.addEventListener('click', () => void act('restore', restore));
        erase.addEventListener('click', () => {
          const dialog = openDialog({
            title: `Erase ${entry.displayName}?`,
            alert: true,
            returnFocusTo: erase,
          });
          const confirm = el('button', { type: 'button', class: 'button', text: 'Erase' });
          const keep = el('button', { type: 'button', class: 'button button-quiet', text: 'Keep' });
          confirm.addEventListener('click', async () => {
            dialog.close();
            await act('erase', erase);
            focus(node.querySelector<HTMLElement>(`[data-state-for="${entry.id}"]`));
          });
          keep.addEventListener('click', () => dialog.close());
          dialog.body.append(
            el('p', { text: 'Erasing removes every personal detail. Booking amounts stay under Erased talent.' }),
            el('div', { class: 'dialog-actions' }, [confirm, keep]),
          );
          focus(keep);
        });

        return el('tr', {}, [
          el('th', { scope: 'row', class: 'pinned' }, [
            el('a', { class: 'link', href: `/workspace/talent/${entry.id}`, text: entry.displayName }),
          ]),
          el('td', { text: entry.office === 'toronto' ? 'Toronto' : 'Vancouver' }),
          el('td', { text: BOARD_TITLES[entry.board] }),
          stateCell,
          el('td', {}, [withdraw, restore, erase]),
        ]);
      });

      const table = el('table', { class: 'table tabular' }, [
        el('caption', { class: 'table-caption', text: 'Roster' }),
        el('thead', {}, [
          el('tr', {}, [
            el('th', { scope: 'col', class: 'pinned', text: 'Talent' }),
            el('th', { scope: 'col', text: 'Office' }),
            el('th', { scope: 'col', text: 'Board' }),
            el('th', { scope: 'col', text: 'State' }),
            el('th', { scope: 'col', text: 'Actions' }),
          ]),
        ]),
        el('tbody', {}, rows),
      ]);

      append(node, [
        pageHeading('Roster', { display: false }),
        el('div', { class: 'actions' }, [importButton, exportLink]),
        el('div', { class: 'table-region', role: 'region', 'aria-label': 'Roster', tabindex: '0' }, [table]),
        report ? reportRegion(report) : null,
        live.node,
      ]);
      if (focusTalentId) focus(node.querySelector<HTMLElement>(`[data-state-for="${focusTalentId}"]`));
    };

    const reportRegion = (data: ImportReport): HTMLElement =>
      el('section', { class: 'table-region', 'aria-label': 'Import report', tabindex: '0' }, [
        el('h2', { class: 'section-heading', id: 'import-report-heading', text: 'Import report' }),
        el('table', { class: 'table tabular' }, [
          el('caption', { class: 'table-caption', text: 'Import report' }),
          el('thead', {}, [
            el('tr', {}, [
              el('th', { scope: 'col', class: 'pinned', text: 'Row' }),
              el('th', { scope: 'col', text: 'Outcome' }),
              el('th', { scope: 'col', text: 'Reason' }),
              el('th', { scope: 'col', text: 'Filled' }),
            ]),
          ]),
          el('tbody', {}, data.rows.map((row) =>
            el('tr', {}, [
              el('th', { scope: 'row', class: 'pinned', text: String(row.row) }),
              el('td', { text: row.outcome }),
              el('td', { text: row.reason ?? '—' }),
              el('td', { text: row.filled.join(', ') || '—' }),
            ]))),
        ]),
      ]);

    const openImportDialog = (trigger: HTMLElement): void => {
      const dialog = openDialog({ title: 'Import roster', sheet: phoneViewport(), returnFocusTo: trigger });
      const problems = problemsSummary();
      const input = el('input', { type: 'file', class: 'input', id: 'roster-csv', accept: '.csv,text/csv' });
      const submit = el('button', { type: 'button', class: 'button', text: 'Import' });
      submit.addEventListener('click', async () => {
        const file = input.files?.[0];
        if (!file) {
          setFieldError(dialog.body, 'roster-csv', 'Enter roster csv.');
          live.announce(copy.validation(1));
          focus(input);
          return;
        }
        const spinner = pending(submit, 'Importing roster…');
        spinner.start();
        const result = await upload<ImportReport>('POST', '/api/roster/imports', file);
        spinner.stop();
        if (result.body) {
          report = result.body;
          const counts = result.body.counts;
          dialog.close();
          live.announce(
            `Import finished: ${counts.created} created, ${counts.merged} merged, ${counts.unchanged} unchanged, ${counts.orphan} orphans.`,
          );
          await draw(null);
          focus(node.querySelector<HTMLElement>('#import-report-heading'));
          return;
        }
        if (result.status === 422 && result.error?.errors) {
          problems.show(result.error.errors, { file: 'roster-csv' }, dialog.body);
          live.announce(copy.validation(Object.keys(result.error.errors).length));
          focus(input);
          return;
        }
        live.announce(errorCopy(result.error, office));
      });
      dialog.body.append(
        problems.node,
        el('div', { class: 'field' }, [
          el('label', { class: 'field-label', for: 'roster-csv', text: 'Roster CSV' }),
          input,
          el('p', { class: 'field-error', id: 'roster-csv-error', hidden: true }),
        ]),
        el('div', { class: 'dialog-actions' }, [submit]),
      );
      focus(input);
    };

    await draw(null);
    return { node, chrome: 'workspace' };
  },
};

export const membersScreen: Screen = {
  pattern: '/workspace/members',
  async render(ctx: RenderContext): Promise<ScreenResult> {
    const member = await requireMember(ctx.path);
    if (!member) return { node: el('main', { class: 'page' }, []), chrome: 'plain' };
    const live = liveRegion('Account announcements');
    const office = await officeOf(member.office);
    const node = el('main', { class: 'page page-workspace' }, []);

    const draw = async (): Promise<void> => {
      const result = await call<{ members: Member[] }>('GET', '/api/members');
      clear(node);
      if (!result.body) {
        append(node, [
          pageHeading('Members', { display: false }),
          isSessionError(result.error?.error) ? sessionEndedNotice((message) => live.announce(message)) : null,
          live.node,
        ]);
        return;
      }
      const invite = el('button', { type: 'button', class: 'button', text: 'Invite member' });
      invite.addEventListener('click', () => openInviteDialog(invite));
      const table = el('table', { class: 'table tabular' }, [
        el('caption', { class: 'table-caption', text: 'Members' }),
        el('thead', {}, [
          el('tr', {}, [
            el('th', { scope: 'col', text: 'Name' }),
            el('th', { scope: 'col', text: 'Email' }),
            el('th', { scope: 'col', text: 'Role' }),
            el('th', { scope: 'col', text: 'Office' }),
          ]),
        ]),
        el('tbody', {}, result.body.members.map((entry) =>
          el('tr', {}, [
            el('th', { scope: 'row', text: entry.name }),
            el('td', { text: entry.email }),
            el('td', { text: ROLE_TITLES[entry.role] }),
            el('td', { text: entry.office === 'toronto' ? 'Toronto' : 'Vancouver' }),
          ]))),
      ]);
      append(node, [
        pageHeading('Members', { display: false }),
        invite,
        el('div', { class: 'table-region', role: 'region', 'aria-label': 'Members', tabindex: '0' }, [table]),
        live.node,
      ]);
    };

    const openInviteDialog = (trigger: HTMLElement): void => {
      const dialog = openDialog({ title: 'Invite member', sheet: phoneViewport(), returnFocusTo: trigger });
      const problems = problemsSummary();
      const name = textbox({ id: 'invite-name', label: 'Name' });
      const email = textbox({ id: 'invite-email', label: 'Email', type: 'email' });
      const role = select({
        id: 'invite-role',
        label: 'Role',
        value: 'booker',
        choices: [
          { value: 'agency_director', label: 'Agency director' },
          { value: 'booker', label: 'Booker' },
          { value: 'accounts_lead', label: 'Accounts lead' },
          { value: 'scout', label: 'Scout' },
        ],
      });
      const officeChoice = radioGroup({
        name: 'invite-office',
        label: 'Office',
        value: 'toronto',
        choices: [
          { value: 'toronto', label: 'Toronto' },
          { value: 'vancouver', label: 'Vancouver' },
        ],
      });
      const submit = el('button', { type: 'button', class: 'button', text: 'Send invitation' });
      submit.addEventListener('click', async () => {
        const spinner = pending(submit, 'Sending…');
        spinner.start();
        const result = await call<{ message: string }>('POST', '/api/invitations', {
          body: {
            name: name.input.value,
            email: email.input.value,
            role: role.node.value,
            office: officeChoice.value(),
          },
        });
        spinner.stop();
        if (result.body) {
          dialog.close();
          live.announce(result.body.message);
          await draw();
          return;
        }
        if (result.status === 422 && result.error?.errors) {
          problems.show(
            result.error.errors,
            { name: 'invite-name', email: 'invite-email', role: 'invite-role', office: 'invite-office-toronto' },
            dialog.body,
          );
          live.announce(copy.validation(Object.keys(result.error.errors).length));
          focus(dialog.body.querySelector<HTMLElement>('#invite-name'));
          return;
        }
        live.announce(errorCopy(result.error, office));
      });
      dialog.body.append(
        problems.node,
        name.field,
        email.field,
        role.field,
        el('div', { class: 'field' }, [el('span', { class: 'field-label', text: 'Office' }), officeChoice.node]),
        el('div', { class: 'dialog-actions' }, [submit]),
      );
      focus(name.input);
    };

    await draw();
    return { node, chrome: 'workspace' };
  },
};

export const rateCardsScreen: Screen = {
  pattern: '/workspace/rate-cards',
  async render(ctx: RenderContext): Promise<ScreenResult> {
    const member = await requireMember(ctx.path);
    if (!member) return { node: el('main', { class: 'page' }, []), chrome: 'plain' };
    const result = await call<{ rateCards: RateCard[] }>('GET', '/api/rate-cards');
    const cards = result.body?.rateCards ?? [];
    const table = el('table', { class: 'table tabular' }, [
      el('caption', { class: 'table-caption', text: 'Rate cards' }),
      el('thead', {}, [
        el('tr', {}, [
          el('th', { scope: 'col', text: 'Name' }),
          el('th', { scope: 'col', text: 'Effective from' }),
          el('th', { scope: 'col', text: 'Women full day' }),
          el('th', { scope: 'col', text: 'Men full day' }),
          el('th', { scope: 'col', text: 'Creators full day' }),
          el('th', { scope: 'col', text: 'New Faces full day' }),
        ]),
      ]),
      el('tbody', {}, cards.map((card) =>
        el('tr', {}, [
          el('th', { scope: 'row', text: card.name }),
          el('td', { text: formatIsoDateHuman(card.effectiveFrom) }),
          el('td', { text: String(card.boards.women.fullDayCents / 100) }),
          el('td', { text: String(card.boards.men.fullDayCents / 100) }),
          el('td', { text: String(card.boards.creators.fullDayCents / 100) }),
          el('td', { text: String(card.boards.new_faces.fullDayCents / 100) }),
        ]))),
    ]);
    return {
      node: el('main', { class: 'page page-workspace' }, [
        pageHeading('Rate cards', { display: false }),
        el('div', { class: 'table-region', role: 'region', 'aria-label': 'Rate cards', tabindex: '0' }, [table]),
      ]),
      chrome: 'workspace',
    };
  },
};

export const officesScreen: Screen = {
  pattern: '/workspace/offices',
  async render(ctx: RenderContext): Promise<ScreenResult> {
    const member = await requireMember(ctx.path);
    if (!member) return { node: el('main', { class: 'page' }, []), chrome: 'plain' };
    const live = liveRegion('Roster announcements');
    const node = el('main', { class: 'page page-workspace' }, []);

    const draw = async (): Promise<void> => {
      const result = await call<{ offices: OfficeRecord[] }>('GET', '/api/offices');
      clear(node);
      const sections = (result.body?.offices ?? []).map((entry) => {
        const date = textbox({ id: `closure-${entry.id}`, label: `Closure date in ${entry.city}`, type: 'date' });
        const add = el('button', { type: 'button', class: 'button', text: `Add ${entry.city} closure` });
        add.addEventListener('click', async () => {
          const spinner = pending(add, 'Saving…');
          spinner.start();
          const saved = await call<{ closures: string[] }>('POST', `/api/offices/${entry.id}/closures`, {
            body: { date: date.input.value },
          });
          spinner.stop();
          if (saved.body) {
            live.announce(`Added a closure date in ${entry.city}.`);
            await draw();
            return;
          }
          if (saved.status === 422 && saved.error?.errors) {
            setFieldError(node, `closure-${entry.id}`, Object.values(saved.error.errors)[0]);
            live.announce(copy.validation(1));
            focus(date.input);
          }
        });
        return el('section', { class: 'office-section', 'aria-label': entry.city }, [
          el('h2', { class: 'section-heading', text: entry.city }),
          el('p', { text: entry.timeZone }),
          el('ul', { class: 'plain-list tabular' }, entry.closures.map((closure) =>
            el('li', { text: formatIsoDateHuman(closure) }))),
          date.field,
          add,
        ]);
      });
      append(node, [pageHeading('Offices', { display: false }), ...sections, live.node]);
    };

    await draw();
    return { node, chrome: 'workspace' };
  },
};
