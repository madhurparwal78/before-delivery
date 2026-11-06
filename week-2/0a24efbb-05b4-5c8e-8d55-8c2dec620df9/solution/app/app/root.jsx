import { Links, Outlet, isRouteErrorResponse, useRouteError, useRouteLoaderData } from "react-router";
import { Page, SharedPage } from "./page.jsx";
import stylesheet from "./styles.css?url";

export const links = () => [
  { rel: "stylesheet", href: stylesheet },
  { rel: "preload", href: "/fonts/open-sans-latin-wght-normal.woff2", as: "font", type: "font/woff2", crossOrigin: "anonymous" },
  { rel: "preload", href: "/fonts/poppins-latin-600-normal.woff2", as: "font", type: "font/woff2", crossOrigin: "anonymous" },
  { rel: "icon", href: "data:," },
];

export async function loader({ context }) {
  const { caller, desk, bare = false } = context;
  return {
    caller: caller && { name: caller.name, role: caller.role },
    version: (await desk.currentPolicy()).version,
    bare,
  };
}

export function Layout({ children }) {
  // The shared month needs no script.
  const bare = useRouteLoaderData("root")?.bare;
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Links />
      </head>
      <body>
        {children}
        {!bare && <script type="module" src="/desk.js" />}
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}

const HEADINGS = {
  400: "That filter is not one the queue understands.",
  403: "Your role does not have access to this page.",
  404: "That page does not exist",
  500: "The desk could not complete that. Try again.",
};

/** The desk's own 400, 403, 404 and 500 pages, inside the chrome when someone is signed in. */
export function ErrorBoundary() {
  const error = useRouteError();
  const status = isRouteErrorResponse(error) ? error.status : 500;
  if (status === 410) {
    const gone = "This shared month is no longer available";
    return (
      <SharedPage title={gone}>
        <section className="answer">
          <h1>{gone}</h1>
          <p>Ask the person who shared it for a new link.</p>
        </section>
      </SharedPage>
    );
  }
  const heading = HEADINGS[status] ?? HEADINGS[500];
  const signedIn = Boolean(useRouteLoaderData("root")?.caller);
  return (
    <Page title={heading} crumb={signedIn ? error.data?.crumb ?? heading : undefined}>
      <section className="answer">
        <h1>{heading}</h1>
        {status === 404 && (
          <p>The link may be out of date. Go back to the desk.</p>
        )}
        {status === 400 && (
          <p>
            <a href="/requests">Clear filters</a>
          </p>
        )}
      </section>
    </Page>
  );
}
