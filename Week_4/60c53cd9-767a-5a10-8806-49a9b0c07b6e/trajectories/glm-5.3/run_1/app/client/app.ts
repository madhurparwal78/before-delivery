// The client entrypoint: routes, shared header, dialogs, notices, and the
// landing, finder, hold, shared and console screens.
import { api, ApiError, salesOfficeTime, countdownClock, priceText,
  STATUS_LABELS, BAND_LABELS, VIEW_LABELS, chipLabel, cellName, basicCellName,
  serverNow, type PublicUnit } from './shared.js';
import { FinderStore, emptyFilters, type Hold, type TowerCell } from './store.js';
import { TowerView } from './tower.js';

const SALES_TZ = (document.documentElement.dataset.salesTz as string) || 'Australia/Sydney';
const STACKS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
const FACET_FIELDS = ['bedrooms', 'band', 'facing', 'view', 'status'];
const FACET_VALUES: Record<string, string[]> = {
  bedrooms: ['1', '2', '3'],
  band: ['03-09', '10-19', '20-29', '30-35', '36-38'],
  facing: ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'],
  view: ['harbour', 'harbour-partial', 'park', 'city', 'ridge'],
  status: ['available', 'held', 'reserved'],
};
const LIMITS = { q: 80, facet: 6 };

const app = document.getElementById('app')!;
const modalRoot = document.getElementById('modal-root')!;
const notices = document.getElementById('notices')!;
const store = new FinderStore();

interface Screen {
  render: () => void;
  teardown?: () => void;
}


let currentScreen: Screen | null = null;
let lastRenderedScreen: Screen | null = null;

// ---------- tiny dom helpers ----------

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function announce(message: string): void {
  notices.textContent = message;
}

function renderHeader(): void {
  const signIn = document.getElementById('signin-button') as HTMLButtonElement;
  const signOut = document.getElementById('signout-button') as HTMLButtonElement;
  const holdLink = document.getElementById('my-hold-link') as HTMLAnchorElement;
  const active = store.activeHold();
  holdLink.hidden = !(active && location.pathname !== '/shared');
  if (active) holdLink.setAttribute('href', `/holds/${active.id}`);
  signIn.hidden = store.account !== null;
  signOut.hidden = store.account === null;
}

store.subscribe(() => {
  renderHeader();
  if (currentScreen && currentScreen !== lastRenderedScreen) {
    lastRenderedScreen = currentScreen;
    currentScreen.render();
  }
});

// ---------- routing ----------

function route(): void {
  currentScreen?.teardown?.();
  modalRoot.textContent = '';
  const path = location.pathname;
  if (path === '/' ) currentScreen = landingScreen();
  else if (path === '/finder') currentScreen = finderScreen();
  else if (path.startsWith('/holds/')) currentScreen = holdScreen(path);
  else if (path.startsWith('/console')) currentScreen = consoleScreen();
  else currentScreen = landingScreen();
  currentScreen.render();
}

document.getElementById('signin-button')!.addEventListener('click', () => {
  openSignInDialog(false);
});
document.getElementById('signout-button')!.addEventListener('click', async () => {
  await fetch('/api/session', { method: 'DELETE' });
  store.account = null;
  store.holds = [];
  announce('Signed out.');
  if (location.pathname.startsWith('/holds/') || location.pathname.startsWith('/console')) {
    history.pushState({}, '', '/finder');
  }
  route();
});
document.getElementById('my-hold-link')!.addEventListener('click', (event) => {
  // Default navigation is fine; the link target is the hold page.
  void event;
});

window.addEventListener('popstate', () => {
  store.loadFromQuery(location.search);
  route();
});

// ---------- dialogs ----------

interface DialogHandle {
  close: (returnFocus?: HTMLElement | null) => void;
  root: HTMLElement;
}

function trapFocus(container: HTMLElement, onEscape: () => void): void {
  container.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onEscape();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusables = Array.from(container.querySelectorAll<HTMLElement>('button, input, [href], [tabindex]:not([tabindex="-1"])')).filter((node) => !node.hasAttribute('disabled'));
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });
}

function openSignInDialog(fromHold: boolean): DialogHandle {
  const backdrop = el('div', 'dialog-backdrop');
  const dialog = el('div', 'signin-dialog');
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-label', fromHold ? 'Sign in to hold' : 'Sign in');
  backdrop.appendChild(dialog);
  modalRoot.appendChild(backdrop);

  let mode: 'signin' | 'create' = 'signin';
  const render = (): void => {
    dialog.textContent = '';
    const heading = el('h2', undefined, mode === 'signin' ? (fromHold ? 'Sign in to hold' : 'Sign in') : 'Create an account');
    dialog.appendChild(heading);
    const form = el('form') as HTMLFormElement;
    dialog.appendChild(form);
    const addField = (label: string, type: string, name: string, value = ''): HTMLInputElement => {
      const wrap = el('div', 'field');
      const labelEl = el('label', undefined, label);
      labelEl.setAttribute('for', `signin-${name}`);
      const input = el('input') as HTMLInputElement;
      input.type = type;
      input.id = `signin-${name}`;
      input.name = name;
      input.value = value;
      input.required = mode === 'create' || name !== 'email';
      labelEl.appendChild(input);
      wrap.appendChild(labelEl);
      const error = el('div', 'field-error');
      error.hidden = true;
      wrap.appendChild(error);
      form.appendChild(wrap);
      return input;
    };
    const nameField = mode === 'create' ? addField('Name', 'text', 'name') : null;
    const emailField = addField('Email', 'email', 'email');
    const passwordField = addField('Password', 'password', 'password');
    const message = el('div', 'field-error');
    form.appendChild(message);
    const actions = el('div', 'confirm-actions');
    const submit = el('button', 'btn accent', mode === 'signin' ? 'Sign in' : 'Create account');
    submit.type = 'submit';
    actions.appendChild(submit);
    const switcher = el('button', 'btn ghost', mode === 'signin' ? 'Create an account' : 'I have an account');
    switcher.type = 'button';
    switcher.addEventListener('click', () => {
      const email = emailField.value;
      mode = mode === 'signin' ? 'create' : 'signin';
      render();
      const emailNow = dialog.querySelector<HTMLInputElement>('#signin-email');
      if (emailNow) {
        emailNow.value = email;
        if (mode === 'signin') emailNow.focus();
      }
    });
    actions.appendChild(switcher);
    form.appendChild(actions);

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      message.textContent = '';
      if (mode === 'create') {
        submit.textContent = 'Creating...';
        submit.disabled = true;
        try {
          const reply = await api<{ message: string }>('/api/accounts', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ name: nameField?.value, email: emailField.value, password: passwordField.value }),
          });
          message.textContent = reply.message;
          mode = 'signin';
          render();
          const emailNow = dialog.querySelector<HTMLInputElement>('#signin-email');
          const passNow = dialog.querySelector<HTMLInputElement>('#signin-password');
          if (emailNow) emailNow.value = emailField.value;
          passNow?.focus();
        } catch (error) {
          submit.disabled = false;
          submit.textContent = 'Create account';
          if (error instanceof ApiError) {
            message.textContent = error.message;
            if (error.fields) {
              for (const [field, text] of Object.entries(error.fields)) {
                const input = dialog.querySelector<HTMLInputElement>(`#signin-${field}`);
                if (input) {
                  input.setAttribute('aria-invalid', 'true');
                  const errorNode = input.closest('.field')?.querySelector('.field-error') as HTMLElement | null;
                  if (errorNode) errorNode.textContent = text;
                  errorNode?.removeAttribute('hidden');
                }
              }
            }
          }
        }
      } else {
        submit.textContent = 'Signing in...';
        submit.disabled = true;
        try {
          const reply = await api<{ account: { email: string; name: string; role: string } }>('/api/session', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ email: emailField.value, password: passwordField.value }),
          });
          store.account = reply.account;
          announce('Signed in.');
          handle.close(null);
          void store.refreshHolds();
          if (reply.account.role === 'coordinator') {
            history.pushState({}, '', '/console');
            route();
          } else if (pendingHoldCode && location.pathname === '/finder') {
            // After signing in from Hold this home, open the confirm dialog for
            // the same home (DP-19, DP-66).
            void resumePendingHold();
          }
        } catch (error) {
          submit.disabled = false;
          submit.textContent = 'Sign in';
          if (error instanceof ApiError) message.textContent = error.message;
        }
      }
    });
    if (mode === 'signin') passwordField.focus();
    else nameField?.focus();
  };
  render();

  const handle: DialogHandle = {
    root: backdrop,
    close: () => {
      modalRoot.removeChild(backdrop);
      signinOpen = false;
    },
  };
  let signinOpen = true;
  trapFocus(backdrop, () => {
    if (signinOpen) handle.close();
  });
  return handle;
}

// ---------- landing ----------

