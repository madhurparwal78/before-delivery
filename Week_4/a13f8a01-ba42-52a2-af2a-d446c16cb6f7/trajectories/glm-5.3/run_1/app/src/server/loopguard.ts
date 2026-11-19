// Loop guard: instruments for/while/do-while headers in the pane script so
// iteration counts are enforced per loop instance, by iterations and never by
// elapsed time. Line numbers stay true because the guard call sites occupy
// the same line as the loop header they wrap.
//
// Every loop is counted from when it starts to when it exits. The guard runs
// in the test position: once per iteration.
export function rewriteJsForLoopGuard(js: string, loopLimit: number): string {
  const lines = js.split("\n");
  const out: string[] = [];
  let loopSeq = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const t = line.trimStart();
    const isFor = /^for\s*\(/.test(t);
    const isWhile = /^while\s*\(/.test(t);
    const isDo = /^do\s*\{/.test(t);
    if (isFor || isWhile || isDo) {
      loopSeq++;
      const id = loopSeq;
      const startLine = i + 1;
      if (isFor) {
        // `for (A; B; C) body` becomes `for (A, __ashlarLoop(id, line); (B); C) body`
        // by injecting the guard into the test slot through a wrapper call.
        const m = /^(\s*)for\s*\(/.exec(line);
        const indent = m?.[1] ?? "";
        const open = line.indexOf("for");
        const after = line.slice(open + 3).replace(/^\s*\(/, "");
        // split the header into init; test; update respecting nesting
        const header = readParens(after);
        const body = line.slice(open + 3).replace(/^\s*\(/ + header + /\)/.source, "");
        const parts = splitHeader(header);
        const init = parts[0];
        const test = parts[1] || "true";
        const update = parts[2];
        out.push(`${indent}for (${init ? init + ", " : ""}__ashlarLoop(${id}, ${startLine}); ${test}; ${update ?? ""})${body}`);
      } else if (isWhile) {
        const m = /^(\s*)while\s*\(/.exec(line);
        const indent = m?.[1] ?? "";
        const open = line.indexOf("while");
        const after = line.slice(open + 5).replace(/^\s*\(/, "");
        const header = readParens(after);
        const body = line.slice(open + 5).replace(/^\s*\(/, "").slice(header.length);
        out.push(`${indent}while (__ashlarLoop(${id}, ${startLine}) && (${header}))${body}`);
      } else {
        out.push(line.replace(/\bdo\s*\{/, `do { __ashlarLoop(${id}, ${startLine});`));
      }
    } else {
      out.push(line);
    }
  }
  const prelude = `var __ashlarLoopCounts = {};
function __ashlarLoop(id, line) {
  var n = (__ashlarLoopCounts[id] = (__ashlarLoopCounts[id] || 0) + 1);
  if (n > ${loopLimit}) {
    __ashlarLoopCounts[id] = 0;
    window.__ashlarReportLoop(line);
    throw window.__ashlarLoopExit;
  }
}
`;
  return prelude + out.join("\n");
}

function readParens(s: string): string {
  let depth = 0;
  let inStr: string | null = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (inStr) {
      if (c === "\\") i++;
      else if (c === inStr) inStr = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") inStr = c;
    else if (c === "(") depth++;
    else if (c === ")") {
      depth--;
      if (depth === 0) return s.slice(0, i);
    }
  }
  return s;
}

function splitHeader(header: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let inStr: string | null = null;
  let start = 0;
  for (let i = 0; i < header.length; i++) {
    const c = header[i]!;
    if (inStr) {
      if (c === "\\") i++;
      else if (c === inStr) inStr = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") inStr = c;
    else if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (c === ";" && depth === 0) {
      parts.push(header.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(header.slice(start));
  return parts;
}
