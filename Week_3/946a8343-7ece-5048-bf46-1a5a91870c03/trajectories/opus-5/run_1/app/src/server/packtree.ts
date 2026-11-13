import { TreeEntry, hashBlob, hashTree } from './repo';

export function treeIdOf(files: Map<string, string>): string {
  const level = (prefix: string): string => {
    const entries: TreeEntry[] = [];
    const folders = new Set<string>();
    for (const [path, content] of files) {
      if (!path.startsWith(prefix)) continue;
      const rest = path.slice(prefix.length);
      const slash = rest.indexOf('/');
      if (slash === -1) {
        entries.push({ name: rest, mode: '100644', id: hashBlob(content), type: 'blob' });
      } else {
        folders.add(rest.slice(0, slash));
      }
    }
    for (const folder of folders) {
      entries.push({ name: folder, mode: '040000', id: level(`${prefix}${folder}/`), type: 'tree' });
    }
    return hashTree(entries);
  };
  return level('');
}
