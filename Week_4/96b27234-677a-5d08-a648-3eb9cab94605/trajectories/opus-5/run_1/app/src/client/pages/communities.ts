import { api } from '../api.js';
import { clear, el, focusHeading } from '../dom.js';
import { openDialog } from '../dialog.js';
import { HEADING, heading } from '../shell.js';
import { button, field, select, statusRegion } from '../widgets.js';
import type { CommunityMember, CommunitySummary, GatheringView } from '../types.js';
import type { Page, PageContext } from '../main.js';

const ROLES = ['owner', 'steward', 'member'];

export async function renderCommunities(ctx: PageContext): Promise<void> {
  heading(ctx.main, 'Communities');
  const list = el('ul', { 'aria-label': 'Communities', class: 'rows' });
  const response = await api.get<{ communities: CommunitySummary[] }>('/api/communities');
  for (const community of response.data?.communities ?? []) {
    list.append(
      el('li', { 'data-community-id': community.id, 'data-role': community.role }, [
        el('a', { href: `/communities/${community.id}`, text: community.name }),
        el('span', { text: ` \u2014 ${community.role}` })
      ])
    );
  }
  ctx.main.append(el('section', { class: 'panel' }, [list]));
}

export function scheduleGatheringButton(
  communityId: string,
  result: HTMLElement,
  onSaved: () => void
): HTMLButtonElement {
  const open = button('Schedule gathering', 'primary');
  open.addEventListener('click', () => {
    openDialog(
      'Schedule gathering',
      (close) => {
        const title = field('Title', 'text');
        const starts = field('Starts', 'text', { placeholder: '2027-03-07T19:00' });
        const duration = field('Duration in minutes', 'number', { value: '90', min: '15', max: '480' });
        const repeats = select('Repeats', [
          { label: 'none', value: 'none' },
          { label: 'weekly', value: 'weekly' }
        ]);
        const limit = field('Limit', 'number', { value: '20', min: '1', max: '500' });
        const save = button('Save gathering', 'primary');
        const cancel = button('Cancel');
        save.addEventListener('click', () => {
          result.textContent = 'Saving...';
          void api
            .post(`/api/communities/${communityId}/gatherings`, {
              title: title.input.value,
              startsLocal: starts.input.value,
              durationMinutes: Number(duration.input.value),
              recurrence: repeats.input.value,
              limit: Number(limit.input.value)
            })
            .then((response) => {
              result.textContent = response.ok ? 'Gathering scheduled.' : (response.error ?? '');
              if (response.ok) {
                close();
                onSaved();
              }
            });
        });
        cancel.addEventListener('click', () => close());
        return [
          el('h2', { text: 'Schedule gathering' }),
          title.wrap,
          starts.wrap,
          duration.wrap,
          repeats.wrap,
          limit.wrap,
          save,
          cancel
        ];
      },
      open
    );
  });
  return open;
}

export async function renderCommunity(ctx: PageContext): Promise<Page> {
  const communityId = ctx.params['id'] ?? '';
  const communities = await api.get<{ communities: CommunitySummary[] }>('/api/communities');
  const mine = (communities.data?.communities ?? []).find((entry) => entry.id === communityId);
  if (mine === undefined) {
    heading(ctx.main, HEADING.notFound);
    return {};
  }
  heading(ctx.main, mine.name);
  const result = statusRegion('Community result');
  const memberBody = el('tbody', {});
  const table = el('table', { 'aria-label': 'Members', class: 'grid' }, [
    el('thead', {}, [el('tr', {}, [el('th', { text: 'Name' }), el('th', { text: 'Role' }), el('th', { text: 'Change' })])]),
    memberBody
  ]);
  const gatheringList = el('ul', { 'aria-label': 'Gatherings', class: 'rows' });
  const gatheringResult = statusRegion('Gathering result');
  const scheduleHolder = el('div', {});
  ctx.main.append(
    el('section', { class: 'panel' }, [el('h2', { text: 'Members' }), el('div', { class: 'table-wrap' }, [table]), result]),
    el('section', { class: 'panel' }, [
      el('h2', { text: 'Gatherings' }),
      scheduleHolder,
      gatheringList,
      gatheringResult
    ])
  );

  let role = mine.role;

  const drawSchedule = (): void => {
    clear(scheduleHolder);
    if (role === 'owner' || role === 'steward') {
      scheduleHolder.append(scheduleGatheringButton(communityId, gatheringResult, () => void drawGatherings()));
    }
  };

  async function drawMembers(): Promise<void> {
    const response = await api.get<{ members: CommunityMember[] }>(`/api/communities/${communityId}/members`);
    clear(memberBody);
    for (const member of response.data?.members ?? []) {
      const change = el('td', {});
      if (role === 'owner' && member.personId !== ctx.me?.personId) {
        const roleSelect = select(
          `Role for ${member.displayName}`,
          ROLES.map((entry) => ({ label: entry, value: entry })),
          member.role
        );
        roleSelect.input.addEventListener('change', () => {
          result.textContent = 'Saving...';
          void api
            .put(`/api/communities/${communityId}/members/${member.personId}`, { role: roleSelect.input.value })
            .then((changed) => {
              result.textContent = changed.ok ? 'Role changed.' : (changed.error ?? '');
              void drawMembers();
            });
        });
        change.append(roleSelect.wrap);
      }
      const mayRemove =
        member.personId !== ctx.me?.personId &&
        (role === 'owner' || (role === 'steward' && member.role === 'member'));
      if (mayRemove) {
        const remove = button(`Remove ${member.displayName}`, 'danger');
        remove.addEventListener('click', () => {
          result.textContent = 'Saving...';
          void api.remove(`/api/communities/${communityId}/members/${member.personId}`).then((removed) => {
            result.textContent = removed.ok ? 'Member removed.' : (removed.error ?? '');
            void drawMembers();
          });
        });
        change.append(remove);
      }
      memberBody.append(
        el('tr', { 'data-person-id': member.personId, 'data-role': member.role }, [
          el('td', { text: member.displayName }),
          el('td', { text: member.role }),
          change
        ])
      );
    }
  }

  async function drawGatherings(): Promise<void> {
    const response = await api.get<{ gatherings: GatheringView[] }>(`/api/communities/${communityId}/gatherings`);
    clear(gatheringList);
    for (const gathering of response.data?.gatherings ?? []) {
      gatheringList.append(
        el('li', { 'data-gathering-id': gathering.id, 'data-status': gathering.status }, [
          el('a', { href: `/gatherings/${gathering.id}`, text: gathering.title }),
          el('span', { text: ` \u2014 ${gathering.display} \u2014 ${gathering.status}` })
        ])
      );
    }
  }

  drawSchedule();
  await drawMembers();
  await drawGatherings();

  return {
    onPersonEvent: (event) => {
      if (event.type !== 'role-changed' && event.type !== 'removed-from-community') return;
      void api.get<{ communities: CommunitySummary[] }>('/api/communities').then((fresh) => {
        const found = (fresh.data?.communities ?? []).find((entry) => entry.id === communityId);
        const focused = document.activeElement;
        role = found?.role ?? 'member';
        drawSchedule();
        void drawMembers();
        if (focused !== null && focused !== document.body && !focused.isConnected) focusHeading();
      });
    }
  };
}
