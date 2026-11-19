import type { BlockSummary, LightNode, Mempool, NamespaceInfo, Validator } from "../../shared/api.ts";
import { formatDate, formatTime, pluralBlobs } from "../../shared/units.ts";
import { Footer } from "../components/Footer.tsx";
import { LightNodePanel } from "../components/LightNodePanel.tsx";
import { Marquee } from "../components/Marquee.tsx";
import { NextBlockControl } from "../components/NextBlock.tsx";
import { LinkPill } from "../components/Pill.tsx";
import { RejectionBanners } from "../components/RejectionBanners.tsx";
import { Reveal, SplitHeading } from "../components/Reveal.tsx";
import { SquareGrid, sharesSeedText } from "../components/SquareGrid.tsx";
import { Loading, StrandCanvas } from "../components/StrandCanvas.tsx";
import { useBlockSquare } from "../lib/blocks.ts";
import { display } from "../lib/config.ts";
import { capitalise, sizeText } from "../lib/format.ts";
import { useJson } from "../lib/resource.ts";
import { Link } from "../lib/router.tsx";
import { useMe } from "../lib/session.tsx";
import { seedFrom } from "../lib/strands.ts";
import { useWorkspace } from "../lib/workspace.tsx";

export function ExplorerPage() {
  const { id, info } = useWorkspace();
  const me = useMe();
  const blocks = useJson<BlockSummary[]>(`/api/w/${id}/blocks`);
  const namespaces = useJson<NamespaceInfo[]>(`/api/w/${id}/namespaces`);
  const mempool = useJson<Mempool>(`/api/w/${id}/mempool`);
  const validators = useJson<Validator[]>(`/api/w/${id}/validators`);
  const nodes = useJson<LightNode[]>(`/api/w/${id}/light-nodes`);
  const latest = blocks.data?.[0];
  const square = useBlockSquare(latest?.height ?? null, true);
  const names = namespaces.data ?? [];

  const today = formatDate(info.clock, display.timeZone);
  const includedToday = (blocks.data ?? [])
    .filter((block) => block.status !== "rejected" && formatDate(block.producedAt, display.timeZone) === today)
    .reduce((sum, block) => sum + block.blobs, 0);
  const waveSeed = seedFrom(square.data ? sharesSeedText(square.data.shares, square.data.shares.rows[0]?.[0]?.namespace ?? "") : "wave");

  return (
    <>
      <section className="hero">
        <div className="container hero__copy">
          <Reveal as="h1" className="hero__title"><span>Run your own data</span> <span>availability network.</span></Reveal>
          <Reveal index={1} as="p" className="lede">
            Blobs become shares, shares become a square, and a square becomes a root. Every block here is yours to inspect, sample and break on purpose.
          </Reveal>
        </div>
        <div className="container">
          <div className="stage" aria-busy={square.loading}>
            <StrandCanvas seed={seedFrom(`stage-${latest?.height ?? 0}`)} variant="stage" className="stage__strands" />
            {square.data ? (
              <SquareGrid block={square.data.block} shares={square.data.shares} namespaces={names} meId={me.user.id} />
            ) : <Loading label="Latest square loading" />}
          </div>
        </div>
      </section>

      <section className="container section">
        {latest && (
          <section aria-label="Network stats" className="stats">
            <div className="stat"><p className="stat__value">{latest.height} blocks</p><p className="stat__caption">Current height</p></div>
            <div className="stat"><p className="stat__value">{sizeText(latest.squareWidth)} shares</p><p className="stat__caption">Latest square</p></div>
            <div className="stat"><p className="stat__value">{pluralBlobs(includedToday)}</p><p className="stat__caption">Included today</p></div>
          </section>
        )}
        {blocks.data && <RejectionBanners blocks={blocks.data} />}
        <NextBlockControl />
        <p className="readout">Mempool {pluralBlobs(mempool.data?.count ?? 0)}</p>

        <SplitHeading text="Blocks" />
        <div className="panel" tabIndex={0}>
          <table aria-label="Blocks">
            <thead><tr><th scope="col">Height</th><th scope="col">Time</th><th scope="col" className="num">Blobs</th><th scope="col">Square</th><th scope="col">Status</th></tr></thead>
            <tbody>
              {blocks.data?.map((block) => (
                <tr key={block.height}>
                  <td><Link to={`/w/${id}/explorer/blocks/${block.height}`}>{block.height}</Link></td>
                  <td>{formatTime(block.producedAt, display.timeZone)}</td>
                  <td className="num">{block.blobs}</td>
                  <td>{sizeText(block.squareWidth)}</td>
                  <td><span className="badge">{capitalise(block.status)}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <SplitHeading text="Namespaces" />
        <div className="panel" tabIndex={0}>
          <table aria-label="Namespaces">
            <thead><tr><th scope="col">Name</th><th scope="col">Hex</th><th scope="col" className="num">Blobs</th></tr></thead>
            <tbody>
              {names.map((namespace) => (
                <tr key={namespace.id}><td>{namespace.name}</td><td><code>{namespace.hex}</code></td><td className="num">{namespace.blobCount}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="band-light">
        <div className="container section">
          <SplitHeading text="Shares by namespace" />
          <ul aria-label="Namespace showcase" className="showcase">
            {names.map((namespace) => (
              <li key={namespace.id} className="showcase__card">
                <StrandCanvas seed={seedFrom(square.data ? sharesSeedText(square.data.shares, namespace.hex) || namespace.hex : namespace.hex)}
                  variant="card" className="showcase__art" />
                <div className="showcase__text">
                  <h3>{namespace.name}</h3>
                  <code>{namespace.hex}</code>
                  <p>{pluralBlobs(namespace.blobCount)}</p>
                </div>
              </li>
            ))}
          </ul>
          {validators.data && <Marquee names={validators.data.map((validator) => validator.name)} />}
          <Reveal className="band-light__action">
            <LinkPill to={`/w/${id}/submit`} variant="outline">Register a namespace</LinkPill>
          </Reveal>
        </div>
      </section>

      <section aria-label="Light nodes" className="container section">
        <SplitHeading text="Light nodes" />
        <div className="stack stack--wide">
          {nodes.data?.map((node, position) => <LightNodePanel key={node.id} node={node} position={position} latest={latest} />)}
        </div>
      </section>

      <Footer workspaceId={id} seed={waveSeed} />
    </>
  );
}
