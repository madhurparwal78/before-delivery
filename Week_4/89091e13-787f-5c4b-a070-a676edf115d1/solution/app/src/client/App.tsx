import { useEffect, type ReactNode } from "react";
import { Shell } from "./components/Shell.tsx";
import { Boot } from "./components/StrandCanvas.tsx";
import { navigate, usePath } from "./lib/router.tsx";
import { useSession } from "./lib/session.tsx";
import { WorkspaceProvider } from "./lib/workspace.tsx";
import { BlobPage } from "./pages/Blob.tsx";
import { BlockPage } from "./pages/Block.tsx";
import { ExplorerPage } from "./pages/Explorer.tsx";
import { InvitePage } from "./pages/Invite.tsx";
import { LedgerPage } from "./pages/Ledger.tsx";
import { MembersPage } from "./pages/Members.tsx";
import { NodePage } from "./pages/Node.tsx";
import { NodesPage } from "./pages/Nodes.tsx";
import { NotFoundContent, NotFoundScreen } from "./pages/NotFound.tsx";
import { ProposalPage } from "./pages/Proposal.tsx";
import { HomeRedirect, SignInPage } from "./pages/SignIn.tsx";
import { StakePage } from "./pages/Stake.tsx";
import { SubmitPage } from "./pages/Submit.tsx";
import { TransactionPage } from "./pages/Transaction.tsx";
import { VotePage } from "./pages/Vote.tsx";

const WHOLE_NUMBER = /^\d+$/;

function workspacePage(workspaceId: string, rest: string[]): ReactNode {
  const [section, second, third] = rest;
  const param = second ?? "";
  if (section === "explorer" && rest.length === 1) return <ExplorerPage />;
  if (section === "explorer" && second === "blocks" && third && WHOLE_NUMBER.test(third) && rest.length === 3) {
    return <BlockPage key={third} height={Number(third)} />;
  }
  if (section === "explorer" && second === "tx" && third && rest.length === 3) return <TransactionPage key={third} txId={third} />;
  if (section === "blobs" && second && rest.length === 2) return <BlobPage key={param} blobId={param} />;
  if (section === "submit" && rest.length === 1) return <SubmitPage />;
  if (section === "nodes" && rest.length === 1) return <NodesPage />;
  if (section === "nodes" && second && rest.length === 2) return <NodePage key={param} nodeId={param} />;
  if (section === "stake" && rest.length === 1) return <StakePage />;
  if (section === "vote" && rest.length === 1) return <VotePage />;
  if (section === "vote" && second && WHOLE_NUMBER.test(second) && rest.length === 2) return <ProposalPage key={param} number={param} />;
  if (section === "ledger" && rest.length === 1) return <LedgerPage />;
  if (section === "members" && rest.length === 1) return <MembersPage />;
  return <NotFoundContent key={workspaceId} />;
}

function WorkspaceRoute({ workspaceId, rest }: { workspaceId: string; rest: string[] }) {
  const { status } = useSession();
  useEffect(() => {
    if (status === "out") navigate("/signin", true);
    if (status === "in" && rest.length === 0) navigate(`/w/${workspaceId}/explorer`, true);
  }, [status, rest.length, workspaceId]);

  if (status !== "in") return <Boot />;
  return (
    <WorkspaceProvider id={workspaceId} notFound={<NotFoundScreen />}>
      <Shell>{workspacePage(workspaceId, rest)}</Shell>
    </WorkspaceProvider>
  );
}

export function App() {
  const segments = usePath().split("/").filter(Boolean);
  const [first, second, ...rest] = segments;
  if (segments.length === 0) return <HomeRedirect />;
  if (first === "signin" && segments.length === 1) return <SignInPage />;
  if (first === "invites" && second && segments.length === 2) return <InvitePage key={second} token={second} />;
  if (first === "w" && second) return <WorkspaceRoute workspaceId={second} rest={rest} />;
  return <NotFoundScreen />;
}
