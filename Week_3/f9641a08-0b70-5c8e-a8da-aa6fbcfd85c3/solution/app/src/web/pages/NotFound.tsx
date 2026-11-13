import { Panel } from "../components/Panel";

export function NotFound() {
  return (
    <div className="page">
      <Panel tone="red" heading>
        We couldn't find that page.
      </Panel>
    </div>
  );
}
