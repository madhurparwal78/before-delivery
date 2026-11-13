// The five fixed rail segments (brief: Promotion rail), as fractions of the edge length.
// The server derives progress and reached segments from them; the browser only draws them.
export const RAIL_SEGMENTS = [
  { label: "Queued", from: 0, to: 0.1 },
  { label: "Window check", from: 0.1, to: 0.2 },
  { label: "Applying", from: 0.2, to: 0.6 },
  { label: "Health wait", from: 0.6, to: 0.95 },
  { label: "Healthy", from: 0.95, to: 1 },
] as const;
