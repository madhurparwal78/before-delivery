import { useLayoutEffect as useEffect, useRef, useState } from "preact/hooks";
import { historyLine, ownerText, partLine, partNumberLine, promiseLine, shareHeading, stateName, type OwnerRefusalCode } from "../../shared/copy";
import { QuoteFigures, RulingFigure, SettlementFigures } from "../SlipParts";
import type { CatalogueModel, CatalogueModelDetail, Lang, ShareView } from "../../shared/types";
import { get } from "../api";
import { Fan } from "../Fan";
import { ChevronDown, ChevronUp } from "../icons";
import { useOwnerText } from "../language";
import { clearAlert, showAlert, startPending } from "../messages";
import { ownerCopy } from "../refusals";

const REFRESH_MS = 30_000;

/** The ruled slip: a bordered card whose sections are separated by thin warm-grey rules. */
function OwnerSlip({ view, lang }: { view: ShareView; lang: Lang }) {
  const [open, setOpen] = useState(false);
  const text = (key: Parameters<typeof ownerText>[0]): string => ownerText(key, lang);
  const quote = view.quote;
  return (
    <section class="slip" role="region" aria-label={text("slipRegion")}>
      <div class="slip-head">
        <p class="slip-ref">{view.reference}</p>
        <p class="slip-state">{stateName(view.state, lang)}</p>
      </div>
      <div>
        <p class="line">{partLine(view.part.booklet_number, view.part.name, lang)}</p>
        <p class="mono part-number">{partNumberLine(view.part.part_number, lang)}</p>
        <p class="mono">
          {text("quantityLine")} {view.quantity}
        </p>
      </div>
      <div>
        <RulingFigure ruling={view.ruling} lang={lang} />
      </div>
      {quote ? (
        <div>
          <QuoteFigures quote={quote} lang={lang} />
          <p class="line">{promiseLine(quote.promise, lang)}</p>
        </div>
      ) : null}
      {view.paid_minor !== null || view.decline ? (
        <div>
          <SettlementFigures paidMinor={view.paid_minor} decline={view.decline} lang={lang} />
        </div>
      ) : null}
      <div>
        <button type="button" class="disclosure-button" aria-expanded={open} onClick={() => setOpen(!open)}>
          {text("historyButton")}
          {open ? <ChevronUp /> : <ChevronDown />}
        </button>
        {open ? (
          <ul class="disclosure-body">
            {view.history.map((entry, index) => (
              <li key={index}>{historyLine(entry.state, entry.at, lang)}</li>
            ))}
          </ul>
        ) : null}
      </div>
    </section>
  );
}

export function Share({ token }: { token: string }) {
  const { lang } = useOwnerText();
  const [view, setView] = useState<ShareView | null>(null);
  const [detail, setDetail] = useState<CatalogueModelDetail | null>(null);
  const shown = useRef<string>("");

  const refresh = async (first: boolean): Promise<void> => {
    const end = first ? startPending("") : () => undefined;
    const result = await get<ShareView>(`/api/share/${token}`);
    end();
    if (result.data) {
      setView(result.data);
      clearAlert();
      return;
    }
    const code = result.error?.code;
    if (code === "share_unknown" || code === "claim_closed" || code === "link_withdrawn") {
      setView(null);
      showAlert(ownerCopy(code as OwnerRefusalCode, lang));
    } else {
      showAlert(ownerCopy("database_unavailable", lang));
    }
  };

  useEffect(() => {
    void refresh(true);
    const timer = window.setInterval(() => void refresh(false), REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [token]);

  const modelName = view?.model.name ?? "";
  useEffect(() => {
    if (modelName === "" || shown.current === modelName) return;
    shown.current = modelName;
    void get<{ models: CatalogueModel[] }>("/api/models").then((models) => {
      const slug = models.data?.models.find((model) => model.name === modelName)?.slug;
      if (slug) void get<CatalogueModelDetail>(`/api/models/${slug}`).then((found) => setDetail(found.data));
    });
  }, [modelName]);

  if (!view) return <div class="share-page" />;
  return (
    <div class="share-page stack">
      <h1 class="plate-title">{shareHeading(view.reference, lang)}</h1>
      <div class="two-col">
        <div class="fan-column">{detail ? <Fan key={detail.slug} model={detail} lang={lang} selected={view.part.booklet_number} startOpen /> : null}</div>
        <OwnerSlip view={view} lang={lang} />
      </div>
    </div>
  );
}
