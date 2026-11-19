import type { CategoryId, Project } from '../shared/types.js';

export const projectsIn = (projects: Project[], category: CategoryId | null): Project[] =>
  category === null ? projects : projects.filter((project) => project.category === category);

export const countIn = (projects: Project[], category: CategoryId | null): number =>
  projectsIn(projects, category).length;

export interface Neighbours {
  index: number;
  previous: Project | null;
  next: Project | null;
}

export function neighbours(
  projects: Project[],
  category: CategoryId | null,
  slug: string,
): Neighbours {
  const sequence = projectsIn(projects, category);
  const index = sequence.findIndex((project) => project.slug === slug);
  return {
    index,
    previous: index > 0 ? sequence[index - 1]! : null,
    next: index >= 0 && index < sequence.length - 1 ? sequence[index + 1]! : null,
  };
}
