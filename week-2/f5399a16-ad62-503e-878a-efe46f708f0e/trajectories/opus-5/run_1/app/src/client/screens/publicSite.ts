import { COPY } from '../../domain/copy.js';
import { frameSvg } from '../../domain/drawing.js';
import {
  announce,
  api,
  go,
  isRefusal,
  queryOf,
  redraw,
  readSession,
  registerScreen,
  run,
  setQuery,
  state,
} from '../app.js';
import type { Child } from '../dom.js';
import { h } from '../dom.js';
import { NORMAL, recordPlaces, playMoves, reducedMotion } from '../motion.js';
import { button, field, headingNode, link, problemsRegion, redBar } from '../ui.js';

type Kind = 'boards' | 'reels' | 'pitchFrames';

const WORK: { title: string; kind: Kind }[] = [
  { title: 'Ferry at First Light', kind: 'boards' },
  { title: 'The Long Bakery Shift', kind: 'boards' },
  { title: 'Cold Snap Cola', kind: 'boards' },
  { title: 'Night Tram', kind: 'reels' },
  { title: 'Harbour Swimmers', kind: 'reels' },
  { title: 'Paper Kites', kind: 'reels' },
  { title: 'Rainline Coats', kind: 'pitchFrames' },
  { title: 'Orchard Bank', kind: 'pitchFrames' },
  { title: 'Salt and Thyme', kind: 'pitchFrames' },
];

const STRIP = [
  'Tidewater Soda',
  'Kestrel Air',
  'Oak & Ember Bakers',
  'Northquay Bank',
  'Lumen Bicycles',
  'Saffron Street Foods',
];

const ACCORDIONS: { key: string; label: string; words: string }[] = [
  {
    key: 'script',
    label: 'From script to frames',
    words:
      'A script file comes in as a table of shots. Each row becomes a frame with its visual, its audio and its length, and drawings land on the board one file at a time.',
  },
  {
    key: 'timing',
    label: 'Timing the reel',
    words:
      'The Slate strip holds one clip a frame. Trimming moves the later clips, and the strip reads exact against the length the job was sold at.',
  },
  {
    key: 'review',
    label: 'Review and notes',
    words:
      'A producer reads a numbered cut on a private page in their own language, pins notes to the frame and sends them once. The notes arrive on the desk in place.',
  },
  {
    key: 'delivery',
    label: 'Delivery and fee letter',
    words:
      'A signed-off cut makes a boards PDF, an edit decision list and a shot list. The fee letter states its amounts to the cent and is accepted on its own page.',
  },
];

const CITIES: { id: string; label: string; words: string }[] = [
  { id: 'amsterdam', label: 'Amsterdam', words: 'The desk. Mornings for drawing, afternoons for calls.' },
  { id: 'new-york', label: 'New York', words: 'Agency producers on Eastern time, booked in their own hours.' },
  { id: 'toronto', label: 'Toronto', words: 'Boards for Ontario shoots, with French and English on screen.' },
];

export const DESK_ADDRESS = 'desk@noorbakkerboards.example';

function drawnFrame(seed: number, label?: string): Child {
  return h('div', {
    class: 'drawn',
    'aria-hidden': 'true',
    html: frameSvg(seed, { width: 640, height: 360, ...(label === undefined ? {} : { label }) }),
  });
}

registerScreen({
  name: 'home',
  frame: 'public',
  heading: () => 'Boards drawn to the frame',
  ownHeading: true,
  view: () => [
    h(
      'div',
      { key: 'hero', class: 'hero' },
      h(
        'div',
        { class: 'hero__card' },
        h('div', { class: 'hero__band', 'aria-hidden': 'true' }),
        h('p', { class: 'hero__mark' }, 'Noor Bakker Boards'),
        headingNode(['Boards drawn', 'to the frame']),
        h(
          'p',
          { class: 'hero__words' },
          'One desk for the frames, the reel and the notes.',
        ),
        link('/reel', 'See the reel', { class: 'button button--primary' }),
        h(
          'p',
          { class: 'hero__links' },
          link('/how-it-works', 'How it works'),
          link('/how-it-works#amsterdam', 'Contact'),
          link('/sign-in', 'Sign in'),
        ),
      ),
      h(
        'div',
        { class: 'hero__room' },
        h('div', {
          class: 'hero__drawing',
          'aria-hidden': 'true',
          html: frameSvg(31, { width: 960, height: 1200 }),
        }),
        h('span', { class: 'hero__bar', 'aria-hidden': 'true' }),
      ),
    ),
    h(
      'section',
      { key: 'kinds', class: 'section' },
      h('h2', {}, 'Three kinds of work'),
      h(
        'ul',
        { class: 'kinds' },
        h('li', { key: 'boards' }, h('h3', {}, 'Boards'), 'Shot by shot, drawn to the frame.'),
        h('li', { key: 'reels' }, h('h3', {}, 'Story reels'), 'Frames with durations, timed to the sold length.'),
        h('li', { key: 'pitch' }, h('h3', {}, 'Pitch frames'), 'A few frames that sell the idea.'),
      ),
    ),
  ],
});

