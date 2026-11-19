import { useEffect, useState } from 'react';
import type { Piece } from '../../shared/api.js';
import { api } from './api.js';
import { publicUniformsFrom } from './pieceShader.js';

const cache = new Map<string, { name: string; value: number }[]>();
const inFlight = new Map<string, Promise<{ name: string; value: number }[]>>();

/**
 * A piece's public fader values, which colour its live canvas everywhere.
 * Shared across cards so one piece is fetched once per page.
 */
export function usePublicUniforms(slug: string): { name: string; value: number }[] {
  const [uniforms, setUniforms] = useState(() => cache.get(slug) ?? publicUniformsFrom([]));

  useEffect(() => {
    if (slug === '') return;
    const known = cache.get(slug);
    if (known) {
      setUniforms(known);
      return;
    }
    let alive = true;
    let pending = inFlight.get(slug);
    if (!pending) {
      pending = api
        .get<Piece>(`/api/pieces/${slug}`)
        .then((piece) => {
          const value = publicUniformsFrom(piece.uniforms);
          cache.set(slug, value);
          return value;
        })
        .finally(() => inFlight.delete(slug));
      inFlight.set(slug, pending);
    }
    pending
      .then((value) => {
        if (alive) setUniforms(value);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [slug]);

  return uniforms;
}

export function primeUniforms(slug: string, uniforms: readonly { name: string; value: number }[]): void {
  cache.set(slug, publicUniformsFrom(uniforms));
}
