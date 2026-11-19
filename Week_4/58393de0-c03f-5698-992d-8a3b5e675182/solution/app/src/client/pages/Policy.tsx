import { useRouter } from "../lib/router";
import "./pages.css";

interface Section {
  heading: string;
  body: string[];
}

interface PolicyText {
  title: string;
  summary: string;
  sections: Section[];
}

const POLICIES: Record<string, PolicyText> = {
  "/privacy": {
    title: "Privacy",
    summary: "What Quarkyard keeps about you, why, and who can see it.",
    sections: [
      {
        heading: "What we keep",
        body: [
          "Educators and Personal makers give us a name, an email address and a password. We store the password only in a scrambled form that cannot be read back.",
          "Everything you build is kept as numbered saved versions of each project, plus the STL, OBJ and SVG files you export. These live in private storage that only the app reads.",
        ],
      },
      {
        heading: "What we use it for",
        body: [
          "Your email address is used to send the link that verifies your account, and nothing else. We do not send newsletters or advertising.",
          "Saved projects and exports exist so your work is there the next time you open Quarkyard.",
        ],
      },
      {
        heading: "Cookies and tracking",
        body: [
          "Quarkyard sets one cookie, which keeps you signed in. It is not used to follow you around. There are no advertising or analytics scripts, and the pages load nothing from other websites.",
        ],
      },
      {
        heading: "Who can see your work",
        body: [
          "A project is visible to the person who made it. For a Student, it is also visible to the Educators of that Student's classroom. Nobody else can open it, and a link to it shows Project not found.",
        ],
      },
    ],
  },
  "/terms": {
    title: "Terms",
    summary: "The plain rules for using Quarkyard in a class or at home.",
    sections: [
      {
        heading: "Using Quarkyard",
        body: [
          "Quarkyard is a place to design 3D parts, wire circuits and build with blocks. Use it for learning and making, and keep what you share kind and safe for children.",
          "Educators are responsible for the classrooms they create, the nicknames they accept and the people they add as Assistants.",
        ],
      },
      {
        heading: "Your designs",
        body: [
          "Your designs belong to you. We keep them so you can open, change and export them, and we do not use them for anything else.",
          "Hand-in freezes work. After a project or classroom is handed in, changes are no longer saved.",
        ],
      },
      {
        heading: "Accounts",
        body: [
          "Keep your password to yourself. An Educator can remove a Student or an Assistant at any time, and that person's access ends on their next request.",
        ],
      },
      {
        heading: "Availability",
        body: [
          "We work to keep Quarkyard running, but a classroom tool can be unavailable now and then. If storage is down, your unsaved edits stay in your browser until it returns. Keep a copy of anything you cannot afford to lose by exporting it.",
        ],
      },
    ],
  },
  "/student-data": {
    title: "Student data",
    summary: "How Quarkyard treats the children who use it, written for instructors, schools and parents.",
    sections: [
      {
        heading: "Nickname only",
        body: [
          "A Student joins with a class code and a nickname. A Student has no email address and no password, and we ask for no real name, age, photo or contact details.",
          "Please tell children to choose a nickname that does not give away who they are.",
        ],
      },
      {
        heading: "Kept inside the classroom",
        body: [
          "A Student's account belongs to one classroom. Their projects and exports are kept with that classroom and are visible only to that Student and to the classroom's Educators.",
          "Student work is never shown to other classrooms, other Students or the public, and there is no advertising of any kind.",
        ],
      },
      {
        heading: "Removal and end of term",
        body: [
          "When an Educator removes a Student, that Student's session ends, their projects, saved versions and exports are deleted, and the nickname becomes free again.",
          "When an Educator archives a classroom, its Student sessions end.",
        ],
      },
      {
        heading: "Exports",
        body: [
          "Files a Student exports are stored privately and listed on the classroom page for its Educators to download.",
        ],
      },
      {
        heading: "Questions",
        body: [
          "Your programme may have its own rules for children's data. Ask your instructor how they apply, and have them remove any nickname you want gone.",
        ],
      },
    ],
  },
};

export default function Policy() {
  const { location } = useRouter();
  const policy = POLICIES[location.path] ?? POLICIES["/privacy"] as PolicyText;
  return (
    <div className="column page-body">
      <article className="policy">
        <p className="eyebrow">Hollowbrook Maker Co.</p>
        <h1>{policy.title}</h1>
        <p className="policy-summary">{policy.summary}</p>
        {policy.sections.map((section) => (
          <section key={section.heading}>
            <h2>{section.heading}</h2>
            {section.body.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
          </section>
        ))}
      </article>
    </div>
  );
}
