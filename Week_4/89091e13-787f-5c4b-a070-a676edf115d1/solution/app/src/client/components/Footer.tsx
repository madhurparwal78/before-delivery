import { Link } from "../lib/router.tsx";
import { StrandCanvas } from "./StrandCanvas.tsx";

export function Footer({ workspaceId, seed }: { workspaceId: string; seed: number }) {
  const base = `/w/${workspaceId}`;
  return (
    <footer className="footer">
      <StrandCanvas seed={seed} variant="wave" className="footer__wave" />
      <div className="container footer__inner">
        <p className="footer__statement">Run the network. Break it on purpose. Learn what every root proves.</p>
        <nav aria-label="Footer" className="footer__columns">
          <ul>
            <li><Link to={`${base}/explorer`}>Explorer</Link></li>
            <li><Link to={`${base}/nodes`}>Nodes</Link></li>
            <li><Link to={`${base}/ledger`}>Ledger</Link></li>
          </ul>
          <ul>
            <li><Link to={`${base}/stake`}>Stake</Link></li>
            <li><Link to={`${base}/vote`}>Vote</Link></li>
            <li><Link to={`${base}/members`}>Members</Link></li>
          </ul>
        </nav>
        <p className="footer__legal">© 2026 Orrin Fieldworks · FERN is a valueless test token and exists only inside this sandbox.</p>
      </div>
    </footer>
  );
}
