import { useCallback, useEffect, useState, type ReactElement } from "react";
import type { IdDocumentState, IdState } from "../../shared/api";
import { announce } from "../lib/announce";
import { ApiError, api, errorMessage } from "../lib/http";
import { useLive } from "../lib/live";
import { ratingText } from "../lib/format";
import { useSession } from "../lib/session";
import { useRequireMember } from "../lib/useRequireSignIn";
import { Alert, PageHeading, StatusLine } from "../ui/Bits";

const ID_TEXT: Record<IdState, string> = {
  none: "not uploaded",
  pending: "waiting for review",
  verified: "verified",
  rejected: "please upload again",
};

type Kind = "photo" | "id";

export function ProfilePage(): ReactElement | null {
  const member = useRequireMember();
  const session = useSession();
  const [doc, setDoc] = useState<IdDocumentState | null>(null);
  const [files, setFiles] = useState<Record<Kind, File | null>>({ photo: null, id: null });
  const [pending, setPending] = useState<Kind | null>(null);
  const [errors, setErrors] = useState<Record<Kind, string>>({ photo: "", id: "" });
  const [retry, setRetry] = useState<Kind | null>(null);
  const [saved, setSaved] = useState("");

  const load = useCallback(async () => {
    setDoc(await api<IdDocumentState>("GET", "/api/me/id-document"));
    await session.refresh();
  }, [session]);

  useEffect(() => {
    if (member) void load();
    // load once per member; the session object changes on refresh
  }, [member?.id]);

  useLive({
    onEvent: (event) => {
      if (event.type === "hello") void load();
      if (event.type === "id_review") {
        setDoc((d) => ({ id_state: event.data.id_state, reason: event.data.reason, file_id: d?.file_id ?? null }));
        void session.refresh();
        if (event.data.id_state === "verified") announce("Your ID is verified.");
        if (event.data.id_state === "rejected") announce(`Please upload your ID again: ${event.data.reason ?? ""}.`);
      }
    },
  });

  if (!member) return null;

  const upload = async (kind: Kind): Promise<void> => {
    if (pending) return;
    const file = files[kind];
    if (!file) {
      setErrors({ ...errors, [kind]: "Choose a file to upload." });
      return;
    }
    setPending(kind);
    setErrors({ ...errors, [kind]: "" });
    setRetry(null);
    const form = new FormData();
    form.set("file", file);
    try {
      await api("POST", kind === "photo" ? "/api/me/photo" : "/api/me/id-document", { form });
      const message = kind === "photo" ? "Profile photo saved." : "ID document received. It is waiting for review.";
      announce(message);
      setSaved(message);
      await load();
    } catch (e) {
      setErrors((current) => ({ ...current, [kind]: errorMessage(e) }));
      if (e instanceof ApiError && e.code === "storage_unavailable") setRetry(kind);
    } finally {
      setPending(null);
    }
  };

  const state = doc?.id_state ?? member.id_state;

  return (
    <div className="profile-page">
      <PageHeading>Profile</PageHeading>
      <section className="profile-head" aria-label="You">
        {member.photo_url ? <img src={member.photo_url} alt="" width="96" height="96" /> : null}
        <div>
          <p className="driver-name">{member.display_name}</p>
          <p className="muted">{member.email}</p>
          <p className="muted">{ratingText(member.rating)}</p>
        </div>
      </section>

      <p className="id-status">{`ID status: ${ID_TEXT[state]}`}</p>
      {state === "rejected" && doc?.reason ? <p className="muted">{doc.reason}</p> : null}
      <StatusLine text={saved} />

      <form
        className="stack-form"
        onSubmit={(event) => {
          event.preventDefault();
          void upload("photo");
        }}
      >
        <div className="field">
          <label htmlFor="profile-photo">Profile photo</label>
          <input id="profile-photo" type="file" accept="image/png,image/jpeg" onChange={(e) => setFiles({ ...files, photo: e.target.files?.[0] ?? null })} />
        </div>
        <div className="actions">
          <button type="submit">{pending === "photo" ? "Working" : "Upload photo"}</button>
          {retry === "photo" ? (
            <button type="button" onClick={() => void upload("photo")}>
              Try again
            </button>
          ) : null}
        </div>
        <Alert>{errors.photo}</Alert>
      </form>

      <form
        className="stack-form"
        onSubmit={(event) => {
          event.preventDefault();
          void upload("id");
        }}
      >
        <div className="field">
          <label htmlFor="id-document">ID document</label>
          <input id="id-document" type="file" accept="image/png,image/jpeg,application/pdf" onChange={(e) => setFiles({ ...files, id: e.target.files?.[0] ?? null })} />
        </div>
        <div className="actions">
          <button type="submit">{pending === "id" ? "Working" : "Upload ID document"}</button>
          {retry === "id" ? (
            <button type="button" onClick={() => void upload("id")}>
              Try again
            </button>
          ) : null}
        </div>
        <Alert>{errors.id}</Alert>
      </form>
    </div>
  );
}
