// Splits a comment body into prose, code blocks and ```suggestion blocks (the fence may carry `:-a+b`, which the server has
// already read into the suggestion's range).
type BodySegment =
  | { kind: "text"; text: string }
  | { kind: "code"; lines: string[] }
  | { kind: "suggestion"; lines: string[] };

const OPENING = /^```(\w*)(?::-\d+\+\d+)?\s*$/;

export function parseBody(body: string): BodySegment[] {
  const segments: BodySegment[] = [];
  const prose: string[] = [];
  const flush = () => {
    const text = prose.join("\n").trim();
    if (text !== "") segments.push({ kind: "text", text });
    prose.length = 0;
  };
  const lines = body.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const opening = OPENING.exec(lines[i]);
    const close = opening === null ? -1 : lines.indexOf("```", i + 1);
    if (opening === null || close === -1) {
      prose.push(lines[i]);
      continue;
    }
    flush();
    const inner = lines.slice(i + 1, close);
    segments.push(opening[1] === "suggestion" ? { kind: "suggestion", lines: inner } : { kind: "code", lines: inner });
    i = close;
  }
  flush();
  return segments;
}
