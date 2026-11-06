// The contact form and the not-found page.
import { useState } from "preact/hooks";
import type { PageProps } from "../app.js";
import { t } from "../state/i18n.js";
import { api, ApiError } from "../state/api.js";
import { ErrorSummary, type FieldError } from "../components/controls.js";
import { NotFoundContent } from "./checkout.js";

export function ContactPage({ locale }: PageProps) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [topic, setTopic] = useState("");
  const [message, setMessage] = useState("");
  const [errors, setErrors] = useState<FieldError>({});
  const [reference, setReference] = useState("");
  const [pending, setPending] = useState(false);

  const send = async () => {
    setPending(true);
    try {
      const result = await api<{ reference: string }>("/contact", {
        method: "POST",
        body: { name, email, topic, message }
      });
      setReference(result.reference);
      setErrors({});
    } catch (err) {
      if (err instanceof ApiError && err.status === 422 && err.fields) {
        setErrors(err.fields);
      }
    } finally {
      setPending(false);
    }
  };
  const labels: Record<string, string> = {
    name: t("name", locale),
    email: t("email", locale),
    topic: t("topic", locale),
    message: t("message", locale)
  };
  return (
    <div class="page contact-page">
      <h1>{t("contact", locale)}</h1>
      <div role="status" class="contact-status" aria-live="polite" aria-label={t("contactStatus", locale)}>
        {reference
          ? (locale === "fr-CA"
            ? `Merci. Votre référence est ${reference}. Nous vous répondrons par courriel.`
            : `Thanks. Your reference is ${reference}. We'll reply by email.`)
          : pending ? t("saving", locale) : ""}
      </div>
      {Object.keys(errors).length > 0 && <ErrorSummary locale={locale} errors={errors} labels={labels} />}
      <form onSubmit={(event) => { event.preventDefault(); void send(); }}>
        <div class="field">
          <label for="field-contact-name">{t("name", locale)}</label>
          <input id="field-contact-name" value={name} aria-invalid={errors.name ? "true" : undefined} onInput={(event) => setName((event.target as HTMLInputElement).value)} />
          {errors.name && <p class="field-message">{errors.name}</p>}
        </div>
        <div class="field">
          <label for="field-contact-email">{t("email", locale)}</label>
          <input id="field-contact-email" type="email" value={email} aria-invalid={errors.email ? "true" : undefined} onInput={(event) => setEmail((event.target as HTMLInputElement).value)} />
          {errors.email && <p class="field-message">{errors.email}</p>}
        </div>
        <div class="field">
          <label for="field-contact-topic">{t("topic", locale)}</label>
          <select id="field-contact-topic" value={topic} aria-invalid={errors.topic ? "true" : undefined} onChange={(event) => setTopic((event.target as HTMLSelectElement).value)}>
            <option value="">{t("chooseTopic", locale)}</option>
            <option value="order">{locale === "fr-CA" ? "Question sur une commande" : "Order question"}</option>
            <option value="subscription">{locale === "fr-CA" ? "Abonnement" : "Subscription"}</option>
            <option value="wholesale">{locale === "fr-CA" ? "Vente en gros" : "Wholesale"}</option>
            <option value="other">{locale === "fr-CA" ? "Autre chose" : "Something else"}</option>
          </select>
          {errors.topic && <p class="field-message">{errors.topic}</p>}
        </div>
        <div class="field">
          <label for="field-contact-message">{t("message", locale)}</label>
          <textarea id="field-contact-message" rows={6} value={message} aria-invalid={errors.message ? "true" : undefined} onInput={(event) => setMessage((event.target as HTMLTextAreaElement).value)}></textarea>
          {errors.message && <p class="field-message">{errors.message}</p>}
        </div>
        <button type="submit" class="button primary" disabled={pending}>
          {pending ? (locale === "fr-CA" ? "Envoi…" : "Sending…") : t("sendMessage", locale)}
        </button>
      </form>
    </div>
  );
}

export function NotFoundPage({ locale }: PageProps) {
  return <NotFoundContent locale={locale} />;
}
