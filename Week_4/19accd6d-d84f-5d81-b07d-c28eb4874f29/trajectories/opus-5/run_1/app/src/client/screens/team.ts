import { api, ApiCallError, type TeamBody } from '../api.js';
import { announceInto, clear, h, icon } from '../dom.js';
import { dialogActions, openModal, plainButton, primaryButton, withBusy } from '../dialogs.js';
import type { Screen, Shell } from '../main.js';

/** Team settings at /team: create a team, invite and remove teammates. */
export function renderTeamSettings(host: HTMLElement, shell: Shell): Screen {
  const nameField = h('input', { type: 'text', class: 'text-input', 'aria-label': 'Team name' });
  const createButton = primaryButton('Create team', () => undefined);
  const accordion = h('div', { class: 'team-accordion' });
  const announcements = h('div', {
    class: 'status-strip',
    role: 'status',
    'aria-live': 'polite',
    'aria-label': 'Team announcements',
  });
  const pane = h('section', { class: 'pane single-pane' }, [
    h('div', { class: 'pane-title' }, [h('h1', { class: 'pane-title-text library-heading', text: 'Team settings' })]),
    h('div', { class: 'pane-body' }, [
      h('div', { class: 'field-rows' }, [
        h('div', { class: 'field-row' }, [h('span', { class: 'field-label', text: 'Team name' }), nameField]),
        h('div', { class: 'field-row' }, [createButton]),
      ]),
      accordion,
    ]),
    announcements,
  ]);
  host.append(pane);

  let teams: TeamBody[] = [];
  let openTeam: string | null = null;

  function memberRow(team: TeamBody, member: TeamBody['members'][number]): HTMLElement {
    const row = h('div', { class: 'list-row', role: 'listitem', 'aria-label': member.displayName }, [
      h('span', { class: 'row-link', text: member.displayName }),
      h('span', { class: 'row-meta', text: member.email }),
      h('span', { class: 'row-meta', text: member.role }),
    ]);
    const isOwner = team.owner === shell.session?.user.id;
    if (isOwner && member.id !== team.owner) {
      row.append(plainButton(`Remove ${member.displayName}`, () => openRemove(team, member)));
    }
    return row;
  }

  function render(): void {
    clear(accordion);
    if (teams.length === 0) {
      accordion.append(h('p', { class: 'muted-note', text: 'No teams yet. Create one above.' }));
      return;
    }
    for (const team of teams) {
      const open = openTeam === team.id;
      const header = h('button', {
        type: 'button',
        class: `family-header${open ? ' open' : ''}`,
        'aria-expanded': open ? 'true' : 'false',
        'aria-label': team.name,
      }, [h('span', { text: team.name })]);
      header.append(icon('chevron-down'));
      header.addEventListener('click', () => {
        openTeam = open ? null : team.id;
        render();
      });
      const members = h('div', {
        class: 'row-list',
        role: 'list',
        'aria-label': `Members of ${team.name}`,
        hidden: !open,
      });
      for (const member of team.members) members.append(memberRow(team, member));
      if (open && team.owner === shell.session?.user.id) {
        members.append(plainButton('Invite teammate', () => openInvite(team)));
      }
      accordion.append(header, members);
    }
  }

  async function load(): Promise<void> {
    if (shell.session === null) {
      accordion.append(h('p', { class: 'muted-note', text: 'Sign in to work with teams.' }));
      return;
    }
    await shell.reloadSession();
    const loaded: TeamBody[] = [];
    for (const membership of shell.session?.teams ?? []) {
      try {
        const team = await api.team(membership.id);
        loaded.push(team.team);
      } catch (cause) {
        if (!(cause instanceof ApiCallError)) throw cause;
      }
    }
    teams = loaded;
    if (openTeam === null && teams.length > 0) openTeam = teams[0]!.id;
    render();
  }

  createButton.addEventListener(
    'click',
    withBusy(createButton, async () => {
      try {
        const created = await api.createTeam(nameField.value.trim());
        nameField.value = '';
        openTeam = created.team.id;
        await load();
      } catch (cause) {
        if (!(cause instanceof ApiCallError)) throw cause;
        announceInto(announcements, cause.failure.message);
      }
    }),
  );

  function openInvite(team: TeamBody): void {
    const modal = openModal({ title: 'Invite teammate' });
    const emailField = h('input', { type: 'email', class: 'text-input', 'aria-label': 'Email' });
    const send = primaryButton('Send invite', () => undefined);
    send.addEventListener(
      'click',
      withBusy(send, async () => {
        try {
          const invited = await api.invite(team.id, emailField.value.trim());
          modal.close();
          announceInto(announcements, `Invite sent to ${invited.invite.email}.`);
          await load();
        } catch (cause) {
          if (!(cause instanceof ApiCallError)) throw cause;
          modal.close();
          announceInto(announcements, cause.failure.message);
        }
      }),
    );
    modal.body.append(
      h('div', { class: 'field-row' }, [h('span', { class: 'field-label', text: 'Email' }), emailField]),
      dialogActions([send, plainButton('Cancel', () => modal.close())]),
    );
    emailField.focus();
  }

  function openRemove(team: TeamBody, member: TeamBody['members'][number]): void {
    const modal = openModal({ title: 'Remove teammate' });
    const remove = primaryButton('Remove', () => {
      void (async () => {
        try {
          await api.removeMember(team.id, member.id);
          modal.close();
          announceInto(announcements, `Removed ${member.displayName}.`);
          await load();
        } catch (cause) {
          if (!(cause instanceof ApiCallError)) throw cause;
          modal.close();
          announceInto(announcements, cause.failure.message);
        }
      })();
    });
    modal.body.append(
      h('p', { class: 'dialog-text', text: `Remove ${member.displayName} from ${team.name}?` }),
      dialogActions([remove, plainButton('Cancel', () => modal.close())]),
    );
    remove.focus();
  }

  void load();

  return {
    onLiveEvent(event) {
      if (event.type === 'membership_changed') void load();
    },
    onReconnect() {
      void load();
    },
  };
}
