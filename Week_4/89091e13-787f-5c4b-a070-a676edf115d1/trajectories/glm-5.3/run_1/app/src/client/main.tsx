// Fernsquare browser app.

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { useEffect, useMemo, useRef, useState } from "react";
import "./styles.css";
import { AppProvider, useApp } from "./app.jsx";
import { LiveProvider, useLive } from "./live.jsx";
import { linkProps, navigate, usePath } from "./router.js";
import {
  ApiError,
  errorCopy,
  fieldErrors,
  getJson,
  patchJson,
  postJson,
  putJson,
  type BlobBody,
  type BlockBody,
  type BlockSummary,
  type FraudProofBody,
  type NodeBody,
  type ProposalBody,
  type RowProof,
  type ShareBody,
  type StakingMe,
  type TxBody,
  type ValidatorBody,
} from "./api.js";
import {
  Banner,
  CopyPill,
  Field,
  FormAlert,
  Loading,
  NotFound,
  Panel,
  StatTrio,
  StatusLine,
  TopBar,
  WorkspaceTabs,
} from "./ui.jsx";
import { SharePanel, SquareGrid, useReducedMotion, useRowReveal, type CellMeta } from "./square.jsx";
import {
  displayDate,
  displayDateTime,
  displayTime,
  formatFernUfern,
  formatFernWithUnit,
  percent,
  plural,
  truncateMiddle,
} from "./display.js";
import {
  feeUfern,
  blobGas,
  shareCount,
  formatFern,
  verifyRowProof,
} from "../shared/domain.js";

function Mount(): JSX.Element {
  return (
    <StrictMode>
      <AppProvider>
        <Routes />
      </AppProvider>
    </StrictMode>
  );
}

function Routes(): JSX.Element {
  const path = usePath();
  const { user, workspaces } = useApp();
  const workspaceMatch = path.match(/^\/w\/([^/]+)(\/.*)?$/);

  if (path === "/" || path === "") {
    if (user && workspaces.length > 0) {
      return <Redirect to={`/w/${workspaces[0]!.id}/explorer`} />;
    }
    return <Redirect to="/signin" />;
  }
  if (!user && path !== "/signin" && !path.startsWith("/invites/")) {
    return <Redirect to="/signin" />;
  }
  if (workspaceMatch) {
    const workspaceId = workspaceMatch[1]!;
    const workspace = workspaces.find((w) => w.id === workspaceId);
    if (!workspace) return <NotFound />;
    return (
      <LiveProvider workspaceId={workspaceId}>
        <WorkspaceShell workspaceId={workspaceId} role={workspace.role} path={path} />
      </LiveProvider>
    );
  }
  if (path === "/signin") return <SignIn />;
  const inviteMatch = path.match(/^\/invites\/([^/]+)$/);
  if (inviteMatch) return <InviteAccept token={inviteMatch[1]!} />;
  return <NotFound />;
}

function Redirect({ to }: { to: string }): JSX.Element {
  useEffect(() => {
    navigate(to, true);
  }, [to]);
  return <Loading />;
}

function WorkspaceShell({ workspaceId, role, path }: { workspaceId: string; role: string; path: string }): JSX.Element {
  const { reload } = useApp();
  const sub = path.replace(/^\/w\/[^/]+/, "") || "/explorer";
  const panel = sub.split("/")[1] ?? "explorer";
  return (
    <div>
      <TopBar
        workspaceId={workspaceId}
        onSignOut={() => {
          void fetch("/api/session", { method: "DELETE" }).then(() => reload());
        }}
      />
      <div style={{ height: 64 }} />
      <WorkspaceTabs workspaceId={workspaceId} current={`/w/${workspaceId}/${panel}`} />
      <main className="container" style={{ paddingTop: 24 }}>
        {sub === "/explorer" && <Explorer workspaceId={workspaceId} role={role} />}
        {sub.startsWith("/explorer/blocks/") && <BlockPage workspaceId={workspaceId} height={Number(sub.split("/")[3])} />}
        {sub.startsWith("/explorer/tx/") && <TransactionPage workspaceId={workspaceId} txId={sub.split("/")[3]!} />}
        {sub.startsWith("/blobs/") && <BlobPage workspaceId={workspaceId} blobId={sub.split("/")[2]!} />}
        {sub === "/submit" && <Submit workspaceId={workspaceId} role={role} />}
        {sub === "/nodes" && <Nodes workspaceId={workspaceId} role={role} />}
        {sub.startsWith("/nodes/") && <NodePage workspaceId={workspaceId} nodeId={sub.split("/")[2]!} role={role} />}
        {sub === "/stake" && <Stake workspaceId={workspaceId} role={role} />}
        {sub === "/vote" && <Vote workspaceId={workspaceId} role={role} />}
        {sub.startsWith("/vote/") && <ProposalPage workspaceId={workspaceId} number={Number(sub.split("/")[2])} role={role} />}
        {sub === "/ledger" && <Ledger workspaceId={workspaceId} />}
        {sub === "/members" && <Members workspaceId={workspaceId} role={role} />}
      </main>
    </div>
  );
}

function useWorkspaceData<T>(loader: () => Promise<T>, deps: unknown[]): { data: T | null; reload: () => void } {
  const [data, setData] = useState<T | null>(null);
  const { version } = useLive();
  const load = async () => {
    try {
      setData(await loader());
    } catch {
      setData(null);
    }
  };
  useEffect(() => {
    void load();
  }, [...deps, version]);
  return { data, reload: () => void load() };
}

function SignIn(): JSX.Element {
  const { reload } = useApp();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const emailRef = useRef<HTMLInputElement | null>(null);

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = await postJson<{ user: { id: string }; workspaces: { id: string }[] }>("/api/session", {
        email,
        password,
      });
      await reload();
      navigate(`/w${""}`.replace("/w", body.workspaces[0] ? `/w/${body.workspaces[0].id}` : "/signin"));
    } catch (caught) {
      setError(errorCopy(caught) ?? "Fernsquare can't reach the server. Your last action was not sent.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="container" style={{ maxWidth: 480, paddingTop: 96 }}>
      <Panel>
        <h2>Sign in</h2>
        <form aria-label="Sign in" onSubmit={submit}>
          <FormAlert message={error} />
          <Field label="Email" htmlFor="signin-email">
            <input
              ref={emailRef}
              id="signin-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="username"
            />
          </Field>
          <Field label="Password" htmlFor="signin-password">
            <input
              id="signin-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
            />
          </Field>
          <button className="pill primary" type="submit" aria-busy={busy} disabled={busy}>
            Sign in
          </button>
        </form>
      </Panel>
    </div>
  );
}

function InviteAccept({ token }: { token: string }): JSX.Element {
  const { reload } = useApp();
  const [info, setInfo] = useState<{ workspaceName: string; existingAccount: boolean } | null>(null);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    void getJson<{ workspaceName: string; existingAccount: boolean }>(`/api/invites/${token}`)
      .then(setInfo)
      .catch(() => setExpired(true));
  }, [token]);

  if (expired) {
    return (
      <div className="container" style={{ maxWidth: 480, paddingTop: 96 }}>
        <Panel>
          <Banner>This invite link has already been used or has expired.</Banner>
        </Panel>
      </div>
    );
  }
  if (!info) return <Loading />;

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    setError(null);
    try {
      const body = await postJson<{ workspaceId: string }>(`/api/invites/${token}/accept`, {
        name,
        password,
      });
      await reload();
      navigate(`/w/${body.workspaceId}/explorer`);
    } catch (caught) {
      const errors = fieldErrors(caught);
      if (errors.name) setError(errors.name);
      else if (errors.password) setError(errors.password);
      else setError(errorCopy(caught) ?? "Fernsquare can't reach the server. Your last action was not sent.");
    }
  };

  return (
    <div className="container" style={{ maxWidth: 480, paddingTop: 96 }}>
      <Panel>
        <h2>Join {info.workspaceName} on Fernsquare</h2>
        <form aria-label="Accept invite" onSubmit={submit}>
          <FormAlert message={error} />
          {!info.existingAccount && (
            <Field label="Your name" htmlFor="invite-name">
              <input id="invite-name" value={name} onChange={(event) => setName(event.target.value)} />
            </Field>
          )}
          <Field label="Password" htmlFor="invite-password">
            <input
              id="invite-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </Field>
          <button className="pill primary" type="submit">
            Accept invite
          </button>
        </form>
      </Panel>
    </div>
  );
}

