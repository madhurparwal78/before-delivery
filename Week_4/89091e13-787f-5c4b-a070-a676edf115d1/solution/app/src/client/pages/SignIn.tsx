import { useEffect, useState } from "react";
import type { Me } from "../../shared/api.ts";
import { Field, FormAlert, SubmitButton, useFormModel } from "../components/forms.tsx";
import { Boot } from "../components/StrandCanvas.tsx";
import { PublicTopBar } from "../components/TopBar.tsx";
import { api } from "../lib/api.ts";
import { navigate } from "../lib/router.tsx";
import { useSession } from "../lib/session.tsx";

function explorerOf(me: Me): string | null {
  const first = me.workspaces[0];
  return first ? `/w/${first.id}/explorer` : null;
}

export function SignInPage() {
  const { status, me, refresh } = useSession();
  const model = useFormModel();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  useEffect(() => {
    const target = me && explorerOf(me);
    if (status === "in" && target) navigate(target, true);
  }, [status, me]);

  return (
    <>
      <PublicTopBar />
      <main className="page page--centred">
        <section className="panel auth-panel">
          <h1 className="page-title page-title--form">Sign in</h1>
          <form aria-label="Sign in" noValidate className="stack" onSubmit={(event) => {
            event.preventDefault();
            void model.run(event.currentTarget, async () => {
              const session = await api<Me>("POST", "/api/session", { email, password });
              await refresh();
              navigate(explorerOf(session) ?? "/");
              return "";
            });
          }}>
            <Field name="email" label="Email" error={model.errors.email}>
              {(props) => <input {...props} type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />}
            </Field>
            <Field name="password" label="Password" error={model.errors.password}>
              {(props) => <input {...props} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />}
            </Field>
            <FormAlert model={model} />
            <SubmitButton model={model}>Sign in</SubmitButton>
          </form>
        </section>
      </main>
    </>
  );
}

export function HomeRedirect() {
  const { status, me } = useSession();
  useEffect(() => {
    if (status === "loading") return;
    navigate((me && explorerOf(me)) ?? "/signin", true);
  }, [status, me]);
  return <Boot />;
}
