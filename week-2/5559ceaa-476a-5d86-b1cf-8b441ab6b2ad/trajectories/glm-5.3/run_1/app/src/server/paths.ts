import { createHash } from "node:crypto";

const MAX_PATH_LEN = 255;

export function normalizePath(p: string): string {
  let s = p.replace(/\\/g, "/");
  if (s.startsWith("./")) s = s.slice(2);
  s = s.replace(/\/{2,}/g, "/").normalize("NFC");
  return s;
}

export type PathCheck = { ok: true; path: string } | { ok: false; code: string; field?: string };

export function checkPath(p: string): PathCheck {
  const path = normalizePath(p);
  if (path.startsWith("/") || /^[a-zA-Z]:/.test(path)) {
    return { ok: false, code: "absolute_path", field: "path" };
  }
  if (path.split("/").some((seg) => seg === "..")) {
    return { ok: false, code: "path_traversal", field: "path" };
  }
  if (path.length > MAX_PATH_LEN) {
    return { ok: false, code: "path_too_long", field: "path" };
  }
  if (path === "") return { ok: false, code: "path_traversal", field: "path" };
  return { ok: true, path };
}

const ALLOWED_EXTENSIONS = [
  ".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", ".py",
  ".html", ".css", ".json", ".md", ".txt", ".svg", ".yml", ".yaml",
];

const ALLOWED_NAMES = new Set([".gitignore", "Makefile", "README", "LICENSE"]);

export function allowedExtension(path: string): boolean {
  const name = path.split("/").pop() ?? "";
  if (ALLOWED_NAMES.has(name)) return true;
  const dot = name.lastIndexOf(".");
  if (dot === -1) return false;
  return ALLOWED_EXTENSIONS.includes(name.slice(dot).toLowerCase());
}

export type ContentCheck = { ok: true; sha256: string; size: number } | { ok: false; code: string; field?: string };

export const MAX_FILE_BYTES = 1_000_000;

export function checkContent(bytes: Buffer, field = "content"): ContentCheck {
  if (bytes.includes(0)) return { ok: false, code: "content_mismatch", field };
  const text = bytes.toString("utf8");
  if (Buffer.byteLength(text, "utf8") !== bytes.length) {
    return { ok: false, code: "content_mismatch", field };
  }
  if (bytes.length > MAX_FILE_BYTES) return { ok: false, code: "file_too_large", field };
  return { ok: true, sha256: sha256(bytes), size: bytes.length };
}

export function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function unsafeSvg(path: string, bytes: Buffer): boolean {
  if (!path.toLowerCase().endsWith(".svg")) return false;
  const text = bytes.toString("utf8");
  if (/<script[\s>]/i.test(text)) return true;
  return /\son[a-z]+\s*=/i.test(text);
}

export function validateNewFile(path: string, content: string): { path?: string; content?: string } {
  const pc = checkPath(path);
  if (!pc.ok) return { path: pc.code };
  if (!allowedExtension(pc.path)) return { path: "disallowed_type" };
  const bytes = Buffer.from(content, "utf8");
  const cc = checkContent(bytes);
  if (!cc.ok) return { content: cc.code };
  if (unsafeSvg(pc.path, bytes)) return { content: "unsafe_svg" };
  return {};
}
