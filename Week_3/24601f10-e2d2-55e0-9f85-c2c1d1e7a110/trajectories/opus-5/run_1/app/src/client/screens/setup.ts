import {
  COPY,
  FIELD_MESSAGES,
  PAGE_NOTICE,
  YOUR_ACTION,
  checkinCount,
  seedRangeMessage,
} from '../../shared/copy';
import type { ApiTournament, PreviewMatch } from '../../shared/types';
import { api, ApiError } from '../api';
import { navigate, pageAlert, pageNotice, refresh, state } from '../app';
import { openDialog } from '../dialog';
import { h } from '../dom';
import { roundOnePreview } from './bracket';
import { emptyState } from './pages';

const yourAction = (text: string): void => {
  const region = document.querySelector<HTMLElement>('[data-your-action]');
  if (region !== null) region.textContent = text;
};

const zoneOffsetMs = (utcMs: number, zone: string): number => {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(new Date(utcMs));
  const value = (type: string): number => Number(parts.find((part) => part.type === type)?.value ?? '0');
  const asUtc = Date.UTC(
    value('year'),
    value('month') - 1,
    value('day'),
    value('hour') % 24,
    value('minute'),
    value('second'),
  );
  return asUtc - utcMs;
};

export const zonedTextToUtc = (text: string, zone: string): string | null => {
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(text.trim());
  if (match === null) return null;
  const [, year, month, day, hour, minute, second] = match;
  const wall = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second ?? '0'),
  );
  let instant = wall;
  for (let pass = 0; pass < 2; pass += 1) instant = wall - zoneOffsetMs(instant, zone);
  return new Date(instant).toISOString();
};

const refreshPreview = (tournament: ApiTournament): void => {
  void api.preview(tournament.id).then(({ matches }) => {
    const holder = document.querySelector<HTMLElement>('[data-preview-holder]');
    if (holder === null) return;
    holder.replaceChildren(roundOnePreview(matches as PreviewMatch[]));
  });
};

const saveOrder = async (tournament: ApiTournament, order: string[]): Promise<void> => {
  try {
    const response = await api.saveSeeding(tournament.id, order, tournament.seeding_version);
    state.entrants = response.entrants;
    state.tournament = { ...tournament, seeding_version: response.seeding_version };
  } catch (error) {
    if (error instanceof ApiError) {
      pageAlert(error.message);
      if (error.body.entrants !== undefined) state.entrants = error.body.entrants;
      const fresh = await api.tournament(tournament.id);
      state.tournament = fresh.tournament;
    }
  }
};

const moveEntrant = async (
  tournament: ApiTournament,
  entrantId: string,
  toSeed: number,
  focusKind: 'item' | 'spin',
): Promise<void> => {
  const ids = state.entrants.map((entrant) => entrant.id);
  const from = ids.indexOf(entrantId);
  if (from === -1) return;
  const target = Math.max(0, Math.min(ids.length - 1, toSeed - 1));
  ids.splice(from, 1);
  ids.splice(target, 0, entrantId);
  const name = state.entrants.find((entrant) => entrant.id === entrantId)?.name ?? '';
  await saveOrder(tournament, ids);
  refresh();
  const item = document.querySelector<HTMLElement>(`[data-entrant-id="${entrantId}"]`);
  if (focusKind === 'spin') item?.querySelector<HTMLElement>('input[type="number"]')?.focus();
  else item?.focus();
  yourAction(YOUR_ACTION.moved(name, target + 1));
  refreshPreview(tournament);
};

