/** Marks a route result as HTTP 201 Created. */
export interface CreatedMarker {
  __created: unknown;
}

export function created(value: unknown): CreatedMarker {
  return { __created: value };
}