function landingScreen(): Screen {
  const root = el('div');
  let stopScroll: (() => void) | null = null;
  const render = (): void => {
    root.textContent = '';
    const hero = el('section', 'hero');
    const field = el('div', 'hero-field');
    const headline = el('h1', 'hero-headline', 'HIGHWATER');
    const sub = el('p', 'hero-sub', 'Look out of the window before you buy it.');
    const link = el('a', 'hero-link', 'Find your floor');
    link.href = '/finder';
    field.append(headline, sub, link);
    const stage = el('div', 'hero-stage');
    const canvas = el('canvas') as HTMLCanvasElement;
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', 'Highwater tower at floor 38');
    const view = new TowerView(canvas);
    stage.appendChild(canvas);
    hero.append(field, stage);
    root.appendChild(hero);

    const readout = el('div', 'readout', 'Floor 38');
    root.appendChild(readout);

    const bands = [
      { id: '36-38', numeral: '38' },
      { id: '30-35', numeral: '35' },
      { id: '20-29', numeral: '29' },
      { id: '10-19', numeral: '19' },
      { id: '03-09', numeral: '9' },
    ];
    for (const band of bands) {
      const section = el('section', 'band-section');
      const light = bands.indexOf(band) % 2 === 1;
      if (light) section.classList.add('light');
      const copy = el('div', 'band-copy');
      copy.appendChild(el('h2', undefined, BAND_LABELS[band.id]));
      copy.appendChild(el('p', undefined, `Floors ${band.id.replace('-', ' to ')}. Released homes with the views buyers ask for.`));
      const giant = el('span', 'giant', band.numeral);
      section.append(copy, giant);
      root.appendChild(section);
    }

    const tally = el('section', 'tally');
    const sentence = el('p', 'sentence');
    tally.setAttribute('role', 'region');
    tally.setAttribute('aria-label', 'Available now');
    sentence.textContent = 'Loading…';
    tally.appendChild(sentence);
    root.appendChild(tally);
    void api<{ units: TowerCell[] }>('/api/tower').then((reply) => {
      const available = reply.units.filter((unit) => unit.status === 'available').length;
      sentence.textContent = `${available} homes available now`;
    });

    const footer = el('footer', 'site-footer');
    footer.appendChild(el('p', undefined, 'Orrin & Vale Developments · Highwater, 38 storeys, one live inventory.'));
    root.appendChild(footer);

    app.textContent = '';
    app.appendChild(root);

    const onScroll = (): void => {
      const p = Math.min(1, window.scrollY / 4800);
      const floor = 38 - Math.round(35 * p);
      readout.textContent = `Floor ${floor}`;
      canvas.setAttribute('aria-label', `Highwater tower at floor ${floor}`);
      const bandIndex = Math.min(4, Math.floor(p * 5));
      const light = bandIndex % 2 === 1;
      hero.style.background = light ? '#ffffff' : '';
      field.style.color = light ? '#241c78' : '';
      view.render();
    };
    window.addEventListener('scroll', onScroll);
    view.render();
    stopScroll = () => window.removeEventListener('scroll', onScroll);
  };
  return {
    render,
    teardown: () => stopScroll?.(),
  };
}

// ---------- finder ----------

