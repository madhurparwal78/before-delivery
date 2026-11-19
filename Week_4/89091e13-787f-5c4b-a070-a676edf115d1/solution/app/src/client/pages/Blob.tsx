import type { BlobInfo, NamespaceInfo } from "../../shared/api.ts";
import { formatFernUnit, groupThousands } from "../../shared/units.ts";
import { Page } from "../components/Page.tsx";
import { SquareGrid } from "../components/SquareGrid.tsx";
import { Empty, Loading } from "../components/StrandCanvas.tsx";
import { useBlockSquare } from "../lib/blocks.ts";
import { useJson } from "../lib/resource.ts";
import { Link } from "../lib/router.tsx";
import { useMe } from "../lib/session.tsx";
import { useWorkspace } from "../lib/workspace.tsx";
import { NotFoundContent } from "./NotFound.tsx";

export function BlobPage({ blobId }: { blobId: string }) {
  const { id } = useWorkspace();
  const me = useMe();
  const blob = useJson<BlobInfo>(`/api/w/${id}/blobs/${blobId}`);
  const namespaces = useJson<NamespaceInfo[]>(`/api/w/${id}/namespaces`);
  const square = useBlockSquare(blob.data?.height ?? null);
  if (blob.error) return <NotFoundContent />;
  const data = blob.data;
  if (!data) return <Page title="Blob"><Loading label="Blob loading" /></Page>;
  const outline = new Set(data.positions.map(([r, c]) => `${r},${c}`));

  return (
    <Page title={`Blob ${data.id.slice(0, 8)}`}>
      <div className="blob-layout">
        <div className="stack">
          <ul aria-label="Blob facts" className="panel facts-list">
            <li>{data.statusText}</li>
            <li>Namespace {data.namespaceName} <code>{data.namespace}</code></li>
            <li>Size {groupThousands(data.size)} bytes</li>
            <li>Shares {data.shares}</li>
            <li>Fee {formatFernUnit(data.feeUfern)}</li>
            {data.height !== null && <li><Link to={`/w/${id}/explorer/blocks/${data.height}`}>Block {data.height}</Link></li>}
            <li><Link to={`/w/${id}/explorer/tx/${data.txId}`}>Transaction</Link></li>
          </ul>
          <section className="panel">
            <h2 className="section-title">Share positions</h2>
            {data.positions.length > 0 ? (
              <ul aria-label="Share positions" className="positions">
                {data.positions.map(([r, c]) => <li key={`${r}-${c}`}>({r}, {c})</li>)}
              </ul>
            ) : <p className="muted">Shares are placed when a block includes this blob.</p>}
          </section>
        </div>
        <div className="blob-layout__square">
          {square.data ? (
            <SquareGrid block={square.data.block} shares={square.data.shares} namespaces={namespaces.data ?? []} meId={me.user.id} outline={outline} />
          ) : data.height === null ? (
            <Empty sentence="No square yet. The next block will lay this blob out." />
          ) : <Loading label="Square loading" />}
        </div>
      </div>
    </Page>
  );
}
