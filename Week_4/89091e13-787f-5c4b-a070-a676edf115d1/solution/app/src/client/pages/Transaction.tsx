import type { TransactionInfo } from "../../shared/api.ts";
import { formatDateTime, formatFernUnit } from "../../shared/units.ts";
import { CopyId } from "../components/CopyId.tsx";
import { Page } from "../components/Page.tsx";
import { Loading } from "../components/StrandCanvas.tsx";
import { display } from "../lib/config.ts";
import { capitalise, truncateId } from "../lib/format.ts";
import { useJson } from "../lib/resource.ts";
import { useWorkspace } from "../lib/workspace.tsx";
import { NotFoundContent } from "./NotFound.tsx";

export function TransactionPage({ txId }: { txId: string }) {
  const { id } = useWorkspace();
  const tx = useJson<TransactionInfo>(`/api/w/${id}/transactions/${txId}`);
  if (tx.error) return <NotFoundContent />;
  const data = tx.data;
  return (
    <Page title="Transaction">
      {data ? (
        <dl className="panel facts">
          <div><dt>Transaction</dt><dd className="id-cell"><span className="mono">{truncateId(data.id)}</span><CopyId value={data.id} /></dd></div>
          <div><dt>Kind</dt><dd>{capitalise(data.kind)}</dd></div>
          <div><dt>Sender</dt><dd>{data.senderName}</dd></div>
          <div><dt>Status</dt><dd>{data.statusText}</dd></div>
          <div><dt>Fee</dt><dd>{formatFernUnit(data.feeUfern)}</dd></div>
          <div><dt>Gas</dt><dd>{data.gas}</dd></div>
          <div><dt>Height</dt><dd>{data.height ?? "Not yet included"}</dd></div>
          <div><dt>Time</dt><dd>{formatDateTime(data.submittedAt, display.timeZone)}</dd></div>
        </dl>
      ) : <Loading label="Transaction loading" />}
    </Page>
  );
}
