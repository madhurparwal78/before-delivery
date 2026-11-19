import type { JSX } from "preact";
import { useLayoutEffect, useRef, useState } from "preact/hooks";
import type { ProjectFile } from "../../shared/api.ts";
import { Icon } from "../icons.tsx";

interface Folder {
  path: string;
  name: string;
  folders: Folder[];
  files: ProjectFile[];
}

function buildTree(files: ProjectFile[]): Folder {
  const root: Folder = { path: "", name: "", folders: [], files: [] };
  for (const file of files) {
    const parts = file.path.split("/");
    let node = root;
    for (let i = 0; i < parts.length - 1; i += 1) {
      const path = parts.slice(0, i + 1).join("/");
      let next = node.folders.find((folder) => folder.path === path);
      if (!next) {
        next = { path, name: parts[i] as string, folders: [], files: [] };
        node.folders.push(next);
      }
      node = next;
    }
    node.files.push(file);
  }
  const sort = (folder: Folder) => {
    folder.folders.sort((a, b) => (a.path < b.path ? -1 : 1));
    folder.files.sort((a, b) => (a.path < b.path ? -1 : 1));
    folder.folders.forEach(sort);
  };
  sort(root);
  return root;
}

interface Row {
  key: string;
  folder: boolean;
  parent: string | null;
}

function visibleRows(folder: Folder, closed: Set<string>, parent: string | null, out: Row[]): Row[] {
  for (const child of folder.folders) {
    out.push({ key: child.path, folder: true, parent });
    if (!closed.has(child.path)) visibleRows(child, closed, child.path, out);
  }
  for (const file of folder.files) out.push({ key: file.path, folder: false, parent });
  return out;
}

/** The open file's treeitem, or its nearest visible folder while a folder holding it is closed. */
function openRow(rows: Row[], openPath: string | null): string | undefined {
  if (!openPath) return undefined;
  const keys = new Set(rows.map((row) => row.key));
  if (keys.has(openPath)) return openPath;
  const parts = openPath.split("/");
  for (let i = 1; i < parts.length; i += 1) {
    const folder = parts.slice(0, i).join("/");
    if (keys.has(folder) && !keys.has(parts.slice(0, i + 1).join("/"))) return folder;
  }
  return undefined;
}

interface TreeProps {
  files: ProjectFile[];
  openPath: string | null;
  onOpen: (file: ProjectFile) => void;
  /** A path that should take focus once it appears (after an upload). */
  focusPath: string | null;
  onFocused: () => void;
}

export function FileTree(props: TreeProps): JSX.Element {
  const [closed, setClosed] = useState<Set<string>>(() => new Set());
  const [active, setActive] = useState<string | null>(null);
  const root = useRef<HTMLUListElement>(null);
  const tree = buildTree(props.files);
  const rows = visibleRows(tree, closed, null, []);
  // Opening a file makes its treeitem the tree's one Tab stop again.
  const shownOpen = useRef(props.openPath);
  if (shownOpen.current !== props.openPath) {
    shownOpen.current = props.openPath;
    if (active !== null) setActive(null);
  }
  const current = rows.find((row) => row.key === active)?.key ?? openRow(rows, props.openPath) ?? rows[0]?.key;

  const focusRow = (key: string) => {
    setActive(key);
    const element = root.current?.querySelector<HTMLElement>(`[data-path="${CSS.escape(key)}"]`);
    element?.focus();
  };

  useLayoutEffect(() => {
    if (!props.focusPath) return;
    const element = root.current?.querySelector<HTMLElement>(`[data-path="${CSS.escape(props.focusPath)}"]`);
    if (element) {
      setActive(props.focusPath);
      element.focus();
      props.onFocused();
    }
  });

  const onKeyDown = (event: KeyboardEvent) => {
    const index = rows.findIndex((row) => row.key === current);
    const row = rows[index];
    if (!row) return;
    const fileOf = (key: string) => props.files.find((file) => file.path === key);
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        if (rows[index + 1]) focusRow((rows[index + 1] as Row).key);
        break;
      case "ArrowUp":
        event.preventDefault();
        if (rows[index - 1]) focusRow((rows[index - 1] as Row).key);
        break;
      case "Home":
        event.preventDefault();
        focusRow((rows[0] as Row).key);
        break;
      case "End":
        event.preventDefault();
        focusRow((rows[rows.length - 1] as Row).key);
        break;
      case "ArrowRight":
        event.preventDefault();
        if (row.folder) {
          if (closed.has(row.key)) {
            const next = new Set(closed);
            next.delete(row.key);
            setClosed(next);
          } else if (rows[index + 1]?.parent === row.key) focusRow((rows[index + 1] as Row).key);
        }
        break;
      case "ArrowLeft":
        event.preventDefault();
        if (row.folder && !closed.has(row.key)) setClosed(new Set(closed).add(row.key));
        else if (row.parent) focusRow(row.parent);
        break;
      case "Enter":
      case " ": {
        event.preventDefault();
        if (row.folder) {
          const next = new Set(closed);
          if (next.has(row.key)) next.delete(row.key);
          else next.add(row.key);
          setClosed(next);
        } else {
          const file = fileOf(row.key);
          if (file) props.onOpen(file);
        }
        break;
      }
      default:
    }
  };

  const renderFolder = (folder: Folder): JSX.Element[] => [
    ...folder.folders.map((child) => {
      const open = !closed.has(child.path);
      return (
        <li key={child.path} role="treeitem" aria-label={child.path} aria-expanded={open ? "true" : "false"}
          data-path={child.path} tabIndex={current === child.path ? 0 : -1}
          onFocus={(e) => { if (e.target === e.currentTarget) setActive(child.path); }}>
          <span class="tree-row tree-folder"
            onClick={() => {
              setActive(child.path);
              const next = new Set(closed);
              if (open) next.add(child.path);
              else next.delete(child.path);
              setClosed(next);
            }}>
            <Icon name={open ? "folderOpen" : "folder"} />
            {child.name}
          </span>
          {open ? <ul role="group">{renderFolder(child)}</ul> : null}
        </li>
      );
    }),
    ...folder.files.map((file) => (
      <li key={file.path} role="treeitem" aria-label={file.path} aria-selected={file.path === props.openPath ? "true" : "false"}
        data-path={file.path} tabIndex={current === file.path ? 0 : -1} class={file.path === props.openPath ? "is-open" : ""}
        onFocus={() => setActive(file.path)}
        onClick={() => {
          setActive(file.path);
          props.onOpen(file);
        }}>
        <span class="tree-row">
          <Icon name="file" />
          {file.path.split("/").pop()}
        </span>
      </li>
    )),
  ];

  return (
    <ul ref={root} role="tree" aria-label="Project files" class="tree" onKeyDown={onKeyDown}>
      {renderFolder(tree)}
    </ul>
  );
}