function Explorer({ workspaceId, role }: { workspaceId: string; role: string }): JSX.Element {
  const { bootstrap } = useApp();
  const reducedMotion = useReducedMotion();
  const [blocks, setBlocks] = useState<BlockSummary[] | null>(null);
  const [namespaces, setNamespaces] = useState<{ id: string; name: string; hex: string; blobCount: number }[] | null>(null);
  const [mempool, setMempool] = useState<{ count: number } | null>(null);
  const [nodes, setNodes] = useState<NodeBody[] | null>(null);
  const [nextBlock, setNextBlock] = useState("honest");
  const [producerStatus, setProducerStatus] = useState("");
  const [shares, setShares] = useState<ShareBody[][] | null>(null);
  const [announcements, setAnnouncements] = useState<string[]>([]);
  const { version, lastEvent } = useLive();

  const load = async () => {
    const [blocksBody, nsBody, mempoolBody, nodesBody, workspaceBody] = await Promise.all([
      getJson<BlockSummary[]>(`/api/w/${workspaceId}/blocks`),
      getJson<{ id: string; name: string; hex: string; blobCount: number }[]>(`/api/w/${workspaceId}/namespaces`),
      getJson<{ count: number }>(`/api/w/${workspaceId}/mempool`),
      getJson<NodeBody[]>(`/api/w/${workspaceId}/light-nodes`),
      getJson<{ nextBlock: string }>(`/api/w/${workspaceId}`),
    ]);
    setBlocks(blocksBody);
    setNamespaces(nsBody);
    setMempool(mempoolBody);
    setNodes(nodesBody);
    setNextBlock(workspaceBody.nextBlock);
    const latest = blocksBody[0];
    if (latest) {
      setShares(await getJson<{ rows: ShareBody[][] }>(`/api/w/${workspaceId}/blocks/${latest.height}/shares`).then((body) => body.rows));
    }
  };

  useEffect(() => {
    void load();
  }, [workspaceId, version]);

  useEffect(() => {
    if (!lastEvent) return;
    if (lastEvent.kind === "block") {
      const body = lastEvent.body as { height: number; blobs: number; square: number };
      setAnnouncements((previous) => [
        ...previous,
        `Block ${body.height} produced: ${body.blobs} ${plural(body.blobs, "blob")}, square ${body.square} × ${body.square}.`,
      ]);
    }
    if (lastEvent.kind === "block-rejected") {
      const body = lastEvent.body as { height: number; reason: string; nodeName?: string; row?: number; col?: number; axis?: string; index?: number };
      const text =
        body.reason === "withheld"
          ? `Block ${body.height} was rejected: shares were withheld. Light node ${body.nodeName} could not fetch share (${body.row}, ${body.col}).`
          : `Block ${body.height} was rejected: ${body.axis} ${body.index} is not encoded correctly.`;
      setAnnouncements((previous) => [...previous, text]);
    }
  }, [lastEvent]);

  const timeZone = bootstrap.timeZone;
  const latest = blocks?.[0] ?? null;
  const k = latest?.squareWidth ?? 1;
  const revealed = useRowReveal(latest?.height ?? 0, 2 * k, bootstrap.squareRowRevealMs, reducedMotion);
  const namespaceNames = useMemo(() => new Map((namespaces ?? []).map((n) => [n.hex, n.name])), [namespaces]);
  const cells = useMemo(() => {
    if (!shares) return [];
    return shares.flat().map((share) => ({
      row: share.row,
      col: share.col,
      quadrant: share.quadrant,
      namespace: share.namespace,
      kind: share.kind,
      share: share.share,
      mine: false,
      label: share.kind === "padding" ? "Padding" : share.kind === "parity" ? "Parity" : share.kind === "withheld" ? "Withheld" : namespaceNames.get(share.namespace) ?? "Blob",
    }));
  }, [shares, namespaceNames]);
  const [focus, setFocus] = useState<{ row: number; col: number } | null>(null);
  const [sharePanel, setSharePanel] = useState<CellMeta | null>(null);

  const includedToday = (blocks ?? []).filter((block) => displayDate(block.producedAt, timeZone) === displayDate(new Date().toISOString(), timeZone)).reduce((acc, block) => acc + block.blobs, 0);

  const rejectedRecent = (blocks ?? []).slice(0, 5).filter((block) => block.status === "rejected");

  return (
    <div>
      <section className="hero-stage container" style={{ paddingLeft: 0, paddingRight: 0 }}>
        <h1>Run your own data availability network.</h1>
        <p style={{ fontSize: 18, marginTop: 10, maxWidth: 560 }}>
          Blobs become shares, laid out in an erasure-extended square and sampled by light nodes.
        </p>
        {latest && cells.length > 0 && (
          <div style={{ marginTop: 28 }}>
            <SquareGrid
              height={latest.height}
              k={k}
              cells={cells}
              focus={focus}
              onFocusChange={setFocus}
              onOpenShare={setSharePanel}
              revealedRows={revealed}
              revealMs={bootstrap.squareRowRevealMs}
              reducedMotion={reducedMotion}
            />
          </div>
        )}
      </section>
      <div className="container">
        <StatTrio
          stats={[
            { value: String(latest?.height ?? 0), noun: "blocks", caption: "Current height" },
            { value: `${k} × ${k}`, noun: "shares", caption: "Latest square" },
            { value: String(includedToday), noun: plural(includedToday, "blob"), caption: "Included today" },
          ]}
        />
        {rejectedRecent.map((block) => (
          <Banner key={block.height}>
            <span aria-label={`Block ${block.height} rejected`}>
              Block {block.height} was rejected: shares were withheld.
            </span>
          </Banner>
        ))}
        <Panel title="Producer">
          <form aria-label="Set producer behaviour" style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
            <div role="radiogroup" aria-label="Next block" style={{ display: "flex", gap: 12 }}>
              {(["honest", "withhold", "bad-encoding"] as const).map((option) => (
                <label key={option} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <input
                    type="radio"
                    name="next-block"
                    checked={nextBlock === option}
                    disabled={role !== "owner"}
                    aria-describedby={role !== "owner" ? "producer-role-description" : undefined}
                    onChange={async () => {
                      setNextBlock(option);
                      try {
                        await putJson(`/api/w/${workspaceId}/producer`, { nextBlock: option });
                        setProducerStatus(`Next block: ${option === "honest" ? "Honest" : option === "withhold" ? "Withhold shares" : "Bad encoding"}.`);
                      } catch (caught) {
                        setProducerStatus(errorCopy(caught) ?? "Fernsquare can't reach the server. Your last action was not sent.");
                      }
                    }}
                  />
                  {option === "honest" ? "Honest" : option === "withhold" ? "Withhold shares" : "Bad encoding"}
                </label>
              ))}
            </div>
            <span id="producer-role-description" hidden>
              {role === "viewer" ? "Viewers can't make changes in this workspace." : "Only the owner can change producer behaviour."}
            </span>
            <StatusLine name="Producer status">{producerStatus}</StatusLine>
          </form>
        </Panel>
        <p style={{ marginTop: 20 }}>
          Mempool {mempool?.count ?? 0} {plural(mempool?.count ?? 0, "blob")}
        </p>
        <Panel>
          <h3>Blocks</h3>
          <table className="data" aria-label="Blocks">
            <thead>
              <tr>
                <th>Height</th>
                <th>Time</th>
                <th>Blobs</th>
                <th>Square</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {(blocks ?? []).map((block) => (
                <tr key={block.height}>
                  <td>
                    <a {...linkProps(`/w/${workspaceId}/explorer/blocks/${block.height}`)}>{block.height}</a>
                  </td>
                  <td>{displayTime(block.producedAt, timeZone)}</td>
                  <td>{block.blobs}</td>
                  <td>
                    {block.squareWidth} × {block.squareWidth}
                  </td>
                  <td>{block.status === "sampling" ? "Sampling" : block.status === "available" ? "Available" : "Rejected"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
        <Panel>
          <h3>Namespaces</h3>
          <table className="data" aria-label="Namespaces">
            <thead>
              <tr>
                <th>Name</th>
                <th>Hex</th>
                <th>Blobs</th>
              </tr>
            </thead>
            <tbody>
              {(namespaces ?? []).map((namespace) => (
                <tr key={namespace.id}>
                  <td>{namespace.name}</td>
                  <td className="mono">{namespace.hex}</td>
                  <td>{namespace.blobCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </div>
      <div className="offwhite-band">
        <div className="container">
          <h2 style={{ color: "#14121a" }}>Namespaces in this workspace</h2>
          <ul aria-label="Namespace showcase" className="card-grid" style={{ listStyle: "none", padding: 0, marginTop: 20 }}>
            {(namespaces ?? []).map((namespace) => (
              <li key={namespace.id} className="showcase-card">
                <div
                  aria-hidden="true"
                  style={{
                    height: 64,
                    borderRadius: 8,
                    marginBottom: 12,
                    background: `repeating-linear-gradient(90deg, hsl(250 + ${(parseInt(namespace.hex.slice(-2), 16) % 40) - 20}, 60%, 40%) 0 6px, transparent 6px 10px)`,
                  }}
                />
                <h3>{namespace.name}</h3>
                <p className="mono" style={{ fontSize: 12 }}>
                  {namespace.hex}
                </p>
                <p>
                  {namespace.blobCount} {plural(namespace.blobCount, "blob")}
                </p>
              </li>
            ))}
          </ul>
          <a className="pill" style={{ marginTop: 22, borderColor: "#14121a", color: "#14121a" }} {...linkProps(`/w/${workspaceId}/submit`)}>
            Register a namespace
          </a>
          <section aria-label="Validators" className="marquee" data-motion={reducedMotion ? "off" : "running"}>
            <div className="marquee-track">
              {["AL", "BI", "CE", "DO", "AL", "BI", "CE", "DO"].map((monogram, index) => (
                <span key={index} className="monogram" aria-hidden="true">
                  {monogram}
                </span>
              ))}
            </div>
          </section>
        </div>
      </div>
      <div className="container">
        <section aria-label="Light nodes" className="section">
          <h2>Light nodes</h2>
          {(nodes ?? []).map((node, index) => (
            <article key={node.id} className="panel" style={{ display: "flex", gap: 20, alignItems: "center", marginLeft: index % 2 === 1 ? "auto" : undefined, maxWidth: index % 2 === 1 ? "80%" : undefined }}>
              <div
                aria-hidden="true"
                style={{
                  width: 84,
                  height: 84,
                  borderRadius: "50%",
                  border: "2px solid rgba(157,123,255,0.6)",
                  boxShadow: "0 0 24px rgba(157,123,255,0.35)",
                }}
              />
              <div>
                <h3>{node.name}</h3>
                <p>Sampling {node.autoSample ? "automatically" : "on demand"}.</p>
                <a className="pill" {...linkProps(`/w/${workspaceId}/nodes/${node.id}`)}>
                  Open {node.name}
                </a>
              </div>
            </article>
          ))}
        </section>
        <footer className="wave">
          <p>Fernsquare — a shared developer sandbox for data availability networks. FERN exists only inside the app.</p>
        </footer>
      </div>
      <StatusLine name="Network updates">
        {announcements.slice(-3).map((text, index) => (
          <span key={index}>{text} </span>
        ))}
      </StatusLine>
      {sharePanel && <SharePanel cell={sharePanel} onClose={() => setSharePanel(null)} />}
    </div>
  );
}

function Submit({ workspaceId, role }: { workspaceId: string; role: string }): JSX.Element {
  const { version } = useLive();
  const [namespaces, setNamespaces] = useState<{ id: string; name: string; hex: string }[]>([]);
  const [name, setName] = useState("");
  const [hex, setHex] = useState("");
  const [nsStatus, setNsStatus] = useState("");
  const [nsError, setNsError] = useState<string | null>(null);
  const [namespace, setNamespace] = useState("");
  const [data, setData] = useState("");
  const [fileBytes, setFileBytes] = useState<Uint8Array | null>(null);
  const [fee, setFee] = useState("");
  const [feeTouched, setFeeTouched] = useState(false);
  const [blobStatus, setBlobStatus] = useState("");
  const [blobError, setBlobError] = useState<string | null>(null);
  const [blobs, setBlobs] = useState<BlobBody[]>([]);

  useEffect(() => {
    void getJson<{ id: string; name: string; hex: string }[]>(`/api/w/${workspaceId}/namespaces`).then(setNamespaces);
  }, [workspaceId, version]);

  useEffect(() => {
    void getJson<BlobBody[]>(`/api/w/${workspaceId}/blobs?mine=true`).then(setBlobs);
  }, [workspaceId, version]);

  const bytes = fileBytes ?? new TextEncoder().encode(data);
  const shares = shareCount(bytes.length);
  const gas = blobGas(shares);
  const minFee = feeUfern(gas, 0.1);
  useEffect(() => {
    if (!feeTouched) setFee(formatFern(minFee));
  }, [minFee, feeTouched]);

  const registerNamespace = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    setNsStatus("Working…");
    setNsError(null);
    try {
      const body = await postJson<{ name: string }>(`/api/w/${workspaceId}/namespaces`, { name, hex });
      setNsStatus(`Namespace ${body.name} registered.`);
      setName("");
      setHex("");
    } catch (caught) {
      const errors = fieldErrors(caught);
      setNsError(errors.hex ?? errors.name ?? errorCopy(caught));
      setNsStatus("");
    }
  };

  const submitBlob = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    setBlobStatus("Working…");
    setBlobError(null);
    try {
      await postJson(`/api/w/${workspaceId}/blobs`, {
        namespace,
        dataBase64: btoa(String.fromCharCode(...bytes)),
        fee,
      });
      setBlobStatus("Blob submitted. It is pending until a block includes it.");
      setData("");
      setFileBytes(null);
      setFeeTouched(false);
    } catch (caught) {
      const errors = fieldErrors(caught);
      setBlobError(errors.namespace ?? errors.data ?? errors.fee ?? errorCopy(caught));
      setBlobStatus("");
    }
  };

  const available = useWorkspaceData<StakingMe>(() => getJson(`/api/w/${workspaceId}/staking/me`), [workspaceId, version]);

  return (
    <div className="split">
      <div>
        <Panel>
          <form aria-label="Register namespace" onSubmit={registerNamespace}>
            <h3 style={{ fontSize: 44 }}>Register namespace</h3>
            <FormAlert message={nsError} />
            <Field label="Namespace name" htmlFor="ns-name">
              <input id="ns-name" value={name} onChange={(event) => setName(event.target.value)} />
            </Field>
            <Field label="Namespace hex" htmlFor="ns-hex">
              <input id="ns-hex" value={hex} onChange={(event) => setHex(event.target.value)} className="mono" />
            </Field>
            <button className="pill primary" type="submit">
              Register namespace
            </button>
            <StatusLine name="Register namespace status">{nsStatus}</StatusLine>
          </form>
        </Panel>
        <Panel>
          <form aria-label="Submit blob" onSubmit={submitBlob}>
            <h3 style={{ fontSize: 44 }}>Submit blob</h3>
            <FormAlert message={blobError} />
            <Field label="Namespace" htmlFor="blob-namespace">
              <select id="blob-namespace" value={namespace} onChange={(event) => setNamespace(event.target.value)}>
                <option value="">Choose a namespace</option>
                {namespaces.map((ns) => (
                  <option key={ns.id} value={ns.hex}>
                    {ns.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Data" htmlFor="blob-data">
              <textarea id="blob-data" rows={4} value={data} onChange={(event) => setData(event.target.value)} />
            </Field>
            <Field label="Upload file" htmlFor="blob-file">
              <input
                id="blob-file"
                type="file"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) {
                    void file.arrayBuffer().then((buffer) => setFileBytes(new Uint8Array(buffer)));
                  } else {
                    setFileBytes(null);
                  }
                }}
              />
            </Field>
            <section aria-label="Blob estimate" className="panel" style={{ background: "var(--ground)" }}>
              <p className="num">Size {bytes.length.toLocaleString("en-US")} bytes</p>
              <p className="num">Shares {shares}</p>
              <p className="num">Gas {gas.toLocaleString("en-US")}</p>
              <p className="num">Fee {formatFern(minFee)} FERN</p>
            </section>
            <Field label="Fee (FERN)" htmlFor="blob-fee">
              <input
                id="blob-fee"
                value={fee}
                onChange={(event) => {
                  setFeeTouched(true);
                  setFee(event.target.value);
                }}
              />
            </Field>
            <p>Available {formatFernWithUnit(available.data?.availableUfern ?? "0")}</p>
            <button className="pill primary" type="submit" disabled={role === "viewer"}>
              Submit blob
            </button>
            <StatusLine name="Submit blob status">{blobStatus}</StatusLine>
          </form>
        </Panel>
      </div>
      <Panel>
        <h3>Your blobs</h3>
        <table className="data" aria-label="Your blobs">
          <thead>
            <tr>
              <th>Blob</th>
              <th>Namespace</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {blobs.map((blob) => (
              <tr key={blob.id}>
                <td>
                  <a {...linkProps(`/w/${workspaceId}/blobs/${blob.id}`)} className="mono">
                    {truncateMiddle(blob.id)}
                  </a>
                </td>
                <td>{blob.namespaceName}</td>
                <td>{blob.statusText}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}

function BlockPage({ workspaceId, height }: { workspaceId: string; height: number }): JSX.Element {
  const { bootstrap } = useApp();
  const { version } = useLive();
  const reducedMotion = useReducedMotion();
  const [block, setBlock] = useState<BlockBody | null>(null);
  const [shares, setShares] = useState<ShareBody[][] | null>(null);
  const [fraud, setFraud] = useState<FraudProofBody | null>(null);
  const [blobs, setBlobs] = useState<BlobBody[]>([]);
  const [namespaces, setNamespaces] = useState<{ name: string; hex: string; blobCount: number }[]>([]);
  const [proofNamespace, setProofNamespace] = useState("");
  const [proofs, setProofs] = useState<RowProof[] | null>(null);
  const [verdicts, setVerdicts] = useState<Record<number, string>>({});
  const [snapshotStatus, setSnapshotStatus] = useState("");
  const [focus, setFocus] = useState<{ row: number; col: number } | null>(null);
  const [sharePanel, setSharePanel] = useState<CellMeta | null>(null);
  const [walkStates, setWalkStates] = useState<("hidden" | "rising" | "shown")[]>(["hidden", "hidden", "hidden"]);
  const [activeWalk, setActiveWalk] = useState(0);
  const walkRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    void (async () => {
      const [blockBody, sharesBody, nsBody] = await Promise.all([
        getJson<BlockBody>(`/api/w/${workspaceId}/blocks/${height}`),
        getJson<{ rows: ShareBody[][] }>(`/api/w/${workspaceId}/blocks/${height}/shares`),
        getJson<{ name: string; hex: string; blobCount: number }[]>(`/api/w/${workspaceId}/namespaces`),
      ]);
      setBlock(blockBody);
      setShares(sharesBody.rows);
      setNamespaces(nsBody);
      try {
        setFraud(await getJson<FraudProofBody>(`/api/w/${workspaceId}/blocks/${height}/fraud-proof`));
      } catch {
        setFraud(null);
      }
      const blobList = await Promise.all(
        blockBody.blobs.map((blob) => getJson<BlobBody>(`/api/w/${workspaceId}/blobs/${blob.id}`)),
      );
      setBlobs(blobList);
    })();
  }, [workspaceId, height, version]);

  useEffect(() => {
    if (reducedMotion) {
      setWalkStates(["shown", "shown", "shown"]);
      setActiveWalk(0);
      return;
    }
    const timers: number[] = [];
    [0, 100, 200].forEach((delay, index) => {
      timers.push(
        window.setTimeout(() => {
          setWalkStates((previous) => {
            const next = [...previous];
            next[index] = "rising";
            return next;
          });
          timers.push(
            window.setTimeout(() => {
              setWalkStates((previous) => {
                const next = [...previous];
                next[index] = "shown";
                return next;
              });
            }, 600),
          );
        }, delay),
      );
    });
    return () => {
      for (const timer of timers) window.clearTimeout(timer);
    };
  }, [reducedMotion, height]);

  useEffect(() => {
    const onScroll = (): void => {
      const section = walkRef.current;
      if (!section) return;
      const rect = section.getBoundingClientRect();
      const total = rect.height - window.innerHeight;
      const progress = Math.min(1, Math.max(0, -rect.top / Math.max(1, total)));
      if (reducedMotion) {
        setActiveWalk(progress < 1 / 3 ? 0 : progress < 2 / 3 ? 1 : 2);
        return;
      }
      setActiveWalk(progress < 1 / 3 ? 0 : progress < 2 / 3 ? 1 : 2);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, [reducedMotion]);

  if (!block) return <Loading />;
  const k = block.squareWidth;
  const width = 2 * k;
  const revealed = useRowReveal(height, width, bootstrap.squareRowRevealMs, reducedMotion);
  const namespaceNames = new Map(namespaces.map((n) => [n.hex, n.name]));
  const cells = (shares ?? []).flat().map((share) => ({
    row: share.row,
    col: share.col,
    quadrant: share.quadrant,
    namespace: share.namespace,
    kind: share.kind,
    share: share.share,
    mine: false,
    label:
      share.kind === "padding"
        ? "Padding"
        : share.kind === "parity"
          ? "Parity"
          : share.kind === "withheld"
            ? "Withheld"
            : namespaceNames.get(share.namespace) ?? "Blob",
  }));

  const prove = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    try {
      const body = await getJson<{ rows: RowProof[] }>(
        `/api/w/${workspaceId}/blocks/${height}/proofs?namespace=${proofNamespace.trim().toLowerCase()}`,
      );
      setProofs(body.rows);
    } catch (caught) {
      setProofs(null);
      const errors = fieldErrors(caught);
      setVerdicts({ [-1]: errors.namespace ?? errorCopy(caught) ?? "Fernsquare can't reach the server. Your last action was not sent." });
    }
  };

  const namespaceCounts = new Map<string, number>();
  for (const blob of block.blobs) {
    namespaceCounts.set(blob.namespace, (namespaceCounts.get(blob.namespace) ?? 0) + blob.positions.length);
  }

  return (
    <div>
      <h2>Block {height}</h2>
      <dl style={{ display: "grid", gridTemplateColumns: "max-content 1fr", gap: "6px 18px" }}>
        <dt>Time</dt>
        <dd>{displayDateTime(block.producedAt, bootstrap.timeZone)}</dd>
        <dt>Status</dt>
        <dd>{block.status === "sampling" ? "Sampling" : block.status === "available" ? "Available" : "Rejected"}</dd>
        <dt>Square width</dt>
        <dd>
          {k} × {k}
        </dd>
        <dt>Data root</dt>
        <dd className="mono">{block.dataRoot}</dd>
      </dl>
      {block.status === "rejected" && (
        <Banner>
          <span aria-label={`Block ${height} rejected`}>
            {block.rejection?.reason === "withheld"
              ? `Block ${height} was rejected: shares were withheld. Light node ${block.rejection.nodeName} could not fetch share (${block.rejection.row}, ${block.rejection.col}).`
              : `Block ${height} was rejected: ${block.rejection?.axis} ${block.rejection?.index} is not encoded correctly.`}
          </span>
        </Banner>
      )}
      <div className="split" style={{ marginTop: 20 }}>
        <div>
          <SquareGrid
            height={height}
            k={k}
            cells={cells}
            focus={focus}
            onFocusChange={setFocus}
            onOpenShare={setSharePanel}
            revealedRows={revealed}
            revealMs={bootstrap.squareRowRevealMs}
            reducedMotion={reducedMotion}
          />
        </div>
        <Panel title="Row roots">
          <ul className="roots-list" aria-label="Row roots" style={{ listStyle: "none", padding: 0 }}>
            {block.rowRoots.map((root, index) => (
              <li key={index} className="root" data-min={root.min} data-max={root.max} data-hash={root.hash}>
                <strong>
                  Row {index}
                </strong>{" "}
                <span className="mono">{root.min}</span> <span className="mono">{root.max}</span>
                <div className="mono">{root.hash}</div>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
      <Panel title="Column roots">
        <ul className="roots-list" aria-label="Column roots" style={{ listStyle: "none", padding: 0 }}>
          {block.columnRoots.map((root, index) => (
            <li key={index} className="root" data-min={root.min} data-max={root.max} data-hash={root.hash}>
              <strong>Column {index}</strong> <span className="mono">{root.min}</span> <span className="mono">{root.max}</span>
              <div className="mono">{root.hash}</div>
            </li>
          ))}
        </ul>
      </Panel>
      <Panel title="Namespace legend">
        <ul aria-label="Namespace legend" style={{ listStyle: "none", padding: 0, display: "flex", gap: 16, flexWrap: "wrap" }}>
          {[...namespaceCounts.entries()].map(([namespace, count]) => (
            <li key={namespace} data-namespace={namespace} data-count={count}>
              {namespaceNames.get(namespace) ?? namespace} {count} {plural(count, "share")}
            </li>
          ))}
          <li data-namespace="fffffffffffffffffe" data-count={k * k - block.blobs.reduce((acc, b) => acc + b.positions.length, 0)}>
            Padding
          </li>
        </ul>
      </Panel>
      <Panel>
        <button
          type="button"
          className="pill"
          onClick={async () => {
            setSnapshotStatus("Downloading snapshot…");
            try {
              const response = await fetch(`/api/w/${workspaceId}/blocks/${height}/snapshot`);
              if (!response.ok) throw new ApiError(response.status, await response.text());
              const blob = await response.blob();
              const url = URL.createObjectURL(blob);
              const anchor = document.createElement("a");
              anchor.href = url;
              anchor.download = `block-${height}-square.bin`;
              anchor.click();
              URL.revokeObjectURL(url);
              setSnapshotStatus("Snapshot ready.");
            } catch {
              setSnapshotStatus("Storage is unavailable, so the snapshot can't be downloaded right now.");
            }
          }}
        >
          Download square snapshot
        </button>
        <StatusLine name="Snapshot status">{snapshotStatus}</StatusLine>
      </Panel>
      <Panel>
        <h3>Blobs in this block</h3>
        <table className="data" aria-label="Blobs in this block">
          <thead>
            <tr>
              <th>Blob</th>
              <th>Namespace</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {blobs.map((blob) => (
              <tr key={blob.id}>
                <td>
                  <a {...linkProps(`/w/${workspaceId}/blobs/${blob.id}`)} className="mono">
                    {truncateMiddle(blob.id)}
                  </a>
                </td>
                <td>{blob.namespaceName}</td>
                <td>{blob.statusText}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
      <Panel>
        <form aria-label="Prove namespace" onSubmit={prove}>
          <Field label="Namespace to prove" htmlFor="prove-namespace">
            <input
              id="prove-namespace"
              className="mono"
              value={proofNamespace}
              onChange={(event) => setProofNamespace(event.target.value)}
            />
          </Field>
          <button className="pill primary" type="submit">
            Prove namespace
          </button>
        </form>
      </Panel>
      {proofs && (
        <Panel>
          <section aria-label="Namespace proof">
            {proofs.map((proof, rowIndex) => (
              <div key={rowIndex}>
                {proof.kind === "inclusion" && (
                  <p>
                    Row {proof.row}: inclusion, columns {proof.start} to {(proof.end ?? 1) - 1}, {proof.nodes?.length ?? 0} proof nodes
                  </p>
                )}
                {proof.kind === "absence" && <p>Row {proof.row}: absence, next leaf at column {proof.nextLeaf?.col}</p>}
                {proof.kind === "outside" && <p>Row {proof.row}: outside this row's namespace range</p>}
                {proof.kind !== "outside" && (
                  <>
                    <ul aria-label={`Row ${proof.row} proof nodes`} style={{ listStyle: "none", padding: 0 }}>
                      {(proof.nodes ?? []).map((node, index) => (
                        <li key={index} className="mono" data-min={node.min} data-max={node.max} data-hash={node.hash}>
                          {node.hash}
                        </li>
                      ))}
                    </ul>
                    {proof.kind === "absence" && proof.nextLeaf && (
                      <p className="mono">Next leaf hash {proof.nextLeaf.hash}</p>
                    )}
                    <button
                      type="button"
                      className="pill"
                      onClick={() => {
                        const verified = verifyRowProof({
                          proof: proof as never,
                          spans: (proof.nodes ?? []).map((node) => node.span),
                          width: 2 * k,
                        });
                        const matches = verified !== null && verified.hash === rootHashOf(block, proof.row);
                        setVerdicts((previous) => ({
                          ...previous,
                          [proof.row]: matches
                            ? `Verified against row ${proof.row} root.`
                            : `Proof does not match row ${proof.row} root.`,
                        }));
                      }}
                    >
                      Verify row {proof.row}
                    </button>
                    {verdicts[proof.row] && <p>{verdicts[proof.row]}</p>}
                  </>
                )}
              </div>
            ))}
          </section>
        </Panel>
      )}
      {fraud && (
        <Panel>
          <section aria-label="Bad encoding fraud proof">
            <p>
              {fraud.axis === "row" ? "Row" : "Column"} {fraud.index} of block {height}
            </p>
            <p>
              {fraud.shares.length} of {k} shares verified against {fraud.axis === "row" ? "column" : "row"} roots
            </p>
            <p className="mono">
              Committed {fraud.axis === "row" ? "row" : "column"} root {fraud.committedRoot.hash}
            </p>
            <p className="mono">
              Recomputed {fraud.axis === "row" ? "row" : "column"} root {fraud.recomputedRoot.hash}
            </p>
            <p>
              {fraud.axis === "row" ? "Row" : "Column"} {fraud.index} is not encoded correctly. Block {height} rejected.
            </p>
          </section>
        </Panel>
      )}
      {sharePanel && <SharePanel cell={sharePanel} onClose={() => setSharePanel(null)} />}
      <div className="walk-section" ref={walkRef} style={{ marginTop: 40 }}>
        <div className="walk-pin">
          <h2>Square walk</h2>
          <p>Follow the square from layout to commitment.</p>
          <div className="walk-cards">
            {(["Lay out", "Extend", "Commit"] as const).map((stage, index) => (
              <article
                key={stage}
                className="walk-card"
                data-state={reducedMotion ? "shown" : walkStates[index]}
                aria-current={activeWalk === index ? "step" : undefined}
                tabIndex={0}
                onMouseEnter={() => setActiveWalk(index)}
                onFocus={() => setActiveWalk(index)}
              >
                <h3>{stage}</h3>
                {stage === "Lay out" && (
                  <>
                    <p>
                      {k} × {k} original shares hold the block's blob data, ordered by namespace.
                    </p>
                    <div data-cells={k * k} aria-hidden="true" style={{ display: "grid", gridTemplateColumns: `repeat(${k}, 1fr)`, gap: 3, marginTop: 12 }}>
                      {Array.from({ length: k * k }, (_, index) => (
                        <span key={index} style={{ height: 14, background: "rgba(157,123,255,0.35)", borderRadius: 2 }} />
                      ))}
                    </div>
                  </>
                )}
                {stage === "Extend" && (
                  <>
                    <p>Reed-Solomon parity doubles the square to {width} × {width}.</p>
                    <div data-cells={width * width} aria-hidden="true" style={{ display: "grid", gridTemplateColumns: `repeat(${width}, 1fr)`, gap: 2, marginTop: 12 }}>
                      {Array.from({ length: width * width }, (_, index) => {
                        const row = Math.floor(index / width);
                        const col = index % width;
                        const original = row < k && col < k;
                        return (
                          <span key={index} style={{ height: 8, background: original ? "rgba(157,123,255,0.35)" : "rgba(111,127,184,0.3)", borderRadius: 2 }} />
                        );
                      })}
                    </div>
                  </>
                )}
                {stage === "Commit" && (
                  <>
                    <p>Row and column roots hash into one data root.</p>
                    <div data-ticks={4 * k} aria-hidden="true" style={{ display: "flex", gap: 3, marginTop: 12, flexWrap: "wrap" }}>
                      {Array.from({ length: 4 * k }, (_, index) => (
                        <span key={index} style={{ width: 6, height: 20, background: "rgba(211,194,255,0.6)", borderRadius: 2 }} />
                      ))}
                    </div>
                    <p className="mono" style={{ marginTop: 12, fontSize: 12 }}>
                      Data root {block.dataRoot}
                    </p>
                  </>
                )}
              </article>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function rootHashOf(block: BlockBody, row: number): string {
  return block.rowRoots[row]?.hash ?? "";
}

function TransactionPage({ workspaceId, txId }: { workspaceId: string; txId: string }): JSX.Element {
  const { bootstrap } = useApp();
  const [tx, setTx] = useState<TxBody | null>(null);
  useEffect(() => {
    void getJson<TxBody>(`/api/w/${workspaceId}/transactions/${txId}`).then(setTx).catch(() => setTx(null));
  }, [workspaceId, txId]);
  if (!tx) return <Loading />;
  return (
    <Panel>
      <h3>Transaction</h3>
      <dl style={{ display: "grid", gridTemplateColumns: "max-content 1fr", gap: "6px 18px" }}>
        <dt>Kind</dt>
        <dd>{tx.kind}</dd>
        <dt>Sender</dt>
        <dd>{tx.senderName}</dd>
        <dt>Status</dt>
        <dd>{tx.statusText}</dd>
        <dt>Fee</dt>
        <dd>{formatFernWithUnit(tx.feeUfern)}</dd>
        <dt>Gas</dt>
        <dd>{tx.gas.toLocaleString("en-US")}</dd>
        <dt>Height</dt>
        <dd>{tx.height ?? "—"}</dd>
        <dt>Time</dt>
        <dd>{displayDateTime(tx.submittedAt, bootstrap.timeZone)}</dd>
      </dl>
      <p style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <span className="mono">{truncateMiddle(tx.id)}</span> <CopyPill value={tx.id} />
      </p>
    </Panel>
  );
}

function BlobPage({ workspaceId, blobId }: { workspaceId: string; blobId: string }): JSX.Element {
  const { bootstrap } = useApp();
  const { version } = useLive();
  const reducedMotion = useReducedMotion();
  const [blob, setBlob] = useState<BlobBody | null>(null);
  const [shares, setShares] = useState<ShareBody[][] | null>(null);
  const [focus, setFocus] = useState<{ row: number; col: number } | null>(null);
  const [sharePanel, setSharePanel] = useState<CellMeta | null>(null);

  useEffect(() => {
    void getJson<BlobBody>(`/api/w/${workspaceId}/blobs/${blobId}`).then(setBlob);
  }, [workspaceId, blobId, version]);

  useEffect(() => {
    if (!blob?.height) return;
    void getJson<{ rows: ShareBody[][]; k: number }>(`/api/w/${workspaceId}/blocks/${blob.height}/shares`).then((body) => {
      setShares(body.rows);
    });
  }, [workspaceId, blob?.height, version]);

  if (!blob) return <Loading />;
  const k = blob.height ? Math.sqrt(shares?.length ?? 0) / 2 : 1;
  const width = Math.round(Math.sqrt(shares?.length ?? 4));
  const revealed = useRowReveal(blob.height ?? 0, width, bootstrap.squareRowRevealMs, reducedMotion);
  const minePositions = new Set(blob.positions.map(([row, col]) => `${row},${col}`));
  const cells = (shares ?? []).flat().map((share) => ({
    row: share.row,
    col: share.col,
    quadrant: share.quadrant,
    namespace: share.namespace,
    kind: share.kind,
    share: share.share,
    mine: minePositions.has(`${share.row},${share.col}`),
    label:
      share.kind === "padding"
        ? "Padding"
        : share.kind === "parity"
          ? "Parity"
          : share.kind === "withheld"
            ? "Withheld"
            : blob.namespaceName,
  }));

  return (
    <div className="split">
      <Panel>
        <h3>
          Blob {blob.id.slice(0, 8)}
        </h3>
        <dl aria-label="Blob facts" style={{ display: "grid", gridTemplateColumns: "max-content 1fr", gap: "6px 18px" }}>
          <dt>Status</dt>
          <dd>{blob.statusText}</dd>
          <dt>Namespace</dt>
          <dd>
            {blob.namespaceName} <span className="mono">{blob.namespace}</span>
          </dd>
          <dt>Size</dt>
          <dd>{blob.size.toLocaleString("en-US")} bytes</dd>
          <dt>Shares</dt>
          <dd>{blob.shares}</dd>
          <dt>Fee</dt>
          <dd>{formatFernWithUnit(blob.feeUfern)}</dd>
          {blob.height !== null && (
            <>
              <dt>Block</dt>
              <dd>
                <a {...linkProps(`/w/${workspaceId}/explorer/blocks/${blob.height}`)}>Block {blob.height}</a>
              </dd>
            </>
          )}
        </dl>
        <h4>Share positions</h4>
        <ul aria-label="Share positions" style={{ listStyle: "none", padding: 0 }}>
          {blob.positions.map(([row, col], index) => (
            <li key={index} className="mono">
              ({row}, {col})
            </li>
          ))}
        </ul>
      </Panel>
      <div>
        {shares && (
          <SquareGrid
            height={blob.height ?? 0}
            k={Math.floor(width / 2) || k as number}
            cells={cells}
            focus={focus}
            onFocusChange={setFocus}
            onOpenShare={setSharePanel}
            revealedRows={revealed}
            revealMs={bootstrap.squareRowRevealMs}
            reducedMotion={reducedMotion}
          />
        )}
      </div>
      {sharePanel && <SharePanel cell={sharePanel} onClose={() => setSharePanel(null)} />}
    </div>
  );
}

function Nodes({ workspaceId }: { workspaceId: string; role: string }): JSX.Element {
  const [nodes, setNodes] = useState<NodeBody[] | null>(null);
  useEffect(() => {
    void getJson<NodeBody[]>(`/api/w/${workspaceId}/light-nodes`).then(setNodes);
  }, [workspaceId]);
  if (!nodes) return <Loading />;
  return (
    <Panel>
      <h3>Light nodes</h3>
      <ul style={{ listStyle: "none", padding: 0 }}>
        {nodes.map((node) => (
          <li key={node.id} style={{ marginBottom: 12 }}>
            <a className="pill" {...linkProps(`/w/${workspaceId}/nodes/${node.id}`)}>
              Open {node.name}
            </a>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function NodePage({ workspaceId, nodeId, role }: { workspaceId: string; nodeId: string; role: string }): JSX.Element {
  const { version } = useLive();
  const [node, setNode] = useState<NodeBody | null>(null);
  const [height, setHeight] = useState<string>("");
  const [samples, setSamples] = useState<{ index: number; row: number; col: number; served: boolean; confidence: string }[]>([]);
  const [confidence, setConfidence] = useState("0.0000");
  const [status, setStatus] = useState("");
  const [latestHeight, setLatestHeight] = useState(0);

  useEffect(() => {
    void getJson<NodeBody>(`/api/w/${workspaceId}/light-nodes/${nodeId}`).then(setNode);
    void getJson<BlockSummary[]>(`/api/w/${workspaceId}/blocks`).then((blocks) => {
      setLatestHeight(blocks[0]?.height ?? 0);
      setHeight(String(blocks[0]?.height ?? 0));
    });
  }, [workspaceId, nodeId]);

  useEffect(() => {
    if (!height) return;
    void getJson<{
      samples: { index: number; row: number; col: number; served: boolean; confidence: string }[];
      confidence: string;
      verdict: string;
    }>(`/api/w/${workspaceId}/light-nodes/${nodeId}/samples?height=${height}`).then((body) => {
      setSamples(body.samples);
      setConfidence(body.confidence);
    });
  }, [workspaceId, nodeId, height, version]);

  if (!node) return <Loading />;
  return (
    <Panel>
      <h3>{node.name}</h3>
      <form aria-label="Sampling controls" onSubmit={(event) => event.preventDefault()}>
        <Field label="Block" htmlFor="node-block">
          <select id="node-block" value={height} onChange={(event) => setHeight(event.target.value)}>
            {Array.from({ length: latestHeight }, (_, index) => index + 1).map((blockHeight) => (
              <option key={blockHeight} value={blockHeight}>
                Block {blockHeight}
              </option>
            ))}
          </select>
        </Field>
        <button
          type="button"
          className="pill primary"
          disabled={role === "viewer"}
          onClick={async () => {
            try {
              const body = await postJson<{ row: number; col: number; served: boolean; confidence: string }>(
                `/api/w/${workspaceId}/light-nodes/${nodeId}/samples`,
                { height: Number(height) },
              );
              const text = body.served
                ? `Sample ${samples.length + 1}: share (${body.row}, ${body.col}) available. Confidence ${Number(body.confidence).toFixed(4)}%.`
                : `Sample ${samples.length + 1}: share (${body.row}, ${body.col}) withheld. Block ${height} is unavailable.`;
              setStatus(text);
            } catch (caught) {
              setStatus(errorCopy(caught) ?? "Fernsquare can't reach the server. Your last action was not sent.");
            }
          }}
        >
          Take sample
        </button>
        <label style={{ display: "flex", gap: 8, alignItems: "center", marginLeft: 16 }}>
          <input
            type="checkbox"
            role="switch"
            aria-label="Auto-sample"
            checked={node.autoSample}
            disabled={role === "viewer"}
            onChange={async (event) => {
              const next = event.target.checked;
              setNode({ ...node, autoSample: next });
              await patchJson(`/api/w/${workspaceId}/light-nodes/${nodeId}`, { autoSample: next });
            }}
          />
          Auto-sample
        </label>
      </form>
      <p className="num" style={{ fontSize: 22 }}>
        Confidence {Number(confidence).toFixed(4)}%
      </p>
      <StatusLine name="Sampling updates">{status}</StatusLine>
      <table className="data" aria-label="Samples">
        <thead>
          <tr>
            <th>Index</th>
            <th>Share</th>
            <th>Served</th>
            <th>Confidence</th>
          </tr>
        </thead>
        <tbody>
          {samples.map((sample) => (
            <tr key={sample.index}>
              <td>{sample.index}</td>
              <td>
                ({sample.row}, {sample.col})
              </td>
              <td>{sample.served ? "Available" : "Withheld"}</td>
              <td>{sample.confidence}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}

function Stake({ workspaceId, role }: { workspaceId: string; role: string }): JSX.Element {
  const { version } = useLive();
  const [validators, setValidators] = useState<ValidatorBody[] | null>(null);
  const [me, setMe] = useState<StakingMe | null>(null);
  const [status, setStatus] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [delegateValidator, setDelegateValidator] = useState("");
  const [delegateAmount, setDelegateAmount] = useState("");
  const [undelegateValidator, setUndelegateValidator] = useState("");
  const [undelegateAmount, setUndelegateAmount] = useState("");
  const [redelegateFrom, setRedelegateFrom] = useState("");
  const [redelegateTo, setRedelegateTo] = useState("");
  const [redelegateAmount, setRedelegateAmount] = useState("");

  const load = async () => {
    setValidators(await getJson<ValidatorBody[]>(`/api/w/${workspaceId}/validators`));
    setMe(await getJson<StakingMe>(`/api/w/${workspaceId}/staking/me`));
  };
  useEffect(() => {
    void load();
  }, [workspaceId, version]);

  if (!validators || !me) return <Loading />;
  const run = async (path: string, body: unknown): Promise<void> => {
    setStatus("Working…");
    setErrors({});
    try {
      await postJson(path, body);
      setStatus("Transaction sent. It takes effect when the next block is produced.");
      await load();
    } catch (caught) {
      const fieldErrorsCaught = fieldErrors(caught);
      if (Object.keys(fieldErrorsCaught).length > 0) {
        setErrors(fieldErrorsCaught);
        setStatus("");
      } else {
        setStatus(errorCopy(caught) ?? "Fernsquare can't reach the server. Your last action was not sent.");
      }
    }
  };

  return (
    <div>
      <Panel>
        <p className="num" style={{ fontSize: 22 }}>
          Balance {formatFernWithUnit(me.balanceUfern)}
        </p>
        <p>Available {formatFernWithUnit(me.availableUfern)}</p>
      </Panel>
      <Panel>
        <h3>Validators</h3>
        <table className="data" aria-label="Validators">
          <thead>
            <tr>
              <th>Name</th>
              <th>Stake</th>
              <th>Commission</th>
              <th>Share of bonded</th>
            </tr>
          </thead>
          <tbody>
            {validators.map((validator) => (
              <tr key={validator.id}>
                <td>{validator.name}</td>
                <td>{formatFernUfern(validator.stakeUfern)}</td>
                <td>{percent((Number(validator.commission) * 100).toFixed(2))}</td>
                <td>{percent(validator.shareOfBonded)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
      <div className="split">
        <Panel>
          <form aria-label="Delegate" onSubmit={(event) => { event.preventDefault(); void run(`/api/w/${workspaceId}/staking/delegate`, { validator: delegateValidator, amount: delegateAmount }); }}>
            <h3>Delegate</h3>
            <p>Fee {formatFernUfern("8000")} FERN</p>
            <Field label="Validator" htmlFor="delegate-validator" error={errors.validator}>
              <select id="delegate-validator" value={delegateValidator} onChange={(event) => setDelegateValidator(event.target.value)}>
                <option value="">Choose a validator</option>
                {validators.map((validator) => (
                  <option key={validator.id} value={validator.id}>
                    {validator.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Amount (FERN)" htmlFor="delegate-amount" error={errors.amount}>
              <input id="delegate-amount" value={delegateAmount} onChange={(event) => setDelegateAmount(event.target.value)} />
            </Field>
            <button className="pill primary" type="submit" disabled={role === "viewer"}>
              Delegate
            </button>
          </form>
        </Panel>
        <Panel>
          <form aria-label="Undelegate" onSubmit={(event) => { event.preventDefault(); void run(`/api/w/${workspaceId}/staking/undelegate`, { validator: undelegateValidator, amount: undelegateAmount }); }}>
            <h3>Undelegate</h3>
            <Field label="Validator" htmlFor="undelegate-validator" error={errors.validator}>
              <select id="undelegate-validator" value={undelegateValidator} onChange={(event) => setUndelegateValidator(event.target.value)}>
                <option value="">Choose a validator</option>
                {validators.map((validator) => (
                  <option key={validator.id} value={validator.id}>
                    {validator.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Amount (FERN)" htmlFor="undelegate-amount" error={errors.amount}>
              <input id="undelegate-amount" value={undelegateAmount} onChange={(event) => setUndelegateAmount(event.target.value)} />
            </Field>
            <button className="pill primary" type="submit" disabled={role === "viewer"}>
              Undelegate
            </button>
          </form>
        </Panel>
      </div>
      <Panel>
        <form aria-label="Redelegate" onSubmit={(event) => { event.preventDefault(); void run(`/api/w/${workspaceId}/staking/redelegate`, { from: redelegateFrom, to: redelegateTo, amount: redelegateAmount }); }}>
          <h3>Redelegate</h3>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14 }}>
            <Field label="From validator" htmlFor="redelegate-from" error={errors.from}>
              <select id="redelegate-from" value={redelegateFrom} onChange={(event) => setRedelegateFrom(event.target.value)}>
                <option value="">Choose a validator</option>
                {validators.map((validator) => (
                  <option key={validator.id} value={validator.id}>
                    {validator.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="To validator" htmlFor="redelegate-to" error={errors.to}>
              <select id="redelegate-to" value={redelegateTo} onChange={(event) => setRedelegateTo(event.target.value)}>
                <option value="">Choose a validator</option>
                {validators.map((validator) => (
                  <option key={validator.id} value={validator.id}>
                    {validator.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Amount (FERN)" htmlFor="redelegate-amount" error={errors.amount}>
              <input id="redelegate-amount" value={redelegateAmount} onChange={(event) => setRedelegateAmount(event.target.value)} />
            </Field>
          </div>
          <button className="pill primary" type="submit" disabled={role === "viewer"}>
            Redelegate
          </button>
        </form>
      </Panel>
      <Panel>
        <button
          type="button"
          className="pill primary"
          disabled={role === "viewer"}
          onClick={() => void run(`/api/w/${workspaceId}/staking/claim`, {})}
        >
          Claim rewards
        </button>
        <StatusLine name="Stake status">{status}</StatusLine>
      </Panel>
      <Panel>
        <h3>Your delegations</h3>
        <table className="data" aria-label="Your delegations">
          <thead>
            <tr>
              <th>Validator</th>
              <th>Amount</th>
              <th>Pending rewards</th>
            </tr>
          </thead>
          <tbody>
            {me.delegations.map((delegation) => (
              <tr key={delegation.validator}>
                <td>{delegation.validatorName}</td>
                <td>{formatFernUfern(delegation.amountUfern)}</td>
                <td>{formatFernUfern(delegation.pendingRewardsUfern)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
      <Panel>
        <h3>Unbondings</h3>
        <table className="data" aria-label="Unbondings">
          <thead>
            <tr>
              <th>Validator</th>
              <th>Amount</th>
              <th>Completes</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {me.unbondings.map((unbonding) => (
              <tr key={unbonding.id}>
                <td>{unbonding.validatorName}</td>
                <td>{formatFernUfern(unbonding.amountUfern)}</td>
                <td>{displayDateTime(unbonding.completesAt, useApp().bootstrap.timeZone)}</td>
                <td>{unbonding.status === "released" ? "Released" : `Unbonding until ${displayTime(unbonding.completesAt, useApp().bootstrap.timeZone)}`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}

function Vote({ workspaceId, role }: { workspaceId: string; role: string }): JSX.Element {
  const { version } = useLive();
  const [proposals, setProposals] = useState<ProposalBody[] | null>(null);
  const [status, setStatus] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [deposit, setDeposit] = useState("");

  useEffect(() => {
    void getJson<ProposalBody[]>(`/api/w/${workspaceId}/proposals`).then(setProposals);
  }, [workspaceId, version]);

  if (!proposals) return <Loading />;
  return (
    <div>
      <Panel>
        <h3>Proposals</h3>
        <table className="data" aria-label="Proposals">
          <thead>
            <tr>
              <th>Number</th>
              <th>Title</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {proposals.map((proposal) => (
              <tr key={proposal.number}>
                <td>
                  <a {...linkProps(`/w/${workspaceId}/vote/${proposal.number}`)}>{proposal.number}</a>
                </td>
                <td>{proposal.title}</td>
                <td>{proposal.statusText}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
      <Panel>
        <form
          aria-label="New proposal"
          onSubmit={async (event) => {
            event.preventDefault();
            setStatus("Working…");
            setErrors({});
            try {
              await postJson(`/api/w/${workspaceId}/proposals`, {
                title,
                description,
                initialDeposit: deposit,
              });
              setStatus("Transaction sent. It takes effect when the next block is produced.");
              setTitle("");
              setDescription("");
              setDeposit("");
            } catch (caught) {
              const caughtErrors = fieldErrors(caught);
              setErrors(caughtErrors);
              setStatus("");
            }
          }}
        >
          <h3>New proposal</h3>
          <FormAlert message={errors.title ?? errors.description ?? errors.amount ?? null} />
          <Field label="Title" htmlFor="proposal-title" error={errors.title}>
            <input id="proposal-title" value={title} onChange={(event) => setTitle(event.target.value)} />
          </Field>
          <Field label="Description" htmlFor="proposal-description" error={errors.description}>
            <textarea id="proposal-description" rows={3} value={description} onChange={(event) => setDescription(event.target.value)} />
          </Field>
          <Field label="Initial deposit (FERN)" htmlFor="proposal-deposit" error={errors.amount}>
            <input id="proposal-deposit" value={deposit} onChange={(event) => setDeposit(event.target.value)} />
          </Field>
          <button className="pill primary" type="submit" disabled={role === "viewer"}>
            Submit proposal
          </button>
          <StatusLine name="Vote status">{status}</StatusLine>
        </form>
      </Panel>
    </div>
  );
}

function ProposalPage({ workspaceId, number, role }: { workspaceId: string; number: number; role: string }): JSX.Element {
  const { bootstrap } = useApp();
  const { version } = useLive();
  const [proposal, setProposal] = useState<ProposalBody | null>(null);
  const [option, setOption] = useState("");
  const [status, setStatus] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [depositAmount, setDepositAmount] = useState("");

  useEffect(() => {
    void getJson<ProposalBody>(`/api/w/${workspaceId}/proposals/${number}`).then((body) => {
      setProposal(body);
      setOption(body.myVote ?? "");
    });
  }, [workspaceId, number, version]);

  if (!proposal) return <Loading />;
  const voting = proposal.status === "voting";
  return (
    <div>
      <h2>
        Proposal {proposal.number}: {proposal.title}
      </h2>
      <p>{proposal.statusText}</p>
      <p>
        Deposit period ends {proposal.depositEndsAt ? displayDateTime(proposal.depositEndsAt, bootstrap.timeZone) : "—"}
      </p>
      <p>Voting ends {proposal.votingEndsAt ? displayDateTime(proposal.votingEndsAt, bootstrap.timeZone) : "—"}</p>
      <Panel>
        <section aria-label="Tally">
          <p className="num">
            Votes {formatFernUfern(proposal.tally.votesUfern)} of {formatFernUfern(proposal.tally.totalBondedUfern)} FERN (
            {percent(proposal.tally.turnout)})
          </p>
          <p>Yes {formatFernUfern(proposal.tally.yesUfern)} FERN</p>
          <p>No {formatFernUfern(proposal.tally.noUfern)} FERN</p>
          <p>
            No with veto {formatFernUfern(proposal.tally.noWithVetoUfern)} FERN ({percent(proposal.tally.vetoShare)})
          </p>
          <p>Abstain {formatFernUfern(proposal.tally.abstainUfern)} FERN</p>
          <p>Yes share {percent(proposal.tally.yesShare)}</p>
          <p>
            {voting ? "Projected result" : "Result"} {proposal.tally.result}
          </p>
        </section>
      </Panel>
      <Panel>
        <form
          aria-label="Cast vote"
          onSubmit={async (event) => {
            event.preventDefault();
            setStatus("Working…");
            setErrors({});
            try {
              await postJson(`/api/w/${workspaceId}/proposals/${number}/votes`, { option });
              setStatus("Transaction sent. It takes effect when the next block is produced.");
            } catch (caught) {
              const caughtErrors = fieldErrors(caught);
              setErrors(caughtErrors);
              setStatus("");
            }
          }}
        >
          <div role="radiogroup" aria-label="Your vote" style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            {[
              ["yes", "Yes"],
              ["no", "No"],
              ["no_with_veto", "No with veto"],
              ["abstain", "Abstain"],
            ].map(([value, label]) => (
              <label key={value} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <input type="radio" name="vote" value={value} checked={option === value} onChange={() => setOption(value!)} />
                {label}
              </label>
            ))}
          </div>
          <FormAlert message={errors.option ?? null} />
          <button className="pill primary" type="submit" disabled={role === "viewer"}>
            Cast vote
          </button>
          <StatusLine name="Vote status">{status}</StatusLine>
        </form>
      </Panel>
      {proposal.status === "deposit" && (
        <Panel>
          <form
            aria-label="Deposit"
            onSubmit={async (event) => {
              event.preventDefault();
              setStatus("Working…");
              setErrors({});
              try {
                await postJson(`/api/w/${workspaceId}/proposals/${number}/deposits`, { amount: depositAmount });
                setStatus("Transaction sent. It takes effect when the next block is produced.");
              } catch (caught) {
                const caughtErrors = fieldErrors(caught);
                setErrors(caughtErrors);
                setStatus("");
              }
            }}
          >
            <h3>Deposit</h3>
            <p>
              {formatFernUfern(proposal.depositUfern)} of {formatFernUfern(proposal.minDepositUfern)} FERN deposited
            </p>
            <Field label="Deposit (FERN)" htmlFor="deposit-amount" error={errors.amount}>
              <input id="deposit-amount" value={depositAmount} onChange={(event) => setDepositAmount(event.target.value)} />
            </Field>
            <button className="pill primary" type="submit" disabled={role === "viewer"}>
              Deposit
            </button>
          </form>
        </Panel>
      )}
    </div>
  );
}

function Ledger({ workspaceId }: { workspaceId: string }): JSX.Element {
  const { bootstrap, user } = useApp();
  const [entries, setEntries] = useState<
    { id: string; pairId: string; account: string; counterAccount: string; kind: string; label: string; amountUfern: string; height: number | null; at: string }[]
  | null>(null);
  const [balance, setBalance] = useState("0");

  useEffect(() => {
    const account = user ? `member:${user.id}` : null;
    void getJson<{
      balanceUfern: string;
      entries: { id: string; pairId: string; account: string; counterAccount: string; kind: string; label: string; amountUfern: string; height: number | null; at: string }[];
    }>(`/api/w/${workspaceId}/ledger${account ? `?account=${account}` : ""}`).then((body) => {
      setEntries(body.entries);
      setBalance(body.balanceUfern);
    });
  }, [workspaceId, user?.id]);

  if (!entries) return <Loading />;
  return (
    <div>
      <Panel>
        <p className="num" style={{ fontSize: 22 }}>
          Balance {formatFernWithUnit(balance)}
        </p>
      </Panel>
      <Panel>
        <h3>Ledger</h3>
        <table className="data" aria-label="Ledger">
          <thead>
            <tr>
              <th>Time</th>
              <th>Height</th>
              <th>Entry</th>
              <th>Amount</th>
              <th>Balance after</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.id}>
                <td>{displayTime(entry.at, bootstrap.timeZone)}</td>
                <td>{entry.height ?? "—"}</td>
                <td>{entry.label}</td>
                <td className="num">{formatFernUfern(entry.amountUfern)}</td>
                <td className="num">—</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}

function Members({ workspaceId, role }: { workspaceId: string; role: string }): JSX.Element {
  const [members, setMembers] = useState<{ id: string; name: string; email: string; role: string }[] | null>(null);
  const [email, setEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("developer");
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void getJson<{ id: string; name: string; email: string; role: string }[]>(`/api/w/${workspaceId}/members`).then(setMembers);
  }, [workspaceId]);

  if (!members) return <Loading />;
  return (
    <div>
      <Panel>
        <h3>Members</h3>
        <table className="data" aria-label="Members">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
            </tr>
          </thead>
          <tbody>
            {members.map((member) => (
              <tr key={member.id}>
                <td>{member.name}</td>
                <td>{member.email}</td>
                <td>{member.role}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
      <Panel>
        <form
          aria-label="Invite member"
          onSubmit={async (event) => {
            event.preventDefault();
            setStatus("Working…");
            setError(null);
            try {
              await postJson(`/api/w/${workspaceId}/invites`, { email, role: inviteRole });
              setStatus(`Invite queued for ${email}.`);
              setEmail("");
            } catch (caught) {
              const caughtErrors = fieldErrors(caught);
              setError(caughtErrors.email ?? caughtErrors.role ?? errorCopy(caught));
              setStatus("");
            }
          }}
        >
          <h3>Invite member</h3>
          <FormAlert message={error} />
          <Field label="Email" htmlFor="invite-email">
            <input id="invite-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
          </Field>
          <div role="radiogroup" aria-label="Role" style={{ display: "flex", gap: 16 }}>
            <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input type="radio" name="invite-role" checked={inviteRole === "developer"} onChange={() => setInviteRole("developer")} />
              Developer
            </label>
            <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input type="radio" name="invite-role" checked={inviteRole === "viewer"} onChange={() => setInviteRole("viewer")} />
              Viewer
            </label>
          </div>
          <button className="pill primary" type="submit" disabled={role !== "owner"} aria-describedby="invite-role-description">
            Send invite
          </button>
          <span id="invite-role-description" hidden>
            {role === "viewer" ? "Viewers can't make changes in this workspace." : "Only the owner can manage members."}
          </span>
          <StatusLine name="Invite member status">{status}</StatusLine>
        </form>
      </Panel>
    </div>
  );
}

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(<Mount />);
}
