// The wizard draft: kept in this tab's session storage when "Create connection" answers 401, bound to the user who
// was signed in, and restored once on the next wizard load after that same user signs in again.
const DRAFT_STORAGE_KEY = "wayline.wizard-draft";

export const draft = {
  save: (userId, step, form) => window.sessionStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify({ userId, step, form })),
  discard: () => window.sessionStorage.removeItem(DRAFT_STORAGE_KEY),
  // Hands the draft over exactly once, and only to its own user; anyone else's load discards it.
  take(userId) {
    const raw = window.sessionStorage.getItem(DRAFT_STORAGE_KEY);
    window.sessionStorage.removeItem(DRAFT_STORAGE_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw);
    return saved.userId === userId ? saved : null;
  },
};
