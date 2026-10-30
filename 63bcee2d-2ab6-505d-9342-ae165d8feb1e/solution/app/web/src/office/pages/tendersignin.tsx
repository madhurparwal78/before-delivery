import { post } from "../../api";
import { navigate } from "../../router";
import { useOffice } from "../context";
import { ActionButton } from "../layout";
import { OfficeShell } from "../shell";

// /tender-sign-in/<token>: names the tender; only "Continue to tender" uses the single-use link.

const EXPIRED = "This sign-in link has expired or has already been used.";
const title = document.querySelector('meta[name="plumbline-tender-title"]')?.getAttribute("content") ?? "";

export function TenderSignInPage({ token }: { token: string }) {
  const office = useOffice();
  const go = async (): Promise<void> => {
    office.announce("Signing you in…");
    const result = await post<{ tenderId: string }>("/api/tender-links/consume", { token });
    if (result.ok) {
      await office.refreshSession();
      navigate(`/office/tenders/${result.data.tenderId}`);
      return;
    }
    office.announce("");
    if (result.status === 404) office.alert(EXPIRED);
    else office.refused(result);
  };
  return (
    <OfficeShell title="Tender sign-in" signedIn={false}>
      <section className="panel sign-panel">
        <div className="panel-body">
          <p className="eyebrow">Invitation to tender</p>
          <h1>{title || "Your tender"}</h1>
          <p>This link signs you in to submit or amend your sealed bid. It works once, so continue when you are ready.</p>
          <div className="actions">
            <ActionButton primary pending="Signing you in…" onAction={go}>Continue to tender</ActionButton>
          </div>
        </div>
      </section>
    </OfficeShell>
  );
}
