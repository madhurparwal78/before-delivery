import type { Project, World } from "../shared/types";
import { catalog } from "./boot";

/** The names of the given services, in the services' published order. */
export function serviceNames(ids: string[]): string {
  return catalog.services.filter((service) => ids.includes(service.id)).map((service) => service.name).join(", ");
}

export function metaLine(item: Pick<Project | World, "industry" | "services">): string {
  return `${item.industry} · ${serviceNames(item.services)}`;
}

export function displayFamily(face: string): string {
  return `"${face}", serif`;
}