registerScreen({
  name: 'reel',
  frame: 'public',
  heading: () => 'Work on the reel',
  view: () => {
    const kind = queryOf().get('kind');
    const shown = WORK.filter((work) => kind === null || work.kind === kind);
    return [
      h(
        'div',
        {
          key: 'kinds',
          class: 'radio-row',
          role: 'radiogroup',
          'aria-label': 'Kind of work',
        },
        ...(
          [
            ['All', null],
            ['Boards', 'boards'],
            ['Reels', 'reels'],
            ['Pitch frames', 'pitchFrames'],
          ] as [string, string | null][]
        ).map(([label, value]) =>
          h(
            'label',
            { key: label, class: 'radio' },
            h('input', {
              type: 'radio',
              name: 'kind',
              checked: (kind ?? null) === value,
              onchange: () => {
                const places = recordPlaces(
                  document.querySelectorAll('[data-part="work"]'),
                );
                setQuery({ kind: value });
                requestAnimationFrame(() => playMoves(places, NORMAL));
              },
            }),
            h('span', {}, label),
          ),
        ),
      ),
      h(
        'ul',
        { key: 'grid', class: 'work-grid' },
        ...shown.map((work, index) =>
          h(
            'li',
            { key: work.title, 'data-part': 'work', class: 'work' },
            drawnFrame(index + 3),
            h('h2', { class: 'work__title' }, work.title),
          ),
        ),
      ),
      h(
        'section',
        {
          key: 'clients',
          class: 'clients',
          role: 'region',
          'aria-label': 'Clients',
        },
        h('h2', {}, 'Clients'),
        h(
          'div',
          { class: 'client-strip', 'data-part': 'client-strip', tabindex: '0' },
          h(
            'ul',
            { class: 'client-strip__row' },
            ...STRIP.map((name) => h('li', { key: name }, name)),
          ),
          h(
            'ul',
            { class: 'client-strip__row', 'aria-hidden': 'true' },
            ...STRIP.map((name) => h('li', { key: `${name}-again` }, name)),
          ),
        ),
      ),
    ];
  },
});

type EnquiryDraft = { name: string; email: string; phone: string; message: string };

const enquiry: EnquiryDraft = { name: '', email: '', phone: '', message: '' };
let enquiryThanks = false;

registerScreen({
  name: 'howItWorks',
  frame: 'public',
  heading: () => 'How the work runs',
  view: () => {
    const open = queryOf().get('open');
    return [
      h(
        'div',
        { key: 'accordions', class: 'accordions' },
        ...ACCORDIONS.map((entry) => {
          const isOpen = open === entry.key;
          return h(
            'div',
            { key: entry.key, class: 'accordion' },
            h(
              'h2',
              { class: 'accordion__head' },
              h(
                'button',
                {
                  type: 'button',
                  id: `accordion-${entry.key}`,
                  class: 'accordion__button',
                  'aria-expanded': isOpen ? 'true' : 'false',
                  'aria-controls': `panel-${entry.key}`,
                  onclick: () => setQuery({ open: isOpen ? null : entry.key }),
                },
                h('span', { class: 'accordion__glyph', 'aria-hidden': 'true' }),
                entry.label,
              ),
            ),
            isOpen
              ? h(
                  'div',
                  {
                    id: `panel-${entry.key}`,
                    class: 'accordion__panel',
                    role: 'region',
                    'aria-labelledby': `accordion-${entry.key}`,
                  },
                  h('p', {}, entry.words),
                )
              : null,
          );
        }),
      ),
      h(
        'section',
        { key: 'contact', class: 'section' },
        h('h2', {}, 'Where the work happens'),
        h(
          'nav',
          { class: 'city-links', 'aria-label': 'Cities' },
          ...CITIES.map((city) => link(`#${city.id}`, city.label, { onclick: landOnCity(city.id) })),
        ),
        ...CITIES.map((city) =>
          h(
            'div',
            { key: city.id, class: 'city' },
            h('h3', { id: city.id, class: 'city__heading', tabindex: '-1' }, city.label),
            h('p', {}, city.words),
          ),
        ),
        h(
          'p',
          { class: 'address' },
          h('span', { id: 'desk-address', class: 'address__text' }, DESK_ADDRESS),
          button({ id: 'copy-address', label: 'Copy address', onPress: copyAddress }),
        ),
      ),
      h(
        'form',
        {
          key: 'enquiry',
          class: 'form',
          'aria-label': 'Enquiry',
          onsubmit: (event: Event) => {
            event.preventDefault();
            void sendEnquiry();
          },
        },
        h('h2', {}, 'Send an enquiry'),
        problemsRegion(state.problems),
        field({
          id: 'name',
          label: 'Name',
          autocomplete: 'name',
          value: enquiry.name,
          onInput: (value) => {
            enquiry.name = value;
          },
          problem: state.problems['name'],
        }),
        field({
          id: 'email',
          label: 'Email',
          kind: 'email',
          autocomplete: 'email',
          value: enquiry.email,
          onInput: (value) => {
            enquiry.email = value;
          },
          problem: state.problems['email'],
        }),
        field({
          id: 'phone',
          label: 'Phone',
          kind: 'tel',
          autocomplete: 'tel',
          value: enquiry.phone,
          onInput: (value) => {
            enquiry.phone = value;
          },
          problem: state.problems['phone'],
        }),
        field({
          id: 'message',
          label: 'Message',
          kind: 'multiline',
          value: enquiry.message,
          onInput: (value) => {
            enquiry.message = value;
          },
          problem: state.problems['message'],
        }),
        button({
          id: 'send-enquiry',
          label: 'Send enquiry',
          kind: 'primary',
          pendingKey: 'enquiry',
          onPress: sendEnquiry,
        }),
        enquiryThanks ? h('p', { class: 'thanks' }, COPY.enquiryThanks) : null,
      ),
    ];
  },
});

