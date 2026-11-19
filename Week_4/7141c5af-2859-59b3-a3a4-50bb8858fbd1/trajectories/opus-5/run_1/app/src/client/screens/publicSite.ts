/**
 * The public site: the Work panel, the work filter, the case rail and the
 * enquiry and access forms.
 */
import { F } from '../../shared/feedback.ts';
import { PUBLIC_CASES } from '../../shared/cases.ts';
import { chairDrawing } from '../../shared/drawings.ts';
import { api, fieldProblems, ApiError } from '../ui/api.ts';
import { DURATION, animate, crossFade, reducedMotion, stopAnimations } from '../ui/motion.ts';
import { all, el, find, need, setAttr, setText } from '../ui/dom.ts';
import { announce, clearProblems, showProblems, withPending } from '../ui/shell.ts';
import { navigate, setQuery } from '../router.ts';

// ------------------------------------------------------------- the Work panel

/**
 * A menu panel at every width: it takes no focus on opening, does not keep Tab
 * inside it and does not rise or slide from an edge.
 */
export function wireWorkPanel(): void {
  const button = find<HTMLButtonElement>('#work-button');
  const panel = find<HTMLElement>('#work-panel');
  if (!button || !panel) return;

  let open = false;
  let preview: HTMLElement | null = null;

  const build = (): void => {
    panel.textContent = '';
    const nav = el('nav', { class: 'work-panel-nav', 'aria-label': 'Work' });
    const list = el('ul', { class: 'work-panel-tiles' });
    for (const item of PUBLIC_CASES) {
      const link = el('a', {
        href: `/work/${item.slug}`,
        'data-case-link': item.slug,
        class: 'work-panel-tile',
      });
      link.append(
        el('span', { class: 'work-panel-drawing', 'data-part': 'case-drawing', 'data-case': item.slug, html: chairDrawing(item.slug) }),
        el('span', { text: item.title }),
      );
      const show = (): void => showPreview(item.slug, item.title);
      link.addEventListener('focus', show);
      link.addEventListener('pointerenter', show);
      list.append(el('li', {}, [link]));
    }
    nav.append(list);
    preview = el('span', {
      class: 'work-panel-preview',
      role: 'img',
      'aria-label': `Preview of ${PUBLIC_CASES[0]!.title}`,
      html: chairDrawing(PUBLIC_CASES[0]!.slug),
    });
    nav.append(el('div', { class: 'work-panel-previewHolder' }, [preview]));
    panel.append(nav);
  };

  const showPreview = (slug: string, title: string): void => {
    if (!preview) return;
    if (preview.getAttribute('aria-label') === `Preview of ${title}`) return;
    preview.setAttribute('aria-label', `Preview of ${title}`);
    preview.innerHTML = chairDrawing(slug);
    crossFade(preview, DURATION.quick);
  };

  const close = (returnFocus: boolean): void => {
    if (!open) return;
    open = false;
    // Its tiles leave the Tab order the moment it starts closing.
    for (const link of all<HTMLElement>('a', panel)) link.setAttribute('tabindex', '-1');
    button.setAttribute('aria-expanded', 'false');
    if (returnFocus) button.focus();

    const finish = (): void => {
      panel.hidden = true;
      panel.textContent = '';
      preview = null;
    };
    if (reducedMotion()) {
      finish();
      return;
    }
    stopAnimations(panel);
    const height = panel.scrollHeight;
    const animation = panel.animate(
      [
        { height: `${height}px`, opacity: 1 },
        { height: '0px', opacity: 0 },
      ],
      { duration: DURATION.normal, easing: 'cubic-bezier(0.2, 0, 0.1, 1)' },
    );
    animation.finished.then(finish).catch(finish);
  };

  const show = (): void => {
    if (open) {
      close(true);
      return;
    }
    open = true;
    panel.hidden = false;
    build();
    button.setAttribute('aria-expanded', 'true');
    // Focus stays on Work; Tab or Down moves into the panel.
    if (!reducedMotion()) {
      stopAnimations(panel);
      const height = panel.scrollHeight;
      animate(panel, [{ height: '0px', opacity: 0 }, { height: `${height}px`, opacity: 1 }], DURATION.normal);
    }
  };

  button.addEventListener('click', show);
  button.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown') {
      if (!open) show();
      event.preventDefault();
      find<HTMLElement>('a', panel)?.focus();
      return;
    }
    if (event.key === 'Escape' && open) {
      event.preventDefault();
      close(true);
    }
  });

  panel.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close(true);
      return;
    }
    if (event.key !== 'Tab' || event.shiftKey) return;
    const links = all<HTMLElement>('a', panel);
    if (document.activeElement === links[links.length - 1]) close(false);
  });

  document.addEventListener('pointerdown', (event) => {
    if (!open) return;
    const target = event.target as Node;
    if (!panel.contains(target) && target !== button) close(false);
  });
}

