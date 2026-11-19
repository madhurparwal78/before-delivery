import { copy } from '../../shared/copy.js';
import { diffSnapshots } from '../../shared/diff.js';
import { boundingBox, layoutMap } from '../../shared/layout.js';
import { emptyDoc } from '../../shared/ops.js';
import { colourHex, derivedColour } from '../../shared/style.js';
import { visibleTopics } from '../../shared/tree.js';
import type { MapDoc, Role, VersionRow, VersionSnapshot } from '../../shared/types.js';
import { api, RequestFailed } from '../api.js';
import { clear, el, on } from '../dom.js';
import { navigate } from '../router.js';
import { inboxButton, notify, resetScreen, trapFocus } from '../shell.js';

function docFromSnapshot(snapshot: VersionSnapshot): MapDoc {
  const rootTopic = snapshot.topics.find((topic) => topic.parent_id === null && !topic.floating);
  const doc = emptyDoc(rootTopic?.id ?? 'root', rootTopic?.title ?? '');
  doc.topics = {};
  doc.floating = [];
  for (const topic of snapshot.topics) {
    doc.topics[topic.id] = { ...topic, children: [...topic.children] };
    if (topic.floating) doc.floating.push(topic.id);
  }
  for (const topic of Object.values(doc.topics)) {
    topic.children = topic.children.filter((id) => doc.topics[id]);
  }
  doc.links = snapshot.links;
  doc.boundaries = snapshot.boundaries;
  doc.slides = snapshot.slides;
  doc.layout = snapshot.layout;
  doc.theme = snapshot.theme;
  return doc;
}

export async function versionScreen(params: Record<string, string>, url: URL): Promise<void> {
  const root = resetScreen();
  let answer: {
    number: number;
    name: string;
    snapshot: VersionSnapshot;
    map: { id: string; title: string; role: Role; owner: string };
    versions: VersionRow[];
  };
  try {
    answer = await api.get(`/api/maps/${params.id}/versions/${params.vid}`);
  } catch (error) {
    if (error instanceof RequestFailed) {
      root.append(el('main', { class: 'message-page' }, [el('h1', { text: copy.unknownPage })]));
      return;
    }
    throw error;
  }
  document.title = `${answer.map.title} \u2014 version ${answer.number}`;
  const doc = docFromSnapshot(answer.snapshot);
  const stage = el('div', { class: 'stage' });
  const canvas = el('div', { class: 'canvas', role: 'region', 'aria-label': 'Canvas' }, [stage]);
  const removedList = el('ul', { class: 'removed', 'aria-label': 'Removed topics' });
  const changes = el('div', { class: 'changes', role: 'region', 'aria-label': 'Changes' }, [
    removedList,
  ]);
  const compare = el(
    'select',
    { 'aria-label': 'Compare with' },
    [
      el('option', { value: '', text: 'No comparison' }),
      ...answer.versions.map((version) =>
        el('option', { value: version.id, text: `Version ${version.number}` }),
      ),
    ],
  ) as HTMLSelectElement;

  const diffMarks = new Map<string, string>();
  const paint = (): void => {
    clear(stage);
    const view = { doc, collapsed: new Set<string>(), hidden: new Set<string>() };
    const layout = layoutMap(view, doc.layout);
    const bounds = boundingBox(layout) ?? { x: 0, y: 0, w: 1, h: 1 };
    const zoom = 1;
    stage.dataset.zoom = zoom.toFixed(4);
    stage.style.transform = `translate(${(-bounds.x + 60).toFixed(2)}px, ${(-bounds.y + 60).toFixed(2)}px) scale(${zoom})`;
    for (const id of visibleTopics(view)) {
      const laid = layout.get(id);
      const topic = doc.topics[id];
      if (!laid || !topic) continue;
      const node = el('div', { class: 'topic' }, [el('span', { text: topic.title })]);
      node.dataset.topicId = id;
      node.dataset.x = String(laid.x);
      node.dataset.y = String(laid.y);
      node.dataset.w = String(laid.w);
      node.dataset.h = String(laid.h);
      const mark = diffMarks.get(id);
      if (mark) node.dataset.diff = mark;
      node.style.left = `${laid.x - laid.w / 2}px`;
      node.style.top = `${laid.y - laid.h / 2}px`;
      node.style.width = `${laid.w}px`;
      node.style.minHeight = `${laid.h}px`;
      node.style.setProperty('--branch', colourHex(derivedColour(doc, id)));
      stage.append(node);
    }
  };

  const runDiff = async (otherId: string): Promise<void> => {
    diffMarks.clear();
    clear(removedList);
    const summary = changes.querySelector('.diff-summary');
    summary?.remove();
    if (otherId === '') {
      paint();
      return;
    }
    const other = await api.get<{ snapshot: VersionSnapshot; number: number }>(
      `/api/maps/${params.id}/versions/${otherId}`,
    );
    const earlier = other.number < answer.number ? other.snapshot : answer.snapshot;
    const later = other.number < answer.number ? answer.snapshot : other.snapshot;
    const result = diffSnapshots(earlier, later);
    for (const id of result.added) diffMarks.set(id, 'added');
    for (const id of result.moved) diffMarks.set(id, 'moved');
    for (const id of result.edited) {
      diffMarks.set(id, diffMarks.get(id) === 'moved' ? 'moved edited' : 'edited');
    }
    changes.prepend(el('p', { class: 'diff-summary', text: result.summary }));
    for (const id of result.removed) {
      const row = el('li', { text: earlier.topics.find((topic) => topic.id === id)?.title ?? id });
      row.dataset.diff = 'removed';
      removedList.append(row);
    }
    paint();
  };

  on(compare, 'change', () => {
    void runDiff(compare.value);
  });

  const restore = el('button', { type: 'button', class: 'primary', text: 'Restore this version' });
  on(restore, 'click', () => {
    void api
      .post(`/api/maps/${params.id}/versions/${params.vid}/restore`)
      .then(() => {
        notify(copy.versionRestored(answer.number));
        navigate(`/m/${params.id}`);
      })
      .catch((error: unknown) => {
        if (error instanceof RequestFailed) notify(error.body.message, 'warning');
      });
  });

  root.append(
    el('header', { class: 'editor-bar', role: 'banner' }, [
      el('a', { href: `/m/${params.id}`, class: 'map-title', text: answer.map.title }),
      inboxButton(),
    ]),
    el('main', { class: 'version-view' }, [
      el('div', { class: 'notice-band' }, [
        el('p', { text: copy.readOnlyVersion(answer.number) }),
      ]),
      el('label', {}, [el('span', { text: 'Compare with' }), compare]),
      canvas,
      changes,
      answer.map.role === 'owner' ? restore : el('span'),
    ]),
  );
  paint();
  const other = url.searchParams.get('compare');
  if (other !== null) {
    compare.value = other;
    await runDiff(other);
  }
}

