import { historyRowText } from '../../shared/cards';
import { COPY } from '../../shared/copy';
import { FORMATS, FORMAT_NAMES, type ApiTournament, type Format } from '../../shared/types';
import { api, ApiError } from '../api';
import { navigate, pageAlert, state } from '../app';
import { cardElement, viewerOf } from '../card';
import { h, prefersReducedMotion, svg } from '../dom';
import { FORMAT_OBJECTS } from '../objects';
import { bracketScreen, fieldList } from './bracket';

let landingFormat: Format = 'single_elimination';

export const landingScreen = (): HTMLElement => {
  const tile = h('div', { class: `hero-tile fill-${FORMAT_OBJECTS[landingFormat].fill}` });
  const renderObject = (): void => {
    const object = FORMAT_OBJECTS[landingFormat];
    tile.className = `hero-tile fill-${object.fill}`;
    tile.replaceChildren(
      svg(object.markup, object.label, { class: 'hero-object' }),
      h('span', { class: 'slats hero-slats', 'aria-hidden': 'true' }),
    );
  };
  renderObject();

  const fact = h('p', { class: 'fact' }, FORMAT_OBJECTS[landingFormat].fact);
  const tablist = h('div', { role: 'tablist', 'aria-label': 'Formats', class: 'format-tabs' });
  const panel = h('div', { role: 'tabpanel', 'aria-label': FORMAT_NAMES[landingFormat], class: 'format-panel' }, tile);

  const paint = (): void => {
    for (const [index, format] of FORMATS.entries()) {
      const tab = tablist.children[index] as HTMLElement | undefined;
      if (tab === undefined) continue;
      tab.setAttribute('aria-selected', format === landingFormat ? 'true' : 'false');
      tab.setAttribute('tabindex', format === landingFormat ? '0' : '-1');
      tab.className = `format-tab step-${Math.abs(FORMATS.indexOf(landingFormat) - index)}`;
    }
    panel.setAttribute('aria-label', FORMAT_NAMES[landingFormat]);
    fact.textContent = FORMAT_OBJECTS[landingFormat].fact;
  };

  for (const format of FORMATS) {
    const tab = h('button', { type: 'button', role: 'tab', class: 'format-tab' }, FORMAT_NAMES[format]);
    tab.addEventListener('click', () => {
      if (format === landingFormat) return;
      landingFormat = format;
      if (prefersReducedMotion()) {
        renderObject();
        paint();
        return;
      }
      tile.classList.add('swapping');
      window.setTimeout(() => {
        renderObject();
        paint();
        tile.classList.add('swapping');
        window.setTimeout(() => tile.classList.remove('swapping'), 170);
      }, 170);
    });
    tablist.appendChild(tab);
  }
  paint();

  const links = h(
    'div',
    { class: 'hero-links' },
    state.user === null
      ? [
          h('a', { href: '/signin', class: 'link' }, 'Sign in'),
          h('a', { href: '/signup', class: 'link' }, 'Create account'),
        ]
      : h('a', { href: '/t', class: 'link' }, 'Your tournaments'),
  );

  return h(
    'div',
    { class: 'landing' },
    h(
      'header',
      { class: 'landing-top' },
      h('h1', { class: 'wordmark' }, 'Cupfold'),
      h('p', { class: 'description' }, 'A bracket desk for the one volunteer who runs the cup.'),
    ),
    h('div', { class: 'landing-middle' }, tablist, panel),
    h('div', { class: 'landing-bottom' }, fact, h('a', { href: '/t/new', class: 'cta' }, 'Start a tournament'), links),
  );
};

