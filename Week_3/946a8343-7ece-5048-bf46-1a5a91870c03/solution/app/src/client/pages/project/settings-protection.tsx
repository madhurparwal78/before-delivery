// Settings cards: protected branches, protected tags and protected environments (name or pattern -> minimum roles).
import { useState } from "preact/hooks";
import { announce } from "../../announce.tsx";
import { api, useAction } from "../../api.ts";
import { Button } from "../../ui/button.tsx";
import { Card } from "../../ui/card.tsx";
import { Select, TextField } from "../../ui/fields.tsx";
import type { BranchRule, ProtectedEnvironment, SettingsData, TagRule } from "./types.ts";
import { blankField, FeedbackView, feedbackOf, ROLE_OPTIONS } from "./write.tsx";

export interface CardProps {
  projectId: string;
  data: SettingsData;
  editable: boolean;
  reload: () => Promise<void>;
}

function BranchRow({ projectId, rule, editable, reload }: { projectId: string; rule: BranchRule; editable: boolean; reload: () => Promise<void> }) {
  const base = `/api/projects/${projectId}/protected_branches/${encodeURIComponent(rule.name)}`;
  const change = useAction(async (next: { allowed_to_push: string; allowed_to_merge: string }) => {
    await api.put(base, next);
    announce(`Protected branch ${rule.name} saved.`);
    await reload();
  });
  const remove = useAction(async () => {
    await api.del(base);
    announce(`Protected branch ${rule.name} removed.`);
    await reload();
  });
  const feedback = feedbackOf(change.error ?? remove.error, `branch-${rule.name}`, ["allowed_to_push", "allowed_to_merge"]);
  return (
    <li class="sp-rule-row">
      <span class="sp-rule-row__name sp-mono">{rule.name}</span>
      {editable ? (
        <div class="sp-rule-row__controls">
          <Select
            label={`Allowed to push to ${rule.name}`}
            hideLabel
            name={`branch-${rule.name}-push`}
            value={rule.allowed_to_push}
            options={ROLE_OPTIONS}
            disabled={change.pending}
            onChange={(event) => void change.run({ allowed_to_push: event.currentTarget.value, allowed_to_merge: rule.allowed_to_merge })}
          />
          <Select
            label={`Allowed to merge into ${rule.name}`}
            hideLabel
            name={`branch-${rule.name}-merge`}
            value={rule.allowed_to_merge}
            options={ROLE_OPTIONS}
            disabled={change.pending}
            onChange={(event) => void change.run({ allowed_to_push: rule.allowed_to_push, allowed_to_merge: event.currentTarget.value })}
          />
          <Button variant="secondary" pending={remove.pending} aria-label={`Remove protection from ${rule.name}`} onClick={() => void remove.run()}>
            Remove
          </Button>
        </div>
      ) : (
        <span class="sp-rule-row__summary">
          Push: {rule.allowed_to_push}. Merge: {rule.allowed_to_merge}.
        </span>
      )}
      <FeedbackView feedback={feedback} signal={change.error ?? remove.error} />
    </li>
  );
}

export function ProtectedBranchesCard({ projectId, data, editable, reload }: CardProps) {
  const [pattern, setPattern] = useState("");
  const [push, setPush] = useState("maintainer");
  const [merge, setMerge] = useState("developer");
  const add = useAction(async () => {
    if (pattern.trim() === "") throw blankField("pattern", "Pattern can't be blank.");
    await api.put(`/api/projects/${projectId}/protected_branches/${encodeURIComponent(pattern.trim())}`, { allowed_to_push: push, allowed_to_merge: merge });
    announce(`Protected branch ${pattern.trim()} saved.`);
    setPattern("");
    await reload();
  });
  const feedback = feedbackOf(add.error, "branch", ["pattern", "allowed_to_push", "allowed_to_merge"]);
  return (
    <Card
      kicker="BRANCHES"
      title="Protected branches"
      explanation="Choose who may push to and merge into a branch. A pattern with * covers every branch whose name matches."
    >
      {data.protected_branches.length === 0 ? <p class="sp-muted">No protected branches.</p> : null}
      <ul class="sp-rule-list">
        {data.protected_branches.map((rule) => (
          <BranchRow key={rule.name} projectId={projectId} rule={rule} editable={editable} reload={reload} />
        ))}
      </ul>
      {editable ? (
        <form
          class="sp-rule-form"
          onSubmit={(event) => {
            event.preventDefault();
            void add.run();
          }}
        >
          <FeedbackView feedback={feedback} signal={add.error} />
          <TextField label="Branch name or pattern" name="branch-pattern" value={pattern} error={feedback.byField["pattern"]} onInput={(event) => setPattern(event.currentTarget.value)} />
          <Select label="Allowed to push" name="branch-allowed_to_push" value={push} options={ROLE_OPTIONS} error={feedback.byField["allowed_to_push"]} onChange={(event) => setPush(event.currentTarget.value)} />
          <Select label="Allowed to merge" name="branch-allowed_to_merge" value={merge} options={ROLE_OPTIONS} error={feedback.byField["allowed_to_merge"]} onChange={(event) => setMerge(event.currentTarget.value)} />
          <Button type="submit" pending={add.pending}>
            Protect branch
          </Button>
        </form>
      ) : null}
    </Card>
  );
}