export async function shareEntryScreen(params: Record<string, string>): Promise<void> {
  const root = resetScreen();
  let answer: { map_id: string; map_title: string; role: Role };
  try {
    answer = await api.get(`/api/share/${params.code}`);
  } catch (error) {
    const message =
      error instanceof RequestFailed && error.body.error === 'link_expired'
        ? copy.expiredLink
        : error instanceof RequestFailed && error.body.error === 'link_revoked'
          ? copy.turnedOffLink
          : copy.unknownPage;
    root.append(el('main', { class: 'message-page' }, [el('h1', { text: message })]));
    return;
  }
  document.title = answer.map_title;
  const card = el('div', {
    class: 'dialog-card',
    role: 'dialog',
    'aria-modal': 'true',
    'aria-label': 'Join map',
  });
  const name = el('input', { type: 'text', 'aria-label': 'Your name' }) as HTMLInputElement;
  const join = el('button', { type: 'button', class: 'primary', text: 'Join' });
  const error = el('p', { class: 'field-error' });
  card.append(
    el('h2', { text: `Join ${answer.map_title}` }),
    el('label', {}, [el('span', { text: 'Your name' }), name]),
    error,
    join,
  );
  const scrim = el('div', { class: 'scrim' }, [card]);
  root.append(scrim);
  trapFocus(scrim, { escapable: false });
  on(join, 'click', () => {
    void api
      .post<{ map_id: string }>(`/api/share/${params.code}/join`, { display_name: name.value.trim() })
      .then((result) => navigate(`/m/${result.map_id}`))
      .catch((failure: unknown) => {
        if (failure instanceof RequestFailed) error.textContent = failure.body.message;
      });
  });
}

export function notFoundScreenView(): void {
  const root = resetScreen();
  document.title = 'Not found';
  root.append(
    el('main', { class: 'message-page' }, [
      el('h1', { text: copy.unknownPage }),
      el('a', { href: '/', text: 'Sprigmap' }),
    ]),
  );
}
