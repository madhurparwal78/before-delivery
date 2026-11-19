import { api } from '../api';
import { announce, h, qs } from '../dom';
import { entryNode, type PostData } from '../components/post';
import { personCardNode, type PersonCard } from '../components/person';
import { timeElement } from '../components/text';
import { on, refreshCounters } from '../state';
import { S } from '../strings';
import { WORKPLACE_LABELS } from '../../shared/format';

type SearchType = 'people' | 'posts' | 'jobs';

type JobCard = {
  id: string;
  title: string;
  company: { id: string; name: string; handle: string };
  location: string;
  workplace: string;
  posted_at: string;
};

export function notFoundView(): HTMLElement {
  return h('div', { class: 'empty' }, [
    h('h1', { class: 'big-sentence', text: S.empty.unknownAddress }),
    h('a', { href: '/feed', class: 'link underline' }, ['Go to Home']),
  ]);
}

export function notificationsView(): HTMLElement {
  const host = h('div', { class: 'narrow' });
  void load();
  const off = on('network', () => {
    if (!document.contains(host)) {
      off();
      return;
    }
    void load(false);
  });
  const offPost = on('post', () => {
    if (document.contains(host)) void load(false);
  });
  const offApplication = on('application', () => {
    if (document.contains(host)) void load(false);
  });
  const observer = new MutationObserver(() => {
    if (!document.contains(host)) {
      off();
      offPost();
      offApplication();
      observer.disconnect();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
  return host;

  async function load(markSeen = true): Promise<void> {
    const result = await api.get<{
      items: {
        id: string;
        kind: string;
        count: number;
        text: string;
        target_url: string;
        created_at: string;
        updated_at: string;
        unread: boolean;
      }[];
    }>('/api/notifications');
    if (!result.ok) return;
    host.replaceChildren(h('h1', { class: 'page-title', text: 'Notifications' }));
    if (result.body.items.length === 0) {
      host.append(
        h('div', { class: 'empty' }, [
          h('p', { class: 'big-sentence', text: S.empty.notifications }),
          h('a', { href: '/feed', class: 'link underline' }, ['Go to Home']),
        ]),
      );
    } else {
      const list = h('ul', { 'aria-label': 'Notifications', class: 'card-list' });
      for (const item of result.body.items) {
        list.append(
          h(
            'li',
            {
              class: item.unread ? 'notification unread' : 'notification',
              'data-notification-id': item.id,
              'data-kind': item.kind,
              'data-count': String(item.count),
            },
            [
              h('a', { href: item.target_url, class: 'link' }, [item.text]),
              timeElement(item.updated_at),
            ],
          ),
        );
      }
      host.append(list);
    }
    if (markSeen) {
      await api.post('/api/notifications/seen');
      void refreshCounters();
    }
  }
}

export function searchView(
  initialType: SearchType,
  initialQuery: string,
  navigate: (path: string, replace?: boolean) => void,
): HTMLElement {
  const host = h('div', { class: 'narrow' });
  let type: SearchType = initialType;
  let text = initialQuery;
  let sequence = 0;
  let timer = 0;

  const count = h('p', { role: 'status', 'aria-label': 'Search results', class: 'count tabular' });
  const results = h('div', { class: 'results' });
  const filterHost = h('div', { class: 'filters' });

  const tablist = h('div', { role: 'tablist', 'aria-label': 'Result type', class: 'tablist' });
  const tabs: Record<SearchType, HTMLElement> = {
    people: tabNode('People', 'people'),
    posts: tabNode('Posts', 'posts'),
    jobs: tabNode('Jobs', 'jobs'),
  };
  tablist.append(tabs.people, tabs.posts, tabs.jobs);

  const degreeGroup = h('div', { role: 'group', 'aria-label': 'Degree', class: 'row' });
  const degreeBoxes: Record<string, HTMLInputElement> = {};
  for (const [value, label] of [
    ['1', '1st'],
    ['2', '2nd'],
    ['3', '3rd+'],
  ]) {
    const box = h('input', {
      type: 'checkbox',
      'aria-label': label,
      change: () => run(),
    }) as HTMLInputElement;
    degreeBoxes[value] = box;
    degreeGroup.append(h('label', { class: 'field inline' }, [box, h('span', { text: label })]));
  }
  const companyFilter = h('input', {
    type: 'text',
    'aria-label': 'Current company',
    class: 'input',
    input: () => run(),
  }) as HTMLInputElement;
  const locationFilter = h('input', {
    type: 'text',
    'aria-label': 'Location',
    class: 'input',
    input: () => run(),
  }) as HTMLInputElement;
  const workplaceFilter = h(
    'select',
    { 'aria-label': 'Workplace', class: 'input', change: () => run() },
    [
      h('option', { value: '' }, ['Any']),
      h('option', { value: 'on-site' }, ['On-site']),
      h('option', { value: 'hybrid' }, ['Hybrid']),
      h('option', { value: 'remote' }, ['Remote']),
    ],
  ) as HTMLSelectElement;
  const postedFilter = h(
    'select',
    { 'aria-label': 'Date posted', class: 'input', change: () => run() },
    [
      h('option', { value: '' }, ['Any time']),
      h('option', { value: 'day' }, ['Past 24 hours']),
      h('option', { value: 'week' }, ['Past week']),
      h('option', { value: 'month' }, ['Past month']),
    ],
  ) as HTMLSelectElement;

  host.append(
    h('h1', { class: 'page-title', text: 'Search' }),
    tablist,
    filterHost,
    count,
    results,
  );
  drawFilters();

  const box = qs<HTMLInputElement>('[aria-label="Search"]');
  if (box) {
    box.value = initialQuery;
    box.addEventListener('input', onTyping);
  }
  const observer = new MutationObserver(() => {
    if (!document.contains(host)) {
      box?.removeEventListener('input', onTyping);
      observer.disconnect();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  void run(true);
  return host;

  function onTyping(): void {
    text = box?.value ?? '';
    navigate(`/search?type=${type}&q=${encodeURIComponent(text)}`, true);
    window.clearTimeout(timer);
    timer = window.setTimeout(() => void run(), 300);
  }

  function tabNode(label: string, value: SearchType): HTMLElement {
    return h(
      'button',
      {
        type: 'button',
        role: 'tab',
        'aria-selected': type === value ? 'true' : 'false',
        class: 'tab',
        click: () => {
          type = value;
          for (const [key, node] of Object.entries(tabs)) {
            node.setAttribute('aria-selected', key === value ? 'true' : 'false');
          }
          drawFilters();
          navigate(`/search?type=${type}&q=${encodeURIComponent(text)}`, true);
          void run(true);
        },
      },
      [label],
    );
  }

  function drawFilters(): void {
    filterHost.replaceChildren();
    if (type === 'people') filterHost.append(degreeGroup, companyFilter, locationFilter);
    else if (type === 'jobs') filterHost.append(locationFilter, workplaceFilter, postedFilter);
  }

  function run(immediate = false): void {
    if (!immediate) {
      void request();
      return;
    }
    void request();
  }

  async function request(): Promise<void> {
    const mine = ++sequence;
    const wanted = text;
    const params = new URLSearchParams({ type, q: wanted });
    if (type === 'people') {
      const ticked = Object.entries(degreeBoxes)
        .filter(([, box2]) => box2.checked)
        .map(([value]) => value);
      if (ticked.length > 0 && ticked.length < 3) params.set('degree', ticked.join(','));
      if (companyFilter.value) params.set('company', companyFilter.value);
      if (locationFilter.value) params.set('location', locationFilter.value);
    } else if (type === 'jobs') {
      if (locationFilter.value) params.set('location', locationFilter.value);
      if (workplaceFilter.value) params.set('workplace', workplaceFilter.value);
      if (postedFilter.value) params.set('posted', postedFilter.value);
    }
    const timeout = window.setTimeout(() => {
      if (mine === sequence) showFailure();
    }, 10000);
    const result = await api.get<{ total: number; results: unknown[] }>(
      `/api/search?${params.toString()}`,
    );
    window.clearTimeout(timeout);
    if (mine !== sequence || wanted !== text) return;
    if (!result.ok) {
      showFailure();
      return;
    }
    count.textContent = S.search.count(result.body.total, wanted);
    results.replaceChildren();
    if (result.body.total === 0) {
      results.append(
        h('div', { class: 'empty' }, [
          h('a', { href: '/feed', class: 'link underline' }, ['Clear search']),
        ]),
      );
      announce('Feed announcements', S.search.count(0, wanted));
      return;
    }
    if (type === 'people') {
      const list = h('ul', { class: 'card-list' });
      for (const card of result.body.results as PersonCard[]) {
        list.append(personCardNode(card, { reload: () => void request() }));
      }
      results.append(list);
    } else if (type === 'posts') {
      for (const post of result.body.results as PostData[]) {
        results.append(
          entryNode({
            entry_id: post.id,
            kind: 'post',
            created_at: post.created_at,
            post,
            reposter: null,
          }),
        );
      }
    } else {
      const list = h('ul', { class: 'card-list' });
      for (const job of result.body.results as JobCard[]) {
        list.append(
          h('li', { class: 'job-card', 'data-job-id': job.id }, [
            h('a', { href: `/jobs/${job.id}`, class: 'person-name' }, [job.title]),
            h('p', { class: 'muted', text: job.company.name }),
            h('p', { class: 'muted', text: job.location }),
            h('p', { class: 'muted', text: WORKPLACE_LABELS[job.workplace] ?? job.workplace }),
            timeElement(job.posted_at),
          ]),
        );
      }
      results.append(list);
    }
  }

  function showFailure(): void {
    count.textContent = '';
    results.replaceChildren(
      h('div', { class: 'empty' }, [
        h('p', { class: 'big-sentence', text: S.empty.searchFailed }),
        h('button', { type: 'button', class: 'button', click: () => void request() }, ['Try again']),
      ]),
    );
  }
}