function landOnCity(id: string) {
  return (event: Event): void => {
    event.preventDefault();
    const heading = document.getElementById(id);
    if (!(heading instanceof HTMLElement)) return;
    history.pushState({ scrollY: window.scrollY }, '', `#${id}`);
    heading.focus({ preventScroll: true });
    const top = heading.getBoundingClientRect().top + window.scrollY;
    const header = document.querySelector('.banner');
    const depth = header === null ? 0 : header.getBoundingClientRect().height;
    window.scrollTo({ top: top - depth - 12, behavior: reducedMotion() ? 'auto' : 'smooth' });
  };
}

/** When the clipboard is refused the address is selected as text in place. */
async function copyAddress(): Promise<void> {
  try {
    await navigator.clipboard.writeText(DESK_ADDRESS);
    announce(COPY.copyAddress);
  } catch {
    const text = document.getElementById('desk-address');
    if (text !== null) {
      const range = document.createRange();
      range.selectNodeContents(text);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    }
    announce(COPY.copyAddressRefused);
  }
}

async function sendEnquiry(): Promise<void> {
  await run('enquiry', async () => {
    state.problems = {};
    try {
      const answer = await api<{ message: string }>('/api/enquiries', {
        method: 'POST',
        body: enquiry,
      });
      enquiryThanks = true;
      announce(answer.message);
      redraw();
    } catch (error) {
      if (isRefusal(error)) {
        state.problems = error.failure.fields;
        announce(error.failure.message);
        redraw();
        requestAnimationFrame(() => {
          document.querySelector<HTMLElement>('.problems')?.focus();
        });
        return;
      }
      throw error;
    }
  });
}

type SignInDraft = { name: string; email: string; password: string };
const signIn: SignInDraft = { name: '', email: '', password: '' };

function accessScreen(name: 'signIn' | 'signUp'): void {
  const isUp = name === 'signUp';
  const label = isUp ? 'Start a desk' : 'Sign in';
  const press = (id: string): Child =>
    button({
      id,
      label,
      kind: 'primary',
      pendingKey: 'access',
      onPress: () =>
        void run('access', async () => {
          state.problems = {};
          try {
            await api(isUp ? '/api/sign-up' : '/api/sign-in', {
              method: 'POST',
              body: isUp
                ? { name: signIn.name, email: signIn.email, password: signIn.password }
                : { email: signIn.email, password: signIn.password },
            });
            state.sessionEnded = false;
            const next = queryOf().get('next');
            await readSession();
            await go(next ?? '/desk/jobs');
          } catch (error) {
            if (isRefusal(error)) {
              state.problems =
                Object.keys(error.failure.fields).length > 0
                  ? error.failure.fields
                  : { password: error.failure.message };
              announce(error.failure.message);
              redraw();
              return;
            }
            throw error;
          }
        }),
    });

  registerScreen({
    name,
    frame: 'public',
    heading: () => label,
    view: () => [
      h(
        'form',
        {
          key: 'access',
          class: 'form form--narrow',
          'aria-label': label,
          onsubmit: (event: Event) => {
            event.preventDefault();
            document.getElementById(name)?.click();
          },
        },
        problemsRegion(state.problems),
        isUp
          ? field({
              id: 'name',
              label: 'Name',
              autocomplete: 'name',
              value: signIn.name,
              onInput: (value) => {
                signIn.name = value;
              },
              problem: state.problems['name'],
            })
          : null,
        field({
          id: 'email',
          label: 'Email',
          kind: 'email',
          autocomplete: 'email',
          value: signIn.email,
          onInput: (value) => {
            signIn.email = value;
          },
          problem: state.problems['email'],
        }),
        field({
          id: 'password',
          label: 'Password',
          kind: 'password',
          autocomplete: isUp ? 'new-password' : 'current-password',
          value: signIn.password,
          onInput: (value) => {
            signIn.password = value;
          },
          problem: state.problems['password'],
        }),
        press(name),
        state.sessionEnded ? h('p', {}, link('/sign-in', 'Sign in again')) : null,
      ),
    ],
  });
}

accessScreen('signIn');
accessScreen('signUp');

registerScreen({
  name: 'notFound',
  frame: 'public',
  heading: () => 'Page not found',
  view: () => [
    h('p', { key: 'words' }, redBar(), 'That address has nothing on it. The reel is this way.'),
    h('p', { key: 'link' }, link('/reel', 'Work on the reel')),
  ],
});
