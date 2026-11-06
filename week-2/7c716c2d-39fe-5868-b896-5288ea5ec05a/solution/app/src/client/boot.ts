// First-paint data the server embedded in the page (the same bodies the API returns), so the
// page renders its controls without waiting for a round trip. Read once at start.
import { get, type Channel, type Cycle, type Me, type Person, type Project, type UnreadBody } from "./api";

interface WorkspaceBoot {
  me: Me;
  projects?: Project[];
  members?: Person[];
  channels?: Channel[];
  unread?: UnreadBody;
  current_cycle?: number;
  last_event_id?: string;
}

function read(): { signed_in: WorkspaceBoot | null } | null {
  const node = document.getElementById("boot");
  if (!node?.textContent) return null;
  return JSON.parse(node.textContent) as { signed_in: WorkspaceBoot | null } | null;
}

export const boot = read();

let pending: WorkspaceBoot | null = boot?.signed_in ?? null;

/** First-paint data for this person, handed out once; later mounts fetch fresh. */
export function takeWorkspaceBoot(personId: string): WorkspaceBoot | null {
  const found = pending?.me.person.id === personId ? pending : null;
  pending = null;
  return found;
}

/** Loads the same first-paint data after an in-page sign-in or join, before the workspace shows. */
export async function prefetchWorkspace(me: Me): Promise<void> {
  if (!me.workspace) return;
  try {
    const [projects, members, channels, unread, cycle] = await Promise.all([
      get<{ projects: Project[] }>("/api/projects"),
      get<{ members: Person[] }>("/api/members"),
      get<{ channels: Channel[] }>("/api/channels"),
      get<UnreadBody>("/api/unread"),
      get<Cycle>("/api/cycles/current"),
    ]);
    pending = { me, projects: projects.projects, members: members.members, channels: channels.channels, unread, current_cycle: cycle.number };
  } catch {
    pending = null;
  }
}
