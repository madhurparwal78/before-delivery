// The public landing page.

import { el } from './dom';
import { heroCollage, hubDiagram, iconTile } from './illustrations';

const personas = [
  {
    title: "The engineer's desk",
    audience: 'For the localization engineer who runs several client apps alone.',
    body:
      'Import a client\u2019s legacy memory, branch a feature, draft with routed AI, review what scores low and publish only what you approved.',
    matters: [
      'Exact matches survive casing, spacing and placeholder styles.',
      'Branch merges never overwrite a translation silently.',
      'Any import or merge restores to the exact earlier state.',
      'Originals are kept byte for byte as submitted.',
    ],
    link: 'Open the engineer walkthrough',
  },
  {
    title: "The client reviewer's queue",
    audience: 'For the linguist or product owner invited to one client project.',
    body:
      'Work only the segments assigned to you, on a phone, by keyboard alone: approve what reads well and correct what does not.',
    matters: [
      'You see only the projects you were invited to.',
      'Assignments hold your segments until they expire.',
      'MQM issues explain why a segment landed in review.',
      'Your corrections are kept with your comment.',
    ],
    link: 'Open the reviewer walkthrough',
  },
];

const posture: [string, string, string][] = [
  ['One session cookie', 'cookie', 'Signing in sets one HttpOnly session cookie and nothing else.'],
  ['Files kept as submitted', 'file', 'Every uploaded memory and locale file is stored byte for byte.'],
  ['Exact restore', 'restore', 'An import or merge restores main and the memory exactly as they were.'],
  ['Erasure on request', 'erase', 'Erasing a project removes its rows, files, tokens and webhooks.'],
  ['Signed webhooks', 'signature', 'Publish and review events are signed and retried until your CI answers.'],
  ['Scoped reviewer access', 'scope', 'Reviewers reach only their projects and their assigned segments.'],
  ['Per-project CI tokens', 'token', 'Each token pulls locales for one project and nothing else.'],
  ['Six-month audit log', 'clock', 'Every state change is logged and kept for 183 days.'],
  ['Formula-safe exports', 'table', 'Exported cells that start with a formula character are neutralised.'],
  ['Same-origin only', 'origin', 'The browser talks to this origin alone; no third-party scripts or fonts.'],
  ['Your own storage', 'storage', 'Records live in your Postgres and your object storage.'],
  ['No trackers', 'tracker', 'No analytics, advertising or tracking cookies at all.'],
];

export function renderLanding(screen: HTMLElement): void {
  screen.append(
    el('section', { class: 'band hero' }, [
      el('div', { class: 'content-column hero-inner' }, [
        el('div', { class: 'hero-copy' }, [
          el('h1', {}, [
            el('span', { text: 'Keep every string.' }),
            el('span', { text: 'Branch without losing one.' }),
            el('span', { text: 'Publish what you approved.' }),
          ]),
          el('p', {
            class: 'lead',
            text: 'Translation memory, branches, AI drafts and MQM review for the engineer who runs several client apps alone.',
          }),
          el('a', { href: '/sign-in', class: 'button primary', text: 'Open the demo desk' }),
        ]),
        heroCollage(),
      ]),
    ]),

    el('section', {
      class: 'band tinted',
      role: 'region',
      'aria-label': 'Who works here',
    }, [
      el('div', { class: 'content-column' }, [
        el('div', { class: 'persona-grid' }, personas.map((persona) =>
          el('article', { class: 'card persona-card' }, [
            hubDiagram(`How ${persona.title} connects apps, languages, the memory and the AI route`),
            el('h2', { text: persona.title }),
            el('p', { class: 'audience', text: persona.audience }),
            el('p', { text: persona.body }),
            el('p', { class: 'matters-label', text: 'What matters' }),
            el('ul', {}, persona.matters.map((item) => el('li', { text: item }))),
            el('a', { class: 'link-arrow', href: '/sign-in' }, [
              persona.link,
              el('span', { class: 'arrow', 'aria-hidden': 'true', text: '\u2192' }),
            ]),
          ]),
        )),
      ]),
    ]),

    el('section', {
      class: 'band',
      role: 'region',
      'aria-label': 'Security and hosting',
    }, [
      el('div', { class: 'content-column' }, [
        el('h2', { class: 'centred two-line' }, [
          el('span', { text: "How your clients' strings are kept" }),
          el('span', { class: 'subheading', text: 'One session, your own storage, and an audit trail you can export.' }),
        ]),
        el('div', { class: 'posture-grid' }, posture.map(([title, glyph, body]) =>
          el('div', { class: 'posture-item' }, [
            iconTile(glyph),
            el('h3', { text: title }),
            el('p', { text: body }),
          ]),
        )),
        el('div', { class: 'centred' }, [
          el('a', { href: '/sign-in', class: 'button primary', text: 'Open the demo desk' }),
        ]),
      ]),
    ]),
  );
}

export function landingHeader(): HTMLElement {
  return el('header', { class: 'desk-header landing-header' }, [
    el('div', { class: 'content-column header-inner' }, [
      el('a', { href: '/', class: 'brand', 'aria-label': 'Interline Desk', text: 'Interline Desk' }),
      el('div', { class: 'header-desktop' }, [
        el('a', { href: '/sign-in', class: 'header-link', text: 'Sign in' }),
        el('a', { href: '/sign-in', class: 'button primary', text: 'Open the demo desk' }),
      ]),
    ]),
  ]);
}
