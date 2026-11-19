interface Deadlined {
  id: string;
  state: string;
  due_at: string;
  client: { name: string };
}

/** Deadline order: equal deadlines by state code, then client name, then return id. */
export function deadlineOrder(a: Deadlined, b: Deadlined): number {
  const name = (r: Deadlined): string => r.client.name;
  return a.due_at.localeCompare(b.due_at) || a.state.localeCompare(b.state)
    || (name(a) < name(b) ? -1 : name(a) > name(b) ? 1 : 0) || a.id.localeCompare(b.id);
}
