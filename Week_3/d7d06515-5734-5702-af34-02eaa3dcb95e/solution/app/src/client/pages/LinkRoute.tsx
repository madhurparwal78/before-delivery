// /s/<token>: checks the link, then opens the editor through it or shows the expired, revoked or invalid page.
import { useEffect, useState } from 'react';
import type { LinkInfo } from '../../shared/types.ts';
import { ApiError, get, useLinkToken } from '../api.ts';
import { EditorPage } from '../editor/EditorPage.tsx';
import { LoadingStrokes } from '../ui/LoadingStrokes.tsx';
import { LinkEnded, type LinkEndState } from './LinkEnded.tsx';

type State =
  | { kind: 'checking' }
  | { kind: 'open'; timeZone: string }
  | { kind: 'ended'; state: LinkEndState; timeZone?: string };

function endedState(error: unknown): LinkEndState {
  if (error instanceof ApiError && error.code === 'link_expired') return 'expired';
  if (error instanceof ApiError && error.code === 'link_revoked') return 'revoked';
  return 'invalid';
}

export function LinkRoute({ token }: { token: string }) {
  const [state, setState] = useState<State>({ kind: 'checking' });

  useEffect(() => {
    let active = true;
    get<LinkInfo>(`/api/links/${encodeURIComponent(token)}`).then(
      (info) => {
        if (!active) return;
        // The editor's first requests must already carry the link header.
        useLinkToken(token);
        setState({ kind: 'open', timeZone: info.time_zone });
      },
      (error: unknown) => {
        if (!active) return;
        const zone = error instanceof ApiError ? error.body.time_zone : undefined;
        setState({ kind: 'ended', state: endedState(error), timeZone: typeof zone === 'string' ? zone : undefined });
      },
    );
    return () => {
      active = false;
      useLinkToken(null);
    };
  }, [token]);

  if (state.kind === 'checking') return <main className="page-loading"><h1 className="sr-only">Loading</h1><LoadingStrokes /></main>;
  if (state.kind === 'ended') return <LinkEnded state={state.state} timeZone={state.timeZone} />;
  const timeZone = state.timeZone;
  return <EditorPage linkToken={token} onLinkEnded={(ended) => setState({ kind: 'ended', state: ended, timeZone })} />;
}
