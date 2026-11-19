const NAME_MAX = 120;

export function validateName(name: unknown): string | null {
  if (typeof name !== 'string') return 'Enter a name.';
  const trimmed = name.trim();
  if (trimmed.length < 1) return 'Enter a name.';
  if (trimmed.length > NAME_MAX) return `Names can be up to ${NAME_MAX} characters.`;
  if (trimmed.includes('/') || trimmed.includes('\\')) return 'Names cannot contain / or \\.';
  return null;
}

export const trimName = (name: string): string => name.trim();
