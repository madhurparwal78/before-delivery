import { useCallback, useEffect, useState } from 'react';
import type { SheetName, NonModalSheet, ViewUrlState } from './store/types';

const SHEETS: SheetName[] = [
  'layouts', 'versions', 'timetable', 'crew-packets', 'members', 'standards', 'history', 'trash', 'sessions',
];
const NON_MODAL: NonModalSheet[] = ['conflict', 'deadlock', 'piece-inspector'];

function readUrl(): ViewUrlState {
  const params = new URLSearchParams(window.location.search);
  const sheetRaw = params.get('sheet');
  let sheet: SheetName | null = null;
  let dialog: NonModalSheet | null = null;
  if (sheetRaw && SHEETS.includes(sheetRaw as SheetName)) sheet = sheetRaw as SheetName;
  if (sheetRaw && NON_MODAL.includes(sheetRaw as NonModalSheet)) dialog = sheetRaw as NonModalSheet;
  const modeRaw = params.get('mode');
  const heading = params.get('heading');
  return {
    workspace: params.get('workspace'),
    layout: params.get('layout'),
    version: params.get('version'),
    session: params.get('session'),
    mode: modeRaw === 'operate' ? 'operate' : modeRaw === 'build' ? 'build' : null,
    train: params.get('train'),
    block: params.get('block'),
    piece: params.get('piece'),
    end: params.get('end'),
    heading: heading !== null ? Number(heading) : null,
    sheet,
    dialog,
  };
}

function writeUrl(state: ViewUrlState): void {
  const params = new URLSearchParams();
  if (state.workspace) params.set('workspace', state.workspace);
  if (state.layout) params.set('layout', state.layout);
  if (state.version) params.set('version', state.version);
  if (state.session) params.set('session', state.session);
  if (state.mode) params.set('mode', state.mode);
  if (state.train) params.set('train', state.train);
  if (state.block) params.set('block', state.block);
  if (state.piece) params.set('piece', state.piece);
  if (state.end) params.set('end', state.end);
  if (state.heading !== null) params.set('heading', String(state.heading));
  const sheetValue = state.sheet ?? state.dialog;
  if (sheetValue) params.set('sheet', sheetValue);
  const query = params.toString();
  const url = `${window.location.pathname}${query ? `?${query}` : ''}`;
  window.history.replaceState(null, '', url);
}

/** View state lives in the URL and is restored on refresh. */
export function useViewUrl(): [ViewUrlState, (patch: Partial<ViewUrlState>) => void] {
  const [state, setState] = useState<ViewUrlState>(() => readUrl());

  useEffect(() => {
    const onPop = () => setState(readUrl());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const update = useCallback((patch: Partial<ViewUrlState>) => {
    setState((prev) => {
      const next = { ...prev, ...patch };
      writeUrl(next);
      return next;
    });
  }, []);

  return [state, update];
}
