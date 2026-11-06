// Share: the read-only page an inspector or landlord opens without an account.

import { FileText } from "lucide-react";
import { useEffect, useState } from "react";
import type { ShareView } from "../../shared/api.js";
import { api } from "../api.js";
import { EmptySpike } from "../components/Feedback.js";
import { copy } from "../copy.js";

type Loaded = { state: "loading" } | { state: "dead" } | { state: "live"; view: ShareView };

export function Share({ token }: { token: string }) {
  const [loaded, setLoaded] = useState<Loaded>({ state: "loading" });

  useEffect(() => {
    void api<ShareView>(`/api/share/${encodeURIComponent(token)}`).then((result) =>
      setLoaded(result.ok ? { state: "live", view: result.data } : { state: "dead" }),
    );
  }, [token]);

  return (
    <div className="share">
      <header className="share__top">
        <p className="brand">
          Railside <span className="brand__by">by Brigade &amp; Bench</span>
        </p>
      </header>
      <main className="share__body">
        {loaded.state === "loading" ? <span className="skeleton" aria-busy="true" /> : null}
        {loaded.state === "dead" ? (
          <section className="share__dead">
            <h1 className="screen__title">{copy.share.deadHeading}</h1>
            <p>{copy.share.deadBody}</p>
          </section>
        ) : null}
        {loaded.state === "live" ? (
          <>
            <p className="share__kitchen">{loaded.view.kitchen.name}</p>
            <p className="share__address">{loaded.view.kitchen.address}</p>
            <h1 className="screen__title">Current compliance documents</h1>
            {loaded.view.renters.length === 0 ? (
              <EmptySpike text={copy.empty.share} />
            ) : (
              loaded.view.renters.map((renter, index) => (
                <section key={renter.business_name} className="card share__renter" aria-labelledby={`share-renter-${index}`}>
                  <h2 id={`share-renter-${index}`} className="card__title">
                    {renter.business_name}
                  </h2>
                  <ul className="doc-rows">
                    {renter.documents.map((document) => (
                      <li key={document.id} className="doc-row">
                        <span className="doc-row__label">{document.label}</span>
                        <span className="doc-row__expiry mono">{document.expires_on ? `Expires ${document.expires_on}` : "No expiry date"}</span>
                        <a className="link link--icon" href={document.file_url} target="_blank" rel="noopener">
                          <FileText aria-hidden="true" className="icon" />
                          {`Open ${document.label} for ${renter.business_name}`}
                        </a>
                      </li>
                    ))}
                  </ul>
                </section>
              ))
            )}
          </>
        ) : null}
      </main>
    </div>
  );
}
