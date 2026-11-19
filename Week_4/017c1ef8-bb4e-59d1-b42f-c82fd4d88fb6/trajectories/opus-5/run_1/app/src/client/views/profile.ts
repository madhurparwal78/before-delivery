import { firstName, skillRowText } from '../../shared/format';
import { api } from '../api';
import { announce, clearAlerts, dialog, h, isPhone, menu, qs, qsa, showAlert } from '../dom';
import { degreeBlock, type MutualData } from '../components/degree';
import { personCardNode, type PersonCard } from '../components/person';
import {
  acceptFrom,
  connectTo,
  ignoreFrom,
  removeConnectionWith,
  withdrawTo,
} from '../components/person';
import { cfg, currentMember, loadMe, on } from '../state';
import { S } from '../strings';

type Skill = {
  name: string;
  endorsements: number;
  endorsed_by_me: boolean;
  featured_position: number | null;
  endorser_line: string | null;
};

type Profile = {
  id: string;
  handle: string;
  name: string;
  headline?: string;
  location?: string;
  photo_url?: string | null;
  visibility: string;
  degree: string;
  connection_state?: string;
  following?: boolean;
  mutual?: MutualData;
  about?: string;
  experience?: { title: string; company: string; start: string; end: string | null }[];
  education?: { school: string; degree: string; start: string; end: string | null }[];
  skills?: Skill[];
  versions?: Record<string, number>;
  email?: string;
};

