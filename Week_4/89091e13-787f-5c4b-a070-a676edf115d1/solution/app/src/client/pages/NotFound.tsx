import { LinkPill } from "../components/Pill.tsx";
import { PublicTopBar } from "../components/TopBar.tsx";

export function NotFoundContent() {
  return (
    <section className="container narrow page-body">
      <h1 className="page-title">Not found</h1>
      <LinkPill to="/" variant="outline">Back to the explorer</LinkPill>
    </section>
  );
}

export function NotFoundScreen() {
  return (
    <>
      <PublicTopBar />
      <main className="page">
        <NotFoundContent />
      </main>
    </>
  );
}
