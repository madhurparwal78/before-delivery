import { useEffect, useMemo, useRef, useState } from "react";
import type { Assembly, Member, Part, PurchasedPart, WorkspaceInfo } from "../shared/types.js";
import { bodyStatusChip } from "./copy.js";
import type { DialogState } from "./Workspace.js";

/** The feature tree: assemblies, parts (with sketches and extrudes), purchased. */

interface OpenItem {
  kind: "assembly" | "part" | "sketch" | "feature";
  id: string;
  partId?: string;
}

export function FeatureTree(props: {
  asSheet: boolean;
  member: Member;
  founder: boolean;
  parts: Part[];
  assemblies: Assembly[];
  purchased: PurchasedPart[];
  workspace: WorkspaceInfo | null;
  openItem: (item: OpenItem) => void;
  setDialog: (dialog: DialogState) => void;
  sheet: "feature-tree" | "properties" | null;
  onCloseSheet: () => void;
}): JSX.Element | null {
  const rows = useMemo(() => {
    const list: {
      key: string;
      label: string;
      kind: OpenItem["kind"];
      id: string;
      partId?: string;
      chip?: string;
      chipConflict?: boolean;
      expandable?: boolean;
      children?: {
        key: string;
        label: string;
        kind: OpenItem["kind"];
        id: string;
        partId?: string;
      }[];
    }[] = [];
    for (const a of props.assemblies) {
      list.push({ key: `a-${a.id}`, label: a.name, kind: "assembly", id: a.id, expandable: false });
    }
    for (const p of props.parts) {
      const chip = bodyStatusChip(p);
      list.push({
        key: `p-${p.id}`,
        label: p.name,
        kind: "part",
        id: p.id,
        chip: chip.text,
        chipConflict: chip.conflict,
        expandable: p.sketches.length + p.features.length > 0,
        children: [
          ...p.sketches.map((s) => ({
            key: `s-${s.id}`,
            label: `${s.name}${s.fully_held ? "" : ` (Slack ${s.slack})`}`,
            kind: "sketch" as const,
            id: s.id,
            partId: p.id
          })),
          ...p.features.map((f) => ({
            key: `f-${f.id}`,
            label: f.name,
            kind: "feature" as const,
            id: f.id,
            partId: p.id
          }))
        ]
      });
    }
    for (const p of props.purchased) {
      list.push({ key: `pp-${p.id}`, label: p.name, kind: "part", id: p.id, expandable: false });
    }
    return list;
  }, [props.assemblies, props.parts, props.purchased]);

  const [focusIndex, setFocusIndex] = useState(0);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const treeRef = useRef<HTMLDivElement | null>(null);

  const visible = useMemo(() => {
    const out: typeof rows & {} = [];
    for (const row of rows) {
      out.push(row);
    }
    return out as typeof rows;
  }, [rows]);

  useEffect(() => {
    if (props.asSheet) {
      treeRef.current?.focus();
    }
  }, [props.asSheet]);

  const onKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setFocusIndex((i) => Math.min(visible.length - 1, i + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setFocusIndex((i) => Math.max(0, i - 1));
    } else if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault();
      const row = visible[focusIndex];
      if (row?.expandable) {
        setExpanded((prev) => {
          const next = new Set(prev);
          if (event.key === "ArrowRight") next.add(row.key);
          else next.delete(row.key);
          return next;
        });
      }
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      const row = visible[focusIndex];
      if (row) {
        props.openItem({ kind: row.kind, id: row.id, partId: row.partId });
      }
    }
  };

  const body = (
    <div
      ref={treeRef}
      role="tree"
      aria-label="Feature tree"
      tabIndex={0}
      onKeyDown={onKeyDown}
      className="tree-list"
    >
      <div className="tree-group-heading">Assemblies</div>
      {rows
        .filter((r) => r.kind === "assembly")
        .map((row, index) => (
          <TreeRow
            key={row.key}
            row={row}
            focused={focusIndex === index}
            onFocusRow={() => setFocusIndex(index)}
            onOpen={() => props.openItem({ kind: row.kind, id: row.id })}
            expanded={false}
            onToggleExpand={() => undefined}
          />
        ))}
      <div className="tree-group-heading">Parts</div>
      {rows
        .filter((r) => r.kind === "part" && !r.key.startsWith("pp-"))
        .map((row) => {
          const index = rows.findIndex((r) => r.key === row.key);
          return (
            <TreeRow
              key={row.key}
              row={row}
              focused={focusIndex === index}
              onFocusRow={() => setFocusIndex(index)}
              onOpen={() => props.openItem({ kind: row.kind, id: row.id })}
              expanded={expanded.has(row.key)}
              onToggleExpand={() =>
                setExpanded((prev) => {
                  const next = new Set(prev);
                  if (next.has(row.key)) next.delete(row.key);
                  else next.add(row.key);
                  return next;
                })
              }
              childRows={row.children?.map((child) => (
                <TreeRow
                  key={child.key}
                  row={{ ...child, expandable: false }}
                  focused={false}
                  onFocusRow={() => undefined}
                  onOpen={() =>
                    props.openItem({ kind: child.kind, id: child.id, partId: child.partId })
                  }
                  expanded={false}
                  onToggleExpand={() => undefined}
                />
              ))}
            />
          );
        })}
      <div className="tree-group-heading">Purchased parts</div>
      {rows
        .filter((r) => r.key.startsWith("pp-"))
        .map((row) => {
          const index = rows.findIndex((r) => r.key === row.key);
          return (
            <TreeRow
              key={row.key}
              row={row}
              focused={focusIndex === index}
              onFocusRow={() => setFocusIndex(index)}
              onOpen={() => props.openItem({ kind: "part", id: row.id })}
              expanded={false}
              onToggleExpand={() => undefined}
            />
          );
        })}
      {props.founder ? (
        <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
          <button onClick={() => props.setDialog({ kind: "new-part" })}>New part</button>
          <button onClick={() => props.setDialog({ kind: "new-assembly" })}>New assembly</button>
          <button onClick={() => props.setDialog({ kind: "new-purchased" })}>New purchased part</button>
        </div>
      ) : null}
    </div>
  );

  return (
    <nav
      aria-label="Workspace"
      role={props.asSheet ? "dialog" : "navigation"}
      className="panel feature-tree"
    >
      <div className="sheet-title">
        <h3>Feature tree</h3>
        <button className="sheet-close-button" onClick={props.onCloseSheet}>
          Close
        </button>
      </div>
      {body}
    </nav>
  );
}

