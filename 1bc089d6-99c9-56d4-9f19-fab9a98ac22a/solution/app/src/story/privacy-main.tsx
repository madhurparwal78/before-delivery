import "./styles/fonts.css";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/page.css";

import { createRoot } from "react-dom/client";

import { Wordmark } from "./components/Mark";

const SECTIONS = [
  {
    title: "What we keep",
    body: [
      "Your email address, your bedtime, your time zone, the rituals you chose with their minutes, and the note you wrote for tonight.",
      "A record of each reminder sent or skipped, so you never get two for the same night.",
      "The one-time links we email you, and your sign-in sessions (one cookie while you are signed in).",
      "There are no advertising or analytics cookies, and nothing is shared with anyone.",
    ],
  },
  {
    title: "What we send",
    body: [
      "A confirmation email when you save an hour, a sign-in link when you ask for one, and one reminder each night when your hour starts.",
      "Pause reminders on the Manage my hour page at any time.",
    ],
  },
  {
    title: "Shared links",
    body: [
      "A shared link shows your bedtime, your time zone and your rituals. A partner never sees your email or your note. Turning the link off makes it stop working at once.",
    ],
  },
  {
    title: "Deleting everything",
    body: [
      "On Manage my hour, choose Delete everything. It removes all of it at once: your hour, drafts, emailed links, sessions, shared link, unsent emails and reminder records. No reminder is sent afterwards.",
    ],
  },
];

const slug = (title: string) => `privacy-${title.toLowerCase().replace(/[^a-z]+/g, "-")}`;

function Privacy() {
  return (
    <main className="sh-page" id="main">
      <a className="sh-page__brand" href="/">
        <Wordmark className="sh-wordmark" />
      </a>
      <h1 className="sh-page__title">Privacy</h1>
      <p className="sh-page__lead">Stillhour keeps only what it needs to send you one email a night, and forgets it when you ask.</p>
      {SECTIONS.map((section) => (
        <section key={section.title} className="sh-page__section" aria-labelledby={slug(section.title)}>
          <h2 className="sh-page__heading" id={slug(section.title)}>
            {section.title}
          </h2>
          {section.body.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </section>
      ))}
      <p className="sh-page__back">
        <a href="/">Back to the story</a> · <a href="/manage">Manage my hour</a>
      </p>
    </main>
  );
}

createRoot(document.getElementById("root") as HTMLElement).render(<Privacy />);
