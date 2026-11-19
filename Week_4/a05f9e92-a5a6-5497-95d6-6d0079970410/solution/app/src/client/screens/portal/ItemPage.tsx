import { useMemo } from "react";
import type { FormPolicy } from "../../../server/rules.js";
import { get } from "../../lib/api.js";
import { useSession } from "../../lib/session.js";
import { Page, Rest, useLoad } from "../../lib/ui.js";
import { gate, PortalActions } from "./common.js";
import { ItemForm, type ShownItem } from "./ItemForm.js";
import { policiesFor } from "./policy.js";

export function ItemPage({ id }: { id: string }): JSX.Element {
  const session = useSession();
  const { state, reload } = useLoad(async () => {
    const [{ item }, { form_policies }] = await Promise.all([get<{ item: ShownItem }>(`/api/catalog/items/${encodeURIComponent(id)}`), get<{ form_policies: FormPolicy[] }>("/api/form-policies")]);
    return { item, policies: form_policies };
  }, [id, session.accessVersion]);
  const ready = state.status === "ready" ? state.data : null;
  const policies = useMemo(() => (ready ? policiesFor(ready.policies, ready.item.id) : []), [ready]);
  if (state.status !== "ready") return gate(state, id, reload);
  const { item } = state.data;
  return (
    <Page subject={item.name}>
      <PortalActions />
      <Rest narrow className="portal-column">
        <ItemForm key={item.id} item={item} policies={policies} />
      </Rest>
    </Page>
  );
}
