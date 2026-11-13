import { useLayoutEffect as useEffect, useRef, useState } from "preact/hooks";
import { OWNER_REFUSALS, estimateShown, fill, partLine, partNumberLine, pick } from "../../shared/copy";
import type { CatalogueModel, CatalogueModelDetail, EstimateView } from "../../shared/types";
import { get, request } from "../api";
import { Fan, FanPlaceholder } from "../Fan";
import { useOwnerText } from "../language";
import { clearAlert, showAlert, startPending } from "../messages";
import { fieldError, ownerRefusal } from "../refusals";
import { navigate } from "../router";

type FieldKey = "name" | "email" | "postcode" | "part" | "quantity" | "purchase_date" | "description";
const FIELD_ORDER: FieldKey[] = ["name", "email", "postcode", "part", "quantity", "purchase_date", "description"];

/** The server's field names, mapped to the form's fields. */
const FIELD_OF: Record<string, FieldKey> = {
  name: "name",
  email: "email",
  postcode: "postcode",
  model: "part",
  booklet_number: "part",
  quantity: "quantity",
  purchase_date: "purchase_date",
  description: "description",
};

type Estimate = { kind: "shown"; text: string } | { kind: "refused"; text: string } | null;

const baseName = (filename: string): string => filename.split(/[\\/]/).pop() ?? filename;

