import { useCallback, useEffect, useState } from "react";
import { formatDkk } from "../../../shared/money.js";
import { Button } from "../ui.js";
import { call, failureText, say } from "./desk.js";
import { formatPercent, humanise } from "./format.js";
import { StaffList, type Column } from "./List.js";
import { RefundPanel } from "./RefundPanel.js";
import type { LedgerOrder } from "./types.js";

export const RefundsPage = () => {
  const [orders, setOrders] = useState<LedgerOrder[]>([]);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      setOrders((await call<{ orders: LedgerOrder[] }>("GET", "/api/staff/ledger/orders")).body.orders);
    } catch (error) {
      say(failureText(error), true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const columns: Column<LedgerOrder>[] = [
    { header: "Box", cell: (order) => <strong>{order.number}</strong> },
    { header: "Reference", cell: (order) => order.reference },
    { header: "Payment", cell: (order) => humanise(order.paymentState) },
    { header: "Box state", cell: (order) => humanise(order.boxState) },
    { header: "Gross", cell: (order) => formatDkk(order.grossOre) },
    { header: "Rate", cell: (order) => formatPercent(order.rateBasisPoints) },
    {
      header: "Actions",
      actions: true,
      cell: (order) => (
        <Button aria-expanded={open === order.reference} onClick={() => setOpen(open === order.reference ? null : order.reference)}>
          {open === order.reference ? "Close ledger" : "Open ledger"}
        </Button>
      ),
    },
  ];

  return (
    <StaffList
      label="Orders"
      rows={orders}
      rowKey={(order) => order.reference}
      columns={columns}
      empty="No orders yet."
      detail={(order) => (open === order.reference ? <RefundPanel reference={order.reference} onRefunded={load} /> : null)}
    />
  );
};
