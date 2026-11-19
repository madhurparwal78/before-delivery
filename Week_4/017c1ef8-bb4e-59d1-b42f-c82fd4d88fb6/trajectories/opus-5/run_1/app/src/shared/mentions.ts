/** Mention suggestions: the author's 1st-degree connections, by name, at most 5. */
export type MentionCandidate = { id: string; handle: string; name: string };

export function mentionSuggestions(
  connections: readonly MentionCandidate[],
  fragment: string,
): MentionCandidate[] {
  const typed = fragment.toLowerCase();
  if (typed === '') return [];
  const matched = connections.filter(
    (candidate) =>
      candidate.handle.toLowerCase().startsWith(typed) ||
      candidate.name
        .toLowerCase()
        .split(' ')
        .some((word) => word.startsWith(typed)),
  );
  matched.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
  return matched.slice(0, 5);
}
