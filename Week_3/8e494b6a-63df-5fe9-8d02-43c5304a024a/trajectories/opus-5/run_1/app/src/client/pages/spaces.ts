import { clear, el } from '../dom.js';
import { announce, ApiFailure, get, state, write } from '../state.js';
import { loadFailed, openDialog, showFormError } from '../widgets.js';

type SpaceRow = { slug: string; name: string; role: string };

type SavedSearch = { id: string; name: string; stream: string; needs_attention: boolean };

export async function renderSpaces(main: HTMLElement): Promise<void> {
  let data: { spaces: SpaceRow[]; members: { username: string; role: string }[] };
  let searches: { saved_searches: SavedSearch[] };
  try {
    data = await get<{ spaces: SpaceRow[]; members: { username: string; role: string }[] }>('/api/spaces');
    searches = await get<{ saved_searches: SavedSearch[] }>('/api/saved-searches');
  } catch {
    main.append(loadFailed(() => void renderSpaces(main)));
    return;
  }
  const copied = el('div', { role: 'status', 'aria-label': 'Copied', class: 'notice-line' });

  const newSpace = el('button', {
    type: 'button',
    'aria-label': 'New space',
    text: 'New space',
    class: 'primary',
  });
  newSpace.addEventListener('click', () => {
    openDialog({
      label: 'New space',
      opener: newSpace,
      content: (dialog) => {
        const name = el('input', { type: 'text', 'aria-label': 'Space name', 'data-field': 'name' });
        const slug = el('input', { type: 'text', 'aria-label': 'Space slug', 'data-field': 'slug' });
        const create = el('button', {
          type: 'button',
          'aria-label': 'Create space',
          text: 'Create space',
          class: 'primary',
        });
        const host = el('div', {});
        create.addEventListener('click', () => {
          void (async () => {
            try {
              await write('POST', '/api/spaces', { slug: slug.value, name: name.value });
              dialog.close();
              announce(`Space ${name.value} created.`);
              clear(main);
              await renderSpaces(main);
            } catch (cause) {
              if (cause instanceof ApiFailure) showFormError(host, cause);
            }
          })();
        });
        return [el('h2', { text: 'New space' }), host, name, slug, create];
      },
    });
  });

  const addMember = el('button', { type: 'button', 'aria-label': 'Add member', text: 'Add member' });
  addMember.addEventListener('click', () => {
    openDialog({
      label: 'Add member',
      opener: addMember,
      content: (dialog) => {
        const username = el('input', {
          type: 'text',
          'aria-label': 'Member username',
          'data-field': 'username',
        });
        const role = el(
          'select',
          { 'aria-label': 'Role' },
          ['viewer', 'editor', 'admin'].map((option) => el('option', { value: option, text: option })),
        );
        const add = el('button', { type: 'button', 'aria-label': 'Add', text: 'Add', class: 'primary' });
        const host = el('div', {});
        add.addEventListener('click', () => {
          void (async () => {
            try {
              await write('POST', `/api/spaces/${state.me?.space.slug ?? ''}/members`, {
                username: username.value,
                role: role.value,
              });
              dialog.close();
              announce(`${username.value} added as ${role.value}.`);
              clear(main);
              await renderSpaces(main);
            } catch (cause) {
              if (cause instanceof ApiFailure) showFormError(host, cause);
            }
          })();
        });
        return [el('h2', { text: 'Add member' }), host, username, role, add];
      },
    });
  });

  const searchList = el('ul', { role: 'list', 'aria-label': 'Saved searches', class: 'saved-searches' });
  for (const search of searches.saved_searches) {
    const copy = el('button', { type: 'button', 'aria-label': 'Copy to space', text: 'Copy to space' });
    copy.addEventListener('click', () => {
      openDialog({
        label: 'Copy to space',
        opener: copy,
        content: (dialog) => {
          const target = el(
            'select',
            { 'aria-label': 'Target space' },
            (state.me?.spaces ?? [])
              .filter((space) => space.slug !== state.me?.space.slug)
              .map((space) => el('option', { value: space.slug, text: space.name })),
          );
          const run = el('button', { type: 'button', 'aria-label': 'Copy', text: 'Copy', class: 'primary' });
          const host = el('div', {});
          run.addEventListener('click', () => {
            run.setAttribute('aria-busy', 'true');
            void (async () => {
              try {
                const result = await write<{ message: string }>(
                  'POST',
                  `/api/saved-searches/${search.id}/copy`,
                  { space: target.value },
                );
                dialog.close();
                copied.textContent = result.message;
                announce(result.message);
              } catch (cause) {
                if (cause instanceof ApiFailure) showFormError(host, cause);
              } finally {
                run.removeAttribute('aria-busy');
              }
            })();
          });
          return [el('h2', { text: 'Copy to space' }), host, target, run];
        },
      });
    });
    const openSearch = el('a', {
      href: `/explore?saved=${encodeURIComponent(search.id)}`,
      text: search.name,
      'aria-label': search.name,
    });
    const item = el('li', {}, [openSearch, copy]);
    if (search.needs_attention) item.append(el('span', { class: 'attention', text: 'Needs attention' }));
    searchList.append(item);
  }

  main.append(
    el('h1', { class: 'view-title', text: 'Spaces' }),
    newSpace,
    el('table', { 'aria-label': 'Spaces', class: 'data-table' }, [
      el('thead', {}, [
        el('tr', {}, [
          el('th', { scope: 'col', text: 'Space' }),
          el('th', { scope: 'col', text: 'Slug' }),
          el('th', { scope: 'col', text: 'Role' }),
        ]),
      ]),
      el(
        'tbody',
        {},
        data.spaces.map((space) =>
          el('tr', {}, [
            el('td', { text: space.name }),
            el('td', { class: 'mono', text: space.slug }),
            el('td', { class: 'mono', text: space.role }),
          ]),
        ),
      ),
    ]),
    addMember,
    el('table', { 'aria-label': 'Members', class: 'data-table' }, [
      el('thead', {}, [
        el('tr', {}, [
          el('th', { scope: 'col', text: 'Member' }),
          el('th', { scope: 'col', text: 'Role' }),
        ]),
      ]),
      el(
        'tbody',
        {},
        data.members.map((member) =>
          el('tr', {}, [
            el('td', { class: 'mono', text: member.username }),
            el('td', { class: 'mono', text: member.role }),
          ]),
        ),
      ),
    ]),
    searchList,
    copied,
  );
}
