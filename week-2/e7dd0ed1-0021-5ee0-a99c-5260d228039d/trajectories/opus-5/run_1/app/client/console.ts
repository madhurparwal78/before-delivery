import { ApiFailure, api } from './api';
import { button, el, field, openDialog, replace, setStatus, statusRegion, textbox } from './dom';
import { bucketStatus, suspensionBanner } from './copy';
import { renderObjectView, type ObjectViewState } from './objectview';
import {
  pagePaths,
  renderDeliveries,
  renderKeys,
  renderSecurity,
  renderShareLinks,
  renderTeam,
  renderUsage,
  renderWebhooks,
} from './pages';
import type { Bucket, ConsoleContext, Identity, RegionRecord } from './types';

interface Route {
  slug: string | null;
  page: string | null;
  bucket: string | null;
  endpointId: string | null;
}

function parseRoute(path: string): Route {
  const parts = path.split('/').filter((part) => part !== '');
  const slug = parts[1] ?? null;
  const third = parts[2] ?? null;
  if (third === null) return { slug, page: null, bucket: null, endpointId: null };
  if (third === pagePaths.deliveries) return { slug, page: third, bucket: null, endpointId: parts[3] ?? null };
  const pages = Object.values(pagePaths);
  if (pages.includes(third)) return { slug, page: third, bucket: null, endpointId: null };
  return { slug, page: null, bucket: decodeURIComponent(third), endpointId: null };
}

function objectState(query: URLSearchParams): ObjectViewState {
  return {
    prefix: query.get('prefix') ?? '',
    tagFilter: query.get('tag_filter') ?? '',
    cursor: query.get('cursor'),
    prev: query.getAll('prev'),
    objectKey: query.get('object'),
    search: '',
  };
}