export function profileView(handle: string, navigate: (path: string) => void): HTMLElement {
  const host = h('div', { class: 'profile-page' });
  let profile: Profile | null = null;
  let block: ReturnType<typeof degreeBlock> | null = null;
  let pathIds: string[] = [];
  let refreshTimer = 0;
  let refreshing = false;
  let rollingUntil = 0;

  void load(true);
  const offGraph = on('graph', scheduleRefresh);
  const offNetwork = on('network', scheduleRefresh);
  const offSkills = on('skills', scheduleRefresh);
  const offProfile = on('profile', scheduleRefresh);
  const observer = new MutationObserver(() => {
    if (!document.contains(host)) {
      offGraph();
      offNetwork();
      offSkills();
      offProfile();
      observer.disconnect();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  return host;

  async function load(first: boolean): Promise<void> {
    const result = await api.get<Profile>(`/api/profiles/${encodeURIComponent(handle)}`);
    if (!result.ok) {
      const blocked = await iBlocked();
      host.replaceChildren(
        blocked
          ? h('div', { class: 'empty' }, [
              h('p', { class: 'big-sentence', text: S.announce.blocked(blocked) }),
              h('a', { href: '/settings', class: 'link underline' }, ['Manage blocked members']),
            ])
          : h('div', { class: 'empty' }, [
              h('h1', { class: 'big-sentence', text: S.empty.profileUnavailable }),
              h('a', { href: '/feed', class: 'link underline' }, ['Go to Home']),
            ]),
      );
      return;
    }
    profile = result.body;
    if (first) draw();
    else draw();
  }

  async function iBlocked(): Promise<string | null> {
    const result = await api.get<{ blocked: { name: string; handle: string }[] }>('/api/blocks');
    if (!result.ok) return null;
    const found = result.body.blocked.find(
      (entry) => entry.handle.toLowerCase() === handle.toLowerCase(),
    );
    return found ? found.name : null;
  }

  /** Several stored changes can land at once; one reload answers them all. */
  function scheduleRefresh(): void {
    window.clearTimeout(refreshTimer);
    refreshTimer = window.setTimeout(() => void refresh(), 100);
  }

  async function refresh(): Promise<void> {
    if (refreshing) {
      scheduleRefresh();
      return;
    }
    refreshing = true;
    try {
      await reload();
    } finally {
      refreshing = false;
    }
  }

  async function reload(): Promise<void> {
    const result = await api.get<Profile>(`/api/profiles/${encodeURIComponent(handle)}`);
    if (!result.ok) {
      await load(false);
      return;
    }
    const next = result.body;
    const previous = profile;
    profile = next;
    void redrawPath();
    if (!previous || !block || previous.degree !== next.degree) {
      if (block && previous && previous.degree !== next.degree) {
        rollingUntil = Date.now() + 700;
        block.update(next.degree, next.mutual ?? { count: 0 }, next.handle, () => degreeActions());
        return;
      }
      draw();
      return;
    }
    /* A redraw mid-roll would cut the Degree Roll short. */
    if (Date.now() < rollingUntil) return;
    draw();
  }

  async function redrawPath(): Promise<void> {
    if (!profile) return;
    const target = profile;
    const before = pathIds;
    const built = await pathRegion(target);
    const region = qs<HTMLElement>('[data-connection-path]', host);
    if (built && region) region.replaceWith(built);
    else if (built) qs<HTMLElement>('.path-host', host)?.append(built);
    else if (region) region.remove();
    const changed = before.join(',') !== pathIds.join(',');
    if (changed && before.length > 0 && pathIds.length > 0) {
      announce('Network announcements', S.announce.connectionPathChanged);
    }
  }

  function isOwner(): boolean {
    const me = currentMember();
    return me !== null && profile !== null && me.id === profile.id;
  }

  function degreeActions(): HTMLElement[] {
    if (!profile) return [];
    const actions: HTMLElement[] = [];
    const state = profile.connection_state ?? 'none';
    const alertHost = host;
    const after = (): void => void refresh();

    if (state === 'none' || state === 'withdrawn' || state === 'ignored') {
      actions.push(
        pressable('Connect', async () => {
          clearAlerts(alertHost);
          const outcome = await connectTo(profile as Profile, alertHost, true);
          if (!outcome.failed) after();
        }),
      );
    } else if (state === 'pending_sent') {
      actions.push(
        pressable('Withdraw', async () => {
          const outcome = await withdrawTo((profile as Profile).id, alertHost);
          if (!outcome.failed) after();
        }),
      );
    } else if (state === 'pending_received') {
      actions.push(
        pressable('Accept', async () => {
          const outcome = await acceptFrom(profile as Profile, alertHost, true);
          if (!outcome.failed) after();
        }),
        pressable('Ignore', async () => {
          const outcome = await ignoreFrom((profile as Profile).id, alertHost);
          if (!outcome.failed) after();
        }),
      );
    } else if (state === 'connected') {
      actions.push(
        h('a', { href: `/messaging/with/${profile.handle}`, class: 'button' }, ['Message']),
        pressable('Remove connection', () => openRemoveDialog()),
      );
    }

    const follow = h(
      'button',
      {
        type: 'button',
        class: 'button quiet',
        'aria-pressed': profile.following ? 'true' : 'false',
        click: async () => {
          const target = profile as Profile;
          const result = target.following
            ? await api.del(`/api/follows/${target.id}`)
            : await api.post('/api/follows', { target_id: target.id });
          if (result.ok) after();
        },
      },
      [profile.following ? 'Following' : 'Follow'],
    );
    actions.push(follow);

    const more = h(
      'button',
      {
        type: 'button',
        class: 'button quiet',
        click: () => {
          const target = profile as Profile;
          menu(more, [
            { label: `Block ${target.name}`, run: () => openBlockDialog(target) },
          ]);
        },
      },
      ['More actions'],
    );
    actions.push(more);
    return actions;
  }

  function pressable(label: string, run: () => void | Promise<void>): HTMLElement {
    const button = h(
      'button',
      {
        type: 'button',
        class: 'button',
        click: async () => {
          button.setAttribute('disabled', '');
          await run();
          button.removeAttribute('disabled');
        },
      },
      [label],
    );
    return button;
  }

  function openRemoveDialog(): void {
    dialog(
      'Remove connection?',
      (close) => {
        const confirm = h(
          'button',
          {
            type: 'button',
            class: 'button',
            click: async () => {
              const outcome = await removeConnectionWith((profile as Profile).id, host);
              close();
              if (!outcome.failed) void refresh();
            },
          },
          ['Remove'],
        );
        return [
          h('h2', { text: 'Remove connection?' }),
          confirm,
          h('button', { type: 'button', class: 'button quiet', click: () => close() }, ['Cancel']),
        ];
      },
      null,
    );
  }

  function openBlockDialog(target: Profile): void {
    dialog(
      `Block ${target.name}?`,
      (close) => {
        const confirm = h(
          'button',
          {
            type: 'button',
            class: 'button',
            click: async () => {
              const result = await api.post('/api/blocks', { member_id: target.id });
              close();
              if (!result.ok) {
                showAlert(host, S.alert.somethingWrong);
                return;
              }
              announce('Network announcements', S.announce.blocked(target.name));
              if (block) {
                block.update('out', { count: 0 }, target.handle, () => []);
                window.setTimeout(() => {
                  host.replaceChildren(
                    h('div', { class: 'empty' }, [
                      h('p', { class: 'big-sentence', text: S.announce.blocked(target.name) }),
                      h('a', { href: '/settings', class: 'link underline' }, [
                        'Manage blocked members',
                      ]),
                    ]),
                  );
                  qs<HTMLElement>('a.link.underline', host)?.focus();
                }, 600);
              }
            },
          },
          ['Block'],
        );
        return [
          h('h2', { text: `Block ${target.name}?` }),
          confirm,
          h('button', { type: 'button', class: 'button quiet', click: () => close() }, ['Cancel']),
        ];
      },
      null,
    );
  }

  async function pathRegion(target: Profile): Promise<HTMLElement | null> {
    if (target.degree !== '2' && target.degree !== '3') return null;
    const result = await api.get<{ path: ({ id: string; name: string; handle: string } | { private: true })[] }>(
      `/api/profiles/${encodeURIComponent(target.handle)}/path`,
    );
    if (!result.ok || result.body.path.length === 0) {
      pathIds = [];
      return null;
    }
    pathIds = result.body.path.map((step) => ('private' in step ? 'private' : step.id));
    const list = h('ol', { 'aria-label': 'Connection path', class: 'plain-list' });
    for (const step of result.body.path) {
      list.append(
        h('li', {}, [
          'private' in step
            ? document.createTextNode('Private member')
            : h('a', { href: `/in/${step.handle}`, class: 'link' }, [step.name]),
        ]),
      );
    }
    return h(
      'section',
      { 'aria-label': "How you're connected", 'data-connection-path': '', class: 'panel' },
      [h('h2', { class: 'section-title', text: "How you're connected" }), list],
    );
  }

  function draw(): void {
    if (!profile) return;
    const target = profile;
    host.replaceChildren();
    const top = h('div', { class: 'profile-top' });

    if (!isOwner()) {
      block = degreeBlock(
        target.degree,
        target.mutual ?? { count: 0 },
        target.handle,
        degreeActions,
      );
      top.append(block.node);
    } else {
      block = null;
    }

    top.append(h('h1', { class: 'profile-name', text: target.name }));
    if (target.headline !== undefined) {
      top.append(h('p', { class: 'headline large', text: target.headline }));
    }
    if (target.location !== undefined) {
      top.append(h('p', { class: 'muted', text: target.location }));
    }

    if (isOwner()) {
      const row = h('div', { class: 'action-row' }, [
        h(
          'button',
          { type: 'button', class: 'button quiet', click: () => openIntroDialog(target) },
          ['Edit intro'],
        ),
        h(
          'button',
          { type: 'button', class: 'button quiet', click: () => openPhotoDialog() },
          ['Change photo'],
        ),
        h(
          'button',
          {
            type: 'button',
            class: 'button quiet',
            click: async () => {
              await api.post('/api/auth/signout');
              await loadMe();
              navigate('/');
            },
          },
          ['Sign out'],
        ),
      ]);
      top.append(row);
    } else if (block) {
      top.append(block.actionRow);
    }
    host.append(top);

    if (target.photo_url) {
      host.append(h('img', { src: target.photo_url, alt: '', class: 'profile-photo' }));
    }

    const pathHost = h('div', { class: 'path-host' });
    host.append(pathHost);
    void (async () => {
      const region = await pathRegion(target);
      if (region && document.contains(pathHost)) pathHost.append(region);
    })();

    const columns = h('div', { class: isPhone() ? 'profile-columns phone' : 'profile-columns' });
    const left = h('div', { class: 'profile-left' });
    const right = h('div', { class: 'profile-right' });

    if (target.visibility === 'private' && !isOwner()) {
      left.append(
        h('p', { class: 'big-sentence small', text: S.placeholder.private(firstName(target.name)) }),
      );
    } else if (target.about === undefined && !isOwner()) {
      left.append(
        h('p', {
          class: 'big-sentence small',
          text: S.placeholder.connectionsOnly(firstName(target.name)),
        }),
      );
    } else {
      left.append(aboutSection(target));
      left.append(experienceSection(target));
      right.append(skillsSection(target));
      right.append(educationSection(target));
    }
    columns.append(left, right);
    host.append(columns);
  }

  function aboutSection(target: Profile): HTMLElement {
    const section = h('section', { 'aria-label': 'About', class: 'panel' }, [
      h('h2', { class: 'section-title', text: 'About' }),
      h('p', { class: 'body-text', text: target.about ?? '' }),
    ]);
    if (isOwner()) {
      section.append(
        h('button', { type: 'button', class: 'button quiet', click: () => openAboutDialog(target) }, [
          'Edit about',
        ]),
      );
    }
    return section;
  }

  function experienceSection(target: Profile): HTMLElement {
    const list = h('ul', { class: 'plain-list' });
    for (const entry of target.experience ?? []) {
      list.append(
        h('li', {}, [
          h('p', { class: 'person-name small', text: entry.title }),
          h('p', {
            class: 'muted',
            text: `${entry.company} · ${entry.start} – ${entry.end ?? 'Present'}`,
          }),
        ]),
      );
    }
    const section = h('section', { 'aria-label': 'Experience', class: 'panel' }, [
      h('h2', { class: 'section-title', text: 'Experience' }),
      list,
    ]);
    if (isOwner()) {
      section.append(
        h(
          'button',
          { type: 'button', class: 'button quiet', click: () => openExperienceDialog(target) },
          ['Edit experience'],
        ),
      );
    }
    return section;
  }

  function educationSection(target: Profile): HTMLElement {
    const list = h('ul', { class: 'plain-list' });
    for (const entry of target.education ?? []) {
      list.append(
        h('li', {}, [
          h('p', { class: 'person-name small', text: entry.school }),
          h('p', {
            class: 'muted',
            text: `${entry.degree} · ${entry.start} – ${entry.end ?? 'Present'}`,
          }),
        ]),
      );
    }
    const section = h('section', { 'aria-label': 'Education', class: 'panel' }, [
      h('h2', { class: 'section-title', text: 'Education' }),
      list,
    ]);
    if (isOwner()) {
      section.append(
        h(
          'button',
          { type: 'button', class: 'button quiet', click: () => openEducationDialog(target) },
          ['Edit education'],
        ),
      );
    }
    return section;
  }

  function skillsSection(target: Profile): HTMLElement {
    const section = h('section', { 'aria-label': 'Skills', class: 'panel skills' }, [
      h('h2', { class: 'section-title', text: 'Skills' }),
    ]);
    const skills = target.skills ?? [];
    const featured = skills
      .filter((skill) => skill.featured_position !== null)
      .sort((a, b) => (a.featured_position ?? 0) - (b.featured_position ?? 0));

    if (isOwner() && featured.length > 0) {
      section.append(featuredListbox(target, featured, skills));
    }

    for (const skill of skills) {
      const row = h('div', {
        class: 'skill-row',
        'data-skill': skill.name,
        'data-endorsements': String(skill.endorsements),
        'data-featured': skill.featured_position !== null ? 'true' : undefined,
        'data-featured-position':
          skill.featured_position !== null ? String(skill.featured_position) : undefined,
      });
      row.append(h('p', { class: 'skill-text', text: skillRowText(skill.name, skill.endorsements) }));
      if (skill.endorser_line) {
        row.append(h('p', { 'data-endorser-line': '', class: 'muted', text: skill.endorser_line }));
      }
      if (target.degree === '1') {
        row.append(
          h(
            'button',
            {
              type: 'button',
              class: 'button quiet',
              'aria-pressed': skill.endorsed_by_me ? 'true' : 'false',
              click: async (event: Event) => {
                const button = event.currentTarget as HTMLButtonElement;
                button.disabled = true;
                const path = `/api/members/${target.id}/skills/${encodeURIComponent(skill.name)}/endorsement`;
                const result = skill.endorsed_by_me ? await api.del(path) : await api.put(path);
                button.disabled = false;
                if (result.ok) {
                  announce(
                    'Profile announcements',
                    skill.endorsed_by_me
                      ? S.announce.endorsementRemoved
                      : S.announce.endorsed(skill.name),
                  );
                  void refresh();
                } else showAlert(section, S.alert.somethingWrong);
              },
            },
            [`Endorse ${skill.name}`],
          ),
        );
      }
      if (isOwner()) {
        row.append(
          h(
            'button',
            {
              type: 'button',
              class: 'text-button',
              click: () => void saveSkills(target, skills.filter((entry) => entry.name !== skill.name).map((entry) => entry.name), featuredNames(featured).filter((name) => name !== skill.name)),
            },
            [`Remove ${skill.name}`],
          ),
          skill.featured_position === null
            ? h(
                'button',
                {
                  type: 'button',
                  class: 'text-button',
                  click: () =>
                    void saveSkills(
                      target,
                      skills.map((entry) => entry.name),
                      [...featuredNames(featured), skill.name].slice(0, 3),
                      { featuredSave: true },
                    ),
                },
                [`Feature ${skill.name}`],
              )
            : h(
                'button',
                {
                  type: 'button',
                  class: 'text-button',
                  click: () =>
                    void saveSkills(
                      target,
                      skills.map((entry) => entry.name),
                      featuredNames(featured).filter((name) => name !== skill.name),
                      { featuredSave: true },
                    ),
                },
                [`Unfeature ${skill.name}`],
              ),
        );
      }
      section.append(row);
    }

    if (isOwner()) {
      const input = h('input', {
        type: 'text',
        'aria-label': 'Add a skill',
        class: 'input',
      }) as HTMLInputElement;
      section.append(
        h('div', { class: 'row' }, [
          input,
          h(
            'button',
            {
              type: 'button',
              class: 'button',
              click: () => {
                const name = input.value.trim();
                if (name === '') return;
                void saveSkills(
                  target,
                  [...skills.map((entry) => entry.name), name],
                  featuredNames(featured),
                );
              },
            },
            ['Add skill'],
          ),
        ]),
      );
    }
    return section;
  }

  function featuredNames(featured: Skill[]): string[] {
    return featured.map((skill) => skill.name);
  }

  function featuredListbox(target: Profile, featured: Skill[], skills: Skill[]): HTMLElement {
    const listbox = h('ul', {
      role: 'listbox',
      'aria-label': 'Featured skills',
      class: 'listbox featured',
    });
    let focusIndex = 0;
    const order = featuredNames(featured);
    const draw = (): void => {
      listbox.replaceChildren();
      order.forEach((name, index) => {
        listbox.append(
          h(
            'li',
            {
              role: 'option',
              'aria-label': name,
              'aria-selected': 'false',
              tabindex: index === focusIndex ? '0' : '-1',
              class: 'option',
              draggable: 'true',
              dragstart: (event: Event) => {
                (event as DragEvent).dataTransfer?.setData('text/plain', String(index));
              },
              dragover: (event: Event) => event.preventDefault(),
              drop: (event: Event) => {
                const dragEvent = event as DragEvent;
                dragEvent.preventDefault();
                const from = Number(dragEvent.dataTransfer?.getData('text/plain') ?? '-1');
                if (from < 0) return;
                const node = dragEvent.currentTarget as HTMLElement;
                const box = node.getBoundingClientRect();
                const after = dragEvent.clientY > box.top + box.height / 2;
                move(from, after ? index + 1 : index);
              },
            },
            [name],
          ),
        );
      });
    };
    const move = (from: number, to: number): void => {
      const next = [...order];
      const [moved] = next.splice(from, 1);
      const target2 = to > from ? to - 1 : to;
      next.splice(target2, 0, moved);
      order.splice(0, order.length, ...next);
      focusIndex = target2;
      draw();
      announce(
        'Profile announcements',
        S.announce.skillMoved(moved, target2 + 1, order.length),
      );
      void saveSkills(target, skills.map((skill) => skill.name), [...order], {
        featuredSave: true,
        quiet: true,
      });
      qsa<HTMLElement>('[role="option"]', listbox)[focusIndex]?.focus();
    };
    listbox.addEventListener('keydown', (event) => {
      const options = qsa<HTMLElement>('[role="option"]', listbox);
      if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
        event.preventDefault();
        const next = event.key === 'ArrowUp' ? focusIndex - 1 : focusIndex + 1;
        if (next < 0 || next >= options.length) return;
        move(focusIndex, event.key === 'ArrowUp' ? next : next + 1);
        return;
      }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const next = event.key === 'ArrowDown' ? focusIndex + 1 : focusIndex - 1;
        if (next < 0 || next >= options.length) return;
        focusIndex = next;
        draw();
        qsa<HTMLElement>('[role="option"]', listbox)[focusIndex]?.focus();
      } else if (event.key === 'Home' || event.key === 'End') {
        event.preventDefault();
        focusIndex = event.key === 'Home' ? 0 : options.length - 1;
        draw();
        qsa<HTMLElement>('[role="option"]', listbox)[focusIndex]?.focus();
      }
    });
    draw();
    return listbox;
  }

  async function saveSkills(
    target: Profile,
    names: string[],
    featured: string[],
    options: { featuredSave?: boolean; quiet?: boolean } = {},
  ): Promise<void> {
    const version = target.versions?.skills ?? 1;
    const result = await api.patch<{ error?: string; limit?: number }>('/api/me/sections/skills', {
      version,
      skills: names,
      featured,
    });
    if (result.ok) {
      if (!options.quiet) announce('Profile announcements', S.announce.sectionSaved);
      void refresh();
      return;
    }
    if (result.body.error === 'version_conflict' && options.featuredSave) {
      showAlert(host, S.alert.featuredOrderConflict);
      void refresh();
      return;
    }
    if (result.body.error === 'skill_limit') {
      showAlert(host, S.alert.skillLimit(result.body.limit ?? cfg().max_skills));
      return;
    }
    if (result.body.error === 'featured_limit') {
      showAlert(host, S.alert.featuredLimit);
      return;
    }
    if (result.body.error === 'version_conflict') {
      showAlert(host, S.alert.sectionConflict);
      return;
    }
    showAlert(host, S.alert.somethingWrong);
  }

  function sectionDialog(
    name: string,
    section: string,
    target: Profile,
    build: () => { nodes: HTMLElement[]; payload: () => Record<string, unknown> },
  ): void {
    dialog(
      name,
      (close) => {
        const built = build();
        const body = h('div', { class: 'dialog-body' }, built.nodes);
        const save = h(
          'button',
          {
            type: 'button',
            class: 'button',
            click: () => void submit(target.versions?.[section] ?? 1),
          },
          ['Save'],
        );
        return [h('h2', { text: name }), body, save];

        async function submit(version: number): Promise<void> {
          clearAlerts(body);
          save.setAttribute('disabled', '');
          const result = await api.patch<{
            error?: string;
            fields?: Record<string, string>;
            current_version?: number;
            current?: Record<string, unknown>;
          }>(`/api/me/sections/${section}`, { version, ...built.payload() });
          save.removeAttribute('disabled');
          if (result.ok) {
            announce('Profile announcements', S.announce.sectionSaved);
            close();
            void refresh();
            return;
          }
          if (result.body.error === 'version_conflict') {
            showAlert(body, S.alert.sectionConflict);
            const current = result.body.current ?? {};
            const version2 = result.body.current_version ?? version;
            body.append(
              h(
                'button',
                {
                  type: 'button',
                  class: 'button quiet',
                  click: () => {
                    close();
                    void refresh();
                  },
                },
                ['Load latest'],
              ),
              h(
                'button',
                {
                  type: 'button',
                  class: 'button quiet',
                  click: () => void submit(version2),
                },
                ['Save mine anyway'],
              ),
            );
            void current;
            return;
          }
          const fields = result.body.fields ?? {};
          showAlert(body, Object.values(fields)[0] ?? S.alert.somethingWrong);
        }
      },
      null,
    );
  }

  function openIntroDialog(target: Profile): void {
    sectionDialog('Edit intro', 'intro', target, () => {
      const name = h('input', {
        type: 'text',
        'aria-label': 'Name',
        class: 'input',
        value: target.name,
      }) as HTMLInputElement;
      const headline = h('input', {
        type: 'text',
        'aria-label': 'Headline',
        class: 'input',
        value: target.headline ?? '',
      }) as HTMLInputElement;
      const location = h('input', {
        type: 'text',
        'aria-label': 'Location',
        class: 'input',
        value: target.location ?? '',
      }) as HTMLInputElement;
      return {
        nodes: [name, headline, location],
        payload: () => ({
          name: name.value,
          headline: headline.value,
          location: location.value,
        }),
      };
    });
  }

  function openAboutDialog(target: Profile): void {
    sectionDialog('Edit about', 'about', target, () => {
      const about = h('textarea', {
        'aria-label': 'About',
        class: 'input',
        rows: '6',
        value: target.about ?? '',
      }) as HTMLTextAreaElement;
      return { nodes: [about], payload: () => ({ about: about.value }) };
    });
  }

  function openExperienceDialog(target: Profile): void {
    sectionDialog('Edit experience', 'experience', target, () => {
      const rows: { title: HTMLInputElement; company: HTMLInputElement; start: HTMLInputElement; end: HTMLInputElement }[] = [];
      const list = h('div', { class: 'rows' });
      const addRow = (entry?: { title: string; company: string; start: string; end: string | null }) => {
        const title = h('input', { type: 'text', 'aria-label': 'Title', class: 'input', value: entry?.title ?? '' }) as HTMLInputElement;
        const company = h('input', { type: 'text', 'aria-label': 'Company', class: 'input', value: entry?.company ?? '' }) as HTMLInputElement;
        const start = h('input', { type: 'text', 'aria-label': 'Start', class: 'input', value: entry?.start ?? '' }) as HTMLInputElement;
        const end = h('input', { type: 'text', 'aria-label': 'End', class: 'input', value: entry?.end ?? '' }) as HTMLInputElement;
        rows.push({ title, company, start, end });
        list.append(h('div', { class: 'row-group' }, [title, company, start, end]));
      };
      for (const entry of target.experience ?? []) addRow(entry);
      const add = h('button', { type: 'button', class: 'button quiet', click: () => addRow() }, [
        'Add experience',
      ]);
      return {
        nodes: [list, add],
        payload: () => ({
          experience: rows.map((row) => ({
            title: row.title.value,
            company: row.company.value,
            start: row.start.value,
            end: row.end.value === '' ? null : row.end.value,
          })),
        }),
      };
    });
  }

  function openEducationDialog(target: Profile): void {
    sectionDialog('Edit education', 'education', target, () => {
      const rows: { school: HTMLInputElement; degree: HTMLInputElement; start: HTMLInputElement; end: HTMLInputElement }[] = [];
      const list = h('div', { class: 'rows' });
      const addRow = (entry?: { school: string; degree: string; start: string; end: string | null }) => {
        const school = h('input', { type: 'text', 'aria-label': 'School', class: 'input', value: entry?.school ?? '' }) as HTMLInputElement;
        const degree = h('input', { type: 'text', 'aria-label': 'Degree', class: 'input', value: entry?.degree ?? '' }) as HTMLInputElement;
        const start = h('input', { type: 'text', 'aria-label': 'Start', class: 'input', value: entry?.start ?? '' }) as HTMLInputElement;
        const end = h('input', { type: 'text', 'aria-label': 'End', class: 'input', value: entry?.end ?? '' }) as HTMLInputElement;
        rows.push({ school, degree, start, end });
        list.append(h('div', { class: 'row-group' }, [school, degree, start, end]));
      };
      for (const entry of target.education ?? []) addRow(entry);
      const add = h('button', { type: 'button', class: 'button quiet', click: () => addRow() }, [
        'Add education',
      ]);
      return {
        nodes: [list, add],
        payload: () => ({
          education: rows.map((row) => ({
            school: row.school.value,
            degree: row.degree.value,
            start: row.start.value,
            end: row.end.value === '' ? null : row.end.value,
          })),
        }),
      };
    });
  }

  function openPhotoDialog(): void {
    dialog(
      'Change photo',
      (close) => {
        const body = h('div', { class: 'dialog-body' });
        const input = h('input', {
          type: 'file',
          'aria-label': 'Photo',
          accept: 'image/jpeg,image/png',
          class: 'input',
        }) as HTMLInputElement;
        const save = h(
          'button',
          {
            type: 'button',
            class: 'button',
            click: async () => {
              const file = input.files?.[0];
              if (!file) return;
              save.setAttribute('disabled', '');
              announce('Profile announcements', S.announce.uploading);
              const upload = await api.upload<{ photo_id: string; error?: string; limit?: number }>(
                '/api/uploads/photo',
                file,
              );
              if (!upload.ok) {
                save.removeAttribute('disabled');
                showAlert(
                  body,
                  upload.body.error === 'photo_too_large'
                    ? S.alert.photoTooLarge(upload.body.limit ?? cfg().photo_max_bytes)
                    : upload.body.error === 'photo_type'
                      ? S.alert.photoWrongType
                      : upload.body.error === 'storage_unavailable'
                        ? S.alert.storageUnreachable
                        : S.alert.somethingWrong,
                );
                return;
              }
              await api.put('/api/me/photo', { photo_id: upload.body.photo_id });
              announce('Profile announcements', S.announce.sectionSaved);
              close();
              void refresh();
            },
          },
          ['Save'],
        );
        body.append(input);
        return [h('h2', { text: 'Change photo' }), body, save];
      },
      null,
    );
  }
}

export function mutualView(handle: string): HTMLElement {
  const host = h('div', { class: 'narrow' });
  void load();
  return host;

  async function load(): Promise<void> {
    const profile = await api.get<{ name: string }>(`/api/profiles/${encodeURIComponent(handle)}`);
    const result = await api.get<{ count: number; members: PersonCard[] }>(
      `/api/profiles/${encodeURIComponent(handle)}/mutual`,
    );
    if (!result.ok || !profile.ok) {
      host.replaceChildren(
        h('div', { class: 'empty' }, [
          h('h1', { class: 'big-sentence', text: S.empty.profileUnavailable }),
          h('a', { href: '/feed', class: 'link underline' }, ['Go to Home']),
        ]),
      );
      return;
    }
    const list = h('ul', { 'aria-label': 'Mutual connections', class: 'card-list' });
    for (const card of result.body.members) {
      list.append(personCardNode(card, { reload: () => void load() }));
    }
    host.replaceChildren(
      h('h1', {
        class: 'page-title',
        text: `Mutual connections with ${profile.body.name}`,
      }),
      list,
    );
  }
}

export function settingsView(): HTMLElement {
  const host = h('div', { class: 'narrow' });
  void load();
  return host;

  async function load(): Promise<void> {
    const me = await api.get<{ visibility: string }>('/api/me');
    const blocks = await api.get<{ blocked: { id: string; name: string; handle: string }[] }>(
      '/api/blocks',
    );
    const group = h('div', {
      role: 'radiogroup',
      'aria-label': 'Profile visibility',
      class: 'panel',
    });
    const options: [string, string][] = [
      ['public', 'Public'],
      ['connections', 'Connections only'],
      ['private', 'Private'],
    ];
    for (const [value, label] of options) {
      const radio = h('input', {
        type: 'radio',
        name: 'visibility',
        'aria-label': label,
        value,
        checked: me.ok && me.body.visibility === value,
        change: async () => {
          const result = await api.patch('/api/me/settings', { visibility: value });
          if (result.ok) announce('Profile announcements', S.announce.visibilitySaved);
          else showAlert(group, S.alert.somethingWrong);
        },
      }) as HTMLInputElement;
      group.append(h('label', { class: 'field inline' }, [radio, h('span', { text: label })]));
    }

    const blockedList = h('ul', { 'aria-label': 'Blocked members', class: 'card-list' });
    const blocked = blocks.ok ? blocks.body.blocked : [];
    for (const entry of blocked) {
      blockedList.append(
        h('li', { class: 'person-card' }, [
          h('span', { class: 'person-name', text: entry.name }),
          h(
            'button',
            {
              type: 'button',
              class: 'button',
              click: async () => {
                const result = await api.del(`/api/blocks/${entry.id}`);
                if (result.ok) {
                  announce('Network announcements', S.announce.unblocked(entry.name));
                  void load();
                } else showAlert(blockedList, S.alert.somethingWrong);
              },
            },
            [`Unblock ${entry.name}`],
          ),
        ]),
      );
    }

    host.replaceChildren(
      h('h1', { class: 'page-title', text: 'Settings' }),
      group,
      h('section', { class: 'panel' }, [
        h('h2', { class: 'section-title', text: 'Blocked members' }),
        blocked.length === 0
          ? h('p', { class: 'big-sentence small', text: S.empty.blocked })
          : blockedList,
      ]),
    );
  }
}
