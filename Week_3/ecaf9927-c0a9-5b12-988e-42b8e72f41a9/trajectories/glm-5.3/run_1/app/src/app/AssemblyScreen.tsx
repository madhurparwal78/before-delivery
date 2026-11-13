import { useCallback, useEffect, useState } from "react";
import type { Assembly, Bom, Member, Part, PurchasedPart, TreeRow } from "../shared/types.js";
import { api } from "./api.js";
import { BomView, BodyView } from "./views.js";
import { display } from "../shared/units.js";
import type { DialogState, Mode } from "./Workspace.js";
import type { KeyStore } from "./api.js";

/** Assembly mode: the Model tab with the assembly tree, and the BOM tab. */

export function AssemblyScreen(props: {
  member: Member;
  founder: boolean;
  mode: Extract<Mode, { kind: "assembly" }>;
  setMode: (mode: Mode) => void;
  setDialog: (dialog: DialogState) => void;
  propertiesSheet: boolean;
  closeSheet: () => void;
  assemblies: Assembly[];
  parts: Part[];
  purchased: PurchasedPart[];
  sayModel: (text: string) => void;
  handleError: (err: unknown) => void;
  refreshLists: () => Promise<void>;
  keys: KeyStore;
  storageOutage: boolean;
  afterPartChange: () => void;
}): JSX.Element {
  const [assembly, setAssembly] = useState<Assembly | null>(null);
  const [tree, setTree] = useState<TreeRow[] | null>(null);
  const [bom, setBom] = useState<Bom | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    const [a, t, b] = await Promise.all([
      api.assembly(props.mode.assemblyId),
      api.tree(props.mode.assemblyId),
      api.bom(props.mode.assemblyId)
    ]);
    setAssembly(a.assembly);
    setTree(t.rows);
    setBom(b);
  }, [props.mode.assemblyId]);

  useEffect(() => {
    void load();
    setExpanded(new Set());
  }, [load]);

  const afterChange = useCallback(async () => {
    await load();
    await props.refreshLists();
    props.afterPartChange();
  }, [load, props.refreshLists, props.afterPartChange]);

  if (!assembly || !tree || !bom) return <div />;

  const changeQuantity = async (instanceId: string, quantity: number): Promise<void> => {
    try {
      await api.patchInstance(assembly.id, instanceId, {
        base_revision: assembly.revision,
        quantity
      });
      await afterChange();
    } catch (err) {
      props.handleError(err);
    }
  };

  const removeInstance = async (instanceId: string): Promise<void> => {
    try {
      await api.deleteInstance(assembly.id, instanceId, assembly.revision);
      await afterChange();
    } catch (err) {
      props.handleError(err);
    }
  };

  const collectPartIds = (rows: TreeRow[]): { partId: string; label: string }[] => {
    const out: { partId: string; label: string }[] = [];
    for (const row of rows) {
      if (row.component.type === "part" && row.body_status === "stored") {
        out.push({ partId: row.component.id, label: `${row.component.name} ×${row.quantity}` });
      }
    }
    return out;
  };

  return (
    <>
      <div className="panel view-tabs" role="tablist" aria-label="Assembly view">
        {(["model", "bom"] as const).map((tab) => (
          <button
            key={tab}
            role="tab"
            aria-selected={props.mode.tab === tab}
            onClick={() => props.setMode({ ...props.mode, tab })}
          >
            {tab === "model" ? "Model" : "Bill of materials"}
          </button>
        ))}
      </div>

      {props.mode.tab === "bom" ? (
        <BomView bom={bom} member={props.member} />
      ) : (
        <BodyView
          name={assembly.name}
          kind="assembly"
          partIds={collectPartIds(tree)}
          noBodyText={
            props.storageOutage
              ? "Body view unavailable while storage is unreachable."
              : "No stored body yet"
          }
        />
      )}

      <div className="panel properties-panel" role={props.propertiesSheet ? "dialog" : "complementary"} aria-label="Properties">
        <div className="sheet-title">
          <h3>{assembly.name}</h3>
          {props.propertiesSheet ? <button onClick={props.closeSheet}>Close</button> : null}
        </div>
        <table className="data-table" aria-label="Assembly tree">
          <thead>
            <tr>
              <th>Item</th>
              <th>Qty</th>
              <th>Unit mass</th>
              <th>Subtotal</th>
              <th>Pieces</th>
            </tr>
          </thead>
          <tbody>
            {tree.map((row) => (
              <AssemblyTreeRow
                key={row.instance_id}
                row={row}
                founder={props.founder}
                expanded={expanded.has(row.instance_id)}
                onToggle={() => {
                  const next = new Set(expanded);
                  if (next.has(row.instance_id)) next.delete(row.instance_id);
                  else next.add(row.instance_id);
                  setExpanded(next);
                }}
                onQuantity={changeQuantity}
                onRemove={removeInstance}
              />
            ))}
          </tbody>
        </table>
        <div role="region" aria-label="Assembly totals" style={{ marginTop: 12 }}>
          <div>Total mass {display.mass(assembly.rollup.mass_g)}</div>
          <div>Pieces {assembly.rollup.part_count}</div>
          <div>Lines {assembly.rollup.line_count}</div>
        </div>
        {props.founder ? (
          <div style={{ marginTop: 12 }}>
            <button onClick={() => props.setDialog({ kind: "add-to-assembly", assembly })}>
              Add to assembly
            </button>
          </div>
        ) : null}
      </div>
    </>
  );
}