const seedingList = (tournament: ApiTournament): HTMLElement => {
  const list = h('ul', { role: 'list', 'aria-label': 'Seeding', class: 'plain-list seeding' });
  const total = state.entrants.length;

  state.entrants.forEach((entrant, index) => {
    const seedInput = h('input', {
      type: 'number',
      min: '1',
      max: String(total),
      'aria-label': `Seed for ${entrant.name}`,
      value: String(entrant.seed),
      class: 'seed-input',
    }) as HTMLInputElement;
    const error = h('span', { class: 'field-error' });
    const commitSeed = (): void => {
      const value = Number(seedInput.value);
      if (!Number.isInteger(value) || value < 1 || value > total) {
        error.textContent = seedRangeMessage(total);
        return;
      }
      error.textContent = '';
      if (value === entrant.seed) return;
      void moveEntrant(tournament, entrant.id, value, 'spin');
    };
    seedInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        commitSeed();
      }
    });
    seedInput.addEventListener('blur', commitSeed);

    const account = h('input', {
      type: 'text',
      'aria-label': `Account for ${entrant.name}`,
      value: entrant.username ?? '',
      class: 'account-input',
    }) as HTMLInputElement;
    account.addEventListener('change', () => {
      void api
        .linkEntrant(entrant.id, account.value.trim() === '' ? null : account.value.trim())
        .then(() => api.entrants(tournament.id))
        .then(({ entrants }) => {
          state.entrants = entrants;
          refresh();
        })
        .catch((error_: unknown) => {
          if (error_ instanceof ApiError) pageAlert(error_.body.fields?.username ?? error_.message);
        });
    });

    const remove = h('button', { type: 'button' }, `Remove ${entrant.name}`);
    remove.addEventListener('click', () => {
      void api
        .removeEntrant(entrant.id)
        .then(() => api.entrants(tournament.id))
        .then(({ entrants }) => {
          state.entrants = entrants;
          refresh();
          refreshPreview(tournament);
        })
        .catch((error_: unknown) => {
          if (error_ instanceof ApiError) pageAlert(error_.message);
        });
    });

    const item = h(
      'li',
      {
        tabindex: '0',
        draggable: 'true',
        'aria-label': `${entrant.seed}. ${entrant.name}`,
        'data-entrant-id': entrant.id,
        class: 'seeding-item',
      },
      h('span', { class: 'seed-name' }, `${entrant.seed}. ${entrant.name}`),
      seedInput,
      account,
      remove,
      error,
    );

    item.addEventListener('keydown', (event) => {
      if (!event.altKey) return;
      if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
      event.preventDefault();
      const toSeed = entrant.seed + (event.key === 'ArrowUp' ? -1 : 1);
      if (toSeed < 1 || toSeed > total) return;
      void moveEntrant(tournament, entrant.id, toSeed, 'item');
    });
    item.addEventListener('dragstart', (event) => {
      event.dataTransfer?.setData('text/plain', entrant.id);
    });
    item.addEventListener('dragover', (event) => event.preventDefault());
    item.addEventListener('drop', (event) => {
      event.preventDefault();
      const moved = event.dataTransfer?.getData('text/plain');
      if (moved === undefined || moved === '') return;
      void moveEntrant(tournament, moved, index + 1, 'item');
    });
    list.appendChild(item);
  });

  if (state.entrants.length === 0) {
    list.appendChild(h('li', { class: 'empty' }, emptyState(tournament, COPY.emptySetup)));
  }
  return list;
};

const rosterPanel = (tournament: ApiTournament): HTMLElement => {
  const errorsHolder = h('div', { 'data-roster-errors': '' });
  const upload = h('button', { type: 'button', class: 'primary' }, 'Upload roster');
  upload.addEventListener('click', () => {
    openDialog({
      title: 'Upload roster',
      opener: upload,
      build: (dialog) => {
        const input = h('input', { type: 'file', id: 'roster-file' }) as HTMLInputElement;
        const add = h('button', { type: 'button', class: 'primary' }, 'Add roster') as HTMLButtonElement;
        const cancel = h('button', { type: 'button' }, 'Cancel') as HTMLButtonElement;
        add.addEventListener('click', () => {
          const file = input.files?.[0];
          if (file === undefined) return;
          dialog.setPending(true, [add, cancel]);
          api
            .uploadRoster(tournament.id, file)
            .then(async (response) => {
              dialog.setPending(false, [add, cancel]);
              dialog.close();
              const { entrants } = await api.entrants(tournament.id);
              state.entrants = entrants;
              const fresh = await api.tournament(tournament.id);
              state.tournament = fresh.tournament;
              refresh();
              pageNotice(PAGE_NOTICE.addedEntrants(response.entrants.length, response.file_name));
              refreshPreview(tournament);
            })
            .catch((error: unknown) => {
              dialog.setPending(false, [add, cancel]);
              if (!(error instanceof ApiError)) return;
              dialog.status.textContent = error.message;
              if (error.body.error === 'roster_invalid') {
                dialog.close();
                showRosterErrors(errorsHolder, error.message, error.body.errors ?? []);
              }
            });
        });
        cancel.addEventListener('click', () => dialog.close());
        return [
          h('label', { class: 'field', for: 'roster-file' }, h('span', {}, 'Roster file'), input),
          h('div', { class: 'dialog-buttons' }, add, cancel),
        ];
      },
    });
  });

  const download = h('button', { type: 'button' }, 'Download roster file');
  download.addEventListener('click', () => {
    window.location.href = `/api/tournaments/${tournament.id}/roster`;
  });

  return h(
    'section',
    { class: 'panel' },
    h('h2', {}, 'Roster'),
    upload,
    tournament.has_roster ? download : null,
    errorsHolder,
  );
};

