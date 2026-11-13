import { useOwnerText } from "../language";
import { onLinkClick } from "../router";

export function NotFound() {
  const { t } = useOwnerText();
  return (
    <div class="column-narrow">
      <h1 class="plate-title">{t("brand")}</h1>
      <p>
        <a href="/" onClick={(event) => onLinkClick(event, "/")}>
          {t("brand")}
        </a>
      </p>
    </div>
  );
}
