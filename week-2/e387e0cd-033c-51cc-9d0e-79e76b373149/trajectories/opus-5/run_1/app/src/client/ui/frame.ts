import { get, request, RequestFailed } from '../api';
import { button, element } from '../dom';
import { navigate } from '../router';
import { Dialog } from './dialog';
import { StatusRegion } from './live';

export interface MemberFacts {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly role: string;
}

export interface WorkspaceFacts {
  readonly slug: string;
  readonly name: string;
  readonly legalName: string;
  readonly lei: string;
  readonly jurisdictionCode: string;
  readonly timeZone: string;
  readonly city: string;
  readonly currency: string;
  readonly confirmationLimitCents: number;
  readonly today: string;
  readonly now: string;
}

interface SessionBody {
  member: MemberFacts;
  workspace: { slug: string; name: string };
  home: string;
}

export interface Section {
  readonly label: string;
  readonly path: string;
  readonly roles: readonly string[];
}

export const SECTIONS: readonly Section[] = [
  { label: 'Withdrawals', path: 'cases', roles: ['compliance_officer', 'compliance_analyst', 'operations_lead', 'finance_lead', 'support_agent'] },
  { label: 'Review queue', path: 'review', roles: ['compliance_officer', 'compliance_analyst', 'support_agent'] },
  { label: 'Incoming messages', path: 'messages', roles: ['compliance_officer', 'compliance_analyst', 'operations_lead', 'support_agent'] },
  { label: 'Counterparties', path: 'counterparties', roles: ['compliance_officer', 'compliance_analyst', 'operations_lead', 'finance_lead', 'support_agent'] },
  { label: 'Rules', path: 'rules', roles: ['compliance_officer', 'compliance_analyst', 'operations_lead', 'finance_lead', 'support_agent'] },
  { label: 'Daily report', path: 'reports/daily', roles: ['compliance_officer', 'compliance_analyst'] },
  { label: 'Months', path: 'months', roles: ['compliance_officer', 'finance_lead'] },
  { label: "Regulator's files", path: 'files', roles: ['compliance_officer', 'compliance_analyst', 'support_agent'] },
  { label: 'Partner keys', path: 'partner-keys', roles: ['compliance_officer'] },
  { label: 'Members', path: 'members', roles: ['compliance_officer'] },
  { label: 'Directory listing', path: 'listing', roles: ['compliance_officer'] },
];

export interface StaffFrame {
  readonly work: HTMLElement;
  readonly evidence: HTMLElement;
  readonly status: StatusRegion;
  readonly layer: HTMLElement;
  readonly member: MemberFacts;
  readonly workspace: WorkspaceFacts;
  readonly dialogs: Dialog[];
  destroy(): void;
}

export const RETURN_ROUTE_KEY = 'lanternline.return-route';

export async function staffFrame(
  host: HTMLElement,
  slug: string,
  activePath: string,
): Promise<StaffFrame | null> {
  let session: SessionBody;
  let workspace: WorkspaceFacts;
  try {
    session = await get<SessionBody>('/api/session');
    const body = await get<{ workspace: WorkspaceFacts }>(`/api/w/${slug}`);
    workspace = body.workspace;
  } catch (error) {
    if (error instanceof RequestFailed && error.failure.status === 401) {
      window.sessionStorage.setItem(RETURN_ROUTE_KEY, window.location.pathname + window.location.search);
      navigate('/sign-in', { replace: true });
      return null;
    }
    throw error;
  }

  const status = new StatusRegion('Desk status');
  const sections = SECTIONS.filter((section) => section.roles.includes(session.member.role));
  const dialogs: Dialog[] = [];

  const makeLinks = (): HTMLElement[] =>
    sections.map((section) => {
      const href = `/w/${slug}/${section.path}`;
      const anchor = element('a', {
        text: section.label,
        className: 'rail-link control',
        attributes: { href },
      });
      if (section.path === activePath) anchor.setAttribute('aria-current', 'page');
      return anchor;
    });

  const signOut = button('Sign out', () => {
    void request('DELETE', '/api/session').then(() => navigate('/sign-in'));
  });

  const rail = element('nav', {
    className: 'rail',
    attributes: { 'aria-label': 'Workspace' },
    children: [
      element('div', {
        className: 'rail-header',
        children: [
          element('p', { text: workspace.name, className: 'rail-workspace' }),
          element('p', { text: `${workspace.city} time`, className: 'rail-city' }),
        ],
      }),
      element('div', { className: 'rail-links', children: makeLinks() }),
      signOut,
    ],
  });

  const layer = element('div', { className: 'dialog-layer' });
  const sectionsSheet = new Dialog(layer, {
    name: 'Sections',
    style: 'bottom-sheet',
    build: (controller) => {
      const links = makeLinks();
      for (const anchor of links) anchor.addEventListener('click', () => controller.close());
      const sheetSignOut = button('Sign out', () => {
        void request('DELETE', '/api/session').then(() => navigate('/sign-in'));
      });
      return {
        body: [
          element('h2', { text: 'Sections', className: 'dialog-title' }),
          element('nav', {
            attributes: { 'aria-label': 'Workspace' },
            className: 'rail-links',
            children: [...links, sheetSignOut],
          }),
        ],
        first: () => links[0] ?? null,
      };
    },
  });
  dialogs.push(sectionsSheet);

  const sectionsButton = button('Sections', () => sectionsSheet.open(sectionsButton), {
    className: 'control sections-button',
  });

  const work = element('div', { className: 'work-column' });
  const evidence = element('div', { className: 'evidence-column' });

  host.append(
    element('div', {
      className: 'staff-frame',
      children: [
        element('div', { className: 'top-bar', children: [sectionsButton] }),
        rail,
        element('div', {
          className: 'columns',
          children: [
            element('main', { className: 'work-main', children: [status.node, work] }),
            evidence,
          ],
        }),
        layer,
      ],
    }),
  );

  return {
    work,
    evidence,
    status,
    layer,
    member: session.member,
    workspace,
    dialogs,
    destroy(): void {
      for (const dialog of dialogs) dialog.destroy();
    },
  };
}