const showRosterErrors = (holder: HTMLElement, message: string, errors: string[]): void => {
  const heading = h('h2', { tabindex: '-1' }, message);
  holder.replaceChildren(
    heading,
    h('ul', { role: 'list', 'aria-label': 'Roster errors', class: 'plain-list' }, ...errors.map((line) => h('li', {}, line))),
  );
  heading.focus();
};

const logoPanel = (tournament: ApiTournament): HTMLElement => {
  const upload = h('button', { type: 'button', class: 'primary' }, 'Upload logo');
  upload.addEventListener('click', () => {
    openDialog({
      title: 'Upload logo',
      opener: upload,
      build: (dialog) => {
        const input = h('input', { type: 'file', id: 'logo-file', accept: 'image/png,image/jpeg' }) as HTMLInputElement;
        const add = h('button', { type: 'button', class: 'primary' }, 'Add logo') as HTMLButtonElement;
        const cancel = h('button', { type: 'button' }, 'Cancel') as HTMLButtonElement;
        add.addEventListener('click', () => {
          const file = input.files?.[0];
          if (file === undefined) return;
          dialog.setPending(true, [add, cancel]);
          api
            .uploadLogo(tournament.id, file)
            .then(async () => {
              dialog.setPending(false, [add, cancel]);
              dialog.close();
              const fresh = await api.tournament(tournament.id);
              state.tournament = fresh.tournament;
              refresh();
              pageNotice(COPY.logoUpdated);
            })
            .catch((error: unknown) => {
              dialog.setPending(false, [add, cancel]);
              if (error instanceof ApiError) {
                dialog.status.textContent = error.message;
                if (error.body.error === 'storage_unavailable') pageAlert(error.message);
              }
            });
        });
        cancel.addEventListener('click', () => dialog.close());
        return [
          h('label', { class: 'field', for: 'logo-file' }, h('span', {}, 'Logo image'), input),
          h('div', { class: 'dialog-buttons' }, add, cancel),
        ];
      },
    });
  });

  return h(
    'section',
    { class: 'panel' },
    h('h2', {}, 'Logo'),
    upload,
    tournament.logo_url === null
      ? null
      : h('img', { src: tournament.logo_url, alt: `${tournament.name} logo`, class: 'logo' }),
  );
};

export const shareControls = (tournament: ApiTournament): HTMLElement => {
  const share = h('button', { type: 'button' }, 'Share');
  share.addEventListener('click', () => {
    openDialog({
      title: 'Share tournament',
      opener: share,
      build: (dialog) => {
        const link = h('input', {
          type: 'text',
          readonly: true,
          'aria-label': 'Share link',
          value: tournament.share_url ?? '',
        }) as HTMLInputElement;
        const copy = h('button', { type: 'button', class: 'primary' }, 'Copy link');
        const replace = h('button', { type: 'button' }, 'Replace link');
        const close = h('button', { type: 'button' }, 'Cancel');
        copy.addEventListener('click', () => {
          void navigator.clipboard?.writeText(link.value).catch(() => undefined);
          pageNotice(COPY.linkCopied);
        });
        replace.addEventListener('click', () => {
          void api
            .rotateShare(tournament.id)
            .then(async (response) => {
              link.value = response.share_url;
              const fresh = await api.tournament(tournament.id);
              state.tournament = fresh.tournament;
              pageNotice(COPY.linkReplaced);
            })
            .catch((error: unknown) => {
              if (error instanceof ApiError) dialog.status.textContent = error.message;
            });
        });
        close.addEventListener('click', () => dialog.close());
        return [
          h('label', { class: 'field' }, h('span', {}, 'Share link'), link),
          h('div', { class: 'dialog-buttons' }, copy, replace, close),
        ];
      },
    });
  });
  return share;
};

