import { useEffect, useRef, useState } from 'preact/hooks';
import type { Folder } from '../lib/types.js';
import { Icon } from './Icon.tsx';

interface Props {
  folders: Folder[];
  expanded: Set<string>;
  focusedId: string | null;
  activeFolderId: string | null;
  onToggleExpand: (id: string) => void;
  onOpen: (folder: Folder) => void;
  onDropOnFolder?: (folder: Folder) => void;
  countOverrides?: Record<string, number>;
}

interface TreeNode {
  folder: Folder;
  children: TreeNode[];
}

function buildTree(folders: Folder[], parentId: string | null): TreeNode[] {
  const nodes: TreeNode[] = [];
  for (const folder of folders) {
    if (folder.parentId === parentId) {
      nodes.push({ folder, children: buildTree(folders, folder.id) });
    }
  }
  return nodes;
}

function flatten(nodes: TreeNode[], expanded: Set<string>): TreeNode[] {
  const out: TreeNode[] = [];
  for (const node of nodes) {
    out.push(node);
    if (node.children.length > 0 && expanded.has(node.folder.id ?? '')) {
      out.push(...flatten(node.children, expanded));
    }
  }
  return out;
}

export function FolderTree(props: Props): preact.JSX.Element {
  const { folders, expanded, activeFolderId } = props;
  const [focusedId, setFocusedId] = useState<string | null>(props.focusedId);
  const rootRef = useRef<HTMLDivElement>(null);
  const typeahead = useRef({ text: '', at: 0 });
  const dragOverId = useRef<string | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);

  useEffect(() => { if (props.focusedId) setFocusedId(props.focusedId); }, [props.focusedId]);

  const tree = buildTree(folders, null);
  const flattened = flatten(tree, expanded);
  const ids = flattened.map(n => n.folder.id ?? '');

  const byId = new Map<string, TreeNode>();
  for (const n of flattened) byId.set(n.folder.id ?? '', n);

  const onKeyDown = (e: KeyboardEvent): void => {
    const idx = focusedId ? ids.indexOf(focusedId) : -1;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const next = ids[idx + 1] ?? ids[0];
      if (next) setFocusedId(next);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const prev = idx > 0 ? ids[idx - 1] : ids[ids.length - 1];
      if (prev) setFocusedId(prev);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      const node = focusedId ? byId.get(focusedId) : undefined;
      if (node && node.children.length > 0) {
        if (!expanded.has(node.folder.id ?? '')) props.onToggleExpand(node.folder.id ?? '');
        else if (node.children[0]) setFocusedId(node.children[0].folder.id ?? '');
      }
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      const node = focusedId ? byId.get(focusedId) : undefined;
      if (node && node.children.length > 0 && expanded.has(node.folder.id ?? '')) {
        props.onToggleExpand(node.folder.id ?? '');
      } else if (node && node.folder.parentId) {
        setFocusedId(node.folder.parentId);
      }
    } else if (e.key === 'Home') {
      e.preventDefault();
      if (ids[0]) setFocusedId(ids[0]);
    } else if (e.key === 'End') {
      e.preventDefault();
      const last = ids[ids.length - 1];
      if (last) setFocusedId(last);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const node = focusedId ? byId.get(focusedId) : undefined;
      if (node) props.onOpen(node.folder);
    } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const now = Date.now();
      if (now - typeahead.current.at > 500) typeahead.current.text = '';
      typeahead.current.text += e.key.toLowerCase();
      typeahead.current.at = now;
      const match = flattened.find(n => n.folder.name.toLowerCase().startsWith(typeahead.current.text));
      if (match) setFocusedId(match.folder.id ?? '');
    }
  };

  return (
    <div ref={rootRef} role="tree" aria-label="Folders" tabindex="0" class="tree" onKeyDown={onKeyDown}>
      {flattened.map(node => {
        const id = node.folder.id ?? '';
        const hasChildren = node.children.length > 0;
        const depth = depthOf(folders, node.folder);
        return (
          <div
            key={id}
            role="treeitem"
            aria-expanded={hasChildren ? (expanded.has(id) ? 'true' : 'false') : undefined}
            aria-label={treeItemLabel(node.folder, props.countOverrides)}
            data-folder-id={id}
            class={`treeitem${focusedId === id ? ' focused' : ''}`}
            style={`padding-left:${6 + depth * 14}px;`}
            onDragOver={e => { e.preventDefault(); if (dragOverId.current !== id) { dragOverId.current = id; setDragOver(id); } }}
            onDragLeave={() => { if (dragOverId.current === id) { dragOverId.current = null; setDragOver(null); } }}
            onDrop={e => { e.preventDefault(); dragOverId.current = null; setDragOver(null); props.onDropOnFolder?.(node.folder); }}
          >
            <button
              type="button"
              class="expander"
              aria-hidden="true"
              tabindex="-1"
              onClick={e => { e.stopPropagation(); if (hasChildren) props.onToggleExpand(id); }}
              style={{ visibility: hasChildren ? 'visible' : 'hidden', outlineColor: dragOver === id ? 'var(--accent)' : undefined }}
            >
              <Icon name={expanded.has(id) ? 'chevron-down' : 'chevron-right'} size={12} />
            </button>
            <button
              type="button"
              tabindex="-1"
              class="tname"
              style={{ color: activeFolderId === id ? 'var(--accent)' : undefined, fontWeight: activeFolderId === id ? 600 : undefined }}
              onClick={() => { setFocusedId(id); props.onOpen(node.folder); }}
              title={node.folder.name}
            >
              {node.folder.name}
            </button>
            <span class="tcount" aria-hidden="true">{node.folder.fileCount}</span>
          </div>
        );
      })}
    </div>
  );
}

function treeItemLabel(folder: Folder, overrides?: Record<string, number>): string {
  const count = overrides?.[folder.id ?? ''] ?? folder.fileCount;
  return `${folder.name} ${count} files`;
}

function depthOf(folders: Folder[], folder: Folder): number {
  let depth = 0;
  let current: Folder | undefined = folder;
  const byId = new Map(folders.map(f => [f.id ?? '', f]));
  while (current && current.parentId) {
    depth++;
    current = byId.get(current.parentId);
  }
  return depth;
}