function TreeRow(props: {
  row: {
    key: string;
    label: string;
    chip?: string;
    chipConflict?: boolean;
    expandable?: boolean;
  };
  focused: boolean;
  onFocusRow: () => void;
  onOpen: () => void;
  expanded: boolean;
  onToggleExpand: () => void;
  childRows?: React.ReactNode;
}): JSX.Element {
  const ref = useRef<HTMLLIElement | null>(null);
  useEffect(() => {
    if (props.focused) ref.current?.querySelector("button")?.focus();
  }, [props.focused]);
  return (
    <li ref={ref}>
      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        {props.row.expandable ? (
          <button
            aria-label={`${props.expanded ? "Collapse" : "Expand"} ${props.row.label}`}
            aria-expanded={props.expanded}
            onClick={props.onToggleExpand}
            style={{ minHeight: 32, padding: "0 8px", fontSize: 11, minWidth: 32 }}
          >
            {props.expanded ? "−" : "+"}
          </button>
        ) : (
          <span style={{ display: "inline-block", width: 32 }} />
        )}
        <button
          role="treeitem"
          className="tree-item"
          aria-selected={props.focused}
          onClick={() => {
            props.onFocusRow();
            props.onOpen();
          }}
          onFocus={props.onFocusRow}
        >
          {props.row.label}
          {props.row.chip ? (
            <span className="chip" data-tone={props.row.chipConflict ? "conflict" : undefined}>
              {props.row.chip}
            </span>
          ) : null}
        </button>
      </div>
      {props.expanded && props.childRows ? <ul className="tree-list">{props.childRows}</ul> : null}
    </li>
  );
}
