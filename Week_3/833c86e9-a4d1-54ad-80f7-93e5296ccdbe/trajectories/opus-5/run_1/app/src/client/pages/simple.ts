import { HOME_LAYERS } from '../../shared/strings';
import { api, failureOf } from '../api';
import { Route, navigate, onEvent, toast } from '../app';
import { clear, el, svg } from '../dom';
import { m, t } from '../i18n';
import { state } from '../state';
import { Destination } from '../components/controls';
import { spinbutton } from '../components/controls';

function harbourIllustration(): SVGElement {
  const buildings: SVGElement[] = [];
  let x = 20;
  let seed = 7;
  const next = (): number => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  while (x < 980) {
    const width = 30 + Math.floor(next() * 90);
    const height = 60 + Math.floor(next() * 300);
    buildings.push(
      svg('rect', { x, y: 620 - height, width, height, fill: next() > 0.5 ? '#0a0a0a' : '#b7c9ad' }),
    );
    x += width + 8;
  }
  return svg(
    'svg',
    { viewBox: '0 0 1000 700', role: 'img', 'aria-label': t('ui.harbour'), class: 'harbour' },
    [
      svg('rect', { width: 1000, height: 700, fill: '#ffffff' }),
      svg('circle', { cx: 790, cy: 160, r: 90, fill: '#ff5a00' }),
      ...buildings,
      svg('rect', { y: 620, width: 1000, height: 80, fill: '#0a0a0a' }),
    ],
  );
}

export function homePage(main: HTMLElement): void {
  const hero = el('section', { class: 'hero' }, [
    el('p', { class: 'hero-word' }, [m('hero.word')]),
    el('p', { class: 'hero-sentence' }, [m('hero.sentence')]),
  ]);
  const search = el('a', { href: '/search', class: 'orange-block', 'data-focus-key': 'home:search' }, [
    t('ui.search_stays'),
  ]);
  search.addEventListener('click', (event) => {
    event.preventDefault();
    void navigate('/search');
  });
  hero.append(search);
  const layers = el(
    'section',
    { class: 'layers' },
    HOME_LAYERS[state.lang].map((layer) => el('p', {}, [layer])),
  );
  const cancel = el('section', { class: 'sage-block home-cancel' }, [el('p', {}, [m('home.cancel')])]);
  const numerals = el('section', { class: 'numerals' }, [
    el('div', {}, [el('p', { class: 'numeral' }, ['9%']), el('p', {}, [m('home.commission')])]),
    el('div', {}, [el('p', { class: 'numeral' }, ['180']), el('p', {}, [m('home.reviews')])]),
  ]);
  const illustration = el('section', { class: 'illustration' }, [harbourIllustration()]);
  main.append(hero, layers, cancel, numerals, illustration);
}

export async function destinationsPage(main: HTMLElement): Promise<void> {
  const destinations = await api<Destination[]>('/api/destinations');
  const list = el('ul', { class: 'destinations' });
  for (const destination of destinations) {
    const inDate = new Date(state.serverNowMs + 7 * 86400000).toISOString().slice(0, 10);
    const outDate = new Date(state.serverNowMs + 9 * 86400000).toISOString().slice(0, 10);
    const href = `/search?dest=${destination.code}&in=${inDate}&out=${outDate}&lang=${state.lang}&cur=${state.cur}`;
    const link = el('a', { href }, [
      t('ui.destination_option', { name: destination.name, count: destination.property_count }),
    ]);
    link.addEventListener('click', (event) => {
      event.preventDefault();
      void navigate(href);
    });
    list.append(el('li', {}, [link]));
  }
  main.append(el('h1', {}, [t('ui.destinations')]), list);
}

export function forPropertiesPage(main: HTMLElement): void {
  const link = el('a', { href: '/signin' }, [t('ui.sign_in')]);
  link.addEventListener('click', (event) => {
    event.preventDefault();
    void navigate('/signin');
  });
  main.append(
    el('h1', {}, [t('ui.for_properties')]),
    el('p', { class: 'numeral' }, ['9%']),
    el('p', {}, [m('home.commission')]),
    link,
  );
}

