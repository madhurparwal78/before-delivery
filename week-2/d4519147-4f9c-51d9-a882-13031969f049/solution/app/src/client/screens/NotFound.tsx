export function NotFound({ kind }: { kind: "diagram" | "page" }) {
  return (
    <main className="center-screen">
      <section className="card">
        <p className="eyebrow">Scopewright</p>
        <h1>{kind === "diagram" ? "Diagram not found" : "Page not found"}</h1>
        <p>{kind === "diagram" ? "We couldn't find that diagram. It may have been deleted, or you may not have access to it." : "We couldn't find that page."}</p>
        <p><a className="link" href="/">Go to your diagrams</a></p>
      </section>
    </main>
  );
}
