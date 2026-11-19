import { api, ApiCallError, type RecipeSummary } from '../api.js';
import { clear, h, icon } from '../dom.js';
import type { Screen, Shell } from '../main.js';

/** The Library at /library: own and team recipes, with Meilisearch-backed search. */
export function renderLibrary(host: HTMLElement, shell: Shell): Screen {
  const searchField = h('input', {
    type: 'search',
    class: 'finder',
    'aria-label': 'Search recipes',
    placeholder: 'Search recipes',
    autocomplete: 'off',
  });
  const list = h('div', { class: 'row-list', role: 'list', 'aria-label': 'Recipes' });
  const status = h('div', {
    class: 'status-strip',
    role: 'status',
    'aria-live': 'off',
    'aria-label': 'Library status',
  });
  const searchAlert = h('div', { class: 'pane-alert', role: 'alert', hidden: true });
  const body = h('div', { class: 'pane-body' }, [searchAlert, list]);
  const pane = h('section', { class: 'pane single-pane', role: 'region', 'aria-label': 'Library', tabindex: '-1' }, [
    h('div', { class: 'pane-title' }, [h('h1', { class: 'pane-title-text library-heading', text: 'Library' })]),
    h('div', { class: 'finder-wrap' }, [icon('search'), searchField]),
    body,
    status,
  ]);
  host.append(pane);

  let recipes: RecipeSummary[] = [];
  let searchFailed = false;
  let lastQuery = '';

  const rowFor = (recipe: RecipeSummary): HTMLElement => {
    const link = h('a', { class: 'row-link', href: `/w?recipe=${recipe.id}`, text: recipe.name });
    link.addEventListener('click', (event) => {
      if (event.metaKey || event.ctrlKey) return;
      event.preventDefault();
      shell.navigate(`/w?recipe=${recipe.id}`);
    });
    const historyLink = h('a', { class: 'row-meta-link', href: `/library/${recipe.id}`, text: 'History' });
    historyLink.addEventListener('click', (event) => {
      if (event.metaKey || event.ctrlKey) return;
      event.preventDefault();
      shell.navigate(`/library/${recipe.id}`);
    });
    return h('div', { class: 'list-row', role: 'listitem', 'aria-label': recipe.name }, [
      link,
      h('span', { class: 'row-meta', text: recipe.owner.type === 'user' ? 'Personal' : recipe.owner.name }),
      h('span', { class: 'row-meta', text: `version ${recipe.latestVersion}` }),
      h('span', { class: 'row-tags', text: recipe.tags.join(', ') }),
      historyLink,
    ]);
  };

  function render(): void {
    clear(list);
    if (recipes.length === 0) {
      const query = lastQuery.trim();
      const message =
        query === '' || searchFailed
          ? 'No recipes yet. Save one from the workbench.'
          : `No recipes match ${query}.`;
      list.append(h('p', { class: 'muted-note', text: message }));
    } else {
      for (const recipe of recipes) list.append(rowFor(recipe));
    }
    const count = recipes.length;
    const filtered = lastQuery.trim() !== '' && !searchFailed;
    status.textContent = filtered
      ? `${count} ${count === 1 ? 'result' : 'results'}`
      : `${count} ${count === 1 ? 'recipe' : 'recipes'}`;
  }

  async function loadAll(): Promise<void> {
    const all = await api.recipes();
    recipes = all.recipes;
    render();
  }

  async function runSearch(query: string): Promise<void> {
    lastQuery = query;
    if (query.trim() === '') {
      searchFailed = false;
      searchAlert.hidden = true;
      await loadAll();
      return;
    }
    try {
      const found = await api.search(query);
      searchFailed = false;
      searchAlert.hidden = true;
      recipes = found.results;
      render();
    } catch (cause) {
      if (!(cause instanceof ApiCallError)) throw cause;
      searchFailed = true;
      searchAlert.textContent = cause.failure.message;
      searchAlert.hidden = false;
      await loadAll();
    }
  }

  let debounce: number | null = null;
  searchField.addEventListener('input', () => {
    if (debounce !== null) window.clearTimeout(debounce);
    debounce = window.setTimeout(() => {
      debounce = null;
      void runSearch(searchField.value);
    }, 150);
  });

  if (shell.session === null) {
    clear(body);
    body.append(h('p', { class: 'muted-note', text: 'Sign in to see your library.' }));
    status.textContent = '0 recipes';
  } else {
    void loadAll();
  }

  return {
    onLiveEvent(event) {
      if (event.type !== 'version_saved') return;
      const found = recipes.find((recipe) => recipe.id === event.recipeId);
      if (found === undefined) {
        void runSearch(lastQuery);
        return;
      }
      found.latestVersion = event.version;
      found.name = event.name;
      render();
    },
    onReconnect() {
      void runSearch(lastQuery);
    },
  };
}