export async function mountConsole(root: HTMLElement): Promise<void> {
  const identity = (await api.get<Identity>('/api/me')).body;
  if (identity.memberships.length === 0 && identity.user.operator) {
    window.location.assign('/ops');
    return;
  }
  const regions = (await api.get<{ regions: RegionRecord[] }>('/api/regions')).body.regions;
  const suspended = new Set((document.body.getAttribute('data-suspended') ?? '').split(' ').filter((slug) => slug !== ''));
  // One Bucket status region for the whole console, so no re-render replaces its last message.
  const bucketStatusRegion = statusRegion('Bucket status');
  let stopCurrent: () => void = () => undefined;
  let pendingFocusKey: string | null = null;
  let shownObjectKey: string | null = null;

  async function render(): Promise<void> {
    stopCurrent();
    const route = parseRoute(window.location.pathname);
    const memberships = identity.memberships;
    const membership = memberships.find((item) => item.workspace.slug === route.slug) ?? memberships[0];
    if (!membership) {
      replace(root, [el('p', { text: 'This bucket isn\u2019t in your workspace.' })]);
      return;
    }
    const slug = route.slug ?? membership.workspace.slug;
    const known = memberships.find((item) => item.workspace.slug === slug);
    const role = known?.role ?? 'viewer';
    let buckets: Bucket[] = [];
    if (known) {
      try {
        buckets = (await api.get<{ buckets: Bucket[] }>(`/api/w/${slug}/buckets`)).body.buckets;
      } catch {
        buckets = [];
      }
    }

    const context: ConsoleContext = {
      identity,
      slug,
      workspaceName: known?.workspace.name ?? membership.workspace.name,
      role,
      buckets,
      regions,
      suspended: suspended.has(slug),
      navigate: (url, options) => {
        if (options?.replace === true) window.history.replaceState({}, '', url);
        else window.history.pushState({}, '', url);
        pendingFocusKey = options?.focusKey ?? null;
        void render();
      },
      refresh: async () => {
        await render();
      },
    };

    const bucketName = route.bucket ?? (buckets[0]?.name ?? '');
    if (route.page === null && route.bucket === null && bucketName !== '') {
      window.history.replaceState({}, '', `/console/${slug}/${bucketName}${window.location.search}`);
    }

    const rail = buildRail(context, bucketName, route.page, bucketStatusRegion);
    const navButton = button('Workspaces and buckets', { className: 'nav-button', focusKey: 'nav-button' });
    navButton.addEventListener('click', () => {
      openDialog({
        name: 'Navigation',
        opener: navButton,
        build: (dialog) => {
          const close = button('Close navigation', { onClick: () => dialog.close() });
          const copy = buildRail(context, bucketName, route.page, bucketStatusRegion);
          copy.addEventListener('click', (event) => {
            if ((event.target as HTMLElement).tagName === 'A') dialog.close();
          });
          dialog.body.append(close, copy);
        },
      });
    });

    let centre: HTMLElement;
    let inspector: HTMLElement | null = null;
    let focusHeading: () => void = () => undefined;
    let focusInspector: (() => void) | null = null;
    if (route.page === pagePaths.shareLinks) {
      const page = await renderShareLinks(context);
      centre = page.centre;
      stopCurrent = page.stop;
    } else if (route.page === pagePaths.team) {
      const page = await renderTeam(context);
      centre = page.centre;
      stopCurrent = page.stop;
    } else if (route.page === pagePaths.keys) {
      const page = await renderKeys(context);
      centre = page.centre;
      stopCurrent = page.stop;
    } else if (route.page === pagePaths.usage) {
      const page = await renderUsage(context);
      centre = page.centre;
      stopCurrent = page.stop;
    } else if (route.page === pagePaths.webhooks) {
      const page = await renderWebhooks(context);
      centre = page.centre;
      stopCurrent = page.stop;
    } else if (route.page === pagePaths.deliveries && route.endpointId !== null) {
      const page = await renderDeliveries(context, route.endpointId);
      centre = page.centre;
      stopCurrent = page.stop;
    } else if (route.page === pagePaths.security) {
      const query = new URLSearchParams(window.location.search);
      const page = await renderSecurity(context, {
        action: query.get('action') ?? '',
        actor: query.get('actor') ?? '',
        cursor: query.get('cursor'),
        prev: query.getAll('prev'),
      });
      centre = page.centre;
      stopCurrent = page.stop;
    } else {
      const bucket = buckets.find((item) => item.name === bucketName) ?? null;
      const view = await renderObjectView({
        context,
        bucket,
        bucketName,
        state: objectState(new URLSearchParams(window.location.search)),
      });
      centre = view.centre;
      inspector = view.inspector;
      focusHeading = view.focusHeading;
      focusInspector = view.focusInspector;
      stopCurrent = view.stop;
    }
    centre.append(bucketStatusRegion);

    const children: (Node | null)[] = [
      el('a', { class: 'skip', href: '#objects', text: 'Skip to objects' }),
      context.suspended ? el('p', { class: 'banner', role: 'alert', text: suspensionBanner }) : null,
      navButton,
      el('div', { class: 'shell' }, [rail, centre, inspector]),
    ];
    replace(root, children);
    if (window.history.state && (window.history.state as { focusHeading?: boolean }).focusHeading === true) {
      focusHeading();
      window.history.replaceState({}, '', window.location.href);
    }
    if (pendingFocusKey !== null) {
      document.querySelector<HTMLElement>(`[data-focus-key="${pendingFocusKey}"]`)?.focus();
      pendingFocusKey = null;
    } else {
      const openObject = new URLSearchParams(window.location.search).get('object');
      if (openObject !== null && openObject !== shownObjectKey && focusInspector !== null) focusInspector();
      shownObjectKey = openObject;
    }
  }

  function buildRail(
    context: ConsoleContext,
    bucketName: string,
    page: string | null,
    bucketStatusRegion: HTMLElement,
  ): HTMLElement {
    const bucketLinks = context.buckets.map((bucket) => {
      const placement = bucket.placement
        .map((region) => context.regions.find((candidate) => candidate.id === region)?.name ?? region)
        .join(', ');
      const link = el('a', {
        href: `/console/${context.slug}/${bucket.name}`,
        'aria-label': bucket.name,
        'data-focus-key': `bucket:${bucket.name}`,
      }, [el('span', { class: 'bucket-name', text: bucket.name }), el('span', { class: 'bucket-placement', text: placement })]);
      if (bucket.name === bucketName && page === null) link.setAttribute('aria-current', 'page');
      link.addEventListener('click', (event) => {
        event.preventDefault();
        context.navigate(`/console/${context.slug}/${bucket.name}`);
      });
      return link;
    });

    const workspaceLinks: HTMLElement[] = [];
    const addLink = (label: string, href: string, current: boolean): void => {
      const link = el('a', { href, text: label, 'data-focus-key': `page:${label}` });
      if (current) link.setAttribute('aria-current', 'page');
      link.addEventListener('click', (event) => {
        event.preventDefault();
        context.navigate(href);
      });
      workspaceLinks.push(link);
    };
    addLink('Objects', `/console/${context.slug}/${context.buckets[0]?.name ?? ''}`, page === null);
    addLink('Share links', `/console/${context.slug}/${pagePaths.shareLinks}`, page === pagePaths.shareLinks);
    if (context.role === 'owner') {
      addLink('Team', `/console/${context.slug}/${pagePaths.team}`, page === pagePaths.team);
      addLink('Access keys', `/console/${context.slug}/${pagePaths.keys}`, page === pagePaths.keys);
      addLink('Usage', `/console/${context.slug}/${pagePaths.usage}`, page === pagePaths.usage);
      addLink('Webhooks', `/console/${context.slug}/${pagePaths.webhooks}`, page === pagePaths.webhooks);
      addLink('Security', `/console/${context.slug}/${pagePaths.security}`, page === pagePaths.security);
    }

    const signOut = button('Sign out', {
      focusKey: 'sign-out',
      onClick: async () => {
        await api.delete('/api/session');
        window.location.assign('/signin');
      },
    });

    const children: (Node | null)[] = [
      el('p', { class: 'workspace-name', text: context.workspaceName }),
      el('nav', { 'aria-label': 'Buckets' }, bucketLinks),
    ];
    if (context.role !== 'viewer') {
      const newBucket = button('New bucket', { className: 'primary', focusKey: 'new-bucket' });
      newBucket.addEventListener('click', () => newBucketDialog(context, newBucket, bucketStatusRegion));
      children.push(newBucket);
    }
    children.push(
      el('nav', { 'aria-label': 'Workspace' }, workspaceLinks),
      (() => {
        const account = el('a', { href: '/account', text: 'Account', 'data-focus-key': 'account' });
        return account;
      })(),
      signOut,
    );
    return el('div', { class: 'rail' }, children);
  }

  function newBucketDialog(context: ConsoleContext, opener: HTMLElement, status: HTMLElement): void {
    openDialog({
      name: 'New bucket',
      opener,
      build: (dialog) => {
        const name = textbox('Bucket name');
        const nameField = field('Bucket name', name, 'Lowercase letters, digits and hyphens.');
        const origin = el('select', { 'aria-label': 'Origin region' }) as HTMLSelectElement;
        for (const region of context.regions) origin.append(el('option', { value: region.id, text: region.name }));
        const replicaBoxes = context.regions.map((region) => {
          const box = el('input', { type: 'checkbox', 'aria-label': region.name, value: region.id }) as HTMLInputElement;
          return { region, box };
        });
        const create = button('Create bucket', { className: 'primary' });
        create.addEventListener('click', async () => {
          setStatus(status, bucketStatus.pending(name.value));
          const placement = [origin.value, ...replicaBoxes.filter((entry) => entry.box.checked && entry.region.id !== origin.value).map((entry) => entry.region.id)];
          try {
            const created = await api.post<Bucket>(`/api/w/${context.slug}/buckets`, { name: name.value.trim(), placement });
            setStatus(
              status,
              bucketStatus.success(
                created.body.name,
                created.body.placement.map((region) => context.regions.find((candidate) => candidate.id === region)?.name ?? region),
              ),
            );
            dialog.close();
            window.history.pushState({ focusHeading: true }, '', `/console/${context.slug}/${created.body.name}`);
            await render();
          } catch (error) {
            if (!(error instanceof ApiFailure)) throw error;
            const message =
              error.code === 'bucket_name_taken'
                ? bucketStatus.taken
                : error.errors.name
                  ? bucketStatus.nameError
                  : error.errors.placement
                    ? bucketStatus.placementError
                    : error.message;
            setStatus(status, message);
            dialog.setStatus(message);
            const target = nameField.querySelector('.field-error');
            if (target && error.errors.name) target.textContent = bucketStatus.nameError;
          }
        });
        dialog.body.append(
          el('h2', { text: 'New bucket' }),
          nameField,
          field('Origin region', origin),
          el('div', { class: 'field', role: 'group', 'aria-label': 'Replica regions' }, [
            ...replicaBoxes.map((entry) => el('label', {}, [entry.box, document.createTextNode(` ${entry.region.name}`)])),
          ]),
          el('div', { class: 'dialog-actions' }, [create, button('Cancel', { onClick: () => dialog.close() })]),
        );
      },
    });
  }

  window.addEventListener('popstate', () => void render());
  await render();
}
