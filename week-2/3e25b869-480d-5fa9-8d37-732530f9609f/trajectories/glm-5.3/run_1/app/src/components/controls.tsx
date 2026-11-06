// Shared controls: error summaries, email step, shipping fields, province picker,
// dialogs and cadence menus, all with the published accessible names.
import { useEffect, useRef, useState } from "preact/hooks";
import type { ComponentChildren } from "preact";
import { t, fieldText, type Locale } from "../state/i18n.js";
import { formatMoney } from "../state/format.js";
import { api, ApiError, PROVINCES } from "../state/api.js";

export interface FieldError { [path: string]: string; }

export function ErrorSummary({ locale, errors, labels }: { locale: Locale; errors: FieldError; labels: Record<string, string> }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return (
    <div ref={ref} role="alert" tabIndex={-1} class="error-summary" aria-label={t("checkFields", locale)}>
      <p>{t("checkFields", locale)}</p>
      <ul>
        {Object.keys(errors)
          .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
          .map((path) => (
            <li key={path}>
              <a
                href={`#field-${path.replace(/\./g, "-")}`}
                onClick={(event) => {
                  event.preventDefault();
                  const field = document.getElementById(`field-${path.replace(/\./g, "-")}`);
                  field?.focus();
                }}
              >
                {labels[path] ? `${labels[path]}: ${errors[path]}` : errors[path]}
              </a>
            </li>
          ))}
      </ul>
    </div>
  );
}

export function FieldMessage({ path, value }: { path: string; value?: string }) {
  if (!value) return null;
  return <p class="field-message" id={`message-${path.replace(/\./g, "-")}`}>{value}</p>;
}

export function provinceLabel(code: string, locale: Locale): string {
  const province = PROVINCES.find((candidate) => candidate.code === code);
  if (!province) return code;
  return locale === "fr-CA" ? province.fr : province.en;
}

export function ProvinceSelect({
  locale, value, onChange, id = "field-province"
}: { locale: Locale; value: string; onChange: (value: string) => void; id?: string }) {
  return (
    <div class="field">
      <label for={id}>{t("province", locale)}</label>
      <select id={id} value={value} onChange={(event) => onChange((event.target as HTMLSelectElement).value)}>
        {PROVINCES.map((province) => (
          <option key={province.code} value={province.code}>{provinceLabel(province.code, locale)}</option>
        ))}
      </select>
    </div>
  );
}

export function ShippingFields({
  locale, values, errors, onField
}: {
  locale: Locale;
  values: { name: string; line1: string; city: string; province: string; postal_code: string };
  errors: FieldError;
  onField: (field: keyof typeof values, value: string) => void;
}) {
  const field = (key: keyof typeof values, labelKey: string, inputType = "text") => (
    <div class="field">
      <label for={`field-shipping-${key}`}>{t(labelKey, locale)}</label>
      <input
        id={`field-shipping-${key}`}
        type={inputType}
        value={values[key]}
        aria-invalid={errors[`shipping.${key}`] ? "true" : undefined}
        aria-describedby={errors[`shipping.${key}`] ? `message-shipping-${key}` : undefined}
        onInput={(event) => onField(key, (event.target as HTMLInputElement).value)}
      />
      <FieldMessage path={`shipping.${key}`} value={errors[`shipping.${key}`]} />
    </div>
  );
  return (
    <div class="shipping-fields">
      {field("name", "fullName")}
      {field("line1", "streetAddress")}
      {field("city", "city")}
      <div class="field">
        <label for="field-shipping-province">{t("province", locale)}</label>
        <select
          id="field-shipping-province"
          value={values.province}
          aria-invalid={errors["shipping.province"] ? "true" : undefined}
          onChange={(event) => onField("province", (event.target as HTMLSelectElement).value)}
        >
          {PROVINCES.map((province) => (
            <option key={province.code} value={province.code}>{provinceLabel(province.code, locale)}</option>
          ))}
        </select>
        <FieldMessage path="shipping.province" value={errors["shipping.province"]} />
      </div>
      {field("postal_code", "postalCode")}
    </div>
  );
}

export function shippingLabels(locale: Locale): Record<string, string> {
  return {
    "shipping.name": t("fullName", locale),
    "shipping.line1": t("streetAddress", locale),
    "shipping.city": t("city", locale),
    "shipping.province": t("province", locale),
    "shipping.postal_code": t("postalCode", locale)
  };
}

export interface EmailStepState {
  email: string;
  code: string;
  verified: boolean;
  pending: "code" | "verify" | null;
  rateLimited: boolean;
  lockedOut: boolean;
}

