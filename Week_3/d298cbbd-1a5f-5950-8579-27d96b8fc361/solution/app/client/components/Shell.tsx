import type { ComponentChildren, JSX } from "preact";
import { exchange } from "../api";
import { Link, navigate, useLocation } from "../router";
import { useStore } from "../store";
import { viewer } from "../viewer";

const FOLDERS = [
  { label: "Test", href: "/" },
  { label: "History", href: "/history" },
  { label: "Boards", href: "/boards" },
  { label: "Race rooms", href: "/race" },
  { label: "Settings", href: "/settings" },
] as const;

/** Fill of the folder at each depth, front to back: darker sand, sand, muted blue, darker sand, sand. */
const FILLS = ["surface", "ground", "muted", "surface", "ground", "muted"] as const;

function openFolderIndex(path: string): number {
  const index = FOLDERS.findIndex((folder, i) => (i === 0 ? path === "/" : path === folder.href || path.startsWith(`${folder.href}/`)));
  return index;
}

/** How far back a folder sits: the open one is in front, the others follow in order behind it. */
function depthOf(index: number, open: number): number {
  if (index === open) return 0;
  return open >= 0 && index > open ? index : index + 1;
}

function TopRow(): JSX.Element {
  const { me } = useStore(viewer.state);
  async function signOut(): Promise<void> {
    await exchange("DELETE", "/api/session");
    viewer.signedOut();
    navigate("/");
  }
  return (
    <header class="top-row">
      <p class="wordmark">STRIKEPROOF</p>
      <div class="account-links">
        {me ? (
          <>
            <Link href="/account" class="account-link">Account</Link>
            <button type="button" class="plain-button" onClick={() => void signOut()}>Sign out</button>
          </>
        ) : (
          <Link href="/signin" class="account-link">Sign in</Link>
        )}
      </div>
    </header>
  );
}

function Folders({ open }: { open: number }): JSX.Element {
  return (
    <>
      <div class="bands" aria-hidden="true">
        {FOLDERS.map((folder, index) => (
          <div class={`band fill-${FILLS[depthOf(index, open)]}`} style={{ "--depth": depthOf(index, open) }} key={folder.href} />
        ))}
      </div>
      <nav class="tabs" aria-label="Folders">
        {FOLDERS.map((folder, index) => (
          <Link href={folder.href} class={`tab fill-${FILLS[depthOf(index, open)]}`} current={index === open} vars={{ "--depth": depthOf(index, open), "--index": index }} key={folder.href}>
            <span class="tab-shape">{folder.label}</span>
          </Link>
        ))}
      </nav>
    </>
  );
}

export function Shell({ children, hero }: { children: ComponentChildren; hero?: ComponentChildren }): JSX.Element {
  const { path } = useLocation();
  const open = openFolderIndex(path);
  return (
    <>
      <div class="page" data-hero={hero ? "true" : "false"}>
        <div class="drawer">
          <TopRow />
          {hero}
          <div class="stack">
            <Folders open={open} />
            <main class="folder" id="main">
              {children}
            </main>
          </div>
        </div>
      </div>
      <footer class="back-of-drawer">
        <p>Strikeproof is made by Holloway Carriage Co.</p>
      </footer>
    </>
  );
}
