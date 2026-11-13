// Settings cards: push rules, approval rules and project variables.
import { useState } from "preact/hooks";
import { announce } from "../../announce.tsx";
import { api, useAction } from "../../api.ts";
import { Button } from "../../ui/button.tsx";
import { Card } from "../../ui/card.tsx";
import { Checkbox, TextArea, TextField } from "../../ui/fields.tsx";
import type { CardProps } from "./settings-protection.tsx";
import type { ApprovalRule, PushRules } from "./types.ts";
import { blankField, FeedbackView, feedbackOf, lines, words } from "./write.tsx";

function PushRulesForm({ projectId, rules, editable, reload }: { projectId: string; rules: PushRules; editable: boolean; reload: () => Promise<void> }) {
  const [branch, setBranch] = useState(rules.branch_name ?? "");
  const [message, setMessage] = useState(rules.commit_message ?? "");
  const [forbidden, setForbidden] = useState(rules.forbidden_files.join("\n"));
  const [required, setRequired] = useState(rules.required_files.join("\n"));
  const [secrets, setSecrets] = useState(rules.secrets);
  const save = useAction(async () => {
    await api.put(`/api/projects/${projectId}/push_rules`, {
      branch_name: branch.trim() === "" ? null : branch.trim(),
      commit_message: message.trim() === "" ? null : message.trim(),
      forbidden_files: lines(forbidden),
      required_files: lines(required),
      secrets,
    });
    announce("Push rules saved.");
    await reload();
  });
  const feedback = feedbackOf(save.error, "push", ["branch_name", "commit_message", "forbidden_files", "required_files", "secrets"]);
  return (
    <form
      class="sp-rule-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (editable) void save.run();
      }}
    >
      <FeedbackView feedback={feedback} signal={save.error} />
      <TextField
        label="Branch name pattern"
        name="push-branch_name"
        description="A regular expression new branch names must match."
        value={branch}
        disabled={!editable}
        error={feedback.byField["branch_name"]}
        onInput={(event) => setBranch(event.currentTarget.value)}
      />
      <TextField
        label="Commit message pattern"
        name="push-commit_message"
        description="A regular expression every commit message must match."
        value={message}
        disabled={!editable}
        error={feedback.byField["commit_message"]}
        onInput={(event) => setMessage(event.currentTarget.value)}
      />
      <TextArea
        label="Forbidden files"
        name="push-forbidden_files"
        description="One glob per line. Commits that add or change a matching file are refused."
        rows={3}
        value={forbidden}
        disabled={!editable}
        error={feedback.byField["forbidden_files"]}
        onInput={(event) => setForbidden(event.currentTarget.value)}
      />
      <TextArea
        label="Required files"
        name="push-required_files"
        description="One path per line. Commits whose result lacks a file are refused."
        rows={3}
        value={required}
        disabled={!editable}
        error={feedback.byField["required_files"]}
        onInput={(event) => setRequired(event.currentTarget.value)}
      />
      <Checkbox
        label="Reject secrets on added lines"
        name="push-secrets"
        checked={secrets}
        disabled={!editable}
        error={feedback.byField["secrets"]}
        onChange={(event) => setSecrets(event.currentTarget.checked)}
      />
      {editable ? (
        <Button type="submit" pending={save.pending}>
          Save push rules
        </Button>
      ) : null}
    </form>
  );
}

export function PushRulesCard({ projectId, data, editable, reload }: CardProps) {
  return (
    <Card
      kicker="PUSH"
      title="Push rules"
      explanation="Every commit is checked against these rules, whichever way it arrives. The first failing rule is the refusal."
    >
      <PushRulesForm key={JSON.stringify(data.push_rules)} projectId={projectId} rules={data.push_rules} editable={editable} reload={reload} />
    </Card>
  );
}

function RuleForm({
  projectId,
  rule,
  prefix,
  onDone,
  reload,
}: {
  projectId: string;
  rule: ApprovalRule | null;
  prefix: string;
  onDone: () => void;
  reload: () => Promise<void>;
}) {
  const [name, setName] = useState(rule?.name ?? "");
  const [required, setRequired] = useState(String(rule?.required ?? 1));
  const [users, setUsers] = useState(rule?.users.join(" ") ?? "");
  const [groups, setGroups] = useState(rule?.groups.join(" ") ?? "");
  const save = useAction(async () => {
    if (name.trim() === "") throw blankField("name", "Name must be 1 to 100 characters.");
    const body = { name: name.trim(), required: Number(required), users: words(users), groups: words(groups) };
    if (rule === null) await api.post(`/api/projects/${projectId}/approval_rules`, body);
    else await api.patch(`/api/projects/${projectId}/approval_rules/${rule.id}`, body);
    announce(`Approval rule ${name.trim()} saved.`);
    if (rule === null) {
      setName("");
      setUsers("");
      setGroups("");
    }
    await reload();
    onDone();
  });
  const feedback = feedbackOf(save.error, prefix, ["name", "required", "users", "groups"]);
  return (
    <form
      class="sp-rule-form"
      onSubmit={(event) => {
        event.preventDefault();
        void save.run();
      }}
    >
      <FeedbackView feedback={feedback} signal={save.error} />
      <TextField label="Rule name" name={`${prefix}-name`} value={name} error={feedback.byField["name"]} onInput={(event) => setName(event.currentTarget.value)} />
      <TextField
        label="Approvals required"
        name={`${prefix}-required`}
        type="number"
        min={0}
        value={required}
        error={feedback.byField["required"]}
        onInput={(event) => setRequired(event.currentTarget.value)}
      />
      <TextField
        label="Eligible users"
        name={`${prefix}-users`}
        description="Usernames separated by spaces."
        value={users}
        error={feedback.byField["users"]}
        onInput={(event) => setUsers(event.currentTarget.value)}
      />
      <TextField
        label="Eligible groups"
        name={`${prefix}-groups`}
        description="Group paths separated by spaces."
        value={groups}
        error={feedback.byField["groups"]}
        onInput={(event) => setGroups(event.currentTarget.value)}
      />
      <div class="sp-rule-form__actions">
        <Button type="submit" pending={save.pending}>
          {rule === null ? "Add rule" : "Save rule"}
        </Button>
        {rule !== null ? (
          <Button variant="secondary" onClick={onDone}>
            Cancel
          </Button>
        ) : null}
      </div>
    </form>
  );
}

