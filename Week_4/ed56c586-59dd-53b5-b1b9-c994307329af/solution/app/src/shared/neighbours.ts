import { PROJECTS, type DisciplineValue, type Project } from "./catalog.js";
import { visibleProjects } from "./filter.js";

interface Neighbours {
  readonly previous: Project | undefined;
  readonly next: Project | undefined;
}

/** The neighbours of a project among the projects its address's category list shows; the list does not wrap. */
export function neighbours(project: Project, categories: readonly DisciplineValue[]): Neighbours {
  const shown = visibleProjects(categories);
  const among = shown.includes(project) ? shown : PROJECTS;
  const at = among.indexOf(project);
  return { previous: among[at - 1], next: among[at + 1] };
}
