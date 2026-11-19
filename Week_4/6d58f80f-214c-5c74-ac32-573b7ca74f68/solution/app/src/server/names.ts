// File and folder names (brief: Business rules, Names). Returns the trimmed name or the field message.
export function checkName(value: unknown): { name: string } | { error: string } {
  const name = typeof value === "string" ? value.trim() : "";
  if (!name) return { error: "Enter a name." };
  if ([...name].length > 120) return { error: "Names can be up to 120 characters." };
  if (/[/\\]/.test(name)) return { error: "Names cannot contain / or \\." };
  return { name };
}
