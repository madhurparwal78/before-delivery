import { useEffect, useRef } from 'preact/hooks';
import { api } from '../api';

export interface Project {
  id: string;
  name: string;
  generation_count: number;
  last_generation_at: string | null;
  created_at: string;
}

export interface Generation {
  id: string;
  project_id: string;
  model: string;
  prompt: string;
  duration: number | null;
  image_count: number | null;
  aspect: '16:9' | '9:16' | '1:1';
  cost: number;
  status: 'queued' | 'rendering' | 'ready' | 'cancelled';
  started_by: string;
  created_at: string;
  finished_at: string | null;
  charge?: number;
  refund?: number | null;
}

export interface CreditEntry {
  id: string;
  kind: 'plan' | 'seat' | 'charge' | 'refund';
  amount: number;
  balance_after: number;
  user_name: string | null;
  generation_id: string | null;
  created_at: string;
}

export const isActive = (generation: Generation): boolean =>
  generation.status === 'queued' || generation.status === 'rendering';

const newestFirst = (a: Generation, b: Generation) => b.created_at.localeCompare(a.created_at);

/** The workspace's five newest generations, read through the projects that hold them. */
export async function loadRecentGenerations(projects: Project[]): Promise<Generation[]> {
  const busy = projects
    .filter((project) => project.last_generation_at)
    .sort((a, b) => (b.last_generation_at ?? '').localeCompare(a.last_generation_at ?? ''))
    .slice(0, 5);
  const lists = await Promise.all(
    busy.map((project) => api<Generation[]>(`/api/projects/${project.id}/generations`))
  );
  return lists.flat().sort(newestFirst).slice(0, 5);
}

/** Keeps an open page in step with the server while anything is still rendering. */
export function useRendering(generations: Generation[], reload: () => void): void {
  const latest = useRef(reload);
  latest.current = reload;
  const busy = generations.some(isActive);
  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(() => latest.current(), 2000);
    return () => clearInterval(timer);
  }, [busy]);
}