function TagRow({ projectId, rule, editable, reload }: { projectId: string; rule: TagRule; editable: boolean; reload: () => Promise<void> }) {
  const base = `/api/projects/${projectId}/protected_tags/${encodeURIComponent(rule.name)}`;
  const change = useAction(async (allowed: string) => {
    await api.put(base, { allowed_to_create: allowed });
    announce(`Protected tag ${rule.name} saved.`);
    await reload();
  });
  const remove = useAction(async () => {
    await api.del(base);
    announce(`Protected tag ${rule.name} removed.`);
    await reload();
  });
  const feedback = feedbackOf(change.error ?? remove.error, `tag-${rule.name}`, ["allowed_to_create"]);
  return (
    <li class="sp-rule-row">
      <span class="sp-rule-row__name sp-mono">{rule.name}</span>
      {editable ? (
        <div class="sp-rule-row__controls">
          <Select
            label={`Allowed to create ${rule.name}`}
            hideLabel
            name={`tag-${rule.name}-create`}
            value={rule.allowed_to_create}
            options={ROLE_OPTIONS}
            disabled={change.pending}
            onChange={(event) => void change.run(event.currentTarget.value)}
          />
          <Button variant="secondary" pending={remove.pending} aria-label={`Remove protection from ${rule.name}`} onClick={() => void remove.run()}>
            Remove
          </Button>
        </div>
      ) : (
        <span class="sp-rule-row__summary">Create: {rule.allowed_to_create}.</span>
      )}
      <FeedbackView feedback={feedback} signal={change.error ?? remove.error} />
    </li>
  );
}

export function ProtectedTagsCard({ projectId, data, editable, reload }: CardProps) {
  const [pattern, setPattern] = useState("");
  const [allowed, setAllowed] = useState("maintainer");
  const add = useAction(async () => {
    if (pattern.trim() === "") throw blankField("pattern", "Pattern can't be blank.");
    await api.put(`/api/projects/${projectId}/protected_tags/${encodeURIComponent(pattern.trim())}`, { allowed_to_create: allowed });
    announce(`Protected tag ${pattern.trim()} saved.`);
    setPattern("");
    await reload();
  });
  const feedback = feedbackOf(add.error, "tag", ["pattern", "allowed_to_create"]);
  return (
    <Card kicker="TAGS" title="Protected tags" explanation="Choose who may create tags whose name matches a name or a pattern with *.">
      {data.protected_tags.length === 0 ? <p class="sp-muted">No protected tags.</p> : null}
      <ul class="sp-rule-list">
        {data.protected_tags.map((rule) => (
          <TagRow key={rule.name} projectId={projectId} rule={rule} editable={editable} reload={reload} />
        ))}
      </ul>
      {editable ? (
        <form
          class="sp-rule-form"
          onSubmit={(event) => {
            event.preventDefault();
            void add.run();
          }}
        >
          <FeedbackView feedback={feedback} signal={add.error} />
          <TextField label="Tag name or pattern" name="tag-pattern" value={pattern} error={feedback.byField["pattern"]} onInput={(event) => setPattern(event.currentTarget.value)} />
          <Select label="Allowed to create" name="tag-allowed_to_create" value={allowed} options={ROLE_OPTIONS} error={feedback.byField["allowed_to_create"]} onChange={(event) => setAllowed(event.currentTarget.value)} />
          <Button type="submit" pending={add.pending}>
            Protect tag
          </Button>
        </form>
      ) : null}
    </Card>
  );
}

