import { useDesk } from '../lib/desk.tsx';
import type { Specimen } from '../../shared/types.ts';

/**
 * The specimen a stock workspace is working on. The `specimen` query parameter
 * picks one; otherwise the first dealer-owned specimen is shown.
 */
export function useSelectedSpecimen(): { key: string; specimen: Specimen | undefined } {
  const desk = useDesk();
  const asked = new URL(window.location.href).searchParams.get('specimen');
  const specimens = desk.state?.specimens ?? {};
  if (asked && specimens[asked]) return { key: asked, specimen: specimens[asked] };
  const first = Object.entries(specimens).find(([, value]) => value.owner === 'dealer');
  return { key: first?.[0] ?? '', specimen: first?.[1] };
}

/** Every dealer-owned specimen, in creation order. */
export function useDealerSpecimens(): [string, Specimen][] {
  const desk = useDesk();
  return Object.entries(desk.state?.specimens ?? {}).filter(
    ([, specimen]) => specimen.owner === 'dealer',
  );
}
