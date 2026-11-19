import { Sticker, type StickerKind } from "../components/Sticker";
import { COPY } from "../copy";

function OnePage({ heading, sticker, children }: { heading: string; sticker: StickerKind; children?: React.ReactNode }) {
  return (
    <div className="field field-slate one-page">
      <Sticker kind={sticker} tilt={-8} className="one-page-sticker" />
      <main className="one-page-body">
        <h1 className="one-line">{heading}</h1>
        {children}
      </main>
    </div>
  );
}

export function SignInErrorPage() {
  return (
    <OnePage heading={COPY.pages.signInError} sticker="coin">
      <p className="one-next">{COPY.pages.signInErrorNext}</p>
      <a className="pill" href="/auth/login?next=/">Sign in</a>
    </OnePage>
  );
}

export function SignInUnavailablePage() {
  return <OnePage heading={COPY.pages.signInUnavailable} sticker="dial" />;
}

export function NoVenuePage() {
  return (
    <OnePage heading={COPY.pages.noVenue} sticker="envelope">
      <p className="one-next">{COPY.pages.noVenueNext}</p>
    </OnePage>
  );
}

export function NotFoundPage() {
  return <OnePage heading={COPY.pages.notFound} sticker="cube" />;
}