function finderScreen(): Screen {
  const root = el('div', 'finder');
  let tower: TowerView | null = null;
  let poller = 0;
  let rateTimer = 0;
  let outageTimer = 0;
  let focusedCode: string | null = null;
  let hoverCode: string | null = null;
  let rateSecondsLeft = 0;
  const teardownFunctions: Array<() => void> = [];
  const unitCache = new Map<string, PublicUnit>();
  const idempotencyKeys = new Map<string, string>();

  const cellByCode = (code: string): TowerCell | undefined => store.tower.find((c) => c.code === code);
  const unitByCode = (code: string): PublicUnit | undefined => store.results.find((u) => u.code === code) ?? unitCache.get(code);
  // The bearing and facing are fixed per stack, so the lens chip can name a
  // cell even before its unit read has arrived.
  const STACK_BEARINGS: Record<string, number> = { A: 134, B: 178, C: 214, D: 268, E: 311, F: 4, G: 41, H: 93 };
  const STACK_FACINGS: Record<string, string> = { A: 'SE', B: 'S', C: 'SW', D: 'W', E: 'NW', F: 'N', G: 'NE', H: 'E' };
  const bearingOf = (code: string): number => unitByCode(code)?.bearing ?? STACK_BEARINGS[code.slice(-1)] ?? 0;
  const facingOf = (code: string): string => unitByCode(code)?.facing ?? STACK_FACINGS[code.slice(-1)] ?? '';

  const isDimmed = (code: string): boolean => {
    if (store.searchDown) return false;
    // Before the first reply has arrived nothing is dimmed.
    if (!store.hasSearchReply) return false;
    const cell = cellByCode(code);
    if (!cell) return false;
    if (cell.status === 'withdrawn' || cell.status === 'unreleased') return false;
    return !store.matchingCodes.includes(code);
  };

  const pinnable = (code: string): boolean => {
    const cell = cellByCode(code);
    if (!cell) return false;
    if (cell.status === 'withdrawn' || cell.status === 'unreleased') return false;
    return !isDimmed(code);
  };

  const statusLabel = (code: string): string => {
    const cell = cellByCode(code);
    if (!cell) return 'Available';
    if (cell.status === 'held') {
      const mine = store.activeHold();
      if (mine && mine.unitCode === code) return 'Held by you';
      return 'Held';
    }
    return STATUS_LABELS[cell.status] ?? 'Available';
  };

  // Filters in the address (DP-73). Unknown values are dropped in place.
  const sanitise = (filters: typeof store.filters): typeof store.filters => {
    const allowed: Record<string, string[]> = {
      bedrooms: ['1', '2', '3'],
      band: ['03-09', '10-19', '20-29', '30-35', '36-38'],
      facing: ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'],
      view: ['harbour', 'harbour-partial', 'park', 'city', 'ridge'],
      status: ['available', 'held', 'reserved'],
    };
    const cleaned = { ...filters };
    for (const field of ['bedrooms', 'band', 'facing', 'view', 'status'] as const) {
      const list = filters[field];
      if (list.length > 6) {
        cleaned[field] = [];
        continue;
      }
      cleaned[field] = list.filter((value) => allowed[field].includes(value));
    }
    if (filters.q.length > 80) cleaned.q = '';
    for (const key of ['priceMin', 'priceMax'] as const) {
      if (filters[key] !== '' && !/^\d+$/.test(filters[key])) cleaned[key] = '';
    }
    if (cleaned.priceMin !== '' && cleaned.priceMax !== '' && Number(cleaned.priceMin) > Number(cleaned.priceMax)) {
      cleaned.priceMin = '';
      cleaned.priceMax = '';
    }
    return cleaned;
  };

  const addressFor = (filters = store.filters, unit = store.openUnit): string => {
    const params: string[] = [];
    if (filters.q) params.push(`q=${encodeURIComponent(filters.q)}`);
    for (const value of filters.bedrooms) params.push(`bedrooms=${encodeURIComponent(value)}`);
    for (const value of filters.band) params.push(`band=${encodeURIComponent(value)}`);
    for (const value of filters.facing) params.push(`facing=${encodeURIComponent(value)}`);
    for (const value of filters.view) params.push(`view=${encodeURIComponent(value)}`);
    for (const value of filters.status) params.push(`status=${encodeURIComponent(value)}`);
    if (filters.priceMin) params.push(`priceMin=${encodeURIComponent(filters.priceMin)}`);
    if (filters.priceMax) params.push(`priceMax=${encodeURIComponent(filters.priceMax)}`);
    if (unit) params.push(`unit=${encodeURIComponent(unit)}`);
    return `/finder${params.length > 0 ? `?${params.join('&')}` : ''}`;
  };

  const normaliseAddress = (): void => {
    const cleaned = sanitise(store.filters);
    const target = addressFor(cleaned, store.openUnit);
    if (location.pathname + location.search !== target) {
      history.replaceState({}, '', target);
      store.filters = cleaned;
    }
  };

  const pushFilters = (): void => {
    history.pushState({}, '', addressFor());
  };

  const replaceUnit = (unit: string | null): void => {
    store.openUnit = unit;
    history.replaceState({}, '', addressFor());
  };

  const runSearch = async (): Promise<void> => {
    if (rateSecondsLeft > 0) return;
    try {
      await store.search();
      if (store.searchDown) {
        store.searchDown = false;
        announce(`Search is back. ${store.total === 1 ? '1 home matches.' : `${store.total} homes match.`}`);
      }
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.status === 429) {
          const seconds = Number((error.message.match(/in (\d+) seconds/) ?? [])[1] ?? 1);
          rateSecondsLeft = seconds;
          showRateBanner(error.message);
          rateTimer = window.setInterval(() => {
            rateSecondsLeft -= 1;
            updateRateBanner();
            if (rateSecondsLeft <= 0) {
              window.clearInterval(rateTimer);
              hideRateBanner();
              void runSearch();
            }
          }, 1000);
        } else if (error.status === 503) {
          if (!store.searchDown) {
            store.searchDown = true;
            showOutageBanner(error.message);
            startOutageRetry();
          }
        } else if (error.status === 422 && error.fields) {
          store.fieldErrors = error.fields;
          store.busy = false;
        }
      }
    }
  };

  let rateBanner: HTMLElement | null = null;
  let outageBanner: HTMLElement | null = null;

  const showRateBanner = (message: string): void => {
    rateBanner = el('div', 'alert-banner');
    rateBanner.setAttribute('role', 'alert');
    rateBanner.textContent = message;
    document.body.appendChild(rateBanner);
  };
  const updateRateBanner = (): void => {
    if (rateBanner) rateBanner.textContent = rateBanner.textContent?.replace(/in \d+ seconds/, `in ${Math.max(0, rateSecondsLeft)} seconds`) ?? '';
  };
  const hideRateBanner = (): void => {
    rateBanner?.remove();
    rateBanner = null;
  };
  const showOutageBanner = (message: string): void => {
    outageBanner = el('div', 'alert-banner');
    outageBanner.setAttribute('role', 'alert');
    outageBanner.textContent = message;
    document.body.appendChild(outageBanner);
  };
  const hideOutageBanner = (): void => {
    outageBanner?.remove();
    outageBanner = null;
  };
  const startOutageRetry = (): void => {
    outageTimer = window.setInterval(() => {
      void runSearch();
    }, 10000);
  };

  // ---------- filters pane ----------

  const buildFilters = (inSheet: boolean): HTMLElement => {
    const wrap = inSheet ? el('div') : el('section', 'filters-pane pane');
    wrap.setAttribute('role', inSheet ? 'dialog' : 'region');
    wrap.setAttribute('aria-label', 'Filters');

    const searchField = el('div', 'field');
    const searchLabel = el('label', undefined, 'Search homes');
    const searchInput = el('input') as HTMLInputElement;
    searchInput.type = 'search';
    searchInput.setAttribute('aria-label', 'Search homes');
    searchInput.value = store.filters.q;
    let debounce = 0;
    searchInput.addEventListener('input', () => {
      window.clearTimeout(debounce);
      debounce = window.setTimeout(() => {
        if (searchInput.value.length > LIMITS.q) {
          setFieldError(searchInput, 'Use 80 characters or fewer.');
          return;
        }
        clearFieldError(searchInput);
        store.filters.q = searchInput.value;
        pushFilters();
        void runSearch();
      }, 250);
    });
    searchField.append(searchLabel, searchInput, el('div', 'field-error'));
    wrap.appendChild(searchField);

    const groups: Array<{ field: string; label: string }> = [
      { field: 'bedrooms', label: 'Bedrooms' },
      { field: 'band', label: 'Floors' },
      { field: 'facing', label: 'Facing' },
      { field: 'view', label: 'View' },
      { field: 'status', label: 'Availability' },
    ];
    for (const group of groups) {
      const fieldset = el('fieldset', 'group');
      fieldset.setAttribute('role', 'group');
      fieldset.setAttribute('aria-label', group.label);
      const legend = el('legend', undefined, group.label);
      fieldset.appendChild(legend);
      for (const value of FACET_VALUES[group.field]) {
        const count = store.facets[group.field]?.[value] ?? 0;
        const chip = el('button', 'chip');
        chip.type = 'button';
        chip.setAttribute('role', 'checkbox');
        const on = store.filters[group.field as 'bedrooms'].includes(value);
        chip.setAttribute('aria-checked', String(on));
        chip.classList.toggle('on', on);
        const check = el('span', 'check', '✓');
        chip.appendChild(check);
        chip.appendChild(el('span', undefined, `${chipLabel(group.field, value)} (${count})`));
        chip.addEventListener('click', () => {
          const list = store.filters[group.field as 'bedrooms'];
          if (list.includes(value)) {
            store.filters[group.field as 'bedrooms'] = list.filter((v) => v !== value);
          } else if (list.length >= LIMITS.facet) {
            setFieldError(fieldset, 'Choose up to 6.');
            return;
          } else {
            store.filters[group.field as 'bedrooms'] = [...list, value];
          }
          clearFieldError(fieldset);
          pushFilters();
          void runSearch();
        });
        fieldset.appendChild(chip);
      }
      fieldset.appendChild(el('div', 'field-error'));
      wrap.appendChild(fieldset);
    }

    const priceRow = el('div', 'field');
    const priceLabel = el('label', undefined, 'Price');
    const min = el('input') as HTMLInputElement;
    min.type = 'number';
    min.setAttribute('aria-label', 'Lowest price');
    min.value = store.filters.priceMin;
    const max = el('input') as HTMLInputElement;
    max.type = 'number';
    max.setAttribute('aria-label', 'Highest price');
    max.value = store.filters.priceMax;
    let priceDebounce = 0;
    const onPrice = (): void => {
      window.clearTimeout(priceDebounce);
      priceDebounce = window.setTimeout(() => {
        const minRaw = min.value.trim();
        const maxRaw = max.value.trim();
        if (minRaw !== '' && !/^\d+$/.test(minRaw)) {
          setFieldError(min, 'Enter a whole number of dollars.');
          return;
        }
        if (maxRaw !== '' && !/^\d+$/.test(maxRaw)) {
          setFieldError(max, 'Enter a whole number of dollars.');
          return;
        }
        if (minRaw !== '' && maxRaw !== '' && Number(minRaw) > Number(maxRaw)) {
          setFieldError(min, "The lowest price can't be above the highest.");
          return;
        }
        clearFieldError(min);
        clearFieldError(max);
        store.filters.priceMin = minRaw;
        store.filters.priceMax = maxRaw;
        pushFilters();
        void runSearch();
      }, 250);
    };
    min.addEventListener('input', onPrice);
    max.addEventListener('input', onPrice);
    priceRow.append(priceLabel, min, max, el('div', 'field-error'));
    wrap.appendChild(priceRow);

    const clearButton = el('button', 'btn ghost', 'Clear filters');
    clearButton.type = 'button';
    clearButton.addEventListener('click', () => {
      store.filters = emptyFilters();
      store.fieldErrors = {};
      pushFilters();
      void runSearch();
    });
    wrap.appendChild(clearButton);
    return wrap;
  };

  const setFieldError = (input: HTMLElement, message: string): void => {
    input.setAttribute('aria-invalid', 'true');
    const error = input.closest('.field')?.querySelector('.field-error') as HTMLElement | null;
    if (error) {
      error.textContent = message;
      error.removeAttribute('hidden');
    }
  };
  const clearFieldError = (input: HTMLElement): void => {
    input.removeAttribute('aria-invalid');
    const error = input.closest('.field, .group')?.querySelector('.field-error') as HTMLElement | null;
    if (error) {
      error.textContent = '';
      error.setAttribute('hidden', 'hidden');
    }
  };

  // ---------- tower ----------

  const buildTower = (): HTMLElement => {
    const stage = el('div', 'tower-stage');
    stage.setAttribute('role', 'region');
    stage.setAttribute('aria-label', 'Tower');
    const canvas = el('canvas') as HTMLCanvasElement;
    stage.appendChild(canvas);
    const grid = el('div', 'tower-grid');
    grid.setAttribute('role', 'grid');
    grid.setAttribute('aria-label', 'Tower');
    for (let floor = 38; floor >= 3; floor--) {
      const row = el('div', 'tower-grid-row');
      row.style.display = 'contents';
      row.setAttribute('role', 'row');
      row.setAttribute('aria-label', `Floor ${floor}`);
      for (const stack of STACKS) {
        const code = `${floor}${stack}`;
        const cell = el('div', 'tower-cell');
        cell.setAttribute('role', 'gridcell');
        cell.dataset.code = code;
        cell.tabIndex = -1;
        row.appendChild(cell);
      }
      grid.appendChild(row);
    }
    stage.appendChild(grid);
    grid.hidden = true;

    const turnLeft = el('button', 'btn ghost', 'Turn left');
    turnLeft.type = 'button';
    turnLeft.setAttribute('aria-label', 'Turn left');
    const turnRight = el('button', 'btn ghost', 'Turn right');
    turnRight.type = 'button';
    turnRight.setAttribute('aria-label', 'Turn right');
    turnLeft.addEventListener('click', () => tower?.turnLeft());
    turnRight.addEventListener('click', () => tower?.turnRight());
    stage.append(turnLeft, turnRight);

    tower = new TowerView(canvas);
    tower.onCellHover = (hit) => {
      if (!hit) {
        hideLens();
        return;
      }
      hoverCode = `${hit.floor}${hit.stack}`;
      showLens(hoverCode);
    };
    tower.onCellClick = (hit) => {
      const code = `${hit.floor}${hit.stack}`;
      hoverCode = code;
      showLens(code);
      openUnit(code);
    };
    if (!tower.hasGl) {
      grid.hidden = false;
      canvas.hidden = true;
      turnLeft.hidden = true;
      turnRight.hidden = true;
      announce('Tower model unavailable right now. Showing the floor grid.');
    }
    return stage;
  };

  // ---------- lens ----------

  let lens: HTMLElement | null = null;
  let lensChip: HTMLElement | null = null;

  const showLens = (code: string): void => {
    const cell = cellByCode(code);
    if (!cell) return;
    const unit = unitByCode(code);
    if (!lens) {
      lens = el('figure', 'lens');
      lens.setAttribute('role', 'figure');
      lens.setAttribute('aria-label', 'Window Lens');
      const tick = el('span', 'north-tick');
      lens.appendChild(tick);
      const img = el('img');
      lens.appendChild(img);
      const caption = el('figcaption', 'lens-caption');
      lens.appendChild(caption);
      document.body.appendChild(lens);
      lensChip = el('div', 'lens-chip');
      document.body.appendChild(lensChip);
    }
    const img = lens.querySelector('img') as HTMLImageElement;
    const caption = lens.querySelector('.lens-caption') as HTMLElement;
    const tick = lens.querySelector('.north-tick') as HTMLElement;
    const bearing = unit?.bearing ?? 0;
    tick.style.transform = `rotate(${360 - bearing}deg)`;
    if (cell.status === 'withdrawn') {
      img.removeAttribute('src');
      caption.textContent = '';
    } else if (isDimmed(code)) {
      img.removeAttribute('src');
      caption.textContent = 'Outside your filters';
    } else if (unit?.viewPhotographed && unit.viewUrl) {
      const epoch = ++lensEpoch;
      const url = unit.viewUrl;
      const probe = new Image();
      probe.onload = () => {
        if (epoch === lensEpoch) {
          img.src = url;
          caption.textContent = '';
        }
      };
      probe.onerror = () => {
        if (epoch === lensEpoch) {
          img.removeAttribute('src');
          caption.textContent = 'View photograph unavailable right now.';
        }
      };
      probe.src = url;
    } else {
      img.removeAttribute('src');
      caption.textContent = unit ? 'No view photograph yet.' : 'No view photograph yet.';
    }
    lens.setAttribute('aria-label', 'Window Lens');
    img.setAttribute('alt', `View from ${code}`);
    lens.style.display = '';
    lensChip!.textContent = cellChipName(code);
    const rect = (document.querySelector('.tower-stage') as HTMLElement)?.getBoundingClientRect();
    if (rect) {
      const pointer = lastPointer;
      const atPhone = window.innerWidth <= 700;
      if (atPhone) {
        lens.classList.add('inset');
        lensChip!.classList.add('inset');
        lens.style.left = '';
        lens.style.top = '';
        lens.style.right = '12px';
      } else {
        lens.classList.remove('inset');
        lensChip!.classList.remove('inset');
        lens.style.right = '';
        lens.style.left = `${pointer.x - rect.left}px`;
        lens.style.top = `${pointer.y - rect.top}px`;
        lensChip!.style.left = `${pointer.x - rect.left + 8}px`;
        lensChip!.style.top = `${pointer.y - rect.top + 8}px`;
      }
    }
  };

  let lensEpoch = 0;
  let lastPointer = { x: 0, y: 0 };
  document.addEventListener('pointermove', (event) => {
    lastPointer = { x: event.clientX, y: event.clientY };
  });

  const hideLens = (): void => {
    lens?.remove();
    lens = null;
    lensChip?.remove();
    lensChip = null;
  };

  const cellChipName = (code: string): string => {
    const cell = cellByCode(code);
    if (!cell) return code;
    if (cell.status === 'withdrawn' || cell.status === 'unreleased') {
      return basicCellName(code, STATUS_LABELS[cell.status] ?? '');
    }
    const name = cellName(code, bearingOf(code), facingOf(code), statusLabel(code), cell.syncing, isDimmed(code));
    return name;
  };

  // ---------- results ----------

  const buildResults = (): HTMLElement => {
    const pane = el('section', 'results-pane pane');
    pane.setAttribute('role', 'region');
    pane.setAttribute('aria-label', 'Results');
    const count = el('p', 'result-count');
    count.setAttribute('role', 'status');
    count.setAttribute('aria-live', 'polite');
    count.setAttribute('aria-label', 'Result count');
    const list = el('ul', 'homes-list');
    list.setAttribute('aria-label', 'Homes');
    const more = el('button', 'show-more btn', 'Show more homes');
    more.type = 'button';
    pane.append(count, list, more);
    more.addEventListener('click', async () => {
      more.disabled = true;
      pane.setAttribute('aria-busy', 'true');
      const before = new Set(store.results.map((u) => u.code));
      try {
        const reply = await store.loadMore();
        const appended: PublicUnit[] = [];
        for (const unit of reply.hits) {
          unitCache.set(unit.code, unit);
          if (!before.has(unit.code)) appended.push(unit);
        }
        const merged = [...store.results];
        for (const unit of reply.hits) {
          const index = merged.findIndex((u) => u.code === unit.code);
          if (index >= 0) merged[index] = unit;
          else merged.push(unit);
        }
        store.results = merged;
        store.total = reply.total;
        store.nextCursor = reply.nextCursor;
        const shown = store.results.length;
        const k = appended.length;
        announce(k === 1 ? `1 more home. ${shown} of ${reply.total} shown.` : `${k} more homes. ${shown} of ${reply.total} shown.`);
        if (appended.length > 0) {
          const firstRow = list.querySelector(`[data-code="${appended[0].code}"] button`) as HTMLElement | null;
          firstRow?.focus();
        }
      } finally {
        more.disabled = false;
        pane.removeAttribute('aria-busy');
      }
    });
    return pane;
  };

  const renderResults = (pane: HTMLElement): void => {
    const count = pane.querySelector('.result-count') as HTMLElement;
    const list = pane.querySelector('.homes-list') as HTMLElement;
    const more = pane.querySelector('.show-more') as HTMLButtonElement;
    count.textContent = store.total === 1 ? '1 home matches' : `${store.total} homes match`;
    list.textContent = '';
    if (store.results.length === 0 && !store.busy) {
      const empty = el('div', 'empty-state');
      const giant = el('span', 'giant', 'NOTHING HERE');
      const hint = el('p', 'empty-hint', 'No homes match these filters. Clear a filter to see more.');
      empty.append(giant, hint);
      list.appendChild(empty);
    }
    for (const unit of store.results) {
      unitCache.set(unit.code, unit);
      const item = el('li', 'home-row');
      item.dataset.code = unit.code;
      const button = el('button');
      const statusText = statusLabel(unit.code);
      const top = el('div', 'row-top');
      top.appendChild(el('span', 'row-code', unit.code));
      top.appendChild(el('span', 'row-status', `${statusText}${unit.syncing ? ' · Syncing' : ''}`));
      top.appendChild(el('span', 'row-price', `$${priceText(unit.price)}`));
      const meta = el('div', 'row-meta');
      meta.appendChild(el('span', undefined, `${unit.areaM2} m² · ${unit.areaSqft} sq ft`));
      meta.appendChild(el('span', undefined, `${unit.bearing}° ${unit.facing}`));
      meta.appendChild(el('span', undefined, `${unit.bedrooms} bed`));
      meta.appendChild(el('span', undefined, VIEW_LABELS[unit.viewTag] ?? unit.viewTag));
      meta.appendChild(el('span', undefined, BAND_LABELS[unit.band] ?? unit.band));
      button.append(top, meta);
      button.addEventListener('click', () => {
        openUnit(unit.code);
      });
      item.appendChild(button);
      list.appendChild(item);
    }
    more.hidden = store.nextCursor === null;
  };

  // ---------- pinning and the detail dialog ----------

  const openUnit = (code: string): void => {
    if (!pinnable(code)) return;
    replaceUnit(code);
    renderDetail();
  };

  let detailHandle: DialogHandle | null = null;

  const renderDetail = (): void => {
    detailHandle?.close(null);
    detailHandle = null;
    const code = store.openUnit;
    if (!code) return;
    void api<{ unit: PublicUnit }>(`/api/units/${code}`).then((reply) => {
      unitCache.set(reply.unit.code, reply.unit);
      drawDetail(reply.unit);
    }).catch((error: unknown) => {
      if (error instanceof ApiError && error.status === 404) {
        announce(error.message);
        replaceUnit(null);
      }
    });
  };

  const drawDetail = (unit: PublicUnit): void => {
    // Replace any existing detail dialog instead of stacking a second one.
    detailHandle?.close(null);
    const backdrop = el('div', 'dialog-backdrop');
    const dialog = el('div', 'dialog');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-label', `Home ${unit.code}`);
    const close = el('button', 'close-btn', 'Close');
    close.type = 'button';
    close.setAttribute('aria-label', 'Close');
    const view = el('div', 'detail-view');
    const img = el('img');
    img.alt = `View from ${unit.code}`;
    if (unit.viewPhotographed && unit.viewUrl) img.src = unit.viewUrl;
    else {
      const cap = el('p', undefined, 'No view photograph yet.');
      view.appendChild(cap);
    }
    view.appendChild(img);
    const facts = el('div', 'detail-facts');
    facts.appendChild(el('h2', 'unit-code', `Home ${unit.code}`));
    const priceLine = el('p', 'price-line', `$${priceText(unit.price)}`);
    facts.appendChild(priceLine);
    const grid = el('div', 'fact-grid');
    const addFact = (key: string, value: string): void => {
      const fact = el('div', 'fact');
      fact.appendChild(el('span', 'k', key));
      fact.appendChild(el('span', undefined, value));
      grid.appendChild(fact);
    };
    addFact('Price per m²', `$${priceText(unit.pricePerM2)}`);
    addFact('Price per sq ft', `$${priceText(unit.pricePerSqft)}`);
    addFact('Area', `${unit.areaM2} m² · ${unit.areaSqft} sq ft`);
    addFact('Bedrooms', `${unit.bedrooms}`);
    addFact('Bearing and facing', `${unit.bearing}° ${unit.facing}`);
    addFact('View', VIEW_LABELS[unit.viewTag] ?? unit.viewTag);
    addFact('Floor band', BAND_LABELS[unit.band] ?? unit.band);
    addFact('Status', `${statusLabel(unit.code)}${unit.syncing ? ' · Syncing' : ''}`);
    facts.appendChild(grid);
    const mark = el('p', undefined, unit.viewPhotographed ? 'View photographed' : 'No view photograph yet');
    mark.className = 'photo-mark';
    facts.appendChild(mark);
    const holdButton = el('button', 'hold-btn', 'Hold this home');
    holdButton.type = 'button';
    const mine = store.activeHold();
    const heldByOther = unit.status === 'held' && !(mine && mine.unitCode === unit.code);
    if (mine && mine.unitCode === unit.code) {
      holdButton.hidden = true;
    } else if (unit.status === 'held' || unit.status === 'reserved') {
      holdButton.disabled = true;
    }
    holdButton.addEventListener('click', () => {
      if (!store.account) {
        openSignInDialog(true);
        pendingHoldCode = unit.code;
        return;
      }
      openConfirmHold(unit);
    });
    facts.appendChild(holdButton);
    dialog.append(close, view, facts);
    backdrop.appendChild(dialog);
    modalRoot.appendChild(backdrop);
    close.addEventListener('click', () => {
      closeDetail();
    });
    const handle: DialogHandle = {
      root: backdrop,
      close: () => {
        if (backdrop.parentNode === modalRoot) modalRoot.removeChild(backdrop);
      },
    };
    trapFocus(backdrop, () => closeDetail());
    detailHandle = handle;
    close.focus();
  };

  const closeDetail = (): void => {
    const focusCode = store.openUnit;
    replaceUnit(null);
    detailHandle?.close(null);
    detailHandle = null;
    if (focusCode) {
      const cell = document.querySelector(`.tower-cell[data-code="${focusCode}"]`) as HTMLElement | null;
      if (cell && cell.offsetParent !== null) cell.focus();
      else {
        const row = document.querySelector(`.home-row[data-code="${focusCode}"] button`) as HTMLElement | null;
        row?.focus();
      }
    }
  };

  const confirmKey = (code: string): string => {
    const existing = idempotencyKeys.get(code);
    if (existing) return existing;
    const key = crypto.randomUUID();
    idempotencyKeys.set(code, key);
    return key;
  };

  const openConfirmHold = (unit: PublicUnit, key?: string): void => {
    const backdrop = el('div', 'dialog-backdrop');
    const dialog = el('div', 'confirm-dialog');
    dialog.setAttribute('role', 'alertdialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-label', 'Confirm hold');
    const question = el('p', 'question', `Hold ${unit.code} at $${priceText(unit.price)}?`);
    const note = el('p', 'note', 'No payment is taken. You can release the hold at any time.');
    const error = el('p', 'confirm-error');
    error.setAttribute('role', 'alert');
    const actions = el('div', 'confirm-actions');
    const confirm = el('button', 'btn accent', 'Confirm hold');
    confirm.type = 'button';
    const cancel = el('button', 'btn ghost', 'Cancel');
    cancel.type = 'button';
    actions.append(confirm, cancel);
    dialog.append(question, note, error, actions);
    backdrop.appendChild(dialog);
    modalRoot.appendChild(backdrop);
    let idempotencyKey = key ?? confirmKey(unit.code);

    const handle: DialogHandle = {
      root: backdrop,
      close: () => {
        if (backdrop.parentNode === modalRoot) modalRoot.removeChild(backdrop);
      },
    };
    trapFocus(backdrop, () => {
      handle.close();
      detailHandle?.root.querySelector<HTMLElement>('.hold-btn')?.focus();
    });

    const send = async (): Promise<void> => {
      confirm.textContent = 'Holding...';
      confirm.disabled = true;
      error.textContent = '';
      try {
        const reply = await api<{ hold: Hold }>('/api/holds', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'Idempotency-Key': idempotencyKey },
          body: JSON.stringify({ unitCode: unit.code, priceVersion: unit.priceVersion }),
        });
        handle.close();
        await store.refreshHolds();
        drawConfirmation(reply.hold);
      } catch (err) {
        confirm.disabled = false;
        confirm.textContent = 'Confirm hold';
        if (err instanceof ApiError) {
          if (err.status === 429) {
            const seconds = Number((err.message.match(/in (\d+) seconds/) ?? [])[1] ?? 1);
            error.textContent = err.message;
            confirm.disabled = true;
            const timer = window.setInterval(() => {
              const rest = seconds - 1;
              error.textContent = err.message.replace(/in \d+ seconds/, `in ${Math.max(0, rest)} seconds`);
              if (rest <= 0) {
                window.clearInterval(timer);
                confirm.disabled = false;
              }
            }, 1000);
          } else if (err.status === 401) {
            handle.close();
            openSignInDialog(true);
            pendingHoldCode = unit.code;
          } else if (err.status === 409 && err.code === 'price_changed') {
            error.textContent = err.message;
            try {
              const fresh = await api<{ unit: PublicUnit }>(`/api/units/${unit.code}`);
              unitCache.set(fresh.unit.code, fresh.unit);
              question.textContent = `Hold ${fresh.unit.code} at $${priceText(fresh.unit.price)}?`;
              unit.priceVersion = fresh.unit.priceVersion;
              unit.price = fresh.unit.price;
              idempotencyKey = confirmKey(unit.code);
              confirm.focus();
            } catch {
              error.textContent = err.message;
            }
          } else {
            error.textContent = err.message;
            idempotencyKeys.delete(unit.code);
            if (err.code === 'unit_unavailable' || err.code === 'unit_reserved') {
              void store.refreshTower();
            }
          }
        } else {
          error.textContent = "We couldn't reach Highwater. Your hold was not placed yet. Try again.";
        }
      }
    };
    confirm.addEventListener('click', send);
    cancel.addEventListener('click', () => {
      handle.close();
      detailHandle?.root.querySelector<HTMLElement>('.hold-btn')?.focus();
    });
    confirm.focus();
  };

  const drawConfirmation = (hold: Hold): void => {
    const code = store.openUnit ?? hold.unitCode;
    const backdrop = detailHandle?.root ?? el('div', 'dialog-backdrop');
    const dialog = backdrop.querySelector('.dialog') as HTMLElement;
    if (!dialog) return;
    dialog.textContent = '';
    const confirmation = el('div', 'yellow-confirmation');
    confirmation.appendChild(el('h2', undefined, 'This home is held for you.'));
    confirmation.appendChild(el('p', 'ends-line', `Held until ${salesOfficeTime(Date.parse(hold.endsAt), SALES_TZ)}.`));
    const openLink = el('a', undefined, 'Open your hold');
    openLink.href = `/holds/${hold.id}`;
    confirmation.appendChild(openLink);
    dialog.appendChild(confirmation);
    const heading = confirmation.querySelector('h2') as HTMLElement;
    heading.setAttribute('tabindex', '-1');
    heading.focus();
  };

  // sign-in returning to a hold (DP-19, DP-66)
  const resumePendingHoldInner = async (): Promise<void> => {
    if (!pendingHoldCode) return;
    const code = pendingHoldCode;
    pendingHoldCode = null;
    try {
      const reply = await api<{ unit: PublicUnit }>(`/api/units/${code}`);
      openConfirmHold(reply.unit);
    } catch {
      // The unit may have changed; the detail stays open.
    }
  };
  resumePendingHold = resumePendingHoldInner;

  // ---------- render ----------

  let filtersSheet: HTMLElement | null = null;
  let filtersButton: HTMLButtonElement | null = null;

  const render = (): void => {
    const atDesktop = window.innerWidth > 1024;
    root.textContent = '';
    const sheetButton = el('button', 'btn ghost', 'Filters');
    sheetButton.type = 'button';
    sheetButton.hidden = atDesktop;
    document.querySelector('.header-actions')!.prepend(sheetButton);
    filtersButton = sheetButton;

    const filters = buildFilters(false);
    if (!atDesktop) {
      filtersSheet = el('div', 'filters-sheet closed');
      filtersSheet.setAttribute('role', 'dialog');
      filtersSheet.setAttribute('aria-label', 'Filters');
      filtersSheet.appendChild(filters);
      document.body.appendChild(filtersSheet);
      sheetButton.addEventListener('click', () => {
        if (filtersSheet!.classList.contains('open')) {
          closeSheet();
        } else {
          filtersSheet!.classList.remove('closed');
          filtersSheet!.classList.add('open');
          const first = filtersSheet!.querySelector<HTMLElement>('button, input');
          first?.focus();
        }
      });
      trapFocus(filtersSheet, () => closeSheet());
    } else {
      root.appendChild(filters);
    }

    root.appendChild(buildTower());
    const pane = buildResults();
    root.appendChild(pane);
    app.textContent = '';
    app.appendChild(root);
    renderResults(pane);
    paintCells();
    tower?.render();

    if (store.results.length === 0 && !store.busy) void runSearch();
    if (store.openUnit) renderDetail();
    normaliseAddress();
    if (store.filters.q || store.filters.bedrooms.length > 0 || store.filters.band.length > 0 || store.filters.facing.length > 0 || store.filters.view.length > 0 || store.filters.status.length > 0 || store.filters.priceMin !== '' || store.filters.priceMax !== '') {
      // A restore from the address runs one search under the cleaned filters.
      void runSearch();
    }

    startPolling();
  };

  const closeSheet = (): void => {
    if (!filtersSheet) return;
    filtersSheet.classList.remove('open');
    filtersSheet.classList.add('closed');
    filtersButton?.focus();
  };

  const paintCells = (): void => {
    const cellElements = Array.from(root.querySelectorAll<HTMLElement>('.tower-cell'));
    for (const cellElement of cellElements) {
      const code = cellElement.dataset.code ?? '';
      const cell = cellByCode(code);
      if (!cell) continue;
      cellElement.classList.toggle('held', cell.status === 'held');
      cellElement.classList.toggle('reserved', cell.status === 'reserved');
      cellElement.classList.toggle('withdrawn', cell.status === 'withdrawn');
      cellElement.classList.toggle('unreleased', cell.status === 'unreleased');
      cellElement.classList.toggle('dimmed', isDimmed(code));
      cellElement.setAttribute('aria-disabled', pinnable(code) ? 'false' : 'true');
      cellElement.setAttribute('aria-selected', code === store.openUnit ? 'true' : 'false');
      cellElement.setAttribute('aria-label', cellChipName(code));
    }
    // The roving-focus cell keeps its unit and focus across repaints.
    if (focusedCode) {
      const cellElement = root.querySelector(`.tower-cell[data-code="${focusedCode}"]`) as HTMLElement | null;
      if (cellElement && document.activeElement?.classList.contains('tower-cell')) cellElement.focus();
    }
  };

  const startPolling = (): void => {
    stopPolling();
    const tick = async (): Promise<void> => {
      await store.refreshTower();
      await store.refreshHolds();
      paintCells();
      const pane = root.querySelector('.results-pane');
      if (pane) renderResults(pane as HTMLElement);
      tower?.render();
      if (store.openUnit) {
        try {
          const reply = await api<{ unit: PublicUnit }>(`/api/units/${store.openUnit}`);
          const known = unitCache.get(store.openUnit);
          if (known && known.price !== reply.unit.price) {
            announce(`Price for ${reply.unit.code} is now $${priceText(reply.unit.price)}.`);
          }
          unitCache.set(reply.unit.code, reply.unit);
          if (detailHandle && store.openUnit) drawDetail(reply.unit);
        } catch (error) {
          if (error instanceof ApiError && error.status === 404) {
            announce(`${store.openUnit} has been withdrawn.`);
            if (detailHandle) {
              const view = detailHandle.root.querySelector('.detail-view') as HTMLElement | null;
              if (view) view.textContent = 'This home has been withdrawn.';
            }
          }
        }
      }
    };
    // The first search's reply arrives after render, so the rows are painted
    // when the store changes (newest-input-wins keeps this the only repaint).
    const unsubscribe = store.subscribe(() => {
      const pane = root.querySelector('.results-pane');
      if (pane) renderResults(pane as HTMLElement);
    });
    teardownFunctions.push(unsubscribe);
    poller = window.setInterval(() => {
      void tick();
    }, 5000);
    window.addEventListener('focus', () => {
      void tick();
    });
  };

  const stopPolling = (): void => {
    if (poller) window.clearInterval(poller);
    poller = 0;
  };

  return {
    render,
    teardown: () => {
      stopPolling();
      for (const teardownFunction of teardownFunctions) teardownFunction();
      if (rateTimer) window.clearInterval(rateTimer);
      if (outageTimer) window.clearInterval(outageTimer);
      hideLens();
      hideOutageBanner();
      hideRateBanner();
      filtersSheet?.remove();
      filtersSheet = null;
      document.querySelectorAll('.header-actions .btn').forEach((node) => {
        if (node.textContent === 'Filters') node.remove();
      });
    },
  };
}

