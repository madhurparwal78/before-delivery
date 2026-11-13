// `region "Approvals"`: one line per rule, `<rule>: <given> of <required>`, and Approve / Revoke approval for the signed-in user.
// After Approve focus goes to `Revoke approval`; after Revoke it returns to `Approve`. The sha sent is the current source head.
import { api, idempotencyKey, useAction } from "../../api.ts";
import { Button } from "../../ui/index.ts";
import { type Approvals as ApprovalsView, type MrCaps, type MrPage, mrBase } from "./data.ts";
import { ActionNotice, PanelSection, useFocusRequest } from "./parts.tsx";

interface ApprovalsReply extends ApprovalsView {
  seq: number;
}

export function Approvals({ page, caps }: { page: MrPage; caps: MrCaps }) {
  const { mr } = page;
  const focus = useFocusRequest();
  const sha = mr?.source_head ?? null;
  const approve = useAction(async () => {
    if (!mr || sha === null) return;
    const reply = await api.post<ApprovalsReply>(`${mrBase(page.project, mr.iid)}/approve`, { sha }, { idempotencyKey: idempotencyKey() });
    page.patch((current) => ({ ...current, approvals: { rules: reply.rules, approved_by: reply.approved_by } }));
    focus.request("revoke");
    await page.reload();
  });
  const revoke = useAction(async () => {
    if (!mr) return;
    const reply = await api.del<ApprovalsReply>(`${mrBase(page.project, mr.iid)}/approve`);
    page.patch((current) => ({ ...current, approvals: { rules: reply.rules, approved_by: reply.approved_by } }));
    focus.request("approve");
    await page.reload();
  });

  if (!mr) {
    return (
      <PanelSection title="Approvals">
        <p class="sp-muted">Loading</p>
      </PanelSection>
    );
  }
  const mine = caps.username !== null && mr.approvals.approved_by.includes(caps.username);
  const open = mr.state !== "merged";
  const mayApprove = open && caps.approve && !mine && (!caps.author || caps.authorMayApprove);
  const mayRevoke = open && caps.approve && mine;
  return (
    <PanelSection title="Approvals">
      <ActionNotice errors={[approve.error, revoke.error]} />
      {mr.approvals.rules.length === 0 ? (
        <p class="sp-muted">No approval rules apply.</p>
      ) : (
        <ul class="sp-mr-rules">
          {mr.approvals.rules.map((rule) => (
            <li key={rule.name} class="sp-mr-rule">
              {`${rule.name}: ${rule.given} of ${rule.required}`}
              {rule.optional ? <span class="sp-muted"> (optional)</span> : null}
            </li>
          ))}
        </ul>
      )}
      {mr.approvals.approved_by.length > 0 ? <p class="sp-small sp-muted">{`Approved by ${mr.approvals.approved_by.map((name) => `@${name}`).join(", ")}`}</p> : null}
      {mayApprove ? (
        <Button innerRef={focus.ref("approve")} variant="secondary" onClick={() => void approve.run()} pending={approve.pending}>
          Approve
        </Button>
      ) : null}
      {mayRevoke ? (
        <Button innerRef={focus.ref("revoke")} variant="secondary" onClick={() => void revoke.run()} pending={revoke.pending}>
          Revoke approval
        </Button>
      ) : null}
    </PanelSection>
  );
}
