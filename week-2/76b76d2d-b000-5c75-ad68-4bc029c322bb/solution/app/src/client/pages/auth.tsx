import { useState } from "preact/hooks";
import type { Account } from "../../shared/api.ts";
import type { Locale } from "../../shared/domain.ts";
import { api } from "../api.ts";
import { useApp } from "../context.tsx";
import { Feedback, Field, SelectField, useAction } from "../ui.tsx";

export function SignInPage() {
  const { locale, t, navigate } = useApp();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const action = useAction();
  const next = new URLSearchParams(location.search).get("next");

  const submit = (event: Event) => {
    event.preventDefault();
    void action.run(
      () => api<{ account: Account; redirect: string }>("POST", "/api/auth/signin", { email, password, ...(next ? { next } : {}) }),
      (data) => {
        navigate(data.redirect);
        return "";
      },
    );
  };
  return (
    <section class="page narrow">
      <h1 tabIndex={-1} class="page-title">{t.signInHeading}</h1>
      <form class="stack-form" noValidate onSubmit={submit}>
        <Field label={t.email} type="email" value={email} onInput={setEmail} autocomplete="email" error={action.fields["email"]} />
        <Field label={t.password} type="password" value={password} onInput={setPassword} autocomplete="current-password" error={action.fields["password"]} />
        <button type="submit" class="button primary" disabled={action.busy}>{action.busy ? t.working : t.signIn}</button>
        <Feedback statusName={t.formStatus} alertName={t.formError} status={action.status} error={action.error} />
      </form>
      <p class="aside-link"><a href={`/${locale}/signup`}>{t.createAccountLink}</a></p>
    </section>
  );
}

export function SignUpPage() {
  const { locale, t, navigate } = useApp();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [preferred, setPreferred] = useState<Locale>(locale);
  const action = useAction();

  const submit = (event: Event) => {
    event.preventDefault();
    void action.run(
      () => api<{ account: Account }>("POST", "/api/auth/signup", { name, email, password, locale: preferred }),
      (data) => {
        navigate(`/${data.account.locale}/account`);
        return "";
      },
    );
  };
  return (
    <section class="page narrow">
      <h1 tabIndex={-1} class="page-title">{t.signUpHeading}</h1>
      <form class="stack-form" noValidate onSubmit={submit}>
        <Field label={t.fullName} value={name} onInput={setName} autocomplete="name" error={action.fields["name"]} />
        <Field label={t.email} type="email" value={email} onInput={setEmail} autocomplete="email" error={action.fields["email"]} />
        <Field label={t.password} type="password" value={password} onInput={setPassword} autocomplete="new-password" error={action.fields["password"]} />
        <SelectField label={t.preferredLanguage} value={preferred} onChange={(v) => setPreferred(v === "fr" ? "fr" : "en")}
          options={[{ value: "en", label: "English" }, { value: "fr", label: "Français" }]} error={action.fields["locale"]} />
        <button type="submit" class="button primary" disabled={action.busy}>{action.busy ? t.working : t.createAccount}</button>
        <Feedback statusName={t.formStatus} alertName={t.formError} status={action.status} error={action.error} />
      </form>
      <p class="aside-link"><a href={`/${locale}/signin`}>{t.haveAccount}</a></p>
    </section>
  );
}
