// Parses text that arrives from outside; anything that is not JSON becomes undefined for the schema to refuse.
export function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
