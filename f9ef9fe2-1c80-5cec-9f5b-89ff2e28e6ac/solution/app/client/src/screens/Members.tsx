import { useCallback, useEffect, useState } from "react";
import { call, idempotencyKey } from "../api";
import { hoursText } from "../format";
import { usePaused, useSession } from "../session";
import type { MemberSummary } from "../types";
import { type FormState, FormStatus, Page, Table } from "./common";

export function MembersScreen() {
  const { kitchen } = useSession();
  const [members, setMembers] = useState<MemberSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<FormState | null>(null);
  const [buying, setBuying] = useState<string | null>(null);
  const paused = usePaused("buy_pack");

  const load = useCallback(async () => {
    const result = await call<{ members: MemberSummary[] }>("GET", `/api/kitchens/${kitchen.id}/members`);
    setLoading(false);
    if (result.ok) setMembers(result.data.members);
  }, [kitchen.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const buy = (member: MemberSummary): void => {
    setBuying(member.id);
    setForm({ text: "Adding pack…", tone: "info" });
    void (async () => {
      const result = await call<{ balance_quarters: number }>("POST", `/api/members/${member.id}/packs`, {}, { "Idempotency-Key": idempotencyKey() });
      setBuying(null);
      if (result.ok) {
        setForm({ text: `20-hour pack added. Balance ${hoursText(result.data.balance_quarters)} hours.`, tone: "success" });
        void load();
      } else {
        setForm({
          text: result.error.error === "billing_unavailable" ? "Billing is unreachable. Pack purchases are paused; try again shortly." : result.error.message,
          tone: "error",
        });
      }
    })();
  };

  return (
    <Page title="Members">
      <FormStatus state={form} />
      <Table
        label="Members"
        loading={loading}
        rows={members}
        rowKey={(m) => m.id}
        empty="No members yet."
        columns={[
          { label: "Business", cell: (m: MemberSummary) => <span className="business">{m.business}</span> },
          { label: "Contact", cell: (m) => m.contact_email },
          {
            label: "Papers covered until",
            cell: (m) => (m.covered_until ? <span className="num">{m.covered_until}</span> : <span className="muted">Not covered</span>),
          },
          { label: "Hours this month", numeric: true, cell: (m) => m.month_hours },
          { label: "Pack balance", numeric: true, cell: (m) => `${hoursText(m.pack_balance_quarters)} h` },
          {
            label: "Actions",
            cell: (m) => (
              <button type="button" className="ghost" disabled={buying !== null || paused} onClick={() => buy(m)}>
                Buy 20-hour pack
              </button>
            ),
          },
        ]}
      />
    </Page>
  );
}