function AssemblyTreeRow(props: {
  row: TreeRow;
  founder: boolean;
  expanded: boolean;
  onToggle: () => void;
  onQuantity: (instanceId: string, quantity: number) => Promise<void>;
  onRemove: (instanceId: string) => Promise<void>;
  depth?: number;
}): JSX.Element {
  const { row } = props;
  const depth = props.depth ?? 0;
  const [quantity, setQuantity] = useState(row.quantity);
  const isAssembly = row.component.type === "assembly";
  return (
    <>
      <tr data-depth={depth}>
        <td>
          {isAssembly ? (
            <button
              aria-label={`${props.expanded ? "Collapse" : "Expand"} ${row.component.name}`}
              aria-expanded={props.expanded}
              onClick={props.onToggle}
              style={{ minHeight: 32, padding: "0 8px", marginRight: 6 }}
            >
              {props.expanded ? "−" : "+"}
            </button>
          ) : null}
          {row.component.name}
        </td>
        <td>
          {props.founder ? (
            <input
              type="number"
              min={1}
              max={999}
              value={quantity}
              aria-label={`Quantity of ${row.component.name}`}
              role="spinbutton"
              style={{ width: 70, minHeight: 30 }}
              onChange={(e) => setQuantity(Number(e.target.value))}
              onBlur={() => {
                if (quantity !== row.quantity) void props.onQuantity(row.instance_id, quantity);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && quantity !== row.quantity) {
                  void props.onQuantity(row.instance_id, quantity);
                }
              }}
            />
          ) : (
            <span className="num">{row.quantity}</span>
          )}
        </td>
        <td className="num">{row.unit_mass_g === null ? "—" : display.mass(row.unit_mass_g)}</td>
        <td className="num">{row.subtotal_mass_g === null ? "—" : display.mass(row.subtotal_mass_g)}</td>
        <td className="num">{row.pieces}</td>
        <td>
          {props.founder ? (
            <button
              aria-label={`Remove ${row.component.name}`}
              onClick={() => void props.onRemove(row.instance_id)}
              style={{ minHeight: 32, padding: "0 10px" }}
            >
              Remove
            </button>
          ) : null}
        </td>
      </tr>
      {isAssembly && props.expanded
        ? (row.children ?? []).map((child) => (
            <AssemblyTreeRow
              key={child.instance_id}
              row={child}
              founder={props.founder}
              expanded={false}
              onToggle={() => undefined}
              onQuantity={props.onQuantity}
              onRemove={props.onRemove}
              depth={depth + 1}
            />
          ))
        : null}
    </>
  );
}
