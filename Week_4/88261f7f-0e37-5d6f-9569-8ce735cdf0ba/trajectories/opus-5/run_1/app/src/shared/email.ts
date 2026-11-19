const ADDRESS = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isEmailAddress(value: string): boolean {
  return ADDRESS.test(value.trim());
}
