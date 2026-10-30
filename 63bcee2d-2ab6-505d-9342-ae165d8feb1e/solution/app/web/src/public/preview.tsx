import { useCallback, useEffect, useState } from "react";
import { get, post } from "../api";
import { FORBIDDEN, NETWORK_FAILURE, NOT_FOUND, otherIllegal } from "../office/copy";
import { navigate } from "../router";
import { CaseStudyArticle, type CaseStudyView } from "./casestudy";
import { NotFoundPage } from "./notfound";
import { useNotices } from "./shell";

// A case-study preview exactly as it will appear publicly, with the approval controls. The link only shows
// the case study; approving needs a signed-in client approver of the brand.

interface Preview {
  caseStudy: CaseStudyView & { id: string };
  canApprove: boolean;
}

export function PreviewPage({ token }: { token: string }) {
  const notices = useNotices();
  const [preview, setPreview] = useState<Preview | "missing" | null>(null);
  const [busy, setBusy] = useState(false);
  const [approved, setApproved] = useState(false);

  const load = useCallback(async () => {
    const result = await get<Preview>(`/api/preview/${encodeURIComponent(token)}`);
    setPreview(result.ok ? result.data : "missing");
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  if (preview === "missing") return <NotFoundPage />;
  if (!preview) return <section className="section section-plaster loading-section" data-tone="light" aria-busy="true" />;

  const approve = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    notices.announce("Approving…");
    const result = await post(`/api/case-studies/${preview.caseStudy.id}/approve`, {});
    setBusy(false);
    if (result.ok) {
      setApproved(true);
      notices.announce("Approved for publishing.");
      await load();
      return;
    }
    notices.announce("");
    if (result.status === 401) navigate(`/sign-in?next=${encodeURIComponent(`/preview/${token}`)}`);
    else if (result.status === 0) notices.alert(NETWORK_FAILURE);
    else if (result.status === 404) notices.alert(NOT_FOUND);
    else if (result.status === 403) notices.alert(FORBIDDEN);
    else notices.alert(otherIllegal(String(result.body.from ?? "changed")));
  };

  return (
    <>
      <section className="section section-dark preview-bar" data-tone="dark">
        <div className="grid">
          <p className="sheet-caption"><span>Preview</span><span>Not yet public</span></p>
          <div className="approval">
            <p>This is how the case study will appear on the public site once it is approved and published.</p>
            {preview.canApprove ? (
              <button type="button" className="primary roll" aria-disabled={busy || undefined} onClick={() => void approve()}>
                {busy ? "Approving…" : "Approve for publishing"}
              </button>
            ) : approved ? (
              <p className="approval-done">Approved. The studio director can now publish it.</p>
            ) : (
              <a className="primary" href={`/sign-in?next=${encodeURIComponent(`/preview/${token}`)}`}>Sign in to approve</a>
            )}
          </div>
        </div>
      </section>
      <CaseStudyArticle study={preview.caseStudy} pageTitle={`${preview.caseStudy.title} · Marrow Hall Interiors`} />
    </>
  );
}