// --------------------------------------------------------------- work filter

const KINDS = ['', 'leather', 'fabric', 'frame-only'] as const;

/** Items that leave and enter move as the same elements. */
export function wireWorkPage(): void {
  const group = find<HTMLElement>('[role="radiogroup"][aria-label="Kind"]');
  const grid = find<HTMLElement>('#case-grid');
  if (!group || !grid) return;

  const render = (kind: string): void => {
    const before = new Map<string, DOMRect>();
    for (const tile of all<HTMLElement>('[data-kind]', grid)) {
      before.set(tile.dataset.kind === undefined ? '' : (find<HTMLElement>('[data-case]', tile)?.dataset.case ?? ''), tile.getBoundingClientRect());
    }
    const shown = kind === '' ? PUBLIC_CASES : PUBLIC_CASES.filter((item) => item.kind === kind);
    const keep = new Set(shown.map((item) => item.slug));

    for (const tile of all<HTMLElement>('li[data-kind]', grid)) {
      const slug = find<HTMLElement>('[data-case]', tile)?.dataset.case ?? '';
      tile.hidden = !keep.has(slug);
    }
    if (reducedMotion()) return;
    for (const tile of all<HTMLElement>('li[data-kind]', grid)) {
      if (tile.hidden) continue;
      const slug = find<HTMLElement>('[data-case]', tile)?.dataset.case ?? '';
      const from = before.get(slug);
      if (!from) {
        animate(tile, [{ opacity: 0 }, { opacity: 1 }], DURATION.normal);
        continue;
      }
      const to = tile.getBoundingClientRect();
      const dx = from.left - to.left;
      const dy = from.top - to.top;
      if (dx === 0 && dy === 0) continue;
      animate(tile, [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], DURATION.normal);
    }
  };

  for (const radio of all<HTMLInputElement>('input[type="radio"]', group)) {
    radio.addEventListener('change', () => {
      if (!radio.checked) return;
      const kind = radio.value;
      setQuery({ kind: kind === '' ? null : kind });
      render(kind);
    });
  }

  const current = new URL(window.location.href).searchParams.get('kind') ?? '';
  if (KINDS.includes(current as (typeof KINDS)[number])) render(current);
}

// ----------------------------------------------------------------- case rail

/** The line the current section is read from, under the sticky header. */
const RAIL_LINE = 96;

/**
 * The current section is the last section whose heading has passed the line,
 * and at the very bottom the last section however short it is.
 */
export function wireSectionRail(): void {
  const rail = find<HTMLElement>('#case-rail') ?? find<HTMLElement>('#dossier-rail');
  if (!rail) return;
  const links = all<HTMLAnchorElement>('a[data-rail]', rail);
  if (links.length === 0) return;

  // The number pressed is held current until the reader next scrolls, so the
  // scroll the jump itself causes must not count as the reader scrolling.
  let held = false;
  let jumpedTo: number | null = null;

  const mark = (hash: string): void => {
    for (const link of links) {
      const current = link.dataset.rail === hash ? 'true' : 'false';
      if (link.getAttribute('aria-current') !== current) {
        link.setAttribute('aria-current', current);
        if (current === 'true') {
          animate(link, [{ opacity: 0.55 }, { opacity: 1 }], DURATION.quick);
          keepInFrame(link);
        }
      }
    }
  };

  const keepInFrame = (link: HTMLElement): void => {
    const frame = rail.querySelector<HTMLElement>('.rail-frame');
    if (!frame) return;
    const own = link.getBoundingClientRect();
    const box = frame.getBoundingClientRect();
    if (own.left < box.left) frame.scrollLeft -= box.left - own.left + 8;
    else if (own.right > box.right) frame.scrollLeft += own.right - box.right + 8;
  };

  const readCurrent = (): void => {
    if (held) return;
    const atBottom = window.innerHeight + window.scrollY >= document.body.scrollHeight - 2;
    if (atBottom) {
      mark(links[links.length - 1]!.dataset.rail!);
      return;
    }
    let current = links[0]!.dataset.rail!;
    for (const link of links) {
      const heading = document.getElementById(link.dataset.rail!);
      if (!heading) continue;
      // A heading exactly on the line has passed it.
      if (heading.getBoundingClientRect().top <= RAIL_LINE + 0.5) current = link.dataset.rail!;
    }
    mark(current);
  };

  for (const link of links) {
    link.addEventListener('click', (event) => {
      event.preventDefault();
      const hash = link.dataset.rail!;
      const heading = document.getElementById(hash);
      if (!heading) return;
      held = true;
      // Lands with the heading fully below the sticky header, with no animated
      // scrolling. The heading's scroll margin is the line itself, so taking
      // focus afterwards does not move it again.
      heading.scrollIntoView({ block: 'start', behavior: 'instant' as ScrollBehavior });
      jumpedTo = window.scrollY;
      mark(hash);
      heading.focus({ preventScroll: true });
      window.history.pushState({}, '', `${window.location.pathname}${window.location.search}#${hash}`);
    });
  }

  window.addEventListener(
    'scroll',
    () => {
      if (held && jumpedTo !== null && window.scrollY === jumpedTo) return;
      held = false;
      jumpedTo = null;
      readCurrent();
    },
    { passive: true },
  );

  // A direct address with a hash lands the same way on load.
  const hash = window.location.hash.slice(1);
  if (hash && links.some((link) => link.dataset.rail === hash)) {
    const heading = document.getElementById(hash);
    if (heading) {
      heading.scrollIntoView({ block: 'start', behavior: 'instant' as ScrollBehavior });
      jumpedTo = window.scrollY;
      mark(hash);
      held = true;
      return;
    }
  }
  readCurrent();
}

