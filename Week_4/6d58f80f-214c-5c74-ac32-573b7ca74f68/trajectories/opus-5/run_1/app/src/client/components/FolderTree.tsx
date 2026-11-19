import { useCallback, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { Folder } from '../../shared/types.js';
import { files as filesCopy } from '../../shared/copy.js';

export interface TreeNode {
  folder: Folder;
  children: TreeNode[];
}

export const buildTree = (folders: Folder[]): TreeNode[] => {
  const nodes = new Map<string, TreeNode>(
    folders.map((folder) => [folder.id, { folder, children: [] }]),
  );
  const roots: TreeNode[] = [];
  for (const node of nodes.values()) {
    const parentId = node.folder.parentId;
    const parent = parentId === null ? undefined : nodes.get(parentId);
    if (parent === undefined) roots.push(node);
    else parent.children.push(node);
  }
  const sort = (list: TreeNode[]): void => {
    list.sort((a, b) => a.folder.name.localeCompare(b.folder.name));
    for (const node of list) sort(node.children);
  };
  sort(roots);
  return roots;
};

export const ancestorChain = (folders: Folder[], folderId: string): string[] => {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const chain: string[] = [];
  let current = byId.get(folderId);
  while (current !== undefined) {
    chain.push(current.id);
    const parentId: string | null = current.parentId;
    current = parentId === null ? undefined : byId.get(parentId);
  }
  return chain;
};

interface FolderTreeProps {
  label: string;
  folders: Folder[];
  openFolderId: string | null;
  onOpen: (folderId: string) => void;
  /** Called when a click only picks a node, used where Enter or a button confirms instead. */
  onPick?: (folderId: string) => void;
  onDropFiles?: (folderId: string) => void;
  onPasteInto?: (folderId: string) => void;
  steppedCounts?: Set<string>;
}

interface Flat {
  node: TreeNode;
  depth: number;
}

export const FolderTree = ({
  label,
  folders,
  openFolderId,
  onOpen,
  onPick,
  onDropFiles,
  onPasteInto,
  steppedCounts,
}: FolderTreeProps): JSX.Element => {
  const roots = useMemo(() => buildTree(folders), [folders]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [focusId, setFocusId] = useState<string | null>(null);
  const [dropId, setDropId] = useState<string | null>(null);
  const typeahead = useRef<{ text: string; at: number }>({ text: '', at: 0 });
  const container = useRef<HTMLUListElement>(null);

  const visible = useMemo(() => {
    const out: Flat[] = [];
    const walk = (list: TreeNode[], depth: number): void => {
      for (const node of list) {
        out.push({ node, depth });
        if (node.children.length > 0 && !collapsed.has(node.folder.id)) {
          walk(node.children, depth + 1);
        }
      }
    };
    walk(roots, 0);
    return out;
  }, [roots, collapsed]);

  const current = focusId ?? openFolderId ?? visible[0]?.node.folder.id ?? null;

  const focusNode = useCallback((id: string) => {
    setFocusId(id);
    window.requestAnimationFrame(() => {
      container.current?.querySelector<HTMLElement>(`[data-tree-node="${id}"]`)?.focus();
    });
  }, []);

  const toggle = (id: string, open: boolean): void => {
    setCollapsed((previous) => {
      const next = new Set(previous);
      if (open) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLUListElement>): void => {
    if (current === null) return;
    const index = visible.findIndex((entry) => entry.node.folder.id === current);
    const entry = visible[index];
    if (entry === undefined) return;
    const hasChildren = entry.node.children.length > 0;
    const expanded = hasChildren && !collapsed.has(current);

    const step = (target: number): void => {
      const next = visible[target];
      if (next !== undefined) focusNode(next.node.folder.id);
    };

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        step(index + 1);
        return;
      case 'ArrowUp':
        event.preventDefault();
        step(index - 1);
        return;
      case 'ArrowRight':
        event.preventDefault();
        if (hasChildren && !expanded) toggle(current, true);
        else if (expanded) step(index + 1);
        return;
      case 'ArrowLeft': {
        event.preventDefault();
        if (expanded) toggle(current, false);
        else {
          const parentId = entry.node.folder.parentId;
          if (parentId !== null) focusNode(parentId);
        }
        return;
      }
      case 'Home':
        event.preventDefault();
        step(0);
        return;
      case 'End':
        event.preventDefault();
        step(visible.length - 1);
        return;
      case 'Enter':
        event.preventDefault();
        onOpen(current);
        return;
      default:
        break;
    }

    if ((event.key === 'v' || event.key === 'V') && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      onPasteInto?.(current);
      return;
    }
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const now = Date.now();
      const text =
        now - typeahead.current.at < 500 ? typeahead.current.text + event.key : event.key;
      typeahead.current = { text, at: now };
      const lower = text.toLowerCase();
      const start = index + (text.length === 1 ? 1 : 0);
      for (let offset = 0; offset < visible.length; offset += 1) {
        const candidate = visible[(start + offset) % visible.length];
        if (candidate !== undefined && candidate.node.folder.name.toLowerCase().startsWith(lower)) {
          focusNode(candidate.node.folder.id);
          return;
        }
      }
    }
  };

  const renderNodes = (list: TreeNode[], depth: number): JSX.Element[] =>
    list.map((node) => {
      const id = node.folder.id;
      const hasChildren = node.children.length > 0;
      const expanded = hasChildren && !collapsed.has(id);
      const count = node.folder.fileCount;
      return (
        <li key={id} role="none">
          <div
            role="treeitem"
            aria-label={node.folder.name}
            aria-describedby={`tree-count-${id}`}
            aria-level={depth + 1}
            aria-selected={openFolderId === id}
            {...(hasChildren ? { 'aria-expanded': expanded } : {})}
            tabIndex={current === id ? 0 : -1}
            data-tree-node={id}
            className={`tree-node${dropId === id ? ' drop-target' : ''}`}
            onFocus={() => setFocusId(id)}
            onClick={() => {
              setFocusId(id);
              if (onPick === undefined) onOpen(id);
              else onPick(id);
            }}
            onDragOver={(event) => {
              if (onDropFiles === undefined) return;
              event.preventDefault();
              setDropId(id);
            }}
            onDragLeave={() => setDropId((value) => (value === id ? null : value))}
            onDrop={(event) => {
              if (onDropFiles === undefined) return;
              event.preventDefault();
              setDropId(null);
              onDropFiles(id);
            }}
          >
            {hasChildren ? (
              <button
                type="button"
                className="tree-twisty"
                tabIndex={-1}
                aria-hidden="true"
                onClick={(event) => {
                  event.stopPropagation();
                  toggle(id, !expanded);
                }}
              >
                {expanded ? '−' : '+'}
              </button>
            ) : (
              <span className="tree-twisty" aria-hidden="true" />
            )}
            <span className="tree-name" title={node.folder.name}>
              {node.folder.name}
            </span>
            <span
              className={`tree-count num${steppedCounts?.has(id) === true ? ' count-step' : ''}`}
              aria-hidden="true"
            >
              {count}
            </span>
            <span id={`tree-count-${id}`} className="visually-hidden">
              {filesCopy(count)}
            </span>
          </div>
          {hasChildren && expanded ? (
            <ul role="group">{renderNodes(node.children, depth + 1)}</ul>
          ) : null}
        </li>
      );
    });

  return (
    <ul
      role="tree"
      aria-label={label}
      aria-multiselectable="false"
      ref={container}
      onKeyDown={onKeyDown}
    >
      {renderNodes(roots, 0)}
    </ul>
  );
};
