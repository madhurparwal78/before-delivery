import { Component } from "preact";
import type { MutableRef } from "preact/hooks";
import { useLayoutEffect, useRef } from "preact/hooks";
import { Ledger, type LedgerRow } from "./shuffle";

// The full-width ranked table with the cobalt cut (brief: Ranked-table composition). Its body belongs to the
// Ledger, which renders and shuffles rows outside Preact so the motion is exact.

interface Props {
  label: string;
  cutLabel: string;
  cutCount: number;
  rows: LedgerRow[];
  ledger: MutableRef<Ledger | null>;
  announce: (line: string) => void;
  /** When set, the table opens on these rows and shuffles to `rows` (a reveal). */
  revealFrom?: LedgerRow[] | null;
}

function Table({ label, cutLabel, cutCount, rows, ledger, announce, revealFrom }: Props) {
  const body = useRef<HTMLTableSectionElement>(null);
  useLayoutEffect(() => {
    if (!body.current) return;
    const created = new Ledger(body.current, cutLabel, cutCount, announce);
    ledger.current = created;
    if (revealFrom) void created.replay(revealFrom, rows);
    else created.show(rows);
  }, []);
  return (
    <table class="ranked">
      <caption class="sr-only">{label}</caption>
      <thead>
        <tr>
          <th scope="col" class="rank ranked__rank">Rank</th>
          <th scope="col" class="ranked__entry">Entry</th>
          <th scope="col" class="category ranked__category">Category</th>
          <th scope="col" class="num ranked__score">Score</th>
          <th scope="col" class="ranked__status">Status</th>
        </tr>
      </thead>
      <tbody ref={body} />
    </table>
  );
}

/** Rendered once; later changes go through the ledger so Preact never touches the rows. */
export class StandingsTable extends Component<Props> {
  override shouldComponentUpdate(): boolean {
    return false;
  }

  override render(props: Props) {
    return <Table {...props} />;
  }
}
