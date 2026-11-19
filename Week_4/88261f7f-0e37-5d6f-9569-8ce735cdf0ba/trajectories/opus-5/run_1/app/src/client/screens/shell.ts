import { button, el } from '../dom';
import { navigate, signOut, state } from '../app';

interface NavLink {
  label: string;
  route: string;
  roles: Array<'owner' | 'front_desk' | 'housekeeper'>;
}

const links: NavLink[] = [
  { label: 'Desk', route: '/desk', roles: ['owner', 'front_desk'] },
  { label: 'Guests', route: '/guests', roles: ['owner', 'front_desk'] },
  { label: 'Rates', route: '/rates', roles: ['owner'] },
  { label: 'Reports', route: '/reports', roles: ['owner'] },
  { label: 'Board', route: '/board', roles: ['owner', 'front_desk', 'housekeeper'] },
];

function mainNav(): HTMLElement {
  const role = state.user ? state.user.role : 'housekeeper';
  const nav = el('nav', { 'aria-label': 'Main', class: 'mainnav' });
  for (const link of links) {
    if (!link.roles.includes(role)) continue;
    const anchor = el('a', {
      href: link.route,
      class: state.route === link.route ? 'navlink current' : 'navlink',
    }, [link.label]);
    anchor.addEventListener('click', (event) => {
      event.preventDefault();
      navigate(link.route);
    });
    nav.append(anchor);
  }
  nav.append(button('Sign out', () => void signOut(), { class: 'quiet' }));
  return nav;
}

export function shell(topbarExtras: Node[], content: Node[]): HTMLElement {
  return el('div', { class: 'shell', 'data-layout': state.layout }, [
    el('header', { class: 'topbar' }, [mainNav(), ...topbarExtras]),
    ...content,
  ]);
}