export function findPage(main: HTMLElement): void {
  const code = el('input', { type: 'text', 'aria-label': t('ui.booking_code'), class: 'field' });
  const surname = el('input', { type: 'text', 'aria-label': t('ui.surname'), class: 'field' });
  const button = el('button', { type: 'submit' }, [t('ui.find_booking')]);
  const message = el('p', { class: 'field-message' });
  const form = el('form', { 'aria-label': t('ui.find_form'), class: 'find-form' }, [code, surname, button, message]);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void (async () => {
      message.textContent = '';
      try {
        const found = await api<{ code: string }>('/api/bookings/find', {
          method: 'POST',
          body: { code: code.value.trim(), surname: surname.value.trim() },
          busy: button,
        });
        await navigate(`/bookings/${found.code}`);
      } catch (err) {
        const failure = failureOf(err);
        message.textContent = m(failure?.status === 429 ? 'rate.limited' : 'find.none');
      }
    })();
  });
  main.append(form);
}

export async function inboxPage(main: HTMLElement): Promise<void> {
  const messages = await api<{ id: number; at: string; kind: string; property: string; link: string }[]>('/api/inbox');
  const region = el('div', { role: 'region', 'aria-label': t('ui.inbox_region'), class: 'inbox' });
  if (messages.length === 0) region.append(el('p', {}, [m('inbox.empty')]));
  for (const message of messages) {
    const link = el('a', { href: message.link }, [t('ui.review_link', { name: message.property })]);
    link.addEventListener('click', (event) => {
      event.preventDefault();
      void navigate(message.link);
    });
    region.append(el('p', {}, [link]));
  }
  main.append(region);
}

export async function accountPage(main: HTMLElement): Promise<void> {
  const me = await api<{ tier: string; completed_stays: number; perks: string[] }>('/api/me');
  const region = el('div', { role: 'region', 'aria-label': t('ui.loyalty'), class: 'loyalty' });
  const paint = (tier: string, stays: number, perks: string[]): void => {
    clear(region);
    region.append(el('p', {}, [m('loyalty.line', { tier, n: stays, count: stays })]));
    for (const perk of perks) region.append(el('p', {}, [m(perk)]));
  };
  paint(me.tier, me.completed_stays, me.perks);
  onEvent('account.changed', (data) => {
    void (async () => {
      const fresh = await api<{ tier: string; completed_stays: number; perks: string[] }>('/api/me');
      paint(fresh.tier, fresh.completed_stays, fresh.perks);
      void data;
    })();
  });
  const signOut = el('button', { type: 'button', 'data-focus-key': 'account:signout' }, [
    t('ui.sign_out_everywhere'),
  ]);
  signOut.addEventListener('click', () => {
    void (async () => {
      await api('/api/signout-everywhere', { method: 'POST', busy: signOut }).catch(() => undefined);
      state.me.user = null;
      toast(m('signed.out'));
      await navigate('/signin');
    })();
  });
  main.append(region, signOut);
}

export function signInPage(main: HTMLElement): void {
  const username = el('input', { type: 'text', 'aria-label': t('ui.username'), class: 'field' });
  const password = el('input', { type: 'password', 'aria-label': t('ui.password'), class: 'field' });
  const button = el('button', { type: 'submit' }, [t('ui.sign_in')]);
  const message = el('p', { class: 'field-message' });
  const create = el('a', { href: '/signup' }, [t('ui.create_account')]);
  create.addEventListener('click', (event) => {
    event.preventDefault();
    void navigate('/signup');
  });
  const form = el('form', { 'aria-label': t('ui.sign_in'), class: 'auth-form' }, [
    username,
    password,
    button,
    message,
    create,
  ]);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void (async () => {
      try {
        const user = await api<{ username: string; role: string; manages: string[] }>('/api/signin', {
          method: 'POST',
          body: { username: username.value.trim().toLowerCase(), password: password.value },
          busy: button,
        });
        state.me.user = user;
        await navigate('/account');
      } catch (err) {
        const failure = failureOf(err);
        message.textContent = m(failure?.status === 429 ? 'rate.limited' : 'signin.failed');
      }
    })();
  });
  main.append(form);
}

export function signUpPage(main: HTMLElement): void {
  const username = el('input', { type: 'text', 'aria-label': t('ui.username'), class: 'field' });
  const password = el('input', { type: 'password', 'aria-label': t('ui.password'), class: 'field' });
  const button = el('button', { type: 'submit' }, [t('ui.create_account')]);
  const message = el('p', { class: 'field-message' });
  const form = el('form', { 'aria-label': t('ui.create_account'), class: 'auth-form' }, [
    username,
    password,
    button,
    message,
  ]);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void (async () => {
      try {
        const user = await api<{ username: string; role: string }>('/api/signup', {
          method: 'POST',
          body: { username: username.value.trim().toLowerCase(), password: password.value },
          busy: button,
        });
        state.me.user = { username: user.username, role: user.role, manages: [] };
        await navigate('/account');
      } catch (err) {
        const failure = failureOf(err);
        if (failure?.status === 409) message.textContent = m('signup.taken');
        else {
          const fields = (failure?.body.fields ?? {}) as Record<string, string>;
          message.textContent = Object.values(fields).map((key) => m(key)).join(' ');
        }
      }
    })();
  });
  main.append(form);
}