const checkinPanel = (tournament: ApiTournament): HTMLElement => {
  const panel = h('section', { class: 'panel' }, h('h2', {}, 'Check-in'));
  panel.appendChild(
    h(
      'div',
      { role: 'status', 'aria-label': 'Check-in count', class: 'checkin-count' },
      checkinCount(tournament.checked_in_count, tournament.entrant_count),
    ),
  );

  if (tournament.state === 'draft') {
    const open = h('button', { type: 'button', class: 'primary' }, 'Open check-in');
    open.addEventListener('click', () => {
      openDialog({
        title: 'Open check-in',
        opener: open,
        build: (dialog) => {
          const field = h('input', { type: 'text', 'aria-label': 'Check-in closes', value: '' }) as HTMLInputElement;
          const error = h('span', { class: 'field-error', 'data-field-error': 'closes_at' });
          const start = h('button', { type: 'button', class: 'primary' }, 'Start check-in') as HTMLButtonElement;
          const cancel = h('button', { type: 'button' }, 'Cancel') as HTMLButtonElement;
          start.addEventListener('click', () => {
            const text = field.value.trim();
            let closesAt: string | null = null;
            if (text !== '') {
              closesAt = zonedTextToUtc(text, tournament.time_zone);
              if (closesAt === null) {
                error.textContent = FIELD_MESSAGES.checkinFormat;
                return;
              }
            }
            error.textContent = '';
            dialog.setPending(true, [start, cancel]);
            api
              .openCheckin(tournament.id, closesAt)
              .then((response) => {
                dialog.setPending(false, [start, cancel]);
                dialog.close();
                state.tournament = response.tournament;
                refresh();
              })
              .catch((failure: unknown) => {
                dialog.setPending(false, [start, cancel]);
                if (!(failure instanceof ApiError)) return;
                dialog.status.textContent = failure.message;
                if (failure.body.fields?.closes_at !== undefined) error.textContent = failure.body.fields.closes_at;
              });
          });
          cancel.addEventListener('click', () => dialog.close());
          return [
            h('label', { class: 'field' }, h('span', {}, 'Check-in closes'), field, error),
            h('div', { class: 'dialog-buttons' }, start, cancel),
          ];
        },
      });
    });
    panel.appendChild(open);
  }

  if (tournament.state === 'checkin_open') {
    const close = h('button', { type: 'button' }, 'Close check-in');
    close.addEventListener('click', () => {
      void api
        .closeCheckin(tournament.id)
        .then((response) => {
          state.tournament = response.tournament;
          refresh();
        })
        .catch((error: unknown) => {
          if (error instanceof ApiError) pageAlert(error.message);
        });
    });
    panel.appendChild(close);
  }

  if (tournament.state === 'checkin_open' || tournament.state === 'checkin_closed') {
    const draft = h('button', { type: 'button' }, 'Back to draft');
    draft.addEventListener('click', () => {
      void api
        .backToDraft(tournament.id)
        .then(async (response) => {
          state.tournament = response.tournament;
          const { entrants } = await api.entrants(tournament.id);
          state.entrants = entrants;
          refresh();
        })
        .catch((error: unknown) => {
          if (error instanceof ApiError) pageAlert(error.message);
        });
    });
    panel.appendChild(draft);
  }

  if (tournament.state === 'checkin_open') {
    const boxes = h('div', { class: 'checkin-boxes' });
    for (const entrant of state.entrants) {
      const box = h('input', {
        type: 'checkbox',
        'aria-label': `Checked in: ${entrant.name}`,
        checked: entrant.checked_in,
      }) as HTMLInputElement;
      box.addEventListener('change', () => {
        void api
          .setCheckedIn(entrant.id, box.checked)
          .then(async () => {
            const { entrants } = await api.entrants(tournament.id);
            state.entrants = entrants;
            refresh();
          })
          .catch((error: unknown) => {
            if (error instanceof ApiError) pageAlert(error.message);
          });
      });
      boxes.appendChild(h('label', { class: 'checkin-box' }, box, h('span', {}, entrant.name)));
    }
    panel.appendChild(boxes);
  }
  return panel;
};