function EnvironmentRow({ projectId, rule, editable, reload }: { projectId: string; rule: ProtectedEnvironment; editable: boolean; reload: () => Promise<void> }) {
  const base = `/api/projects/${projectId}/protected_environments/${encodeURIComponent(rule.name)}`;
  const [approvals, setApprovals] = useState(String(rule.approvals));
  const change = useAction(async (next: { roles: string; approvals: number }) => {
    await api.put(base, next);
    announce(`Protected environment ${rule.name} saved.`);
    await reload();
  });
  const remove = useAction(async () => {
    await api.del(base);
    announce(`Protected environment ${rule.name} removed.`);
    await reload();
  });
  const feedback = feedbackOf(change.error ?? remove.error, `env-${rule.name}`, ["roles", "approvals"]);
  return (
    <li class="sp-rule-row">
      <span class="sp-rule-row__name sp-mono">{rule.name}</span>
      {editable ? (
        <div class="sp-rule-row__controls">
          <Select
            label={`Minimum role to approve ${rule.name}`}
            hideLabel
            name={`env-${rule.name}-roles`}
            value={rule.roles}
            options={ROLE_OPTIONS}
            disabled={change.pending}
            onChange={(event) => void change.run({ roles: event.currentTarget.value, approvals: rule.approvals })}
          />
          <TextField
            label={`Approvals needed for ${rule.name}`}
            hideLabel
            name={`env-${rule.name}-approvals`}
            type="number"
            min={0}
            value={approvals}
            error={feedback.byField["approvals"]}
            onInput={(event) => setApprovals(event.currentTarget.value)}
            onChange={() => void change.run({ roles: rule.roles, approvals: Number(approvals) })}
          />
          <Button variant="secondary" pending={remove.pending} aria-label={`Remove protection from ${rule.name}`} onClick={() => void remove.run()}>
            Remove
          </Button>
        </div>
      ) : (
        <span class="sp-rule-row__summary">
          Role: {rule.roles}. Approvals: {rule.approvals}.
        </span>
      )}
      <FeedbackView feedback={feedback} signal={change.error ?? remove.error} />
    </li>
  );
}

export function ProtectedEnvironmentsCard({ projectId, data, editable, reload }: CardProps) {
  const [name, setName] = useState("");
  const [roles, setRoles] = useState("maintainer");
  const [approvals, setApprovals] = useState("1");
  const add = useAction(async () => {
    if (name.trim() === "") throw blankField("pattern", "Name can't be blank.");
    await api.put(`/api/projects/${projectId}/protected_environments/${encodeURIComponent(name.trim())}`, { roles, approvals: Number(approvals) });
    announce(`Protected environment ${name.trim()} saved.`);
    setName("");
    await reload();
  });
  const feedback = feedbackOf(add.error, "env", ["pattern", "roles", "approvals"]);
  return (
    <Card
      kicker="ENVIRONMENTS"
      title="Protected environments"
      explanation="Deployments to a protected environment wait for approvals from people at or above the minimum role."
    >
      {data.protected_environments.length === 0 ? <p class="sp-muted">No protected environments.</p> : null}
      <ul class="sp-rule-list">
        {data.protected_environments.map((rule) => (
          <EnvironmentRow key={rule.name} projectId={projectId} rule={rule} editable={editable} reload={reload} />
        ))}
      </ul>
      {editable ? (
        <form
          class="sp-rule-form"
          onSubmit={(event) => {
            event.preventDefault();
            void add.run();
          }}
        >
          <FeedbackView feedback={feedback} signal={add.error} />
          <TextField label="Environment name" name="env-pattern" value={name} error={feedback.byField["pattern"]} onInput={(event) => setName(event.currentTarget.value)} />
          <Select label="Minimum role to approve" name="env-roles" value={roles} options={ROLE_OPTIONS} error={feedback.byField["roles"]} onChange={(event) => setRoles(event.currentTarget.value)} />
          <TextField label="Approvals needed" name="env-approvals" type="number" min={0} value={approvals} error={feedback.byField["approvals"]} onInput={(event) => setApprovals(event.currentTarget.value)} />
          <Button type="submit" pending={add.pending}>
            Protect environment
          </Button>
        </form>
      ) : null}
    </Card>
  );
}
