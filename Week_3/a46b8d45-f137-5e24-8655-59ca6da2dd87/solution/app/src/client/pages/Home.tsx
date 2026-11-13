import { useOwnerText } from "../language";
import { FanPlaceholder } from "../Fan";
import { onLinkClick } from "../router";

export function Home() {
  const { t } = useOwnerText();
  return (
    <div class="column-narrow">
      <h1 class="plate-title">{t("brand")}</h1>
      <p class="lead">{t("homeExplain")}</p>
      <div class="home-actions">
        <a class="button primary" href="/claim/new" onClick={(event) => onLinkClick(event, "/claim/new")}>
          {t("startClaim")}
        </a>
        <a class="button" href="/find" onClick={(event) => onLinkClick(event, "/find")}>
          {t("findMyClaim")}
        </a>
      </div>
      <FanPlaceholder text="" compact />
    </div>
  );
}
