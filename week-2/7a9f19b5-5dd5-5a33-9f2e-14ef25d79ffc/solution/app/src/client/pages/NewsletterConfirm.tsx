import { useEffect, useState } from "react";
import { request } from "../lib/api";
import { useLocation } from "../lib/router";

export function NewsletterConfirm() {
  const { search } = useLocation();
  const token = search.get("token") ?? "";
  const [result, setResult] = useState<{ email: string } | "invalid" | null>(null);

  useEffect(() => {
    document.title = "Newsletter · Lightfall";
    void request<{ email: string }>(`/api/newsletter/confirm?token=${encodeURIComponent(token)}`).then((reply) =>
      setResult(reply.ok ? { email: reply.data.email } : "invalid"),
    );
  }, [token]);

  if (!result) return <div className="page-loading" aria-busy="true" />;
  return (
    <div className="confirm">
      {result === "invalid" ? (
        <>
          <h1>That confirmation link isn't valid.</h1>
          <p>Subscribe again from the form below and we'll send you a fresh link.</p>
        </>
      ) : (
        <>
          <h1>You're subscribed</h1>
          <p>The Lightfall newsletter will come to {result.email}.</p>
        </>
      )}
    </div>
  );
}
