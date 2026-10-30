const PATH_MAX = 255;
export const CONTENT_MAX = 1_000_000;

const ALLOWED_EXTENSIONS = new Set([
  ".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", ".py", ".html", ".css", ".json", ".md", ".txt", ".svg", ".yml", ".yaml",
]);
const ALLOWED_NAMES = new Set([".gitignore", "Makefile", "README", "LICENSE"]);

type PathProblem = "absolute_path" | "path_traversal" | "path_too_long" | "disallowed_type";
type ContentProblem = "content_mismatch" | "unsafe_svg" | "file_too_large";

export function normalisePath(raw: string): string {
  let path = raw.replace(/\\/g, "/");
  if (path.startsWith("./")) path = path.slice(2);
  return path.replace(/\/{2,}/g, "/").normalize("NFC");
}

export function pathProblem(path: string): PathProblem | null {
  if (path.startsWith("/") || /^[A-Za-z]:/.test(path)) return "absolute_path";
  if (path.split("/").includes("..")) return "path_traversal";
  if (path.length > PATH_MAX) return "path_too_long";
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  const extension = dot > 0 ? name.slice(dot).toLowerCase() : "";
  if (!ALLOWED_NAMES.has(name) && !ALLOWED_EXTENSIONS.has(extension)) return "disallowed_type";
  return null;
}

const decoder = new TextDecoder("utf-8", { fatal: true });

export function contentProblem(path: string, bytes: Buffer): ContentProblem | null {
  if (bytes.length > CONTENT_MAX) return "file_too_large";
  if (bytes.includes(0)) return "content_mismatch";
  let text: string;
  try {
    text = decoder.decode(bytes);
  } catch {
    return "content_mismatch";
  }
  if (path.toLowerCase().endsWith(".svg") && unsafeSvg(text)) return "unsafe_svg";
  return null;
}

function unsafeSvg(text: string): boolean {
  return /<\s*script[\s>/]/i.test(text) || /<[^>]*\s(on[a-z0-9_-]*)\s*=/i.test(text);
}

const PATH_MESSAGES: Record<PathProblem, string> = {
  absolute_path: "Use a path inside the project, not an absolute one.",
  path_traversal: "The path can't leave the project folder.",
  path_too_long: "Paths are at most 255 characters.",
  disallowed_type: "That file type isn't allowed.",
};

const CONTENT_MESSAGES: Record<ContentProblem, string> = {
  content_mismatch: "Content must be readable UTF-8 text.",
  unsafe_svg: "SVG files can't contain script.",
  file_too_large: "Files are at most 1,000,000 bytes.",
};

export function pathMessage(problem: PathProblem): string {
  return PATH_MESSAGES[problem];
}

export function contentMessage(problem: ContentProblem): string {
  return CONTENT_MESSAGES[problem];
}
