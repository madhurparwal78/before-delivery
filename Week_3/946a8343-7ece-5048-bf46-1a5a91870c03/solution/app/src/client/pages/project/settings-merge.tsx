// Settings card: merge settings (merge method, the five switches and the default branch).
import { useState } from "preact/hooks";
import { announce } from "../../announce.tsx";
import { api, useAction } from "../../api.ts";
import { Button } from "../../ui/button.tsx";
import { Card } from "../../ui/card.tsx";
import { Checkbox, Select, TextField, type SelectOption } from "../../ui/fields.tsx";
import type { CardProps } from "./settings-protection.tsx";
import type { SettingsData } from "./types.ts";
import { FeedbackView, feedbackOf } from "./write.tsx";

const METHODS: readonly SelectOption[] = [
  { value: "merge_commit", label: "Merge commit" },
  { value: "squash", label: "Squash" },
  { value: "fast_forward", label: "Fast-forward" },
  { value: "rebase", label: "Rebase" },
];

type Switch = "merge_trains" | "pipelines_must_succeed" | "reset_approvals_on_push" | "author_can_approve" | "auto_resolve_outdated";

const SWITCHES: ReadonlyArray<{ key: Switch; label: string; description: string }> = [
  { key: "merge_trains", label: "Use merge trains", description: "Requests queue as cars on the target branch and merge after their test pipeline passes." },
  { key: "pipelines_must_succeed", label: "Pipelines must succeed", description: "A request can merge only when its head pipeline has passed." },
  { key: "reset_approvals_on_push", label: "Reset approvals on push", description: "A push to the source branch removes the approvals given so far." },
  { key: "author_can_approve", label: "Authors can approve their own requests", description: "Off by default: an author never counts toward a rule." },
  { key: "auto_resolve_outdated", label: "Resolve outdated threads", description: "A thread whose line changed in a new version resolves itself." },
];

function DefaultBranchForm({ projectId, data, reload }: { projectId: string; data: SettingsData; reload: () => Promise<void> }) {
  const [branch, setBranch] = useState(data.default_branch);
  const save = useAction(async () => {
    await api.patch(`/api/projects/${projectId}/settings`, { default_branch: branch.trim() });
    announce(`Default branch is now ${branch.trim()}.`);
    await reload();
  });
  const feedback = feedbackOf(save.error, "merge", ["default_branch"]);
  return (
    <form
      class="sp-rule-form"
      onSubmit={(event) => {
        event.preventDefault();
        void save.run();
      }}
    >
      <FeedbackView feedback={feedback} signal={save.error} />
      <TextField label="Default branch" name="merge-default_branch" value={branch} error={feedback.byField["default_branch"]} onInput={(event) => setBranch(event.currentTarget.value)} />
      <Button type="submit" pending={save.pending}>
        Save default branch
      </Button>
    </form>
  );
}

export function MergeCard({ projectId, data, editable, reload }: CardProps) {
  const change = useAction(async (patch: Record<string, string | boolean>) => {
    await api.patch(`/api/projects/${projectId}/settings`, patch);
    announce("Merge settings saved.");
    await reload();
  });
  const feedback = feedbackOf(change.error, "merge", ["merge_method", ...SWITCHES.map((item) => item.key)]);
  return (
    <Card
      kicker="MERGE"
      title="Merge settings"
      explanation="How requests land on their target branch and which checks they must pass first."
    >
      <FeedbackView feedback={feedback} signal={change.error} />
      <Select
        label="Merge method"
        name="merge-merge_method"
        value={data.merge_method}
        options={METHODS}
        disabled={!editable || change.pending}
        error={feedback.byField["merge_method"]}
        onChange={(event) => void change.run({ merge_method: event.currentTarget.value })}
      />
      {SWITCHES.map((item) => (
        <Checkbox
          key={item.key}
          label={item.label}
          name={`merge-${item.key}`}
          description={item.description}
          checked={data[item.key]}
          disabled={!editable || change.pending}
          error={feedback.byField[item.key]}
          onChange={(event) => void change.run({ [item.key]: event.currentTarget.checked })}
        />
      ))}
      {editable ? <DefaultBranchForm key={data.default_branch} projectId={projectId} data={data} reload={reload} /> : null}
    </Card>
  );
}