const authScreen = (mode: 'signup' | 'signin'): HTMLElement => {
  const username = h('input', { type: 'text', 'aria-label': 'Username', id: 'username' }) as HTMLInputElement;
  const password = h('input', { type: 'password', id: 'password' }) as HTMLInputElement;
  const usernameError = h('span', { class: 'field-error' });
  const passwordError = h('span', { class: 'field-error' });
  const submit = h(
    'button',
    { type: 'submit', class: 'primary' },
    mode === 'signup' ? 'Create account' : 'Sign in',
  ) as HTMLButtonElement;

  const form = h(
    'form',
    { class: 'form card-surface' },
    h('h1', {}, mode === 'signup' ? 'Create account' : 'Sign in'),
    h('label', { class: 'field', for: 'username' }, h('span', {}, 'Username'), username, usernameError),
    h('label', { class: 'field', for: 'password' }, h('span', {}, 'Password'), password, passwordError),
    submit,
  );

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    usernameError.textContent = '';
    passwordError.textContent = '';
    submit.disabled = true;
    const next = state.route.query.get('next') ?? '/t';
    const action = mode === 'signup' ? api.signUp : api.signIn;
    void action(username.value.trim(), password.value)
      .then((response) => {
        state.user = response.user;
        navigate(next);
      })
      .catch((error: unknown) => {
        submit.disabled = false;
        if (!(error instanceof ApiError)) return;
        if (error.body.fields?.username !== undefined) usernameError.textContent = error.body.fields.username;
        if (error.body.fields?.password !== undefined) passwordError.textContent = error.body.fields.password;
        if (error.body.fields === undefined) pageAlert(error.message);
      });
  });
  return form;
};

export const signUpScreen = (): HTMLElement => authScreen('signup');
export const signInScreen = (): HTMLElement => authScreen('signin');

export const tournamentsScreen = (tournaments: ApiTournament[]): HTMLElement =>
  h(
    'div',
    { class: 'page' },
    h('h1', {}, 'Your tournaments'),
    h('a', { href: '/t/new', class: 'cta' }, 'New tournament'),
    tournaments.length === 0
      ? h('p', {}, COPY.emptyTournaments)
      : h(
          'ul',
          { role: 'list', 'aria-label': 'Your tournaments', class: 'plain-list' },
          ...tournaments.map((tournament) =>
            h('li', {}, h('a', { href: `/t/${tournament.id}`, class: 'link' }, tournament.name)),
          ),
        ),
  );

const timeZones = (): string[] => {
  const supported = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf;
  const zones = supported === undefined ? [] : supported('timeZone');
  return ['UTC', ...zones.filter((zone) => zone !== 'UTC')];
};

export const createScreen = (): HTMLElement => {
  const name = h('input', { type: 'text', 'aria-label': 'Tournament name', id: 'tname' }) as HTMLInputElement;
  const nameError = h('span', { class: 'field-error' });
  const formatGroup = h('div', { role: 'radiogroup', 'aria-label': 'Format', class: 'radios' });
  let chosenFormat: Format = 'single_elimination';
  for (const format of FORMATS) {
    const id = `format-${format}`;
    const radio = h('input', {
      type: 'radio',
      name: 'format',
      id,
      checked: format === chosenFormat,
    }) as HTMLInputElement;
    radio.addEventListener('change', () => {
      chosenFormat = format;
    });
    formatGroup.appendChild(h('label', { class: 'radio', for: id }, radio, h('span', {}, FORMAT_NAMES[format])));
  }

  const zone = h('select', { 'aria-label': 'Time zone', id: 'zone' }) as HTMLSelectElement;
  for (const value of timeZones()) {
    zone.appendChild(h('option', { value }, value));
  }
  zone.value = 'UTC';

  const fillGroup = h('div', { role: 'radiogroup', 'aria-label': 'Trophy fill', class: 'radios' });
  let chosenFill = 'lilac';
  for (const fill of ['Lilac', 'Lemon', 'Mint']) {
    const id = `fill-${fill}`;
    const radio = h('input', {
      type: 'radio',
      name: 'fill',
      id,
      checked: fill.toLowerCase() === chosenFill,
    }) as HTMLInputElement;
    radio.addEventListener('change', () => {
      chosenFill = fill.toLowerCase();
    });
    fillGroup.appendChild(h('label', { class: 'radio', for: id }, radio, h('span', {}, fill)));
  }

  const submit = h('button', { type: 'submit', class: 'primary' }, 'Create tournament') as HTMLButtonElement;
  const form = h(
    'form',
    { class: 'form card-surface' },
    h('h1', {}, 'New tournament'),
    h('label', { class: 'field', for: 'tname' }, h('span', {}, 'Tournament name'), name, nameError),
    formatGroup,
    h('label', { class: 'field', for: 'zone' }, h('span', {}, 'Time zone'), zone),
    fillGroup,
    submit,
  );
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    nameError.textContent = '';
    submit.disabled = true;
    void api
      .createTournament({ name: name.value.trim(), format: chosenFormat, time_zone: zone.value, fill: chosenFill })
      .then((response) => {
        state.tournament = response.tournament;
        navigate(`/t/${response.tournament.id}/setup`);
      })
      .catch((error: unknown) => {
        submit.disabled = false;
        if (!(error instanceof ApiError)) return;
        nameError.textContent = error.body.fields?.name ?? '';
        if (error.body.fields === undefined) pageAlert(error.message);
      });
  });
  return form;
};