export function ClaimNew() {
  const { lang, t } = useOwnerText();
  const [models, setModels] = useState<CatalogueModel[]>([]);
  const [modelsAnswered, setModelsAnswered] = useState(false);
  const [slug, setSlug] = useState("");
  const [detail, setDetail] = useState<CatalogueModelDetail | null>(null);
  const [booklet, setBooklet] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [postcode, setPostcode] = useState("");
  const [purchase, setPurchase] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [description, setDescription] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [fieldCodes, setFieldCodes] = useState<Partial<Record<FieldKey, string>>>({});
  const [photoCodes, setPhotoCodes] = useState<{ index: number; code: string }[]>([]);
  const [photoCount, setPhotoCount] = useState(false);
  const [estimate, setEstimate] = useState<Estimate>(null);
  const [busy, setBusy] = useState(false);
  const newest = useRef(0);

  useEffect(() => {
    void get<{ models: CatalogueModel[] }>("/api/models").then((result) => {
      if (result.data) setModels(result.data.models);
      else showAlert(ownerRefusal(result, lang));
      setModelsAnswered(true);
    });
  }, []);

  const chooseModel = (value: string): void => {
    setSlug(value);
    setBooklet(null);
    setDetail(null);
    setEstimate(null);
    if (value === "") return;
    void get<CatalogueModelDetail>(`/api/models/${value}`).then((result) => {
      if (result.data) setDetail(result.data);
    });
  };

  const chosenPart = detail?.parts.find((part) => part.booklet_number === booklet) ?? null;

  const refuseFields = (fields: Record<string, string>): string[] => {
    const codes: Partial<Record<FieldKey, string>> = {};
    const photos: { index: number; code: string }[] = [];
    let count = false;
    for (const [key, code] of Object.entries(fields)) {
      if (key === "photos") count = true;
      else if (key.startsWith("photos.")) photos.push({ index: Number(key.slice(7)), code });
      else {
        const field = FIELD_OF[key];
        if (field && !codes[field]) codes[field] = code;
      }
    }
    setFieldCodes(codes);
    setPhotoCodes(photos);
    setPhotoCount(count);
    const messages = FIELD_ORDER.filter((field) => codes[field]).map((field) => fieldError(field, lang));
    if (count) messages.push(pick(OWNER_REFUSALS.photo_count, lang));
    for (const photo of photos) messages.push(photoMessage(photo.index, photo.code));
    return messages;
  };

  const photoMessage = (index: number, code: string): string => {
    const file = baseName(files[index - 1]?.name ?? "");
    return fill(pick(code === "too_large" ? OWNER_REFUSALS.too_large : OWNER_REFUSALS.not_a_photo, lang), { file });
  };

  const focusAlert = (): void => document.getElementById("alert-region")?.focus();

  const askCarrier = async (): Promise<void> => {
    if (slug === "" || booklet === null) {
      setFieldCodes({ part: "required" });
      showAlert(fieldError("part", lang));
      return;
    }
    newest.current += 1;
    const press = newest.current;
    const end = startPending(t("asking"));
    clearAlert();
    const query = new URLSearchParams({ model: slug, part: String(booklet), quantity, postcode });
    const result = await get<EstimateView>(`/api/carriage-estimate?${query.toString()}`);
    if (press !== newest.current) return;
    end();
    if (result.data) {
      setEstimate({ kind: "shown", text: estimateShown(result.data.band, result.data.charge_minor, lang) });
      return;
    }
    if (result.error?.code === "validation_failed" && result.error.fields) {
      setEstimate(null);
      showAlert(refuseFields(result.error.fields)[0] ?? "");
      return;
    }
    const text = ownerRefusal(result, lang, booklet);
    setEstimate({ kind: "refused", text });
    showAlert(text);
  };

  const start = async (event: Event): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    startPending(t("sending"));
    clearAlert();
    setFieldCodes({});
    setPhotoCodes([]);
    setPhotoCount(false);
    const form = new FormData();
    form.set("name", name);
    form.set("email", email);
    form.set("postcode", postcode);
    form.set("model", slug);
    form.set("booklet_number", booklet === null ? "" : String(booklet));
    form.set("quantity", quantity);
    form.set("purchase_date", purchase);
    form.set("description", description);
    form.set("language", lang);
    for (const file of files) form.append("photos", file, file.name);
    const result = await request<{ reference: string }>("POST", "/api/claims", form);
    setBusy(false);
    if (result.data) {
      navigate(`/claim/${result.data.reference}/sent`);
      return;
    }
    if (result.error?.code === "validation_failed" && result.error.fields) {
      showAlert(refuseFields(result.error.fields)[0] ?? "");
    } else {
      if (result.error?.code === "not_found" || result.error?.code === "part_withdrawn") setFieldCodes({ part: result.error.code });
      showAlert(ownerRefusal(result, lang, booklet ?? 0));
    }
    focusAlert();
  };

  const err = (field: FieldKey) => (fieldCodes[field] ? <p class="field-error">{fieldError(field, lang)}</p> : null);
  const partError = (): string | null =>
    fieldCodes.part === "part_withdrawn" ? fill(pick(OWNER_REFUSALS.part_withdrawn, lang), { number: booklet ?? 0 }) : fieldCodes.part ? fieldError("part", lang) : null;

  return (
    <div class="stack">
      <h1 class="plate-title">{t("claimFormHeading")}</h1>
      <div class="two-col">
        <div class="fan-column">
          {detail ? (
            <Fan key={detail.slug} model={detail} lang={lang} selected={booklet} onSelect={setBooklet} startOpen={false} />
          ) : (
            <FanPlaceholder text={t("fanEmpty")} />
          )}
        </div>
        <form noValidate onSubmit={(event) => void start(event)}>
          <div class="field">
            <label for="claim-name">{t("labelName")}</label>
            <input id="claim-name" type="text" autoComplete="name" value={name} onInput={(event) => setName(event.currentTarget.value)} />
            {err("name")}
          </div>
          <div class="field">
            <label for="claim-email">{t("labelEmail")}</label>
            <input id="claim-email" type="email" autoComplete="email" value={email} onInput={(event) => setEmail(event.currentTarget.value)} />
            {err("email")}
          </div>
          <div class="field">
            <label for="claim-postcode">{t("labelPostcode")}</label>
            <input id="claim-postcode" type="text" autoComplete="postal-code" value={postcode} onInput={(event) => setPostcode(event.currentTarget.value)} />
            {err("postcode")}
          </div>
          {modelsAnswered ? (
            <div class="field">
              <label for="claim-model">{t("labelModel")}</label>
              <select id="claim-model" value={slug} onChange={(event) => chooseModel(event.currentTarget.value)}>
                <option value="">{t("chooseModel")}</option>
                {models.map((model) => (
                  <option key={model.slug} value={model.slug}>
                    {model.name}
                  </option>
                ))}
              </select>
              {partError() ? <p class="field-error">{partError()}</p> : null}
            </div>
          ) : null}
          <div class="field">
            <label for="claim-purchase">{t("labelPurchase")}</label>
            <input id="claim-purchase" type="date" value={purchase} onInput={(event) => setPurchase(event.currentTarget.value)} />
            {err("purchase_date")}
          </div>
          <div class="field">
            <label for="claim-quantity">{t("labelQuantity")}</label>
            <input id="claim-quantity" type="number" inputMode="numeric" value={quantity} onInput={(event) => setQuantity(event.currentTarget.value)} />
            {err("quantity")}
          </div>
          <div class="field">
            <label for="claim-what">{t("labelWhat")}</label>
            <textarea id="claim-what" value={description} onInput={(event) => setDescription(event.currentTarget.value)} />
            {err("description")}
          </div>
          <div class="field">
            <label for="claim-photos">{t("labelPhotos")}</label>
            <input id="claim-photos" type="file" multiple accept="image/jpeg,image/png,image/webp" onChange={(event) => setFiles([...(event.currentTarget.files ?? [])])} />
            <p class="hint">{t("photosHint")}</p>
            {photoCount ? <p class="field-error">{pick(OWNER_REFUSALS.photo_count, lang)}</p> : null}
            {photoCodes.length > 0 ? (
              <ul class="photo-errors">
                {photoCodes.map((photo) => (
                  <li key={photo.index}>{photoMessage(photo.index, photo.code)}</li>
                ))}
              </ul>
            ) : null}
          </div>
          <section class="estimate" role="region" aria-label={t("estimateRegion")}>
            <p class="hint">{t("carriageHint")}</p>
            <button type="button" onClick={() => void askCarrier()}>
              {t("estimateButton")}
            </button>
            <p class={`estimate-result${estimate?.kind === "refused" ? " refused" : ""}`}>{estimate?.text ?? ""}</p>
          </section>
          <button type="submit" class="primary" disabled={busy}>
            {t("startButton")}
          </button>
          {chosenPart ? (
            <p class="selected-part">
              {partLine(chosenPart.booklet_number, chosenPart.name, lang)}
              <span class="mono">{partNumberLine(chosenPart.part_number, lang)}</span>
            </p>
          ) : null}
        </form>
      </div>
    </div>
  );
}

