import { WorkspaceFooter, WorkspaceHeader } from '../ui/Chrome';

export function Missing() {
  return (
    <>
      <WorkspaceHeader />
      <main className="missing panel">
        <h1>Not found.</h1>
        <p className="muted">There is nothing at this address.</p>
      </main>
      <WorkspaceFooter />
    </>
  );
}