/** Empty states show the format's object small in a corner with one sentence. */
export const emptyState = (tournament: ApiTournament, sentence: string): HTMLElement =>
  h(
    'div',
    { class: 'empty-state' },
    h('p', {}, sentence),
    svg(FORMAT_OBJECTS[tournament.format].markup, FORMAT_OBJECTS[tournament.format].label, { class: 'empty-object' }),
  );

export const disputesScreen = (tournament: ApiTournament): HTMLElement => {
  const list = h('ul', { role: 'list', 'aria-label': 'Open disputes', class: 'plain-list' });
  const disputed = state.matches.filter((match) => match.state === 'disputed');
  for (const match of disputed) {
    const button = h('button', { type: 'button' }, `Resolve ${match.label}`);
    button.addEventListener('click', () => {
      void import('../card').then(({ openCardDialog }) => openCardDialog(match.id, button));
    });
    list.appendChild(h('li', {}, match.label, button));
  }
  return h(
    'div',
    { class: 'page' },
    h('h1', {}, tournament.name),
    disputed.length === 0 ? emptyState(tournament, COPY.emptyDisputes) : list,
    h('div', {
      role: 'status',
      'aria-live': 'polite',
      'aria-label': 'Your action',
      class: 'your-action',
      'data-your-action': '',
    }),
  );
};

export const meScreen = (tournament: ApiTournament): HTMLElement => {
  const region = h('section', { role: 'region', 'aria-label': 'Next match', class: 'next-match' });
  const next = state.nextMatch;
  if (next !== null) {
    region.appendChild(cardElement(next, viewerOf()));
  } else if (tournament.state === 'running' || tournament.state === 'finished') {
    region.appendChild(emptyState(tournament, COPY.noMoreMatches));
  } else {
    region.appendChild(emptyState(tournament, COPY.checkedInBeforeStart));
  }
  return h(
    'div',
    { class: 'page me-page' },
    h('h1', {}, tournament.name),
    region,
    h(
      'div',
      {
        role: 'status',
        'aria-live': 'polite',
        'aria-label': 'Bracket announcements',
        class: 'announcements',
      },
      state.announcement,
    ),
    h('div', {
      role: 'status',
      'aria-live': 'polite',
      'aria-label': 'Your action',
      class: 'your-action',
      'data-your-action': '',
    }),
  );
};

export const shareScreen = (tournament: ApiTournament): HTMLElement => {
  const hero = h(
    'div',
    { class: `share-hero fill-${tournament.fill}` },
    h('div', { class: 'share-field' }, fieldList()),
    h(
      'div',
      { class: 'share-trophy-column' },
      svg(FORMAT_OBJECTS[tournament.format].markup, `${tournament.name} trophy`, { class: 'share-trophy' }),
      h(
        'div',
        { class: 'share-name' },
        h('h1', {}, tournament.name),
        tournament.logo_url === null
          ? null
          : h('img', {
              src: `/api/share/${state.shareCode ?? ''}/logo`,
              alt: `${tournament.name} logo`,
              class: 'logo',
            }),
        h('p', {}, `${state.publicEntrants.length} entrants`),
      ),
    ),
  );
  return h('div', { class: 'share-page' }, hero, bracketScreen(tournament, true));
};

export const historyScreen = (username: string): HTMLElement => {
  const page = h('div', { class: 'page' }, h('h1', {}, username));
  const list = h('ul', { role: 'list', 'aria-label': 'Tournament history', class: 'plain-list' });
  page.appendChild(list);
  void api
    .history(username)
    .then(({ rows }) => {
      if (rows.length === 0) {
        list.replaceWith(h('p', {}, COPY.emptyHistory));
        return;
      }
      list.replaceChildren(
        ...rows.map((row) =>
          h('li', {}, row.text || historyRowText(row.tournament_name, row.place, row.field_size, row.finished_on)),
        ),
      );
    })
    .catch(() => {
      list.replaceWith(h('p', {}, COPY.pageNotFound));
    });
  return page;
};

export const notFoundScreen = (text: string = COPY.pageNotFound): HTMLElement =>
  h('div', { class: 'page' }, h('p', {}, text));
