import { VNode, render } from './jsx/jsx-runtime.js';
import { api, ApiError, Part, Score, Collaborator, EngravedSystem } from './api.js';
import { announce } from './liveregions.js';

export interface PartPageProps {
  scoreId: string;
  partId: string;
  me: { collaborator: Collaborator; score: { id: string; title: string } } | null;
  onNeedMe: () => Promise<{ collaborator: Collaborator; score: { id: string; title: string } }>;
}

export function PartPage(props: PartPageProps): VNode {
  let me = props.me;
  let part: Part | null = null;
  let score: Score | null = null;
  let systems: EngravedSystem[] = [];
  let pages: string[][] = [];
  let breakMeasure = '24';
  let playing = false;
  let connectionId: string | null = null;
  let playMeasure = 1;
  let playBeat = 1;
  let narrow = window.innerWidth < 768;

  function canEditLayout(): boolean {
    return me?.collaborator.role === 'composer' || me?.collaborator.role === 'copyist';
  }

  function statusWord(status: string): string {
    switch (status) {
      case 'draft': return 'Draft';
      case 'engraving': return 'Engraving';
      case 'rendering': return 'Rendering';
      case 'ready': return 'Ready';
      case 'pdf_pending': return 'PDF pending';
      default: return status;
    }
  }

  function chipLabel(): string {
    if (!part) return '';
    const base = statusWord(part.status);
    return part.stale ? `${base} · Score changed since this PDF` : base;
  }

  async function load(): Promise<void> {
    try {
      if (!me) me = await props.onNeedMe();
      const partsRes = await api.get<{ parts: Part[] }>(`/api/scores/${props.scoreId}/parts`);
      part = partsRes.parts.find((p) => p.id === props.partId) ?? null;
      const scoreRes = await api.get<{ score: Score }>(`/api/scores/${props.scoreId}`);
      score = scoreRes.score;
      await loadEngraving();
      connectSocket();
      rerender();
    } catch (err) {
      if (err instanceof ApiError && (err.status === 401 || err.status === 403 || err.status === 404)) {
        announce('Parts', err.body.message);
      }
    }
  }

  async function loadEngraving(): Promise<void> {
    systems = [];
    let cursor: string | null = null;
    for (;;) {
      const query = new URLSearchParams({ view: 'part', partId: props.partId, limit: '16' });
      if (cursor) query.set('cursor', cursor);
      const res = await api.get<{ systems: EngravedSystem[]; nextCursor: string | null }>(
        `/api/scores/${props.scoreId}/engraving?${query}`,
      );
      systems = [...systems, ...res.systems];
      cursor = res.nextCursor;
      if (!cursor) break;
    }
    pages = [];
    for (const sys of systems) {
      (pages[sys.page - 1] ??= []).push(sys.svg);
    }
  }

  function connectSocket(): void {
    const token = sessionStorage.getItem('fairline-seat') ?? localStorage.getItem('fairline-seat');
    if (!token) return;
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(`${proto}//${location.host}/api/scores/${props.scoreId}/live?token=${encodeURIComponent(token)}`);
    socket.addEventListener('message', (event) => {
      const message = JSON.parse((event as MessageEvent).data) as Record<string, unknown>;
      if (message['type'] === 'welcome') {
        connectionId = message['connectionId'] as string;
      } else if (message['type'] === 'part') {
        const incoming = message['part'] as Part;
        if (incoming.id === props.partId) {
          part = incoming;
          announce('Parts', partAnnouncement(incoming));
          rerender();
        }
      } else if (message['type'] === 'score') {
        score = message['score'] as Score;
        rerender();
      }
    });
    socket.addEventListener('close', () => {
      setTimeout(connectSocket, 3000);
    });
  }

  function partAnnouncement(p: Part): string {
    if (p.status === 'ready') return `${p.name} PDF ready.`;
    if (p.status === 'pdf_pending') {
      return `${p.name} PDF pending: the renderer is unavailable. The preview pages are ready.`;
    }
    if (p.status === 'engraving') return `Engraving ${p.name}…`;
    if (p.status === 'rendering') return `Rendering ${p.name} PDF…`;
    return `${p.name} is a draft.`;
  }

  async function extract(): Promise<void> {
    if (!part) return;
    announce('Parts', `Engraving ${part.name}…`);
    rerender();
    try {
      await api.post(`/api/scores/${props.scoreId}/parts/${props.partId}/extract`, {});
      announce('Parts', `Rendering ${part.name} PDF…`);
      rerender();
    } catch (err) {
      if (err instanceof ApiError) announce('Parts', err.body.message);
    }
  }

  async function addBreak(kind: 'systemBreaks' | 'pageBreaks'): Promise<void> {
    if (!part) return;
    const measure = Number(breakMeasure);
    if (!Number.isInteger(measure) || measure < 1 || measure >= (score?.measureCount ?? 1)) {
      announce('Layout', `Use a measure from 1 to ${(score?.measureCount ?? 2) - 1}.`);
      return;
    }
    const layout = {
      systemBreaks: [...part.layout.systemBreaks],
      pageBreaks: [...part.layout.pageBreaks],
    };
    if (!layout[kind].includes(measure)) layout[kind].push(measure);
    layout[kind].sort((a, b) => a - b);
    try {
      const res = await api.put<{ part: Part }>(`/api/scores/${props.scoreId}/parts/${props.partId}/layout`, layout);
      part = res.part;
      announce('Layout', kind === 'systemBreaks' ? `System break after measure ${measure} added.` : `Page turn after measure ${measure} added.`);
      await loadEngraving();
      rerender();
    } catch (err) {
      if (err instanceof ApiError) announce('Layout', err.body.message);
    }
  }

  async function removeBreak(measure: number): Promise<void> {
    if (!part) return;
    const layout = {
      systemBreaks: part.layout.systemBreaks.filter((m) => m !== measure),
      pageBreaks: part.layout.pageBreaks.filter((m) => m !== measure),
    };
    try {
      const res = await api.put<{ part: Part }>(`/api/scores/${props.scoreId}/parts/${props.partId}/layout`, layout);
      part = res.part;
      announce('Layout', `Removed break after measure ${measure}.`);
      await loadEngraving();
      rerender();
    } catch (err) {
      if (err instanceof ApiError) announce('Layout', err.body.message);
    }
  }

  function togglePlay(): void {
    playing = !playing;
    rerender();
    if (!playing) return;
    // part pages play their own line in context through the workspace route
    announce('Playback', `Playing from measure ${playMeasure}.`);
  }

  async function holdPartStaves(): Promise<void> {
    if (!part) return;
    try {
      const res = await fetch(`/api/scores/${props.scoreId}/holds`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${sessionStorage.getItem('fairline-seat') ?? localStorage.getItem('fairline-seat')}`,
        },
        body: JSON.stringify({ staffIds: part.staffIds, connectionId }),
      });
      if (res.status === 201) {
        announce('Holds', `Holding ${part.name} staves.`);
        rerender();
        return;
      }
      const body = (await res.json()) as { message?: string };
      announce('Holds', body.message ?? 'Could not hold the staves.');
    } catch {
      announce('Holds', 'Reconnecting — try the hold again in a moment.');
    }
  }

  function handleKeydown(event: KeyboardEvent): void {
    const target = event.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') return;
    if (document.querySelector('.dialog')) return;
    const key = event.key.length === 1 ? event.key.toUpperCase() : event.key;
    if (event.shiftKey && !event.ctrlKey && !event.metaKey && key === 'H') {
      event.preventDefault();
      void holdPartStaves();
    }
  }

  function rerender(): void {
    const host = document.getElementById('part-host');
    if (host) host.replaceChildren(render(body()));
  }

  function body(): VNode {
    const partName = part?.name ?? 'Part';
    const pageNodes = pages.map((svgList, index) => ({
      type: 'section',
      props: { class: 'part-page-paper', role: 'group', 'aria-label': `Page ${index + 1}` },
      children: svgList.map((svg) => ({ type: 'div', props: { dangerouslySetInnerHTML: { __html: svg } } })),
    }));

    const breakItems: (VNode | string | null)[] = [];
    if (part) {
      for (const m of part.layout.systemBreaks) {
        breakItems.push({
          type: 'li',
          props: {},
          children: [
            `System break after measure ${m}`,
            {
              type: 'button',
              props: { class: 'rail-btn small', onclick: () => void removeBreak(m) },
              children: [`Remove break after measure ${m}`],
            },
          ],
        });
      }
      for (const m of part.layout.pageBreaks) {
        breakItems.push({
          type: 'li',
          props: {},
          children: [
            `Page turn after measure ${m}`,
            {
              type: 'button',
              props: { class: 'rail-btn small', onclick: () => void removeBreak(m) },
              children: [`Remove break after measure ${m}`],
            },
          ],
        });
      }
    }

    return {
      type: '#fragment',
      props: {},
      children: [
        {
          type: 'header',
          props: { class: 'part-toolbar night-surface' },
          children: [
            { type: 'h1', props: {}, children: [partName] },
            {
              type: 'span',
              props: { class: `status-chip ${part?.status === 'ready' ? 'ready' : part?.status === 'pdf_pending' ? 'pending' : ''}`, role: 'status' },
              children: [`${partName} PDF status: ${chipLabel()}`],
            },
            {
              type: 'button',
              props: { class: 'rail-btn', disabled: part?.status === 'engraving' || part?.status === 'rendering', onclick: () => void extract() },
              children: [part?.status === 'engraving' || part?.status === 'rendering' ? `Extract ${partName}…` : `Extract ${partName}`],
            },
            {
              type: 'button',
              props: { class: 'rail-btn', onclick: () => history.back() },
              children: ['Back to score'],
            },
            {
              type: 'button',
              props: { class: 'rail-btn', 'aria-label': playing ? 'Stop' : 'Play', onclick: () => togglePlay() },
              children: [playing ? 'Stop' : 'Play'],
            },
            {
              type: 'span',
              props: { class: 'transport-readout', role: 'timer', 'aria-label': 'Playback position' },
              children: [`Measure ${playMeasure} · Beat ${playBeat}`],
            },
            part?.status === 'ready'
              ? {
                  type: 'a',
                  props: {
                    class: 'panel-link',
                    href: `/api/scores/${props.scoreId}/parts/${props.partId}/pdf?token=${encodeURIComponent(sessionStorage.getItem('fairline-seat') ?? localStorage.getItem('fairline-seat') ?? '')}`,
                    download: '',
                  },
                  children: [`Download ${partName} PDF`],
                }
              : null,
          ],
        },
        canEditLayout() && !narrow
          ? {
              type: 'div',
              props: { class: 'part-toolbar night-surface', style: 'flex-wrap:wrap;gap:10px;' },
              children: [
                {
                  type: 'label',
                  props: { for: 'after-measure', style: 'font-size:13px;' },
                  children: ['After measure'],
                },
                {
                  type: 'input',
                  props: {
                    id: 'after-measure',
                    type: 'number',
                    min: '1',
                    value: breakMeasure,
                    style: 'width:90px;min-height:44px;padding:6px;background:#10141c;color:var(--paper);border:1px solid #333c4d;border-radius:4px;',
                    'aria-label': 'After measure',
                    oninput: (e: Event) => (breakMeasure = (e.target as HTMLInputElement).value),
                  },
                },
                { type: 'button', props: { class: 'rail-btn', onclick: () => void addBreak('systemBreaks') }, children: ['Add system break'] },
                { type: 'button', props: { class: 'rail-btn', onclick: () => void addBreak('pageBreaks') }, children: ['Add page turn'] },
                {
                  type: 'ul',
                  props: { class: 'break-list', 'aria-label': 'Breaks', role: 'list', style: 'flex-basis:100%;' },
                  children: breakItems,
                },
              ],
            }
          : null,
        {
          type: 'main',
          props: {
            class: narrow ? 'system-strip' : 'paper-column',
            role: narrow ? 'region' : 'complementary',
            'aria-label': narrow ? 'System strip' : `${partName} part`,
          },
          children: narrow
            ? systems.map((sys) => ({
                type: 'div',
                props: { role: 'group', 'aria-label': `System ${sys.index}, measures ${sys.firstMeasure}–${sys.lastMeasure}` },
                children: [{ type: 'div', props: { dangerouslySetInnerHTML: { __html: sys.svg } } }],
              }))
            : [
                {
                  type: 'div',
                  props: { class: 'part-pages', role: 'region', 'aria-label': `${partName} part` },
                  children: pageNodes,
                },
              ],
        },
      ],
    };
  }

  const node: VNode = {
    type: 'div',
    props: { id: 'part-host', style: 'display:flex;flex-direction:column;min-height:100%;' },
    children: [body()],
  };

  setTimeout(() => {
    void load();
    document.addEventListener('keydown', handleKeydown);
    window.addEventListener('resize', () => {
      const wasNarrow = narrow;
      narrow = window.innerWidth < 768;
      if (wasNarrow !== narrow) rerender();
    });
  }, 0);

  return node;
}
