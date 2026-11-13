// Protection patterns: a name matches when it equals the pattern or the pattern's `*` (any characters) fit it.
export function patternMatches(pattern: string, name: string): boolean {
  if (!pattern.includes("*")) return pattern === name;
  const source = pattern.split("*").map((part) => part.replace(/[\\^$.*+?()[\]{}|/-]/g, "\\$&")).join(".*");
  return new RegExp(`^${source}$`, "s").test(name);
}
