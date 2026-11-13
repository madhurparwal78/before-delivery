import { useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError } from './api.js';
import type { Catalog } from '../../shared/types.js';

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const media = window.matchMedia(query);
    const onChange = (): void => setMatches(media.matches);
    setMatches(media.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

export function useIsPhone(): boolean {
  return useMediaQuery('(max-width: 767px)');
}

export function useIsDesktop(): boolean {
  return useMediaQuery('(min-width: 1280px)');
}

export interface Loaded<T> {
  data: T | null;
  error: ApiError | null;
  reload: () => void;
}

export function useResource<T>(path: string | null, dependency: unknown = null): Loaded<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    if (path === null) {
      setData(null);
      return undefined;
    }
    let live = true;
    void api<T>(path)
      .then((value) => {
        if (live) {
          setData(value);
          setError(null);
        }
      })
      .catch((caught: unknown) => {
        if (live && caught instanceof ApiError) setError(caught);
      });
    return () => {
      live = false;
    };
  }, [path, nonce, dependency]);
  return useMemo(() => ({ data, error, reload: () => setNonce((value) => value + 1) }), [data, error]);
}

export function useCatalog(): Loaded<Catalog> {
  return useResource<Catalog>('/api/catalog');
}

/** Plays a short chime through the Web Audio API when Sound is on. */
export function useChime(enabled: boolean): () => void {
  const context = useRef<AudioContext | null>(null);
  return () => {
    if (!enabled) return;
    context.current ??= new AudioContext();
    const audio = context.current;
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.08, audio.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.4);
    oscillator.connect(gain).connect(audio.destination);
    oscillator.start();
    oscillator.stop(audio.currentTime + 0.42);
  };
}
