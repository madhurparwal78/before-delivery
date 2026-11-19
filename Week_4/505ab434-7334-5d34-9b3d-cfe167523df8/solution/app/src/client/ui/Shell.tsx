import { useState, type ReactNode } from "react";
import { mainNavigation } from "../../shared/routes.ts";
import { Link, navigate } from "../lib/router.tsx";
import { useSession } from "../lib/session.tsx";
import { Button } from "./Button.tsx";
import { FrameGrid } from "./FrameGrid.tsx";
import { QuenbyMark } from "./Glyphs.tsx";
import { PageStatus } from "./Status.tsx";

function TopBar(): ReactNode {
  const { me, signOut } = useSession();
  const [pending, setPending] = useState(false);
  const role = me!.principal.role;
  return (
    <header className="topbar" data-frame>
      <Link to="/library" className="topbar-mark">
        <QuenbyMark size={34} />
      </Link>
      <nav aria-label="Main" className="topbar-nav">
        {mainNavigation(role).map((link) => (
          <Link key={link.href} to={link.href}>
            {link.label}
          </Link>
        ))}
      </nav>
      <span className="topbar-who">{me!.principal.displayName}</span>
      <Button
        pending={pending && "save"}
        onClick={() => {
          setPending(true);
          void signOut().then(() => navigate("/signin"));
        }}
      >
        Sign out
      </Button>
    </header>
  );
}

function PublicBar(): ReactNode {
  return (
    <header className="topbar" data-frame>
      <Link to="/" className="topbar-mark">
        <QuenbyMark size={34} />
      </Link>
      <nav aria-label="Public" className="topbar-nav">
        <Link to="/">Chapters</Link>
        <Link to="/rules">Rule index</Link>
        <Link to="/signin">Sign in</Link>
      </nav>
    </header>
  );
}

/** Chrome of every screen except the home stage: frame grid, top bar, page status, main landmark. */
export function Shell({ children, wide = false }: { children: ReactNode; wide?: boolean }): ReactNode {
  const { me } = useSession();
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  return (
    <div className="shell" ref={setRoot}>
      <FrameGrid watch={root} />
      {me ? <TopBar /> : <PublicBar />}
      {me ? <PageStatus /> : null}
      <main id="main" className={wide ? "page page-wide" : "page"}>
        {children}
      </main>
    </div>
  );
}