const coOrganizerPanel = (tournament: ApiTournament): HTMLElement | null => {
  if (tournament.my_role !== 'organizer') return null;
  const field = h('input', { type: 'text', 'aria-label': 'Co-organizer username' }) as HTMLInputElement;
  const error = h('span', { class: 'field-error' });
  const add = h('button', { type: 'button', class: 'primary' }, 'Add co-organizer');
  add.addEventListener('click', () => {
    void api
      .addCoOrganizer(tournament.id, field.value.trim())
      .then(async () => {
        error.textContent = '';
        field.value = '';
        const fresh = await api.tournament(tournament.id);
        state.tournament = fresh.tournament;
        refresh();
      })
      .catch((failure: unknown) => {
        if (failure instanceof ApiError) error.textContent = failure.body.fields?.username ?? failure.message;
      });
  });
  const list = h('ul', { role: 'list', 'aria-label': 'Co-organizers', class: 'plain-list' });
  for (const username of tournament.co_organizers ?? []) {
    const remove = h('button', { type: 'button' }, `Remove ${username}`);
    remove.addEventListener('click', () => {
      void api
        .removeCoOrganizer(tournament.id, username)
        .then(async () => {
          const fresh = await api.tournament(tournament.id);
          state.tournament = fresh.tournament;
          refresh();
        })
        .catch(() => undefined);
    });
    list.appendChild(h('li', {}, username, remove));
  }
  return h(
    'section',
    { class: 'panel' },
    h('h2', {}, 'Co-organizers'),
    h('label', { class: 'field' }, h('span', {}, 'Co-organizer username'), field, error),
    add,
    list,
  );
};

const startPanel = (tournament: ApiTournament): HTMLElement => {
  const panel = h('section', { class: 'panel' });
  if (tournament.state !== 'running' && tournament.state !== 'finished') {
    const start = h('button', { type: 'button', class: 'primary' }, 'Start tournament');
    start.addEventListener('click', () => {
      pageNotice(COPY.savingDots);
      void api
        .start(tournament.id)
        .then(async (response) => {
          state.tournament = response.tournament;
          if (response.removed.length > 0) pageNotice(PAGE_NOTICE.removedNoShows(response.removed));
          else pageNotice('');
          navigate(`/t/${tournament.id}/bracket`);
        })
        .catch((error: unknown) => {
          pageNotice('');
          if (error instanceof ApiError) pageAlert(error.message);
        });
    });
    panel.appendChild(start);
  }
  if (tournament.my_role === 'organizer' && tournament.state !== 'running' && tournament.state !== 'finished') {
    const remove = h('button', { type: 'button' }, 'Delete tournament');
    remove.addEventListener('click', () => {
      void api
        .deleteTournament(tournament.id)
        .then(() => navigate('/t'))
        .catch((error: unknown) => {
          if (error instanceof ApiError) pageAlert(error.message);
        });
    });
    panel.appendChild(remove);
  }
  return panel;
};

const entrantPanel = (tournament: ApiTournament): HTMLElement => {
  const field = h('input', { type: 'text', 'aria-label': 'Entrant name' }) as HTMLInputElement;
  const error = h('span', { class: 'field-error' });
  const add = h('button', { type: 'button', class: 'primary' }, 'Add entrant');
  const submit = (): void => {
    void api
      .addEntrant(tournament.id, field.value.trim())
      .then(async () => {
        error.textContent = '';
        field.value = '';
        const { entrants } = await api.entrants(tournament.id);
        state.entrants = entrants;
        refresh();
        refreshPreview(tournament);
        field.focus();
      })
      .catch((failure: unknown) => {
        if (failure instanceof ApiError) error.textContent = failure.body.fields?.name ?? failure.message;
      });
  };
  add.addEventListener('click', submit);
  field.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      submit();
    }
  });
  return h(
    'section',
    { class: 'panel' },
    h('label', { class: 'field' }, h('span', {}, 'Entrant name'), field, error),
    add,
  );
};

export const setupScreen = (tournament: ApiTournament): HTMLElement => {
  const left = h(
    'div',
    { class: 'column' },
    h('h1', {}, tournament.name),
    h('section', { class: 'panel' }, h('h2', {}, 'Seeding'), seedingList(tournament)),
    entrantPanel(tournament),
  );
  const right = h(
    'div',
    { class: 'column' },
    h(
      'section',
      { role: 'region', 'aria-label': 'Bracket preview', class: 'panel' },
      h('h2', {}, 'Round 1 preview'),
      h('div', { 'data-preview-holder': '' }),
    ),
    rosterPanel(tournament),
    logoPanel(tournament),
    coOrganizerPanel(tournament),
    checkinPanel(tournament),
    startPanel(tournament),
    h('div', { class: 'panel' }, shareControls(tournament)),
    h('div', {
      role: 'status',
      'aria-live': 'polite',
      'aria-label': 'Your action',
      class: 'your-action',
      'data-your-action': '',
    }),
  );
  refreshPreview(tournament);
  return h('div', { class: `setup-page layout-${window.innerWidth < 1200 ? 'narrow' : 'wide'}` }, left, right);
};
