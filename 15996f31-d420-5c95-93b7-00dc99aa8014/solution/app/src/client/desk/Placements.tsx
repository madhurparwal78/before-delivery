import { MapPin } from "lucide-react";
import { DROP_STATUS_LABELS, type AnyOrder, type BrokerPlacement, type Drop, type GrowerPlacement, type User } from "../../shared/api.js";
import { frames, humanDate, money } from "../../shared/format.js";
import { navigate } from "../hooks.js";
import { toTenths } from "../strength.js";
import { DataTable, Empty, type Column } from "./tables.js";

function strength(average: number | null): string {
  const scaled = toTenths(average);
  return scaled === null ? "Not sampled" : `${frames(scaled)} frames`;
}

function DropLink({ id, yard }: { id: string; yard: string }) {
  return (
    <a
      href={`/desk/drops/${encodeURIComponent(id)}`}
      onClick={(event) => {
        event.preventDefault();
        navigate(`/desk/drops/${encodeURIComponent(id)}`);
      }}
    >
      {yard}
    </a>
  );
}

const growerColumns: Column<GrowerPlacement>[] = [
  { label: "Yard", cell: (row) => row.yard_name },
  { label: "Hives", cell: (row) => row.hives, numeric: true },
  { label: "Delivered", cell: (row) => humanDate(row.delivered_on), numeric: true },
  { label: "Strength", cell: (row) => strength(row.average_frames), numeric: true },
];

const brokerColumns: Column<BrokerPlacement>[] = [
  { label: "Yard", cell: (row) => <DropLink id={row.drop_id} yard={row.yard_name} /> },
  { label: "Beekeeper", cell: (row) => row.beekeeper.name },
  { label: "Hives", cell: (row) => row.hives, numeric: true },
  { label: "Delivered", cell: (row) => humanDate(row.delivered_on), numeric: true },
  { label: "Strength", cell: (row) => strength(row.average_frames), numeric: true },
  { label: "Status", cell: (row) => DROP_STATUS_LABELS[row.status] },
  { label: "Pay per hive", cell: (row) => (row.pay_per_hive_cents === null ? "—" : money(row.pay_per_hive_cents)), numeric: true },
  { label: "Payout", cell: (row) => (row.payout_cents === null ? "—" : money(row.payout_cents)), numeric: true },
];

const beekeeperColumns: Column<Drop>[] = [
  { label: "Yard", cell: (row) => <DropLink id={row.id} yard={row.yard_name} /> },
  { label: "Hives", cell: (row) => row.hives, numeric: true },
  { label: "Delivered", cell: (row) => (row.delivered_on ? humanDate(row.delivered_on) : "—"), numeric: true },
  { label: "Strength", cell: (row) => strength(row.average_frames), numeric: true },
  { label: "Status", cell: (row) => DROP_STATUS_LABELS[row.status] },
  { label: "Expected pay", cell: (row) => (row.payout_cents === null ? "—" : money(row.payout_cents)), numeric: true },
];

export function Placements({ user, order, blockId, blockName }: { user: User; order: AnyOrder; blockId: string; blockName: string }) {
  const label = `Placements, ${blockName}`;
  const empty = (
    <Empty icon={<MapPin aria-hidden="true" size={20} strokeWidth={1.5} />}>No drops in this block yet.</Empty>
  );
  let table = empty;
  if ("my_drops" in order) {
    const rows = order.my_drops.filter((drop) => drop.block?.id === blockId);
    if (rows.length > 0) table = <DataTable label={label} columns={beekeeperColumns} rows={rows} rowKey={(row) => row.id} />;
  } else {
    const block = order.blocks.find((entry) => entry.id === blockId);
    const rows = block?.placements ?? [];
    if (rows.length > 0) {
      table =
        user.role === "broker" ? (
          <DataTable label={label} columns={brokerColumns} rows={rows as BrokerPlacement[]} rowKey={(row) => row.drop_id} />
        ) : (
          <DataTable label={label} columns={growerColumns} rows={rows} rowKey={(row, index) => `${index}-${row.yard_name}`} />
        );
    }
  }
  return (
    <section className="placements" aria-labelledby="placements-title">
      <h2 id="placements-title">Placements in {blockName}</h2>
      {table}
    </section>
  );
}
