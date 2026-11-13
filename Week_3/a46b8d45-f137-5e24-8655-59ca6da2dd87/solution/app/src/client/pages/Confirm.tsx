import { useState } from "preact/hooks";
import { useOwnerText } from "../language";
import { post } from "../api";
import { navigate } from "../router";
import { showAlert, startPending } from "../messages";
import { ownerRefusal } from "../refusals";

export function Confirm({ token }: { token: string }) {
  const { lang, t } = useOwnerText();
  const [busy, setBusy] = useState(false);

  const submitConfirmation = async (): Promise<void> => {
    setBusy(true);
    startPending(t("confirming"));
    const result = await post<{ share_url: string }>("/api/claims/confirm", { token });
    setBusy(false);
    if (result.data) {
      navigate(result.data.share_url);
      return;
    }
    showAlert(ownerRefusal(result, lang));
  };

  return (
    <div class="column-narrow">
      <h1 class="plate-title">{t("confirmHeading")}</h1>
      <button type="button" class="primary" disabled={busy} onClick={() => void submitConfirmation()}>
        {t("confirmButton")}
      </button>
    </div>
  );
}
