import { useLoaderData } from "react-router";
import { queueHref } from "../../src/queue-query.mjs";
import { Page } from "../page.jsx";
import { Queue, loadQueue } from "../queue.jsx";

const SCREEN = "Regularisation requests";

export async function loader({ request, context }) {
  return { queue: await loadQueue(request, context, SCREEN) };
}

export default function QueueScreen() {
  const { queue } = useLoaderData();
  return (
    <Page title={SCREEN} crumb={SCREEN} deskHref={queueHref("/requests", queue.values)} layout="idle">
      <Queue queue={queue} path="/requests" headingLevel={1} canRaise={queue.role !== "admin" && "primary"} />
      <div className="pane-idle" />
    </Page>
  );
}
