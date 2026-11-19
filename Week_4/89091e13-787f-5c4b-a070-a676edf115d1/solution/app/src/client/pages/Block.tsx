import { useState } from "react";
import type { BlockShares, FraudProof, NamespaceInfo } from "../../shared/api.ts";
import { rejectionText } from "../../shared/copy.ts";
import { TAIL_PADDING_NAMESPACE } from "../../shared/namespace.ts";
import { formatDateTime } from "../../shared/units.ts";
import { CopyId } from "../components/CopyId.tsx";
import { FraudProofPanel } from "../components/FraudProofPanel.tsx";
import { Page } from "../components/Page.tsx";
import { ProveNamespace } from "../components/ProveNamespace.tsx";
import { RootsList } from "../components/Roots.tsx";
import { SquareGrid } from "../components/SquareGrid.tsx";
import { SquareWalk } from "../components/SquareWalk.tsx";
import { Empty, Loading } from "../components/StrandCanvas.tsx";
import { ApiError, downloadSnapshot, getJson } from "../lib/api.ts";
import { useBlockSquare } from "../lib/blocks.ts";
import { display } from "../lib/config.ts";
import { capitalise, sizeText, truncateId } from "../lib/format.ts";
import { useJson, useResource } from "../lib/resource.ts";
import { Link } from "../lib/router.tsx";
import { useMe } from "../lib/session.tsx";
import { useWorkspace } from "../lib/workspace.tsx";
import { NotFoundContent } from "./NotFound.tsx";

interface LegendItem {
  namespace: string;
  name: string;
  count: number;
}

function legendOf(shares: BlockShares, namespaces: NamespaceInfo[]): LegendItem[] {
  const counts = new Map<string, number>();
  for (const row of shares.rows.slice(0, shares.k)) {
    for (const cell of row.slice(0, shares.k)) counts.set(cell.namespace, (counts.get(cell.namespace) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([namespace, count]) => ({
      namespace,
      count,
      name: namespace === TAIL_PADDING_NAMESPACE ? "Padding" : (namespaces.find((item) => item.hex === namespace)?.name ?? namespace),
    }));
}

function SnapshotDownload({ height }: { height: number }) {
  const { id } = useWorkspace();
  const [status, setStatus] = useState("");
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  const download = async () => {
    setBusy(true);
    setFailed(false);
    setStatus("Downloading snapshot…");
    try {
      await downloadSnapshot(id, height);
      setStatus("Snapshot ready.");
    } catch (caught) {
      if (!(caught instanceof ApiError)) throw caught;
      setFailed(true);
      setStatus(caught.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack">
      <button type="button" className="pill pill--solid" disabled={busy} aria-busy={busy || undefined} onClick={() => void download()}>
        Download square snapshot
      </button>
      <p role="status" aria-label="Snapshot status" className={failed ? "banner" : "form-status"}>{status}</p>
    </div>
  );
}

export function BlockPage({ height }: { height: number }) {
  const { id } = useWorkspace();
  const me = useMe();
  const square = useBlockSquare(height);
  const namespaces = useJson<NamespaceInfo[]>(`/api/w/${id}/namespaces`);
  const badlyEncoded = square.data?.block.rejection?.reason === "bad-encoding";
  const fraud = useResource<FraudProof>(badlyEncoded ? `${id}/${height}/fraud` : null, () => getJson<FraudProof>(`/api/w/${id}/blocks/${height}/fraud-proof`));
  if (square.error) return <NotFoundContent />;
  const data = square.data;
  if (!data) return <Page title={`Block ${height}`}><Loading label="Block loading" /></Page>;
  const { block, shares } = data;
  const names = namespaces.data ?? [];
  const legend = legendOf(shares, names);

  return (
    <>
      <Page title={`Block ${block.height}`}>
        <dl className="panel facts">
          <div><dt>Time</dt><dd>{formatDateTime(block.producedAt, display.timeZone)}</dd></div>
          <div><dt>Status</dt><dd>{capitalise(block.status)}</dd></div>
          <div><dt>Square width</dt><dd>{sizeText(block.squareWidth)}</dd></div>
          <div><dt>Data root</dt><dd><code className="wrap">{block.dataRoot}</code></dd></div>
        </dl>
        {block.rejection && (
          <div role="alert" aria-label={`Block ${block.height} rejected`} className="banner">{rejectionText(block.height, block.rejection)}</div>
        )}
        <section className="block-square">
          <div className="block-square__main">
            <SquareGrid block={block} shares={shares} namespaces={names} meId={me.user.id} />
            <div className="panel">
              <h2 className="section-title">Column roots</h2>
              <RootsList name="Column roots" word="Column" roots={block.columnRoots} />
            </div>
          </div>
          <div className="panel block-square__side">
            <h2 className="section-title">Row roots</h2>
            <RootsList name="Row roots" word="Row" roots={block.rowRoots} />
          </div>
        </section>
        <section className="panel">
          <h2 className="section-title">Namespaces in this square</h2>
          <ul aria-label="Namespace legend" className="legend">
            {legend.map((item) => (
              <li key={item.namespace} data-namespace={item.namespace} data-count={item.count}>
                <span className="legend__name">{item.name}</span> <span>{item.count} {item.count === 1 ? "share" : "shares"}</span>
              </li>
            ))}
          </ul>
        </section>
        <section className="panel" tabIndex={0}>
          <SnapshotDownload height={block.height} />
        </section>
        <section className="panel" tabIndex={0}>
          <h2 className="section-title">Blobs in this block</h2>
          <table aria-label="Blobs in this block">
            <thead><tr><th scope="col">Blob</th><th scope="col">Namespace</th><th scope="col" className="num">Shares</th><th scope="col">Sender</th></tr></thead>
            <tbody>
              {block.blobs.map((blob) => (
                <tr key={blob.id}>
                  <td className="id-cell"><Link to={`/w/${id}/blobs/${blob.id}`} className="mono">{truncateId(blob.id)}</Link><CopyId value={blob.id} /></td>
                  <td>{names.find((item) => item.hex === blob.namespace)?.name ?? blob.namespace}</td>
                  <td className="num">{blob.positions.length}</td>
                  <td>{blob.senderName}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {block.blobs.length === 0 && <Empty sentence="No blobs in this block." />}
        </section>
        <ProveNamespace block={block} />
        {fraud.data && <FraudProofPanel proof={fraud.data} />}
      </Page>
      <SquareWalk block={block} shares={shares} meId={me.user.id} />
    </>
  );
}