// ---------------------------------------------------------------- the forms

function formProblems(form: HTMLElement, problems: { field: string; message: string }[]): void {
  const region = need<HTMLElement>('#problems');
  showProblems(region, problems, (name) => find<HTMLElement>(`[name="${name}"]`, form), 'Problems');
}

export function wireEnquiryForm(): void {
  const form = find<HTMLFormElement>('#enquiry-form');
  const send = find<HTMLButtonElement>('#enquiry-send');
  if (!form || !send) return;
  const region = need<HTMLElement>('#problems');

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void withPending(send, async () => {
      clearProblems(region, all<HTMLElement>('input, textarea', form));
      const data = new FormData(form);
      try {
        await api.post('/api/enquiries', {
          name: String(data.get('name') ?? ''),
          email: String(data.get('email') ?? ''),
          message: String(data.get('message') ?? ''),
        });
        form.reset();
        announce(F.enquirySent);
      } catch (error) {
        const problems = fieldProblems(error);
        if (problems.length > 0) formProblems(form, problems);
        announce(error instanceof ApiError ? error.failure.message : F.refreshFailed);
      }
    });
  });
}

export function wireAccessForms(): void {
  const signIn = find<HTMLFormElement>('#sign-in-form');
  if (signIn) {
    const submit = need<HTMLButtonElement>('#sign-in-submit');
    const region = need<HTMLElement>('#problems');
    signIn.addEventListener('submit', (event) => {
      event.preventDefault();
      void withPending(submit, async () => {
        clearProblems(region, all<HTMLElement>('input', signIn));
        const data = new FormData(signIn);
        try {
          const answer = (await api.post('/api/session', {
            email: String(data.get('email') ?? ''),
            password: String(data.get('password') ?? ''),
            returnTo: String(data.get('returnTo') ?? '') || undefined,
          })) as { session: { landing: string } };
          window.location.assign(answer.session.landing);
        } catch (error) {
          const problems = fieldProblems(error);
          if (problems.length > 0) formProblems(signIn, problems);
          else if (error instanceof ApiError) {
            showProblems(
              region,
              [{ field: 'password', message: error.failure.message }],
              (name) => find<HTMLElement>(`[name="${name}"]`, signIn),
              'Problems',
            );
          }
        }
      });
    });
  }

  const signUp = find<HTMLFormElement>('#sign-up-form');
  if (signUp) {
    const submit = need<HTMLButtonElement>('#sign-up-submit');
    const region = need<HTMLElement>('#problems');
    signUp.addEventListener('submit', (event) => {
      event.preventDefault();
      void withPending(submit, async () => {
        clearProblems(region, all<HTMLElement>('input', signUp));
        const data = new FormData(signUp);
        try {
          const answer = (await api.post('/api/sign-up', {
            name: String(data.get('name') ?? ''),
            email: String(data.get('email') ?? ''),
            password: String(data.get('password') ?? ''),
          })) as { session: { landing: string } };
          window.location.assign(answer.session.landing);
        } catch (error) {
          const problems = fieldProblems(error);
          if (problems.length > 0) formProblems(signUp, problems);
          else if (error instanceof ApiError) {
            showProblems(
              region,
              [{ field: 'email', message: error.failure.message }],
              (name) => find<HTMLElement>(`[name="${name}"]`, signUp),
              'Problems',
            );
          }
        }
      });
    });
  }
}

export { navigate, setText, setAttr };
