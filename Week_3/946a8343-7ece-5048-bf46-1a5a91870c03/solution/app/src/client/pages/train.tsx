import { useProject } from "../role.ts";
import { useRoute } from "../router.ts";
import { Kicker, Page } from "../ui/index.ts";
import { TrainList } from "./train/train-list.tsx";

export default function TrainPage() {
  const { params, query } = useRoute();
  const project = useProject();
  const target = query.get("target") ?? (project.id === params.id ? project.defaultBranch : null);
  return (
    <Page title="Merge train" project={params.id} live pageKeys={target === null ? [] : [`train:${target}`]}>
      {target === null ? null : (
        <>
          <p>
            <Kicker>{target}</Kicker>
          </p>
          <TrainList project={Number(params.id)} target={target} variant="page" />
        </>
      )}
    </Page>
  );
}
