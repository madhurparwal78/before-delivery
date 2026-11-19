import { useState } from "react";
import { LinkPill } from "../components/Pill.tsx";
import { Field, FormAlert, SubmitButton, useFormModel } from "../components/forms.tsx";
import { PublicTopBar } from "../components/TopBar.tsx";
import { api } from "../lib/api.ts";
import { useJson } from "../lib/resource.ts";
import { navigate } from "../lib/router.tsx";
import { useSession } from "../lib/session.tsx";

interface InviteInfo {
  workspaceName: string;
  email: string;
  role: string;
  existingAccount: boolean;
}

export function InvitePage({ token }: { token: string }) {
  const invite = useJson<InviteInfo>(`/api/invites/${token}`);
  const { refresh } = useSession();
  const model = useFormModel();
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");

  return (
    <>
      <PublicTopBar />
      <main className="page page--centred">
        <section className="panel auth-panel" aria-busy={invite.loading}>
          {invite.error && (
            <>
              <h1 className="page-title page-title--form">Invite</h1>
              <p role="alert" className="form-alert">{invite.error.message}</p>
              <LinkPill to="/signin" variant="outline">Go to sign in</LinkPill>
            </>
          )}
          {invite.data && (
            <>
              <h1 className="page-title page-title--form">Join {invite.data.workspaceName} on Fernsquare</h1>
              <form aria-label="Accept invite" noValidate className="stack" onSubmit={(event) => {
                event.preventDefault();
                void model.run(event.currentTarget, async () => {
                  const accepted = await api<{ workspaceId: string }>("POST", `/api/invites/${token}/accept`, { name, password });
                  await refresh();
                  navigate(`/w/${accepted.workspaceId}/explorer`);
                  return "";
                });
              }}>
                {!invite.data.existingAccount && (
                  <Field name="name" label="Your name" error={model.errors.name}>
                    {(props) => <input {...props} type="text" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />}
                  </Field>
                )}
                <Field name="password" label="Password" error={model.errors.password}>
                  {(props) => <input {...props} type="password" autoComplete={invite.data?.existingAccount ? "current-password" : "new-password"}
                    value={password} onChange={(e) => setPassword(e.target.value)} />}
                </Field>
                <FormAlert model={model} />
                <SubmitButton model={model}>Accept invite</SubmitButton>
              </form>
            </>
          )}
        </section>
      </main>
    </>
  );
}