export function EmailStep({
  locale, state, setState, serverErrors, purpose
}: {
  locale: Locale;
  state: EmailStepState;
  setState: (patch: Partial<EmailStepState>) => void;
  serverErrors: FieldError;
  purpose: "checkout" | "sign_in";
}) {
  const labels = { email: t("email", locale), code: t("code", locale) };
  const mergedErrors: FieldError = { ...serverErrors };
  const sendCode = async () => {
    setState({ pending: "code" });
    try {
      await api("/auth/code", { method: "POST", body: { email: state.email, purpose } });
      setState({ pending: null, rateLimited: false });
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) {
        setState({ pending: null, rateLimited: true });
      } else if (err instanceof ApiError && err.status === 422 && err.fields) {
        setState({ pending: null });
      } else {
        setState({ pending: null });
      }
    }
  };
  const verify = async () => {
    setState({ pending: "verify" });
    try {
      await api("/auth/verify", { method: "POST", body: { email: state.email, code: state.code } });
      setState({ pending: null, verified: true, lockedOut: false });
      const nameField = document.getElementById("field-shipping-name") as HTMLElement | null;
      nameField?.focus();
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) {
        setState({ pending: null, lockedOut: true });
      } else if (err instanceof ApiError && err.status === 422 && err.fields) {
        setState({ pending: null });
      } else {
        setState({ pending: null });
      }
    }
  };
  if (state.verified) {
    return (
      <div class="email-step signed-in">
        <p>{t("signedInAs", locale, { email: state.email })}</p>
      </div>
    );
  }
  return (
    <fieldset class="email-step">
      {state.rateLimited && (
        <div role="alert" class="alert" tabIndex={-1} ref={(element) => { setTimeout(() => (element as HTMLElement | null)?.focus(), 0); }}>
          <p>{locale === "fr-CA" ? "Trop de codes ont été demandés pour ce courriel. Patientez quelques minutes, puis réessayez." : "Too many codes were requested for this email. Wait a few minutes, then try again."}</p>
        </div>
      )}
      {state.lockedOut && (
        <div role="alert" class="alert" tabIndex={-1} ref={(element) => { setTimeout(() => (element as HTMLElement | null)?.focus(), 0); }}>
          <p>{locale === "fr-CA" ? "Trop de codes erronés. Patientez quelques minutes, puis demandez un nouveau code." : "Too many incorrect codes. Wait a few minutes, then request a new code."}</p>
        </div>
      )}
      <div class="field">
        <label for="field-email">{t("email", locale)}</label>
        <input
          id="field-email"
          type="email"
          value={state.email}
          aria-invalid={mergedErrors.email ? "true" : undefined}
          onInput={(event) => setState({ email: (event.target as HTMLInputElement).value })}
        />
        <FieldMessage path="email" value={mergedErrors.email} />
      </div>
      <button
        type="button"
        class="button"
        disabled={state.pending !== null}
        onClick={sendCode}
      >
        {state.pending === "code" ? t("sending", locale) : t("sendCode", locale)}
      </button>
      <div class="field">
        <label for="field-code">{t("code", locale)}</label>
        <input
          id="field-code"
          type="text"
          inputmode="numeric"
          value={state.code}
          aria-invalid={mergedErrors.code ? "true" : undefined}
          onInput={(event) => setState({ code: (event.target as HTMLInputElement).value })}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void verify();
            }
          }}
        />
        <FieldMessage path="code" value={mergedErrors.code} />
      </div>
      <button
        type="button"
        class="button primary"
        disabled={state.pending !== null}
        onClick={verify}
      >
        {state.pending === "verify" ? t("checking", locale) : t("verify", locale)}
      </button>
      {Object.keys(mergedErrors).length > 0 && <ErrorSummary locale={locale} errors={mergedErrors} labels={labels} />}
    </fieldset>
  );
}

export function money(cents: number, locale: Locale): string {
  return formatMoney(cents, locale);
}

export function Dialog({
  title, open, onClose, onConfirm, children, confirmLabel, closeLabel
}: {
  title: string;
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  children?: ComponentChildren;
  confirmLabel: string;
  closeLabel: string;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const [show, setShow] = useState(open);
  useEffect(() => {
    setShow(open);
    if (open) {
      openerRef.current = document.activeElement as HTMLElement | null;
      setTimeout(() => {
        const first = dialogRef.current?.querySelector<HTMLElement>("button, input, select, textarea");
        first?.focus();
      }, 0);
    }
  }, [open]);
  if (!show) return null;
  const close = () => {
    setShow(false);
    onClose();
    openerRef.current?.focus();
  };
  const confirm = () => {
    setShow(false);
    onConfirm();
  };
  const keys = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    }
    if (event.key === "Tab") {
      const focusables = dialogRef.current?.querySelectorAll<HTMLElement>("button, input, select, textarea") ?? [];
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  };
  return (
    <div class="dialog-backdrop">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        class="dialog"
        onKeyDown={keys}
      >
        <h2>{title}</h2>
        {children}
        <div class="dialog-actions">
          <button type="button" class="button primary" onClick={confirm}>{confirmLabel}</button>
          <button type="button" class="button" onClick={close}>{closeLabel}</button>
        </div>
      </div>
    </div>
  );
}

export function fieldMessageFor(path: string, locale: Locale): string {
  return fieldText(path, locale);
}
