// The staff frame: the narrow left rail with the role's sections, the work
// column and the evidence column. Below 1120 px the rail becomes a Sections
// bottom sheet.
import { h } from './dom.js';
import { openDialog } from './panels.js';
import { navigate } from './router.js';
import { api } from './api.js';
import { getSession, workspace, type WorkspaceInfo } from './state.js';
import { liveRegion, Desk } from './feedback.js';

export interface StaffView { slug: string; ws: WorkspaceInfo; desk: Desk; work: HTMLElement; evidence: HTMLElement; container: HTMLElement }

const SECTIONS: { label: string; path: (slug: string) => string; roles: string[] }[] = [
  { label: 'Withdrawals', path: (s) => `/w/${s}/cases`, roles: ['compliance_officer', 'compliance_analyst', 'operations_lead', 'finance_lead', 'support_agent'] },
  { label: 'Review queue', path: (s) => `/w/${s}/review`, roles: ['compliance_officer', 'compliance_analyst', 'support_agent'] },
  { label: 'Incoming messages', path: (s) => `/w/${s}/messages`, roles: ['compliance_officer', 'compliance_analyst', 'operations_lead', 'support_agent'] },
  { label: 'Counterparties', path: (s) => `/w/${s}/counterparties`, roles: ['compliance_officer', 'compliance_analyst', 'operations_lead', 'finance_lead', 'support_agent'] },
  { label: 'Rules', path: (s) => `/w/${s}/rules`, roles: ['compliance_officer', 'compliance_analyst', 'operations_lead', 'finance_lead', 'support_agent'] },
  { label: 'Daily report', path: (s) => `/w/${s}/reports/daily`, roles: ['compliance_officer', 'compliance_analyst'] },
  { label: 'Months', path: (s) => `/w/${s}/months`, roles: ['compliance_officer', 'finance_lead'] },
  { label: "Regulator's files", path: (s) => `/w/${s}/files`, roles: ['compliance_officer', 'compliance_analyst', 'support_agent'] },
  { label: 'Partner keys', path: (s) => `/w/${s}/partner-keys`, roles: ['compliance_officer'] },
  { label: 'Members', path: (s) => `/w/${s}/members`, roles: ['compliance_officer'] },
  { label: 'Directory listing', path: (s) => `/w/${s}/listing`, roles: ['compliance_officer'] },
];

export async function staffView(root: HTMLElement, slug: string): Promise<StaffView | null> {
  const ws = await workspace(slug);
  const session = getSession();
  if (ws === null || session === null) return null;
  const role = session.member.role;

  const deskStatus = liveRegion('Desk status');
  const desk = new Desk(deskStatus);

  const links = SECTIONS.filter((s) => s.roles.includes(role)).map((s) =>
    h('a', { href: s.path(slug), class: 'rail-link' }, s.label),
  );

  const signOut = h('button', {
    type: 'button',
    class: 'btn rail-signout',
    'aria-label': 'Sign out',
    onclick: async () => {
      desk.announce('Signing out…');
      await api('DELETE', '/api/session');
      navigate('/sign-in', true);
    },
  }, 'Sign out');

  const nav = h('nav', { 'aria-label': 'Workspace', class: 'rail' },
    h('header', { class: 'rail-header' },
      h('div', { class: 'rail-workspace' }, ws.name),
      h('div', { class: 'rail-city' }, `${ws.city} time`),
    ),
    ...links,
    signOut,
  );

  const work = h('main', { class: 'work-column', 'aria-label': 'Work' });
  const evidence = h('aside', { class: 'evidence-column' });
  const sectionsSheet = h('button', {
    type: 'button',
    class: 'btn sections-button',
    'aria-label': 'Sections',
    onclick: (e: Event) => {
      const opener = e.currentTarget as HTMLElement;
      openDialog({
        name: 'Sections',
        kind: 'sheet',
        opener,
        onClose: () => {},
        build: (dialog) => {
          dialog.classList.add('sections-sheet');
          const first = h('a', { href: links.length > 0 ? links[0].getAttribute('href') ?? '#' : '#', class: 'rail-link' }, links[0]?.textContent ?? '');
          dialog.append(first);
          for (const link of links.slice(1)) {
            dialog.append(h('a', { href: link.getAttribute('href') ?? '#', class: 'rail-link' }, link.textContent ?? ''));
          }
          dialog.append(h('button', { type: 'button', class: 'btn rail-signout', 'aria-label': 'Sign out', onclick: async () => {
            await api('DELETE', '/api/session');
            navigate('/sign-in', true);
          } }, 'Sign out'));
        },
      });
    },
  }, 'Sections');

  const container = h('div', { class: 'staff-container' }, nav, h('div', { class: 'work-wrap' }, work, evidence), sectionsSheet, deskStatus);
  root.append(container);
  return { slug, ws, desk, work, evidence, container };
}

export function h1(text: string): HTMLElement {
  return h('h1', {}, text);
}
