import { useState, type FormEvent } from 'react';
import { post } from '../api';
import type { PlayView } from '../../shared/types';
import { refusalMessage } from './refusal';

export const JOIN_FORM = 'join-form';

/** The Display name field and the Join request behind the raised Join button. */
export function useJoin(token: string, onJoined: (view: PlayView) => void) {
  const [displayName, setDisplayName] = useState('');
  const [refusal, setRefusal] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setPending(true);
    setRefusal(null);
    try {
      onJoined(await post<PlayView>(`/api/play/${token}/join`, { displayName }));
    } catch (failure) {
      setRefusal(refusalMessage(failure));
    } finally {
      setPending(false);
    }
  };

  return { displayName, setDisplayName, refusal, pending, submit };
}

export type JoinState = ReturnType<typeof useJoin>;