export async function reviewPage(main: HTMLElement, route: Route): Promise<void> {
  const token = route.path.split('/')[2];
  const holder = el('div', { class: 'review' });
  main.append(holder);

  const paint = async (): Promise<void> => {
    clear(holder);
    try {
      await api<{ property: string; in: string; out: string; open_until: string }>(`/api/reviews/${token}`);
    } catch (err) {
      const failure = failureOf(err);
      const key =
        failure?.body.error === 'too_early'
          ? 'review.early'
          : failure?.body.error === 'window_closed'
            ? 'review.closed'
            : failure?.body.error === 'already_reviewed'
              ? 'review.used'
              : 'page.missing';
      holder.append(el('p', {}, [m(key)]));
      return;
    }
    const aspects = ['cleanliness', 'comfort', 'location', 'staff', 'value'] as const;
    const inputs = new Map<string, HTMLInputElement>();
    const form = el('form', { class: 'review-form' });
    for (const aspect of aspects) {
      const input = spinbutton({
        label: t(`ui.${aspect}`),
        min: 1,
        max: 10,
        value: 8,
        focusKey: `review:${aspect}`,
        onChange: () => undefined,
      });
      inputs.set(aspect, input);
      form.append(input);
    }
    const comment = el('textarea', { 'aria-label': t('ui.comment'), class: 'field' });
    const button = el('button', { type: 'submit' }, [t('ui.send_review')]);
    const message = el('p', { class: 'field-message' });
    form.append(comment, button, message);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      void (async () => {
        try {
          await api(`/api/reviews/${token}`, {
            method: 'POST',
            busy: button,
            body: {
              cleanliness: Number(inputs.get('cleanliness')?.value),
              comfort: Number(inputs.get('comfort')?.value),
              location: Number(inputs.get('location')?.value),
              staff: Number(inputs.get('staff')?.value),
              value: Number(inputs.get('value')?.value),
              comment: comment.value,
            },
          });
          toast(m('toast.review_sent'));
          await paint();
        } catch (err) {
          const failure = failureOf(err);
          const fields = (failure?.body.fields ?? {}) as Record<string, string>;
          message.textContent = Object.values(fields).map((key) => m(key)).join(' ');
        }
      })();
    });
    holder.append(form);
  };

  await paint();
  onEvent('clock', () => void paint());
}

export async function moderationPage(main: HTMLElement): Promise<void> {
  const holder = el('div', { class: 'moderation' });
  main.append(holder);
  const paint = async (): Promise<void> => {
    clear(holder);
    try {
      const reviews = await api<{ id: number; property: string; scores: number[]; comment: string }[]>(
        '/api/moderation/reviews',
      );
      if (reviews.length === 0) holder.append(el('p', {}, [m('moderation.empty')]));
      for (const review of reviews) {
        const publish = el('button', { type: 'button' }, [t('ui.publish_review', { id: review.id })]);
        const reject = el('button', { type: 'button' }, [t('ui.reject_review', { id: review.id })]);
        publish.addEventListener('click', () => {
          void (async () => {
            await api(`/api/moderation/reviews/${review.id}/publish`, { method: 'POST', busy: publish });
            toast(m('toast.published'));
            await paint();
          })();
        });
        reject.addEventListener('click', () => {
          void (async () => {
            await api(`/api/moderation/reviews/${review.id}/reject`, { method: 'POST', busy: reject });
            toast(m('toast.rejected'));
            await paint();
          })();
        });
        holder.append(
          el('article', {}, [
            el('p', {}, [review.property]),
            el('p', {}, [review.scores.join(', ')]),
            el('p', {}, [review.comment]),
            publish,
            reject,
          ]),
        );
      }
    } catch (err) {
      const failure = failureOf(err);
      holder.append(el('p', {}, [m(failure?.status === 403 ? 'page.forbidden' : 'page.missing')]));
    }
  };
  await paint();
}

export function notFoundPage(main: HTMLElement): void {
  main.append(
    el('div', { class: 'empty' }, [
      el('p', { class: 'huge-word' }, [m('empty.results.word')]),
      el('p', {}, [m('page.missing')]),
    ]),
  );
}

