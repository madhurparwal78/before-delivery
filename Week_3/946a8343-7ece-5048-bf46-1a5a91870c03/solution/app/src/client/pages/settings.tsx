// `/projects/<id>/-/settings`: one column of settings rule cards on the light band. A live page: a role change reloads the
// data and the controls follow the role.
import "../styles/project.css";
import { api, useResource } from "../api.ts";
import { useLiveResource } from "../live.ts";
import { useRole } from "../role.ts";
import { useRoute } from "../router.ts";
import { Notice, Skeleton } from "../ui/feedback.tsx";
import { Page } from "../ui/page.tsx";
import { MembersCard } from "./project/settings-members.tsx";
import { MergeCard } from "./project/settings-merge.tsx";
import { ProtectedBranchesCard, ProtectedEnvironmentsCard, ProtectedTagsCard } from "./project/settings-protection.tsx";
import { ApprovalRulesCard, PushRulesCard, VariablesCard } from "./project/settings-rules.tsx";
import { WebhooksCard } from "./project/settings-webhooks.tsx";
import type { CustomRole, GroupView, ProjectInfo, SettingsData } from "./project/types.ts";

async function loadCustomRoles(projectId: string, signal: AbortSignal): Promise<CustomRole[]> {
  try {
    const info = await api.get<ProjectInfo>(`/api/projects/${projectId}`, { signal });
    const group = await api.get<GroupView>(`/api/groups/${info.group.id}`, { signal });
    return group.custom_roles;
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === "AbortError") throw cause;
    return [];
  }
}

function SettingsBody({ id }: { id: string }) {
  const { atLeast, can, loaded } = useRole();
  const settings = useLiveResource<SettingsData>({
    project: id,
    types: ["role"],
    load: (signal) => api.get<SettingsData>(`/api/projects/${id}/settings`, { signal }),
    deps: [id],
  });
  const custom = useResource((signal) => loadCustomRoles(id, signal), [id]);
  if (settings.error) return <Notice>{settings.error.message}</Notice>;
  if (!loaded || !settings.data) return <Skeleton rows={4} height={160} />;
  const editable = atLeast("maintainer");
  const shared = { projectId: id, data: settings.data, reload: settings.reload };
  return (
    <div class="sp-settings">
      <ProtectedBranchesCard {...shared} editable={editable} />
      <ProtectedTagsCard {...shared} editable={editable} />
      <PushRulesCard {...shared} editable={editable} />
      <ApprovalRulesCard {...shared} editable={editable} />
      <MergeCard {...shared} editable={editable} />
      <ProtectedEnvironmentsCard {...shared} editable={editable || can("manage_environments")} />
      <VariablesCard {...shared} editable={editable} />
      <MembersCard {...shared} editable={editable} custom={custom.data ?? []} />
      <WebhooksCard {...shared} editable={editable} />
    </div>
  );
}

export default function SettingsPage() {
  const { id = "" } = useRoute().params;
  return (
    <Page title="Settings" band live project={id} pageKeys={["project"]} class="sp-settings-page">
      <SettingsBody id={id} />
    </Page>
  );
}
