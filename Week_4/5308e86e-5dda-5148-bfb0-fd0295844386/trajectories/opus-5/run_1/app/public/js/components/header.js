// The marketing header: four disclosure menus, complete by keyboard and
// pointer. A closed panel is absent from the accessibility tree.

import { el, icon, mark, focusables, trapTab } from '../dom.js';

const MENUS = [
  {
    name: 'Products',
    links: [
      ['Business banking', '/business-banking'],
      ['Payments', '/business-payments'],
      ['Credit card', '/credit'],
      ['Treasury', '/treasury'],
      ['Invoicing', '/invoicing'],
      ['Spend management', '/spend-management'],
      ['Payroll', '/payroll'],
      ['Books', '/books'],
    ],
  },
  {
    name: 'Solutions',
    links: [
      ['Venture debt', '/venture-debt'],
      ['Working capital loans', '/working-capital-loans'],
    ],
  },
  {
    name: 'Resources',
    links: [
      ['Demo', '/demo'],
      ['Plans and pricing', '/pricing'],
    ],
  },
  {
    name: 'About',
    links: [
      ['Contact sales', '/contact'],
      ['Open an account', '/signup'],
    ],
  },
];

function panelId(name) {
  return `header-panel-${name.toLowerCase()}`;
}

export function header() {
  const banner = el('header', { class: 'site-header', role: 'banner' });
  const inner = el('div', { class: 'site-header-inner' });
  banner.append(inner);

  const brand = el('a', { class: 'brand', href: '/' }, [mark(26), el('span', { text: 'Tallwind' })]);
  inner.append(brand);

  const centre = el('nav', { class: 'header-centre', 'aria-label': 'Main' });
  const right = el('div', { class: 'header-right' });

  let openName = null;
  let openPanel = null;
  const triggers = new Map();

  function closeMenu({ focusTrigger = false } = {}) {
    if (!openName) return;
    const name = openName;
    if (openPanel) openPanel.remove();
    openPanel = null;
    openName = null;
    triggers.get(name).setAttribute('aria-expanded', 'false');
    if (focusTrigger) triggers.get(name).focus();
  }

  function headerControlAfter(trigger) {
    const list = focusables(banner).filter((node) => !openPanel || !openPanel.contains(node));
    const index = list.indexOf(trigger);
    return index === -1 ? null : list[index + 1] || null;
  }

  function openMenu(menu, { focusFirstLink = false } = {}) {
    if (openName === menu.name) {
      if (focusFirstLink) openPanel.querySelector('a').focus();
      return;
    }
    closeMenu();
    const trigger = triggers.get(menu.name);
    const items = menu.links.map(([label, href]) => el('li', {}, [el('a', { href, text: label })]));
    const panel = el(
      'ul',
      { class: 'menu-panel', id: panelId(menu.name), 'aria-label': `${menu.name} menu` },
      items
    );
    panel.addEventListener('keydown', (event) => {
      const links = [...panel.querySelectorAll('a')];
      const current = links.indexOf(document.activeElement);
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        links[(current + 1 + links.length) % links.length].focus();
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        links[(current - 1 + links.length) % links.length].focus();
      } else if (event.key === 'Home') {
        event.preventDefault();
        links[0].focus();
      } else if (event.key === 'End') {
        event.preventDefault();
        links[links.length - 1].focus();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        closeMenu({ focusTrigger: true });
      } else if (event.key === 'Tab' && !event.shiftKey && current === links.length - 1) {
        event.preventDefault();
        const next = headerControlAfter(trigger);
        closeMenu();
        if (next) next.focus();
      } else if (event.key === 'Tab' && event.shiftKey && current === 0) {
        event.preventDefault();
        trigger.focus();
      }
    });
    trigger.after(panel);
    trigger.setAttribute('aria-expanded', 'true');
    openName = menu.name;
    openPanel = panel;
    if (focusFirstLink) panel.querySelector('a').focus();
  }

  for (const menu of MENUS) {
    const trigger = el(
      'button',
      {
        type: 'button',
        class: 'menu-trigger',
        'aria-expanded': 'false',
        'aria-controls': panelId(menu.name),
      },
      [el('span', { text: menu.name }), icon('chevronDown', { size: 12 })]
    );
    triggers.set(menu.name, trigger);
    trigger.addEventListener('click', (event) => {
      event.preventDefault();
      if (openName === menu.name) closeMenu();
      else openMenu(menu);
    });
    trigger.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        openMenu(menu, { focusFirstLink: true });
      } else if (event.key === 'Escape') {
        event.preventDefault();
        closeMenu({ focusTrigger: true });
      } else if (event.key === 'ArrowUp' && openName === menu.name) {
        event.preventDefault();
        const links = [...openPanel.querySelectorAll('a')];
        links[links.length - 1].focus();
      }
    });
    centre.append(trigger);
  }
  centre.append(el('a', { class: 'header-link', href: '/pricing', text: 'Pricing' }));

  right.append(el('a', { class: 'header-link', href: '/app', text: 'Dashboard' }));
  right.append(el('a', { class: 'header-link', href: '/login', text: 'Log in' }));
  right.append(el('a', { class: 'pill', href: '/signup', text: 'Open account' }));

  const mobileToggle = el(
    'button',
    { type: 'button', class: 'icon-btn mobile-toggle', 'aria-expanded': 'false', 'aria-label': 'Open Menu' },
    [icon('menu', { size: 20 })]
  );

  let mobilePanel = null;
  let scrim = null;

  function closeMobile({ focusToggle = false } = {}) {
    if (!mobilePanel) return;
    mobilePanel.remove();
    if (scrim) scrim.remove();
    mobilePanel = null;
    scrim = null;
    mobileToggle.setAttribute('aria-expanded', 'false');
    if (focusToggle) mobileToggle.focus();
  }

  function openMobile() {
    if (mobilePanel) {
      closeMobile();
      return;
    }
    scrim = el('div', { class: 'rail-scrim' });
    scrim.addEventListener('click', () => closeMobile());
    mobilePanel = el('div', { class: 'mobile-panel', role: 'dialog', 'aria-label': 'Menu' });
    for (const menu of MENUS) {
      const groupId = `mobile-${menu.name.toLowerCase()}`;
      const groupTrigger = el(
        'button',
        { type: 'button', class: 'menu-trigger', 'aria-expanded': 'false', 'aria-controls': groupId },
        [el('span', { text: menu.name }), icon('chevronDown', { size: 12 })]
      );
      const list = el(
        'ul',
        { class: 'mobile-group-links', id: groupId },
        menu.links.map(([label, href]) => el('li', {}, [el('a', { href, text: label })]))
      );
      list.hidden = true;
      groupTrigger.addEventListener('click', () => {
        const open = groupTrigger.getAttribute('aria-expanded') === 'true';
        groupTrigger.setAttribute('aria-expanded', open ? 'false' : 'true');
        list.hidden = open;
      });
      mobilePanel.append(groupTrigger, list);
    }
    mobilePanel.append(
      el('a', { class: 'header-link', href: '/pricing', text: 'Pricing' }),
      el('a', { class: 'header-link', href: '/app', text: 'Dashboard' }),
      el('a', { class: 'header-link', href: '/login', text: 'Log in' }),
      el('a', { class: 'pill', href: '/signup', text: 'Open account' })
    );
    mobilePanel.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeMobile({ focusToggle: true });
        return;
      }
      trapTab(mobilePanel, event);
    });
    document.body.append(scrim, mobilePanel);
    mobileToggle.setAttribute('aria-expanded', 'true');
    const first = mobilePanel.querySelector('button');
    if (first) first.focus();
  }

  mobileToggle.addEventListener('click', openMobile);
  inner.append(centre, right, mobileToggle);

  const onDocumentClick = (event) => {
    if (!openName) return;
    const trigger = triggers.get(openName);
    if (openPanel.contains(event.target) || trigger.contains(event.target)) return;
    closeMenu();
  };
  document.addEventListener('click', onDocumentClick);

  banner.cleanup = () => {
    document.removeEventListener('click', onDocumentClick);
    closeMobile();
  };
  return banner;
}
