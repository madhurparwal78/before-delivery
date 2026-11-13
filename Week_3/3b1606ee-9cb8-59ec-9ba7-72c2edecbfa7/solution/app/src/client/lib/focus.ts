/**
 * Set by an action that lands in a conversation (Write a letter, Accept) so its composer takes focus on arrival;
 * a mounted composer registers `focus` so an action in the open conversation can move focus into it.
 */
export const composerFocus: { id: string | null; focus: (() => void) | null } = { id: null, focus: null };
