import { useLayoutEffect as useEffect, useState } from "preact/hooks";
import { lifetimeLine, sentText, type OwnerRefusalCode } from "../../shared/copy";
import { get } from "../api";
import { useOwnerText } from "../language";
import { showAlert, startPending } from "../messages";
import { ownerCopy } from "../refusals";

type Link = { kind: "loading" } | { kind: "live"; confirmBy: string } | { kind: "used" } | { kind: "refused"; code: OwnerRefusalCode };

interface Confirmation {
  link_state: "live" | "lapsed" | "used";
  confirm_by: string;
}

export function Sent({ reference }: { reference: string }) {
  const { lang, t } = useOwnerText();
  const [link, setLink] = useState<Link>({ kind: "loading" });

  useEffect(() => {
    const end = startPending("");
    void get<Confirmation>(`/api/claims/${reference}/confirmation`).then((result) => {
      end();
      const body = result.data;
      if (body?.link_state === "live") setLink({ kind: "live", confirmBy: body.confirm_by });
      else if (body?.link_state === "used") setLink({ kind: "used" });
      else if (body) setLink({ kind: "refused", code: "link_lapsed" });
      else setLink({ kind: "refused", code: result.error?.code === "claim_unknown" ? "claim_unknown" : "database_unavailable" });
    });
  }, [reference]);

  useEffect(() => {
    if (link.kind === "refused") showAlert(ownerCopy(link.code, lang));
  }, [link, lang]);

  return (
    <div class="column-narrow">
      <h1 class="plate-title">{t("sentHeading")}</h1>
      <p>{sentText(reference, lang)}</p>
      {link.kind === "live" ? <p class="mono">{lifetimeLine(link.confirmBy, lang)}</p> : null}
      {link.kind === "used" ? <p>{t("alreadyConfirmed")}</p> : null}
    </div>
  );
}
