import { useEffect, useState } from 'react';

export const SHEET_NAMES = [
  'layouts',
  'versions',
  'timetable',
  'crew-packets',
  'members',
  'standards',
  'history',
  'trash',
  'sessions',
  'conflict',
  'deadlock',
  'piece-inspector',
] as const;

export type SheetName = (typeof SHEET_NAMES)[number];

export interface ViewState {
  workspace: string | null;
  layout: string | null;
  version: string | null;
  session: string | null;
  mode: 'build' | 'operate';
  train: string | null;
  block: string | null;
  piece: string | null;
  end: string | null;
  heading: number;
  sheet: SheetName | null;
}

const VIEW_EVENT = 'gandyboard:view';

function read(search: string): ViewState {
  const params = new URLSearchParams(search);
  const sheet = params.get('sheet');
  const heading = Number.parseInt(params.get('heading') ?? '0', 10);
  return {
    workspace: params.get('workspace'),
    layout: params.get('layout'),
    version: params.get('version'),
    session: params.get('session'),
    mode: params.get('mode') === 'operate' ? 'operate' : 'build',
    train: params.get('train'),
    block: params.get('block'),
    piece: params.get('piece'),
    end: params.get('end'),
    heading: Number.isFinite(heading) ? ((heading % 360) + 360) % 360 : 0,
    sheet: SHEET_NAMES.includes(sheet as SheetName) ? (sheet as SheetName) : null,
  };
}

export function readView(): ViewState {
  return read(window.location.search);
}

export function writeView(patch: Partial<ViewState>): void {
  const current = readView();
  const next = { ...current, ...patch };
  const params = new URLSearchParams();
  const put = (name: string, value: string | null): void => {
    if (value !== null && value !== '') params.set(name, value);
  };
  put('workspace', next.workspace);
  put('layout', next.layout);
  put('version', next.version);
  put('session', next.session);
  put('mode', next.mode);
  put('train', next.train);
  put('block', next.block);
  put('piece', next.piece);
  put('end', next.end);
  put('heading', next.heading === 0 ? null : String(next.heading));
  put('sheet', next.sheet);
  const search = params.toString();
  window.history.replaceState(null, '', search === '' ? '/' : `/?${search}`);
  window.dispatchEvent(new Event(VIEW_EVENT));
}

export function useView(): ViewState {
  const [view, setView] = useState<ViewState>(() => readView());
  useEffect(() => {
    const update = (): void => setView(readView());
    window.addEventListener(VIEW_EVENT, update);
    window.addEventListener('popstate', update);
    return () => {
      window.removeEventListener(VIEW_EVENT, update);
      window.removeEventListener('popstate', update);
    };
  }, []);
  return view;
}

const DRAFT_PREFIX = 'gandyboard:draft:';

export function readDraft(name: string): string {
  return window.localStorage.getItem(`${DRAFT_PREFIX}${name}`) ?? '';
}

export function writeDraft(name: string, value: string): void {
  if (value === '') window.localStorage.removeItem(`${DRAFT_PREFIX}${name}`);
  else window.localStorage.setItem(`${DRAFT_PREFIX}${name}`, value);
}
