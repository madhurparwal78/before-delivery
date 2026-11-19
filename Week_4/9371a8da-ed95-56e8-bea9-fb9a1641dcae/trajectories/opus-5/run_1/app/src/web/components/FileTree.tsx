import { ChevronDown, ChevronRight, FileText, Image } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ProjectFile } from '../types.js';

interface Props {
  files: ProjectFile[];
  openPath: string | null;
  onOpen: (path: string) => void;
}

interface FolderNode {
  kind: 'folder';
  path: string;
  name: string;
  children: TreeNode[];
}

interface FileNode {
  kind: 'file';
  path: string;
  name: string;
}

type TreeNode = FolderNode | FileNode;

function buildTree(files: ProjectFile[]): TreeNode[] {
  const roots: TreeNode[] = [];
  const folders = new Map<string, FolderNode>();

  const folderFor = (path: string): FolderNode => {
    const existing = folders.get(path);
    if (existing !== undefined) return existing;
    const slash = path.lastIndexOf('/');
    const node: FolderNode = {
      kind: 'folder',
      path,
      name: slash < 0 ? path : path.slice(slash + 1),
      children: [],
    };
    folders.set(path, node);
    if (slash < 0) roots.push(node);
    else folderFor(path.slice(0, slash)).children.push(node);
    return node;
  };

  for (const file of [...files].sort((left, right) => (left.path < right.path ? -1 : 1))) {
    const slash = file.path.lastIndexOf('/');
    const node: FileNode = {
      kind: 'file',
      path: file.path,
      name: slash < 0 ? file.path : file.path.slice(slash + 1),
    };
    if (slash < 0) roots.push(node);
    else folderFor(file.path.slice(0, slash)).children.push(node);
  }

  const order = (nodes: TreeNode[]): TreeNode[] =>
    nodes
      .map((node) => (node.kind === 'folder' ? { ...node, children: order(node.children) } : node))
      .sort((left, right) => {
        if (left.kind !== right.kind) return left.kind === 'folder' ? -1 : 1;
        return left.path < right.path ? -1 : 1;
      });

  return order(roots);
}

export function FileTree(props: Props): JSX.Element {
  const [closed, setClosed] = useState<string[]>([]);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const tree = useMemo(() => buildTree(props.files), [props.files]);

  const visible: TreeNode[] = [];
  const walk = (nodes: TreeNode[]): void => {
    for (const node of nodes) {
      visible.push(node);
      if (node.kind === 'folder' && !closed.includes(node.path)) walk(node.children);
    }
  };
  walk(tree);

  const openFolderOf = (path: string | null): string | null => {
    if (path === null) return null;
    const slash = path.lastIndexOf('/');
    return slash < 0 ? null : path.slice(0, slash);
  };

  const folderClosed = (path: string | null): boolean => {
    let folder = openFolderOf(path);
    while (folder !== null) {
      if (closed.includes(folder)) return true;
      folder = openFolderOf(folder);
    }
    return false;
  };

  const tabStopPath =
    props.openPath !== null && !folderClosed(props.openPath)
      ? props.openPath
      : (openFolderOf(props.openPath) ?? visible[0]?.path ?? null);

  const [focusPath, setFocusPath] = useState<string | null>(tabStopPath);
  useEffect(() => {
    setFocusPath(tabStopPath);
  }, [tabStopPath]);

  const focusItem = (path: string): void => {
    setFocusPath(path);
    const host = hostRef.current;
    if (host === null) return;
    const element = host.querySelector<HTMLElement>(`[data-path="${CSS.escape(path)}"]`);
    element?.focus();
  };

  const onKeyDown = (event: React.KeyboardEvent): void => {
    const index = visible.findIndex((node) => node.path === focusPath);
    const node = index < 0 ? null : visible[index];
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      const next = visible[Math.min(index + 1, visible.length - 1)];
      if (next !== undefined) focusItem(next.path);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      const previous = visible[Math.max(index - 1, 0)];
      if (previous !== undefined) focusItem(previous.path);
      return;
    }
    if (event.key === 'Home') {
      event.preventDefault();
      if (visible.length > 0) focusItem(visible[0].path);
      return;
    }
    if (event.key === 'End') {
      event.preventDefault();
      if (visible.length > 0) focusItem(visible[visible.length - 1].path);
      return;
    }
    if (event.key === 'ArrowRight' && node !== null && node.kind === 'folder') {
      event.preventDefault();
      setClosed(closed.filter((path) => path !== node.path));
      return;
    }
    if (event.key === 'ArrowLeft' && node !== null && node.kind === 'folder') {
      event.preventDefault();
      if (!closed.includes(node.path)) setClosed([...closed, node.path]);
      return;
    }
    if (event.key === 'Enter' && node !== null) {
      event.preventDefault();
      if (node.kind === 'file') props.onOpen(node.path);
      else if (closed.includes(node.path)) setClosed(closed.filter((path) => path !== node.path));
      else setClosed([...closed, node.path]);
    }
  };

  const renderNodes = (nodes: TreeNode[]): JSX.Element[] =>
    nodes.map((node) => {
      const isTabStop = node.path === tabStopPath;
      if (node.kind === 'folder') {
        const isOpen = !closed.includes(node.path);
        return (
          <div key={node.path} className="tree-branch">
            <div
              role="treeitem"
              aria-label={node.path}
              aria-expanded={isOpen}
              data-path={node.path}
              tabIndex={isTabStop ? 0 : -1}
              className="treeitem treeitem-folder"
              onClick={() => {
                setFocusPath(node.path);
                setClosed(isOpen ? [...closed, node.path] : closed.filter((p) => p !== node.path));
              }}
            >
              {isOpen ? (
                <ChevronDown size={14} aria-hidden="true" />
              ) : (
                <ChevronRight size={14} aria-hidden="true" />
              )}
              {node.name}
            </div>
            {isOpen ? (
              <div role="group" className="tree-group">
                {renderNodes(node.children)}
              </div>
            ) : null}
          </div>
        );
      }
      return (
        <div
          key={node.path}
          role="treeitem"
          aria-label={node.path}
          aria-selected={node.path === props.openPath}
          data-path={node.path}
          tabIndex={isTabStop ? 0 : -1}
          className={`treeitem${node.path === props.openPath ? ' treeitem-open' : ''}`}
          onClick={() => {
            setFocusPath(node.path);
            props.onOpen(node.path);
          }}
        >
          {node.path.endsWith('.png') ||
          node.path.endsWith('.jpg') ||
          node.path.endsWith('.jpeg') ||
          node.path.endsWith('.svg') ||
          node.path.endsWith('.pdf') ? (
            <Image size={14} aria-hidden="true" />
          ) : (
            <FileText size={14} aria-hidden="true" />
          )}
          {node.name}
        </div>
      );
    });

  return (
    <div
      ref={hostRef}
      role="tree"
      aria-label="Project files"
      className="file-tree"
      onKeyDown={onKeyDown}
    >
      {renderNodes(tree)}
    </div>
  );
}
