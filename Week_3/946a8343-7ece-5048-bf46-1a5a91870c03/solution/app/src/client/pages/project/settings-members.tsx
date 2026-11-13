// Settings card: project members (add, change the role, remove). Roles are the five base roles plus the custom roles of the group.
import { useState } from "preact/hooks";
import { announce } from "../../announce.tsx";
import { api, useAction } from "../../api.ts";
import { Button } from "../../ui/button.tsx";
import { Card } from "../../ui/card.tsx";
import { Select, TextField, type SelectOption } from "../../ui/fields.tsx";
import type { CardProps } from "./settings-protection.tsx";
import type { CustomRole, Member } from "./types.ts";
import { FeedbackView, feedbackOf, grantBody, grantValue, ROLE_OPTIONS } from "./write.tsx";

function roleOptions(custom: readonly CustomRole[], current?: string): SelectOption[] {
  const options: SelectOption[] = [...ROLE_OPTIONS, ...custom.map((role) => ({ value: `custom:${role.id}`, label: `${role.name} (custom)` }))];
  if (current !== undefined && !options.some((option) => option.value === current)) options.push({ value: current, label: current.replace("custom:", "") });
  return options;
}

function MemberRow({ projectId, member, custom, editable, reload }: { projectId: string; member: Member; custom: readonly CustomRole[]; editable: boolean; reload: () => Promise<void> }) {
  const base = `/api/projects/${projectId}/members/${encodeURIComponent(member.username)}`;
  const current = grantValue(member, custom);
  const change = useAction(async (value: string) => {
    await api.patch(base, grantBody(value));
    await reload();
  });
  const remove = useAction(async () => {
    await api.del(base);
    announce(`${member.username} was removed from the project.`);
    await reload();
  });
  const feedback = feedbackOf(change.error ?? remove.error, `member-${member.username}`, ["role", "custom_role"]);
  return (
    <li class="sp-rule-row">
      <span class="sp-rule-row__name">{member.username}</span>
      <span class="sp-rule-row__summary">Effective role: {member.effective_role ?? "none"}</span>
      {editable ? (
        <div class="sp-rule-row__controls">
          <Select
            label={`Role of ${member.username}`}
            hideLabel
            name={`member-${member.username}-role`}
            value={current}
            options={roleOptions(custom, current)}
            disabled={change.pending}
            onChange={(event) => void change.run(event.currentTarget.value)}
          />
          <Button variant="secondary" pending={remove.pending} aria-label={`Remove ${member.username}`} onClick={() => void remove.run()}>
            Remove
          </Button>
        </div>
      ) : (
        <span class="sp-rule-row__summary">{member.custom_role ?? member.role}</span>
      )}
      <FeedbackView feedback={feedback} signal={change.error ?? remove.error} />
    </li>
  );
}

export function MembersCard({ projectId, data, editable, reload, custom }: CardProps & { custom: readonly CustomRole[] }) {
  const [username, setUsername] = useState("");
  const [grant, setGrant] = useState("developer");
  const add = useAction(async () => {
    await api.post(`/api/projects/${projectId}/members`, { username: username.trim(), ...grantBody(grant) });
    announce(`${username.trim()} was added to the project.`);
    setUsername("");
    await reload();
  });
  const feedback = feedbackOf(add.error, "member", ["username", "role", "custom_role"]);
  return (
    <Card
      kicker="MEMBERS"
      title="Members"
      explanation="People added here hold the role in this project. A role inherited from the group still applies; the highest one wins."
    >
      {data.members.length === 0 ? <p class="sp-muted">No direct members.</p> : null}
      <ul class="sp-rule-list">
        {data.members.map((member) => (
          <MemberRow key={member.username} projectId={projectId} member={member} custom={custom} editable={editable} reload={reload} />
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
          <TextField label="Username" name="member-username" value={username} error={feedback.byField["username"]} onInput={(event) => setUsername(event.currentTarget.value)} />
          <Select label="Role" name="member-role" value={grant} options={roleOptions(custom)} error={feedback.byField["role"] ?? feedback.byField["custom_role"]} onChange={(event) => setGrant(event.currentTarget.value)} />
          <Button type="submit" pending={add.pending}>
            Add member
          </Button>
        </form>
      ) : null}
    </Card>
  );
}
