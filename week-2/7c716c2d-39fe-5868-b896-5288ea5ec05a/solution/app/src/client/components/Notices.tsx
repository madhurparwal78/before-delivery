// The service notices region: one alert per active notice, changed in place.
import { TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { get, type Billing, type Me } from "../api";
import { DB_NOTICE, STORAGE_NOTICE, mailNotice, useServices } from "../services";
import { useExit } from "./exit";

export function Notices(props: { me: Me | null; path: string }): JSX.Element {
  const { status } = useServices();
  const owner = props.me?.person.role === "owner" && props.me.workspace !== null;
  const onSettings = props.path === "/settings";
  const billingDown = status?.billing === "unavailable";
  const [limit, setLimit] = useState<number | null>(null);

  useEffect(() => {
    if (!owner || !onSettings || !billingDown) return;
    get<Billing>("/api/billing")
      .then((b) => setLimit(b.limit))
      .catch(() => setLimit(props.me?.workspace?.seats?.limit ?? null));
  }, [owner, onSettings, billingDown, props.me]);

  const notices: { id: string; text: string }[] = [];
  if (status?.database === "unavailable") notices.push({ id: "database", text: DB_NOTICE });
  if (props.me && status?.storage === "unavailable") notices.push({ id: "storage", text: STORAGE_NOTICE });
  if (owner && onSettings && billingDown && limit !== null) notices.push({ id: "billing", text: `Billing unavailable. Your seat limit stays at ${limit} until billing is back.` });
  if (owner && status?.mail === "delayed" && status.held_mail !== null && status.held_mail > 0) notices.push({ id: "mail", text: mailNotice(status.held_mail) });

  return (
    <section role="region" aria-label="Service notices" className="notices">
      {notices.map((notice) => (
        <Notice key={notice.id} text={notice.text} />
      ))}
    </section>
  );
}

function Notice(props: { text: string }): JSX.Element {
  const ref = useExit<HTMLDivElement>("notice");
  return (
    <div ref={ref} role="alert" className="notice">
      <TriangleAlert aria-hidden="true" size={16} strokeWidth={1.5} />
      <span>{props.text}</span>
    </div>
  );
}
