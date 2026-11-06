import { useState } from "react";
import { post } from "../../api";
import { navigate, useQuery } from "../../router";
import { useOffice } from "../context";
import { NETWORK_FAILURE, WRONG_PASSWORD } from "../copy";
import { TextField } from "../fields";
import { ActionButton } from "../layout";
import { OfficeShell } from "../shell";
import "./access.css";

/** Only a same-site path is followed after sign-in. */
const safeNext = (next: string | null): string => (next && next.startsWith("/") && !next.startsWith("//") ? next : "/office");

export function SignInPage() {
  const office = useOffice();
  const next = safeNext(useQuery().get("next"));
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const signIn = async (): Promise<void> => {
    office.announce("Signing in…");
    const result = await post<{ member: { id: string } }>("/api/session", { email, password });
    if (!result.ok) {
      office.announce("");
      office.alert(result.status === 0 ? NETWORK_FAILURE : WRONG_PASSWORD);
      return;
    }
    office.clear();
    await office.refreshSession();
    navigate(next);
  };

  return (
    <OfficeShell title="Sign in" signedIn={false}>
      <div className="access">
        <section className="panel access-card" aria-labelledby="sign-in-title">
          <div className="title-block access-title">
            <span><span className="label">Sheet</span> PL-00</span>
            <span>Workspace</span>
            <span>Marrow Hall Interiors</span>
          </div>
          <form className="panel-body" noValidate onSubmit={(event) => event.preventDefault()}>
            <h1 id="sign-in-title">Sign in to Plumbline</h1>
            <p className="access-lede">The delivery workspace for studio staff, brand approvers and contractors.</p>
            <TextField form="sign-in" name="email" label="Email" type="email" autoComplete="username" value={email} onChange={setEmail} />
            <TextField form="sign-in" name="password" label="Password" type="password" autoComplete="current-password" value={password} onChange={setPassword} />
            <ActionButton primary type="submit" pending="Signing in…" onAction={signIn}>Sign in</ActionButton>
          </form>
        </section>
        <aside className="access-aside" aria-label="About Plumbline">
          <p className="access-quote">Every stage signed off, every sheet current, every cent of retention accounted for.</p>
          <dl className="access-facts">
            <div><dt>Stage gates</dt><dd>Groundwork to Aftercare</dd></div>
            <div><dt>Regions</dt><dd>Hong Kong, Singapore, Macao</dd></div>
          </dl>
        </aside>
      </div>
    </OfficeShell>
  );
}