// ---------- hold page ----------

function holdScreen(path: string): Screen {
  const holdId = path.slice('/holds/'.length);
  const root = el('div', 'hold-page');
  let poller = 0;
  let hold: Hold | null = null;
  let countdown = 0;
  let checking = false;

  const render = (): void => {
    root.textContent = '';
    app.textContent = '';
    app.appendChild(root);
    void loadHold();
  };

  const loadHold = async (): Promise<void> => {
    if (!store.account) {
      openSignInDialog(false);
      return;
    }
    try {
      const reply = await api<{ hold: Hold }>(`/api/holds/${holdId}`);
      hold = reply.hold;
      draw();
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.status === 401) {
          store.account = null;
          openSignInDialog(false);
        } else if (error.status === 404) {
          root.textContent = '';
          const heading = el('h1', undefined, "We couldn't find that hold.");
          root.appendChild(heading);
        }
      }
    }
  };

  const draw = (): void => {
    if (!hold) return;
    root.textContent = '';
    const heading = el('h1', undefined, `Your hold on ${hold.unitCode}`);
    heading.id = 'hold-heading';
    root.appendChild(heading);
    if (hold.status !== 'active') {
      const copy = el('p', 'ended-copy');
      copy.textContent = endedCopy(hold.endedBy);
      root.appendChild(copy);
      heading.setAttribute('tabindex', '-1');
      heading.focus();
      announce(endedCopy(hold.endedBy));
      stopPolling();
      return;
    }
    const facts = el('div', 'hold-facts');
    facts.appendChild(el('p', undefined, `Quoted price $${priceText(hold.quotedPrice)}`));
    facts.appendChild(el('p', undefined, `Price version ${hold.priceVersion}`));
    facts.appendChild(el('p', undefined, `Held until ${salesOfficeTime(Date.parse(hold.endsAt), SALES_TZ)}.`));
    const timer = el('span', 'timer');
    timer.setAttribute('role', 'timer');
    timer.textContent = countdownClock(Date.parse(hold.endsAt) - serverNow());
    facts.appendChild(timer);
    root.appendChild(facts);

    const actions = el('div', 'hold-actions');
    const release = el('button', 'btn on-yellow', 'Release hold');
    release.type = 'button';
    release.addEventListener('click', () => confirmRelease());
    actions.appendChild(release);
    root.appendChild(actions);

    const shareBox = el('div', 'share-box');
    const shareInput = el('input') as HTMLInputElement;
    shareInput.setAttribute('aria-label', 'Share link');
    shareInput.readOnly = true;
    shareInput.value = hold.shareUrl ? `${location.origin}${hold.shareUrl}` : '';
    const shareButtons = el('div', 'hold-actions');
    if (hold.shareUrl) {
      const copyButton = el('button', 'btn on-yellow', 'Copy link');
      copyButton.type = 'button';
      copyButton.addEventListener('click', async () => {
        await navigator.clipboard.writeText(shareInput.value);
        announce('Link copied.');
      });
      const newLink = el('button', 'btn on-yellow', 'Make a new link');
      newLink.type = 'button';
      newLink.addEventListener('click', async () => {
        const reply = await api<{ shareUrl: string }>(`/api/holds/${holdId}/share`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
        hold!.shareUrl = reply.shareUrl;
        announce('Share link ready.');
        draw();
      });
      const revoke = el('button', 'btn on-yellow', 'Revoke link');
      revoke.type = 'button';
      revoke.addEventListener('click', async () => {
        await fetch(`/api/holds/${holdId}/share`, { method: 'DELETE' });
        hold!.shareUrl = null;
        announce('Share link revoked.');
        draw();
      });
      shareButtons.append(copyButton, newLink, revoke);
    } else {
      const create = el('button', 'btn on-yellow', 'Create share link');
      create.type = 'button';
      create.addEventListener('click', async () => {
        const reply = await api<{ shareUrl: string }>(`/api/holds/${holdId}/share`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
        hold!.shareUrl = reply.shareUrl;
        announce('Share link ready.');
        draw();
      });
      shareButtons.appendChild(create);
    }
    shareBox.append(shareInput, shareButtons);
    root.appendChild(shareBox);

    stopPolling();
    countdown = window.setInterval(() => {
      const remaining = Date.parse(hold!.endsAt) - serverNow();
      if (remaining > 0) {
        timer.textContent = countdownClock(remaining);
      } else {
        timer.textContent = 'Checking...';
        void checkLapse();
      }
    }, 1000);
    poller = window.setInterval(() => {
      void loadHold();
    }, 5000);
    window.addEventListener('focus', onFocus);
  };

  const onFocus = (): void => {
    void loadHold();
  };

  const checkLapse = async (): Promise<void> => {
    if (checking) return;
    checking = true;
    try {
      await loadHold();
    } finally {
      checking = false;
    }
  };

  const confirmRelease = (): void => {
    const backdrop = el('div', 'dialog-backdrop');
    const dialog = el('div', 'confirm-dialog');
    dialog.setAttribute('role', 'alertdialog');
    dialog.setAttribute('aria-label', 'Release this hold?');
    dialog.appendChild(el('p', 'question', 'Release this hold?'));
    const actions = el('div', 'confirm-actions');
    const release = el('button', 'btn accent', 'Release');
    release.type = 'button';
    const keep = el('button', 'btn ghost', 'Keep hold');
    keep.type = 'button';
    const error = el('p', 'confirm-error');
    actions.append(release, keep);
    dialog.append(actions, error);
    backdrop.appendChild(dialog);
    modalRoot.appendChild(backdrop);
    trapFocus(backdrop, () => {
      modalRoot.removeChild(backdrop);
    });
    keep.addEventListener('click', () => {
      modalRoot.removeChild(backdrop);
    });
    release.addEventListener('click', async () => {
      release.textContent = 'Releasing...';
      release.disabled = true;
      try {
        const reply = await api<{ hold: Hold }>(`/api/holds/${holdId}/release`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
        hold = reply.hold;
        announce('Hold released.');
        modalRoot.removeChild(backdrop);
        draw();
      } catch (error) {
        release.disabled = false;
        release.textContent = 'Release';
        if (error instanceof ApiError) {
          if (error.status === 409) {
            await loadHold();
            modalRoot.removeChild(backdrop);
          } else {
            const node = dialog.querySelector('.confirm-error') as HTMLElement;
            node.textContent = error.message;
          }
        }
      }
    });
    release.focus();
  };

  const stopPolling = (): void => {
    if (poller) window.clearInterval(poller);
    poller = 0;
    if (countdown) window.clearInterval(countdown);
    countdown = 0;
    window.removeEventListener('focus', onFocus);
  };

  const endedCopy = (endedBy: string | null): string => {
    switch (endedBy) {
      case 'buyer': return 'You released this hold.';
      case 'withdrawal': return 'This home was withdrawn, so your hold ended.';
      case 'conversion': return 'This hold became a reservation.';
      case 'lapse': return 'Your hold has lapsed. This home is open to every buyer again.';
      default: return 'This hold has ended.';
    }
  };

  return { render, teardown: stopPolling };
}

// ---------- console ----------

function consoleScreen(): Screen {
  const root = el('div', 'console');
  let notice = '';

  const render = (): void => {
    app.textContent = '';
    app.appendChild(root);
    if (!store.account) {
      openSignInDialog(false);
      return;
    }
    if (store.account.role === 'buyer') {
      root.textContent = '';
      const heading = el('h1', undefined, "Your account can't do that.");
      const link = el('a', undefined, 'Open the finder');
      link.href = '/finder';
      root.append(heading, link);
      return;
    }
    drawConsole();
  };

  const drawConsole = async (): Promise<void> => {
    root.textContent = '';
    const bandsField = el('section', 'console-field');
    bandsField.setAttribute('role', 'region');
    bandsField.setAttribute('aria-label', 'Floor bands');
    bandsField.appendChild(el('h2', undefined, 'Floor bands'));
    const bandButtons = el('div', 'band-buttons');
    for (const band of ['03-09', '10-19', '20-29', '30-35', '36-38']) {
      const button = el('button', 'btn ghost', `Release floors ${band}`);
      button.type = 'button';
      button.addEventListener('click', async () => {
        button.textContent = 'Releasing...';
        button.disabled = true;
        try {
          await api(`/api/console/bands/${band}/release`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
          notice = `Floors ${band} released.`;
        } catch (error) {
          if (error instanceof ApiError) notice = error.message;
          button.disabled = false;
          button.textContent = `Release floors ${band}`;
        }
        renderNotice();
      });
      bandButtons.appendChild(button);
    }
    bandsField.appendChild(bandButtons);
    root.appendChild(bandsField);

    const editor = el('section', 'console-field unit-editor');
    editor.setAttribute('role', 'region');
    editor.appendChild(el('h2', undefined, 'Unit editor'));
    const codeField = el('div', 'field');
    const codeLabel = el('label', undefined, 'Unit code');
    const codeInput = el('input') as HTMLInputElement;
    codeInput.setAttribute('aria-label', 'Unit code');
    codeInput.type = 'search';
    codeField.append(codeLabel, codeInput);
    editor.appendChild(codeField);
    const unitRegion = el('section');
    unitRegion.setAttribute('role', 'region');
    unitRegion.setAttribute('aria-label', 'Unit');
    editor.appendChild(unitRegion);
    codeInput.addEventListener('input', () => {
      const code = codeInput.value.trim().toUpperCase();
      if (/^\d{1,2}[A-H]$/.test(code)) void drawUnit(unitRegion, code);
    });
    root.appendChild(editor);

    const holdsField = el('section', 'console-field');
    holdsField.setAttribute('role', 'region');
    holdsField.setAttribute('aria-label', 'Active holds');
    holdsField.appendChild(el('h2', undefined, 'Active holds'));
    const holdsTable = el('table', 'console-table');
    holdsTable.setAttribute('aria-label', 'Active holds');
    holdsField.appendChild(holdsTable);
    root.appendChild(holdsField);

    const noticeNode = el('p', 'console-notice');
    noticeNode.textContent = notice;
    root.appendChild(noticeNode);

    try {
      const holdsReply = await api<{ holds: Array<{ id: string; unitCode: string; buyerEmail: string; buyerName: string; quotedPrice: number; priceVersion: number; createdAt: string; endsAt: string }> }>('/api/console/holds');
      holdsTable.textContent = '';
      const head = el('thead');
      const headRow = el('tr');
      for (const column of ['unit', 'buyer email', 'quoted price', 'ends']) headRow.appendChild(el('th', undefined, column));
      head.appendChild(headRow);
      holdsTable.appendChild(head);
      const body = el('tbody');
      for (const hold of holdsReply.holds) {
        const row = el('tr');
        row.appendChild(el('td', undefined, hold.unitCode));
        row.appendChild(el('td', undefined, hold.buyerEmail));
        row.appendChild(el('td', undefined, `$${priceText(hold.quotedPrice)}`));
        row.appendChild(el('td', undefined, salesOfficeTime(Date.parse(hold.endsAt), SALES_TZ)));
        const actions = el('td');
        const convert = el('button', 'btn ghost', `Convert ${hold.unitCode}`);
        convert.type = 'button';
        convert.addEventListener('click', async () => {
          convert.textContent = 'Converting...';
          convert.disabled = true;
          try {
            await api(`/api/console/holds/${hold.id}/convert`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
            notice = 'Hold converted to a reservation.';
            drawConsole();
          } catch (error) {
            if (error instanceof ApiError) notice = error.message;
            convert.disabled = false;
            convert.textContent = `Convert ${hold.unitCode}`;
            renderNotice();
          }
        });
        actions.appendChild(convert);
        row.appendChild(actions);
        body.appendChild(row);
      }
      holdsTable.appendChild(body);
    } catch (error) {
      if (error instanceof ApiError) {
        notice = error.message;
        renderNotice();
      }
    }
  };

  const renderNotice = (): void => {
    const node = root.querySelector('.console-notice') as HTMLElement | null;
    if (node) node.textContent = notice;
    announce(notice);
  };

  const drawUnit = async (region: HTMLElement, code: string): Promise<void> => {
    region.textContent = '';
    try {
      const unitsReply = await api<{ units: Array<{ code: string; floor: number; stack: string; band: string; status: string; price: number; priceVersion: number; viewPhotographed: boolean; viewPhoto: { key: string; size: number; checksum: string } | null; hold: { id: string; buyerEmail: string; quotedPrice: number; createdAt: string; endsAt: string } | null }> }>('/api/console/units');
      const unit = unitsReply.units.find((u) => u.code === code);
      if (!unit) {
        region.appendChild(el('p', 'confirm-error', "We couldn't find that."));
        return;
      }
      region.setAttribute('aria-label', `Unit ${code}`);
      region.appendChild(el('h3', undefined, `Unit ${code}`));
      region.appendChild(el('p', undefined, `Status ${STATUS_LABELS[unit.status] ?? unit.status}`));
      region.appendChild(el('p', undefined, `Current price $${priceText(unit.price)} · version ${unit.priceVersion}`));
      region.appendChild(el('p', undefined, unit.viewPhotographed ? 'View photographed' : 'No view photograph yet'));

      const priceField = el('div', 'field');
      const priceLabel = el('label', undefined, 'Price');
      const priceInput = el('input') as HTMLInputElement;
      priceInput.type = 'number';
      priceInput.setAttribute('aria-label', 'Price');
      priceInput.value = String(unit.price);
      priceField.append(priceLabel, priceInput);
      const saveButton = el('button', 'btn ghost', 'Save price');
      saveButton.type = 'button';
      const priceError = el('p', 'confirm-error');
      priceField.append(saveButton, priceError);
      region.appendChild(priceField);
      saveButton.addEventListener('click', async () => {
        saveButton.textContent = 'Saving...';
        saveButton.disabled = true;
        priceError.textContent = '';
        try {
          await api(`/api/console/units/${code}/price`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ price: Number(priceInput.value), expectedVersion: unit.priceVersion }),
          });
          notice = `Price saved for ${code}.`;
          await drawUnit(region, code);
          renderNotice();
        } catch (error) {
          saveButton.disabled = false;
          saveButton.textContent = 'Save price';
          if (error instanceof ApiError) priceError.textContent = error.message;
        }
      });

      const photoField = el('div', 'field');
      const photoLabel = el('label', undefined, 'View photograph');
      photoLabel.setAttribute('for', 'photo-input');
      const photoInput = el('input') as HTMLInputElement;
      photoInput.type = 'file';
      photoInput.id = 'photo-input';
      photoInput.accept = 'image/png,image/jpeg';
      photoInput.setAttribute('aria-label', 'View photograph');
      const uploadButton = el('button', 'btn ghost', 'Upload photo');
      uploadButton.type = 'button';
      const photoError = el('p', 'confirm-error');
      photoField.append(photoLabel, photoInput, uploadButton, photoError);
      region.appendChild(photoField);
      uploadButton.addEventListener('click', async () => {
        const file = photoInput.files?.[0];
        if (!file) {
          photoError.textContent = 'Choose a PNG or JPEG image first.';
          return;
        }
        uploadButton.textContent = 'Uploading...';
        uploadButton.disabled = true;
        photoError.textContent = '';
        try {
          const bytes = await file.arrayBuffer();
          await fetch(`/api/console/units/${code}/view-photo`, {
            method: 'PUT',
            headers: { 'content-type': file.type },
            body: bytes,
          }).then(async (response) => {
            if (!response.ok) {
              const body = await response.json();
              throw new ApiError(response.status, body.error.code, body.error.message, body.error.fields);
            }
            return response.json();
          });
          notice = `Photo confirmed for ${code}.`;
          await drawUnit(region, code);
          renderNotice();
        } catch (error) {
          uploadButton.disabled = false;
          uploadButton.textContent = 'Upload photo';
          if (error instanceof ApiError) photoError.textContent = error.message;
        }
      });

      const withdrawButton = el('button', 'btn ghost', 'Withdraw unit');
      withdrawButton.type = 'button';
      withdrawButton.disabled = unit.status === 'withdrawn';
      region.appendChild(withdrawButton);
      withdrawButton.addEventListener('click', () => {
        const backdrop = el('div', 'dialog-backdrop');
        const dialog = el('div', 'confirm-dialog');
        dialog.setAttribute('role', 'alertdialog');
        dialog.setAttribute('aria-label', `Withdraw ${code}?`);
        dialog.appendChild(el('p', 'question', `Withdraw ${code}?`));
        const actions = el('div', 'confirm-actions');
        const confirm = el('button', 'btn accent', 'Withdraw');
        confirm.type = 'button';
        const cancel = el('button', 'btn ghost', 'Cancel');
        cancel.type = 'button';
        actions.append(confirm, cancel);
        dialog.appendChild(actions);
        backdrop.appendChild(dialog);
        modalRoot.appendChild(backdrop);
        trapFocus(backdrop, () => modalRoot.removeChild(backdrop));
        cancel.addEventListener('click', () => modalRoot.removeChild(backdrop));
        confirm.addEventListener('click', async () => {
          confirm.textContent = 'Withdrawing...';
          confirm.disabled = true;
          try {
            await api(`/api/console/units/${code}/withdraw`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
            notice = `${code} withdrawn.`;
            modalRoot.removeChild(backdrop);
            await drawUnit(region, code);
            renderNotice();
          } catch (error) {
            confirm.disabled = false;
            confirm.textContent = 'Withdraw';
            if (error instanceof ApiError) {
              const errorNode = dialog.querySelector('.confirm-error') ?? el('p', 'confirm-error');
              (errorNode as HTMLElement).textContent = error.message;
              dialog.appendChild(errorNode as HTMLElement);
            }
          }
        });
        confirm.focus();
      });

      const pricesTable = el('table', 'console-table');
      pricesTable.setAttribute('aria-label', 'Price versions');
      const pricesReply = await api<{ versions: Array<{ version: number; price: number; setBy: string; setAt: string }> }>(`/api/console/units/${code}/prices`);
      const head = el('thead');
      const headRow = el('tr');
      for (const column of ['Version', 'Price', 'Set by', 'Set at']) headRow.appendChild(el('th', undefined, column));
      head.appendChild(headRow);
      pricesTable.appendChild(head);
      const body = el('tbody');
      for (const version of pricesReply.versions) {
        const row = el('tr');
        row.appendChild(el('td', undefined, String(version.version)));
        row.appendChild(el('td', undefined, `$${priceText(version.price)}`));
        row.appendChild(el('td', undefined, version.setBy));
        row.appendChild(el('td', undefined, salesOfficeTime(Date.parse(version.setAt), SALES_TZ)));
        body.appendChild(row);
      }
      pricesTable.appendChild(body);
      region.appendChild(pricesTable);
    } catch (error) {
      if (error instanceof ApiError) {
        region.appendChild(el('p', 'confirm-error', error.message));
      }
    }
  };

  return { render };
}

// ---------- shared page ----------

async function renderSharedPage(): Promise<void> {
  const token = location.pathname.slice('/shared/'.length);
  document.querySelector('.site-header')?.setAttribute('hidden', 'hidden');
  const page = el('div', 'shared-page');
  app.textContent = '';
  app.appendChild(page);
  try {
    const reply = await api<{ unit: { code: string; floor: number; stack: string; band: string; bedrooms: number; areaM2: number; areaSqft: number; bearing: number; facing: string; viewTag: string; viewPhotographed: boolean; viewUrl: string | null }; endsAt: string }>(`/api/shared/${token}`);
    const { unit, endsAt } = reply;
    page.textContent = '';
    const left = el('div');
    left.appendChild(el('h1', undefined, `Home ${unit.code}`));
    const lens = el('div', 'shared-lens');
    const img = el('img');
    img.alt = `View from ${unit.code}`;
    if (unit.viewPhotographed && unit.viewUrl) img.src = unit.viewUrl;
    lens.appendChild(img);
    left.appendChild(lens);
    const right = el('div', 'shared-facts');
    const addFact = (key: string, value: string): void => {
      const fact = el('div', 'fact');
      fact.appendChild(el('span', 'k', key));
      fact.appendChild(el('span', undefined, value));
      right.appendChild(fact);
    };
    addFact('Floor', String(unit.floor));
    addFact('Stack', unit.stack);
    addFact('Floor band', BAND_LABELS[unit.band] ?? unit.band);
    addFact('Bedrooms', String(unit.bedrooms));
    addFact('Area', `${unit.areaM2} m² · ${unit.areaSqft} sq ft`);
    addFact('Bearing and facing', `${unit.bearing}° ${unit.facing}`);
    addFact('View', VIEW_LABELS[unit.viewTag] ?? unit.viewTag);
    addFact('Held until', `${salesOfficeTime(Date.parse(endsAt), SALES_TZ)}.`);
    page.append(left, right);
  } catch {
    page.textContent = '';
    page.appendChild(el('h1', undefined, 'This shared link no longer works.'));
    const link = el('a', undefined, 'Open the finder');
    link.href = '/finder';
    page.appendChild(link);
  }
}

// ---------- boot ----------

// The finder registers a resume helper so sign-in can reopen the hold
// confirmation for the same home after a successful sign-in (DP-19, DP-66).
let resumePendingHold: () => Promise<void> = async (): Promise<void> => {};
let pendingHoldCode: string | null = null;

void (async (): Promise<void> => {
  await store.refreshSession();
  await store.refreshTower();
  await store.refreshHolds();
  store.loadFromQuery(location.search);
  if (location.pathname.startsWith('/shared/')) {
    await renderSharedPage();
  } else {
    route();
  }
})();
