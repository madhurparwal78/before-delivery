// Loading the main file and everything it includes into one top-level map.
import { EMPTY_MAP, entryOf, mergeMaps, relocateMap, scalarItems, withoutKey } from "./nodes.ts";
import { messages, type Problems } from "./problems.ts";
import { readYaml, type YamlMap } from "./yaml.ts";

interface IncludeSource {
  readonly load: (path: string) => string | null;
  readonly problems: Problems;
}

// `reportAt` is the main file's include line that led here; every node of an included file is re-lined to it.
function loadFile(
  content: string,
  reportAt: number | null,
  chain: readonly string[],
  source: IncludeSource,
): YamlMap | null {
  const parsed = readYaml(content);
  if (!parsed.ok) {
    source.problems.markUnreadable(reportAt ?? parsed.line);
    return null;
  }
  let included: YamlMap = EMPTY_MAP;
  for (const item of scalarItems(entryOf(parsed.root, "include")?.value)) {
    if (source.problems.unreadable) return null;
    const line = reportAt ?? item.line;
    const start = chain.indexOf(item.text);
    if (start >= 0) {
      source.problems.add(line, messages.includeCycle([...chain.slice(start), item.text]));
      continue;
    }
    const text = source.load(item.text);
    if (text === null) {
      source.problems.add(line, messages.includeMissing(item.text));
      continue;
    }
    const child = loadFile(text, line, [...chain, item.text], source);
    if (child) included = mergeMaps(included, child);
  }
  const own = withoutKey(parsed.root, "include");
  return mergeMaps(included, reportAt === null ? own : relocateMap(own, reportAt));
}

export function loadMergedConfig(mainPath: string, content: string, source: IncludeSource): YamlMap | null {
  return loadFile(content, null, [mainPath], source);
}
