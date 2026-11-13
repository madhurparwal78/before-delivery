// Glob syntax shared by owners files, pipeline `changes`/`exists` rules and push-rule file globs.
// `*` matches within one path segment, `**` across segments, a leading `/` anchors at the root, a trailing `/` matches
// anything under that folder, and a pattern without a leading `/` matches at any depth.

function escapeChar(char: string): string {
  return /[\\^$.*+?()[\]{}|/-]/.test(char) ? `\\${char}` : char;
}

function bodyToRegExpSource(body: string): string {
  let source = "";
  for (let i = 0; i < body.length; i++) {
    const char = body.charAt(i);
    if (char === "*") {
      if (body.charAt(i + 1) === "*") {
        i++;
        if (body.charAt(i + 1) === "/") {
          i++;
          source += "(?:.*/)?";
        } else {
          source += ".*";
        }
      } else {
        source += "[^/]*";
      }
    } else if (char === "?") {
      source += "[^/]";
    } else {
      source += escapeChar(char);
    }
  }
  return source;
}

export function globToRegExp(pattern: string): RegExp {
  const anchored = pattern.startsWith("/");
  const folder = pattern.endsWith("/");
  let body = pattern;
  if (anchored) body = body.slice(1);
  if (folder) body = body.slice(0, -1);
  const source = bodyToRegExpSource(body);
  const prefix = anchored ? "^" : "^(?:.*/)?";
  const suffix = folder ? "/.+$" : "$";
  return new RegExp(prefix + source + suffix);
}

export function matchesGlob(pattern: string, path: string): boolean {
  return globToRegExp(pattern).test(path);
}
