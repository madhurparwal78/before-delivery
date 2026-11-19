import { api, ApiCallError, type RecipeSummary, type VersionBody } from '../api.js';
import { formatStamp } from '../../shared/format.js';
import { announceInto, clear, h } from '../dom.js';
import { dialogActions, openModal, plainButton, primaryButton } from '../dialogs.js';
import type { Screen, Shell } from '../main.js';

type VersionRow = Omit<VersionBody, 'steps'>;

/** Recipe history at /library/<recipeId>: versions, compare and restore. */
export function renderHistory(host: HTMLElement, shell: Shell, recipeId: string): Screen {
  const heading = h('h1', { class: 'pane-title-text history-heading' });
  const compareButton = plainButton('Compare versions', () => openCompare());
  const list = h('div', { class: 'row-list', role: 'list', 'aria-label': 'Versions' });
  const announcements = h('div', {
    class: 'status-strip',
    role: 'status',
    'aria-live': 'polite',
    'aria-label': 'Library announcements',
  });
  const body = h('div', { class: 'pane-body' }, [list]);
  const pane = h('section', { class: 'pane single-pane' }, [
    h('div', { class: 'pane-title' }, [heading, h('div', { class: 'pane-title-actions' }, [compareButton])]),
    body,
    announcements,
  ]);
  host.append(pane);

  let summary: RecipeSummary | null = null;
  let versions: VersionRow[] = [];

  function render(): void {
    heading.textContent = summary?.name ?? '';
    clear(list);
    if (versions.length === 0) {
      list.append(h('p', { class: 'muted-note', text: 'No versions yet.' }));
      return;
    }
    const newest = versions[0]!.n;
    for (const version of versions) {
      const open = plainButton(`Open version ${version.n}`, () => {
        shell.navigate(`/w?recipe=${recipeId}&version=${version.n}`);
      });
      const row = h('div', { class: 'list-row', role: 'listitem', 'aria-label': `Version ${version.n}` }, [
        h('span', { class: 'row-link', text: `Version ${version.n}` }),
        h('span', { class: 'row-meta', text: version.note }),
        h('span', { class: 'row-meta', text: version.author.displayName }),
        h('span', { class: 'row-meta', text: formatStamp(version.createdAt) }),
        open,
      ]);
      if (version.n !== newest) {
        row.append(plainButton(`Restore version ${version.n}`, () => openRestore(version.n)));
      }
      list.append(row);
    }
  }

  async function load(): Promise<void> {
    try {
      const head = await api.recipe(recipeId);
      summary = head.recipe;
      versions = head.versions;
      render();
    } catch (cause) {
      if (!(cause instanceof ApiCallError)) throw cause;
      clear(body);
      body.append(h('p', { class: 'muted-note', text: cause.failure.message }));
    }
  }

  function openCompare(): void {
    const modal = openModal({ title: 'Compare versions', opener: compareButton });
    const numbers = versions.map((version) => version.n);
    const fromSelect = h('select', { class: 'select', 'aria-label': 'From version' });
    const toSelect = h('select', { class: 'select', 'aria-label': 'To version' });
    for (const number of numbers) {
      fromSelect.append(h('option', { value: String(number), text: `Version ${number}` }));
      toSelect.append(h('option', { value: String(number), text: `Version ${number}` }));
    }
    fromSelect.value = String(numbers[1] ?? numbers[0] ?? 1);
    toSelect.value = String(numbers[0] ?? 1);
    const changes = h('div', { class: 'row-list changes', role: 'list', 'aria-label': 'Changes' });
    const refresh = async (): Promise<void> => {
      clear(changes);
      try {
        const compared = await api.compare(recipeId, Number(fromSelect.value), Number(toSelect.value));
        if (compared.changes.length === 0) {
          changes.append(h('p', { class: 'muted-note', text: 'These versions have the same steps.' }));
          return;
        }
        for (const line of compared.changes) {
          changes.append(h('div', { class: 'change-line mono', role: 'listitem', text: line }));
        }
      } catch (cause) {
        if (!(cause instanceof ApiCallError)) throw cause;
        changes.append(h('p', { class: 'muted-note', text: cause.failure.message }));
      }
    };
    fromSelect.addEventListener('change', () => void refresh());
    toSelect.addEventListener('change', () => void refresh());
    modal.body.append(
      h('div', { class: 'field-rows' }, [
        h('div', { class: 'field-row' }, [h('span', { class: 'field-label', text: 'From version' }), fromSelect]),
        h('div', { class: 'field-row' }, [h('span', { class: 'field-label', text: 'To version' }), toSelect]),
      ]),
      changes,
      dialogActions([plainButton('Close', () => modal.close())]),
    );
    fromSelect.focus();
    void refresh();
  }

  function openRestore(version: number): void {
    const modal = openModal({ title: 'Restore version' });
    const restore = primaryButton('Restore', () => {
      void (async () => {
        try {
          const done = await api.restoreVersion(recipeId, {
            version,
            baseVersion: summary?.latestVersion ?? 0,
          });
          modal.close();
          announceInto(announcements, `Restored version ${version} as version ${done.version.n}`);
          await load();
        } catch (cause) {
          if (!(cause instanceof ApiCallError)) throw cause;
          announceInto(announcements, cause.failure.message);
          modal.close();
        }
      })();
    });
    modal.body.append(
      h('p', { class: 'dialog-text', text: `Restore version ${version} as a new version?` }),
      dialogActions([restore, plainButton('Cancel', () => modal.close())]),
    );
    restore.focus();
  }

  void load();

  return {
    onLiveEvent(event) {
      if (event.type === 'version_saved' && event.recipeId === recipeId) void load();
    },
    onReconnect() {
      void load();
    },
  };
}