function ApprovalRuleRow({ projectId, rule, editable, reload }: { projectId: string; rule: ApprovalRule; editable: boolean; reload: () => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const remove = useAction(async () => {
    await api.del(`/api/projects/${projectId}/approval_rules/${rule.id}`);
    announce(`Approval rule ${rule.name} removed.`);
    await reload();
  });
  const feedback = feedbackOf(remove.error, `rule-${rule.id}`, []);
  return (
    <li class="sp-rule-row">
      <span class="sp-rule-row__name">{rule.name}</span>
      <span class="sp-rule-row__summary">
        {rule.required} required. Users: {rule.users.length === 0 ? "none" : rule.users.join(", ")}. Groups: {rule.groups.length === 0 ? "none" : rule.groups.join(", ")}.
      </span>
      {editable ? (
        <div class="sp-rule-row__controls">
          <Button variant="secondary" aria-expanded={editing ? "true" : "false"} aria-label={`Edit rule ${rule.name}`} onClick={() => setEditing(!editing)}>
            Edit
          </Button>
          <Button variant="secondary" pending={remove.pending} aria-label={`Delete rule ${rule.name}`} onClick={() => void remove.run()}>
            Delete
          </Button>
        </div>
      ) : null}
      <FeedbackView feedback={feedback} signal={remove.error} />
      {editing ? <RuleForm projectId={projectId} rule={rule} prefix={`rule-${rule.id}`} reload={reload} onDone={() => setEditing(false)} /> : null}
    </li>
  );
}

export function ApprovalRulesCard({ projectId, data, editable, reload }: CardProps) {
  return (
    <Card
      kicker="APPROVALS"
      title="Approval rules"
      explanation="Each rule needs a number of approvals from its eligible users and groups before a request into a protected branch can merge."
    >
      {data.approval_rules.length === 0 ? <p class="sp-muted">No approval rules.</p> : null}
      <ul class="sp-rule-list">
        {data.approval_rules.map((rule) => (
          <ApprovalRuleRow key={rule.id} projectId={projectId} rule={rule} editable={editable} reload={reload} />
        ))}
      </ul>
      {editable ? <RuleForm projectId={projectId} rule={null} prefix="rule-new" reload={reload} onDone={() => undefined} /> : null}
    </Card>
  );
}

export function VariablesCard({ projectId, data, editable, reload }: CardProps) {
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");
  const add = useAction(async () => {
    if (key.trim() === "") throw blankField("key", "Key must start with a letter or _ and use letters, digits and _.");
    await api.put(`/api/projects/${projectId}/variables/${encodeURIComponent(key.trim())}`, { value });
    announce(`Variable ${key.trim()} saved.`);
    setKey("");
    setValue("");
    await reload();
  });
  const remove = useAction(async (name: string) => {
    await api.del(`/api/projects/${projectId}/variables/${encodeURIComponent(name)}`);
    announce(`Variable ${name} removed.`);
    await reload();
  });
  const feedback = feedbackOf(add.error, "var", ["key", "value"]);
  const removal = feedbackOf(remove.error, "var-remove", []);
  return (
    <Card
      kicker="VARIABLES"
      title="Project variables"
      explanation="Variables are passed to every pipeline of this project. Saving a key that exists replaces its value."
    >
      <FeedbackView feedback={removal} signal={remove.error} />
      {data.variables.length === 0 ? <p class="sp-muted">No variables.</p> : null}
      <ul class="sp-rule-list">
        {data.variables.map((variable) => (
          <li key={variable.key} class="sp-rule-row">
            <span class="sp-rule-row__name sp-mono">{variable.key}</span>
            <span class="sp-rule-row__summary sp-mono">{variable.value}</span>
            {editable ? (
              <div class="sp-rule-row__controls">
                <Button variant="secondary" pending={remove.pending} aria-label={`Remove variable ${variable.key}`} onClick={() => void remove.run(variable.key)}>
                  Remove
                </Button>
              </div>
            ) : null}
          </li>
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
          <TextField label="Key" name="var-key" value={key} error={feedback.byField["key"]} onInput={(event) => setKey(event.currentTarget.value)} />
          <TextField label="Value" name="var-value" value={value} error={feedback.byField["value"]} onInput={(event) => setValue(event.currentTarget.value)} />
          <Button type="submit" pending={add.pending}>
            Save variable
          </Button>
        </form>
      ) : null}
    </Card>
  );
}
