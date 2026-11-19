// Pages for the sign-in outage, the sign-in error, a desk that is not yours and an address that does not exist.
import { EmptyState, Header, ConnectionBanner } from "./ui";

export function SignInOutagePage() {
  return (
    <>
      <Header />
      <main class="narrow">
        <div role="alert" class="banner flat">
          Sign-in is unavailable right now. If you are already signed in, you can carry on bidding.
        </div>
        <p>
          <a class="plain-link" href="/">
            Back to the saleroom
          </a>
        </p>
      </main>
    </>
  );
}

export function SignInErrorPage() {
  return (
    <>
      <Header />
      <main class="narrow">
        <h1 class="display">Sign-in could not be completed</h1>
        <p>Please start again from the saleroom.</p>
        <p>
          <a class="gold-btn" href="/auth/login">
            Sign in again
          </a>
        </p>
      </main>
    </>
  );
}

export function NotFoundPage() {
  return (
    <>
      <Header />
      <ConnectionBanner />
      <main class="narrow">
        <EmptyState line="NOT IN THIS SALE">That page is not in the saleroom.</EmptyState>
      </main>
    </>
  );
}

export function NotYourDeskPage() {
  return (
    <>
      <Header />
      <main class="narrow">
        <EmptyState line="NOT YOUR DESK">This desk belongs to another role.</EmptyState>
      </main>
    </>
  );
}

export function ServerErrorPage() {
  return (
    <>
      <Header />
      <main class="narrow">
        <EmptyState line="SOMETHING WENT WRONG">Something went wrong in the saleroom. Try again.</EmptyState>
      </main>
    </>
  );
}
