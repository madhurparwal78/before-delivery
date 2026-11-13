import { useState } from "preact/hooks";
import { post } from "../api";
import { Search } from "../icons";
import { useOwnerText } from "../language";
import { showAlert, startPending } from "../messages";
import { navigate } from "../router";
import { ownerRefusal } from "../refusals";

export function Find() {
  const { lang, t } = useOwnerText();
  const [reference, setReference] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);

  const find = async (event: Event): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    startPending(t("looking"));
    const result = await post<{ share_url: string }>("/api/claims/lookup", { reference, email });
    setBusy(false);
    if (result.data) {
      navigate(result.data.share_url);
      return;
    }
    showAlert(ownerRefusal(result, lang));
  };

  return (
    <div class="column-form">
      <h1 class="plate-title">{t("findHeading")}</h1>
      <form class="find-form" noValidate onSubmit={(event) => void find(event)}>
        <div class="field">
          <label for="find-reference">{t("labelReference")}</label>
          <input id="find-reference" type="text" autoComplete="off" autoCapitalize="characters" value={reference} onInput={(event) => setReference(event.currentTarget.value)} />
        </div>
        <div class="field">
          <label for="find-email">{t("labelEmail")}</label>
          <input id="find-email" type="email" autoComplete="email" value={email} onInput={(event) => setEmail(event.currentTarget.value)} />
        </div>
        <button type="submit" class="primary" disabled={busy}>
          <Search />
          {t("findButton")}
        </button>
      </form>
    </div>
  );
}
