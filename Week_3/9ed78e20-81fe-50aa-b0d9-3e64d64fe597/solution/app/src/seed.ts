import {
  transaction,
  advisory,
  id,
  saveContent,
  saveRecord,
  saveRequisition,
  saveGrant,
  saveBenefits,
  saveRow,
} from "./db.js";
import { config } from "./config.js";
import { indexContent, indexRole } from "./search.js";
import {
  londonInstant,
  emptyReleaseRecord,
  readTime,
  comparators,
} from "./domain.js";
import type {
  Content,
  Role,
  Grant,
  BenchmarkRow,
  Requisition,
  Benefits,
} from "./types.js";
// The seeded staff password from the brief, kept only as its salted scrypt digest (salt:hash).
const seedPasswordDigest =
  "56963d84594c23b4b941295f8c561118:d09006c42159af5efd5c217bc8821ccd0acb97bbc4f8a00499230f3e11c8f093";
const email = (name: string): string => `${name}@aldermoor.example`;
const ines = email("ines.halloran"),
  tomas = email("tomas.reyes"),
  eleni = email("eleni.marsh"),
  kofi = email("kofi.brennan"),
  sana = email("sana.qadir"),
  jules = email("jules.okonkwo"),
  ada = email("ada.penrose");
export const theses = [
  {
    number: 1,
    heading: "A claim is only as good as the row beneath it.",
    body: "Progress begins with something another person can examine. We publish the measurement, its date and the comparison behind each claim. Follow a number through this record and you should arrive at the evidence that supports it, including the results that give us pause.",
  },
  {
    number: 2,
    heading: "Release is a decision with names on it.",
    body: "A model does not become ready simply because training has ended. Safety and legal review carry separate responsibilities. The people who sign a release put their names to that decision, and the record preserves the distinction between making a model and judging it ready.",
  },
  {
    number: 3,
    heading: "Every surface tells the same story at the same moment.",
    body: "An announcement, a model route and its benchmark rows belong to the same public record. An embargo is a promise about when that record can be read. When the time comes, the whole record opens together.",
  },
  {
    number: 4,
    heading: "Withdrawal should be as thorough as publication.",
    body: "Sometimes evidence changes what we can stand behind. When we withdraw an item, it leaves the lists, the feed and the index together. Its address carries a clear notice, rather than allowing an old claim to linger without explanation.",
  },
  {
    number: 5,
    heading: "Candidates deserve to know where they stand.",
    body: "The care we ask of research also belongs in the way we work with people. Applicants receive a private link to their current stage. Decisions have reasons and an accountable recruiter, while personal details stay out of the public record.",
  },
];
const newsBodies: Record<string, string> = {
  "introducing-kestrel-2":
    "## A model for long reading\nKestrel 2 is our second general research model. It reads long documents carefully and holds a line of reasoning across many steps.\n\n## What the record shows\nEach evaluation behind this release is recorded on the model route, beside the comparators we ran on the same day. The route also records where Kestrel 2 falls short.",
  "how-we-sign-off-a-release":
    "## Two signatures\nA model route reaches the public only after one safety sign-off and one legal sign-off, each from a different approver who did not write it.\n\n## What the signers read\nThe signers read the route, its claims and every evaluation row the claims cite. The claims are then checked against those rows before anyone can clear the release.",
  "interpretability-notes-autumn":
    "## Looking inside\nThis autumn we traced how our models carry a question through a long document, and where that thread is lost.\n\n## What remains open\nSome behaviour still resists a clean explanation. We publish these notes so that others can question the methods as well as the findings.",
  "why-every-score-links-to-a-row":
    "## A number needs a source\nA score without its source asks the reader for trust. On our model routes every score links to the evaluation row it came from.\n\n## What a row holds\nEach row names the model, the benchmark, the date and the score exactly as recorded. Rows are never edited, so a link today leads to the same evidence tomorrow.",
  "an-update-on-corvane-group":
    "## Our place in Corvane Group\nAldermoor Labs is the frontier research arm of Corvane Group. Our record, our release decisions and our hiring remain our own.\n\n## Shared responsibilities\nCorvane Group supports the lab's infrastructure and operations, and it receives our public record at the same moment as everyone else.",
  "we-are-hiring-research-engineers":
    "## Join the record team\nWe are looking for research engineers who enjoy careful work and clear writing.\n\n## How to apply\nOpen roles are listed on our careers page. Each application goes to the recruiters for that role, and every applicant receives a private link to follow their progress.",
  "introducing-kestrel-1":
    "## Our first model\nKestrel 1 is the first general research model from Aldermoor Labs.\n\n## A baseline\nIts recorded result marks where our work began, and later routes are read against it.",
  "introducing-wren-1":
    "## A new route\nWren 1 joins our record as a new research model.\n\n## Released together\nIts model route and this announcement become public at the same moment.",
  "red-team-findings-q3":
    "## What we tested\nOur red team spent the third quarter probing the limits of our models.\n\n## What we found\nThis evaluation records the questions that remain open and the changes we made in response.",
};
export async function seed(): Promise<void> {
  await transaction(async (db) => {
    await advisory(db, "seed");
    if ((await db.query("SELECT 1 FROM staff LIMIT 1")).rowCount) return;
    // Each published item gets its one publication event and its search entry.
    const publish = async (c: Content): Promise<void> => {
      if (c.status === "scheduled")
        await db.query(
          "INSERT INTO embargo_schedules(content_id,release_at,scheduled_by) VALUES($1,$2,$3)",
          [c.id, c.release_at, eleni],
        );
      if (c.status !== "published") return;
      await db.query(
        "INSERT INTO publication_history(content_id,published_at) VALUES($1,$2)",
        [c.id, c.published_at],
      );
      await indexContent(db, c);
    };
    const people: [string, string, Role[]][] = [
      ["Ines Halloran", ines, ["editor"]],
      ["Tomas Reyes", tomas, ["editor", "approver"]],
      ["Eleni Marsh", eleni, ["approver"]],
      ["Kofi Brennan", kofi, ["approver"]],
      ["Sana Qadir", sana, ["recruiter"]],
      ["Jules Okonkwo", jules, ["recruiter"]],
      ["Ada Penrose", ada, ["administrator"]],
      ["Noor Vance", email("noor.vance"), []],
    ];
    for (const [name, mail, roles] of people) {
      await db.query(
        "INSERT INTO staff(email,name,password_hash) VALUES($1,$2,$3)",
        [mail, name, seedPasswordDigest],
      );
      for (const role of roles) {
        const g: Grant = {
          id: id(),
          staff_email: mail,
          role,
          granted_by: ada,
          granted_at: "2026-01-01T00:00:00Z",
          expires_at: "2027-12-31T23:59:59Z",
          revoked_at: null,
          revoked_by: null,
          version: 1,
        };
        await saveGrant(db, g);
      }
    }
    const models: Content[] = [
      {
        id: id(),
        kind: "model",
        slug: "kestrel-2",
        title: "Kestrel 2",
        summary:
          "Our second general research model, built for long, careful reading.",
        body: "## What Kestrel 2 is\nKestrel 2 is our second general research model, trained for long, careful reading and multi-step reasoning. [claim:c1]\n\n## How we evaluated it\nEvery score on this page comes from a recorded evaluation row with its date. We ran each comparator ourselves on the same harness on the same day. [claim:c2]\n\n## Where it falls short\nOn CodeTrace, Kestrel 2 trails Morrow L. We publish that row beside the others.",
        subject: null,
        tags: null,
        claims: [
          {
            id: "c1",
            text: "On ReasonBench-Hard, Kestrel 2 scores 71.4, 3.2 points above Halvard 3.",
            benchmark: "ReasonBench-Hard",
            eval_date: "2026-09-14",
            comparator: "halvard-3",
            stated_delta: "3.2",
          },
          {
            id: "c2",
            text: "On LongDoc-QA, Kestrel 2 scores 84.9, 4.3 points above Halvard 3.",
            benchmark: "LongDoc-QA",
            eval_date: "2026-09-14",
            comparator: "halvard-3",
            stated_delta: "4.3",
          },
        ],
        linked_news_slug: "introducing-kestrel-2",
        status: "published",
        version: 1,
        author: tomas,
        comments: [],
        release_at: "2026-09-30T08:00:00Z",
        release_at_local: "2026-09-30T09:00",
        published_at: "2026-09-30T08:00:00Z",
        read_time_minutes: 1,
      },
      {
        id: id(),
        kind: "model",
        slug: "kestrel-1",
        title: "Kestrel 1",
        summary:
          "Our first research model and the baseline for everything since.",
        body: "## What Kestrel 1 was\nKestrel 1 was our first general research model. Its recorded row remains here as the baseline for the work that followed.",
        subject: null,
        tags: null,
        claims: [],
        linked_news_slug: null,
        status: "published",
        version: 1,
        author: tomas,
        comments: [],
        release_at: null,
        release_at_local: null,
        published_at: "2026-03-12T10:00:00Z",
        read_time_minutes: 1,
      },
      {
        id: id(),
        kind: "model",
        slug: "wren-1",
        title: "Wren 1",
        summary: "A research model for careful investigation.",
        body: "## What Wren 1 is\nWren 1 brings our ongoing research into a new model route. Its evidence and release decision will be published together.",
        subject: null,
        tags: null,
        claims: [],
        linked_news_slug: "introducing-wren-1",
        status: "scheduled",
        version: 1,
        author: ines,
        comments: [],
        release_at: londonInstant("2030-01-15T09:00", false),
        release_at_local: "2030-01-15T09:00",
        published_at: null,
        read_time_minutes: null,
      },
      {
        id: id(),
        kind: "model",
        slug: "kestrel-3",
        title: "Kestrel 3",
        summary: "The next Kestrel research model, under review.",
        body: "## What Kestrel 3 is\n[claim:c1]",
        subject: null,
        tags: null,
        claims: [
          {
            id: "c1",
            text: "On ReasonBench-Hard, Kestrel 3 scores 76.0, 6.9 points above Halvard 3.",
            benchmark: "ReasonBench-Hard",
            eval_date: "2026-10-20",
            comparator: "halvard-3",
            stated_delta: "6.9",
          },
        ],
        linked_news_slug: null,
        status: "draft",
        version: 1,
        author: ines,
        comments: [],
        release_at: null,
        release_at_local: null,
        published_at: null,
        read_time_minutes: null,
      },
    ];
    for (const c of models) {
      if (c.status === "published") c.read_time_minutes = readTime(c);
      const signoffDay = c.slug === "kestrel-1" ? "2026-03-10" : "2026-09-25";
      await saveContent(db, c);
      await publish(c);
      const record = emptyReleaseRecord();
      if (["published", "scheduled"].includes(c.status)) {
        record.status = "cleared";
        record.safety = {
          by: eleni,
          at: `${signoffDay}T10:00:00Z`,
          note: "Safety review recorded.",
        };
        record.legal = {
          by: kofi,
          at: `${signoffDay}T11:00:00Z`,
          note: "Legal review recorded.",
        };
        record.claims_validated_at = `${signoffDay}T12:30:00Z`;
        record.cleared_by = eleni;
        record.cleared_at = `${signoffDay}T13:00:00Z`;
      }
      await saveRecord(db, c.id, record);
    }
    const posts: [string, string, string, string[], string | null, string][] = [
      [
        "introducing-kestrel-2",
        "Introducing Kestrel 2",
        "research",
        ["evaluations", "release-notes"],
        "2026-09-30T09:00",
        "Kestrel 2 brings long, careful reading to our second general research model. Its model route records the evaluations, comparisons and limitations behind this release.",
      ],
      [
        "how-we-sign-off-a-release",
        "How we sign off a release",
        "safety",
        ["evaluations", "governance"],
        "2026-08-20T11:00",
        "A release requires separate safety and legal sign-offs. Here is how those decisions become part of the public record.",
      ],
      [
        "interpretability-notes-autumn",
        "Interpretability notes, autumn",
        "research",
        ["interpretability"],
        "2026-10-08T14:00",
        "Notes from our continuing work to understand how our models reach an answer, and what remains difficult to explain.",
      ],
      [
        "why-every-score-links-to-a-row",
        "Why every score links to a row",
        "policy",
        ["evaluations", "governance"],
        "2026-07-02T10:00",
        "A comparison is useful when its source can be examined. Our recorded rows preserve the model, benchmark and date behind every score.",
      ],
      [
        "an-update-on-corvane-group",
        "An update on our work with Corvane Group",
        "company",
        ["partnerships"],
        "2026-06-15T09:30",
        "Aldermoor Labs is the frontier AI research arm of Corvane Group. This record explains the work and the responsibilities we share.",
      ],
      [
        "we-are-hiring-research-engineers",
        "We are hiring research engineers",
        "company",
        ["hiring"],
        "2026-10-14T09:00",
        "Help build the measurements that make research claims worth reading. Our open roles bring research, engineering and careful judgement together.",
      ],
      [
        "introducing-kestrel-1",
        "Introducing Kestrel 1",
        "research",
        ["release-notes"],
        "2026-03-12T10:00",
        "Our first research model establishes a baseline. We are publishing its recorded result as the starting point for the work that follows.",
      ],
      [
        "introducing-wren-1",
        "Introducing Wren 1",
        "research",
        ["release-notes"],
        null,
        "Introducing the next route in our research record.",
      ],
      [
        "red-team-findings-q3",
        "Red-team findings, third quarter",
        "safety",
        ["evaluations"],
        null,
        "Our red-team work examines the limits of our models and documents the questions that remain.",
      ],
    ];
    for (const [slug, title, subject, tags, local, summary] of posts) {
      const status =
        slug === "introducing-wren-1"
          ? "scheduled"
          : local
            ? "published"
            : "draft";
      const c: Content = {
        id: id(),
        kind: "news",
        slug,
        title,
        summary,
        body: newsBodies[slug],
        subject,
        tags,
        claims: null,
        linked_news_slug: null,
        status,
        version: 1,
        author: slug === "red-team-findings-q3" ? ines : tomas,
        comments: [],
        release_at:
          status === "scheduled"
            ? londonInstant("2030-01-15T09:00", false)
            : local
              ? londonInstant(local, false)
              : null,
        release_at_local: status === "scheduled" ? "2030-01-15T09:00" : local,
        published_at: local ? londonInstant(local, false) : null,
        read_time_minutes: null,
      };
      if (local) c.read_time_minutes = readTime(c);
      await saveContent(db, c);
      await publish(c);
    }
    const data: [string, string, string, string][] = [
      ["kestrel-2", "ReasonBench-Hard", "2026-09-14", "71.4"],
      ["halvard-3", "ReasonBench-Hard", "2026-09-14", "68.2"],
      ["morrow-l", "ReasonBench-Hard", "2026-09-14", "70.9"],
      ["kestrel-2", "LongDoc-QA", "2026-09-14", "84.9"],
      ["halvard-3", "LongDoc-QA", "2026-09-14", "80.6"],
      ["morrow-l", "LongDoc-QA", "2026-09-14", "85.3"],
      ["kestrel-2", "CodeTrace", "2026-09-14", "58.0"],
      ["morrow-l", "CodeTrace", "2026-09-14", "61.5"],
      ["kestrel-1", "ReasonBench-Hard", "2026-03-01", "62.7"],
      ["kestrel-3", "ReasonBench-Hard", "2026-10-20", "76.0"],
      ["halvard-3", "ReasonBench-Hard", "2026-10-20", "69.1"],
    ];
    for (const [subject, benchmark, eval_date, score] of data) {
      const row: BenchmarkRow = {
        id: id(),
        subject,
        subject_name:
          comparators[subject]?.name ||
          models.find((c) => c.slug === subject)!.title,
        organisation: comparators[subject]?.organisation || "Aldermoor Labs",
        benchmark,
        eval_date,
        score,
        source_note: "Recorded laboratory evaluation.",
      };
      await saveRow(db, row);
    }
    const requisitions: [
      string,
      string,
      string,
      string,
      Requisition["status"],
      string | null,
      string[],
    ][] = [
      [
        "research-engineer-evaluations",
        "Research Engineer, Evaluations",
        "research",
        "london",
        "open",
        "2026-10-01",
        [sana],
      ],
      [
        "research-scientist-interpretability",
        "Research Scientist, Interpretability",
        "research",
        "edinburgh",
        "open",
        "2026-09-20",
        [sana],
      ],
      [
        "policy-lead-europe",
        "Policy Lead, Europe",
        "policy",
        "zurich",
        "open",
        "2026-10-10",
        [jules],
      ],
      [
        "infrastructure-engineer-toronto",
        "Infrastructure Engineer",
        "engineering",
        "toronto",
        "open",
        "2026-08-30",
        [jules],
      ],
      [
        "operations-coordinator-london",
        "Operations Coordinator",
        "operations",
        "london",
        "closed",
        "2026-06-01",
        [jules],
      ],
      [
        "research-scientist-alignment",
        "Research Scientist, Alignment",
        "research",
        "london",
        "draft",
        null,
        [sana],
      ],
    ];
    // Each role's description is written for that role; only research-engineer-evaluations may
    // use words beginning "evalu" (brief: Seed data, Words in seeded text you write).
    const requisitionDescriptions: Record<string, string> = {
      "research-engineer-evaluations":
        "You will design and run the evaluations behind every score we publish. That means building the harness that runs Kestrel and each comparator on the same day, recording every result as a dated row, and writing the evaluation notes a sceptical reader needs to check our claims.\n\n## What you will bring\nSeveral years of research engineering in Python or TypeScript, care with statistics, and the habit of asking what a benchmark actually measures. Experience maintaining a shared evaluation suite is welcome; so is having found a flaw in one.\n\n## Working with us\nThe team sits in London beside the safety and release groups, so a row you record today may be cited in a sign-off this week.",
      "research-scientist-interpretability":
        "You will study what our models represent internally and publish what you find, including the results that complicate our own story. Expect to move between small, controlled experiments and the full Kestrel models, and to write notes that readers outside the lab can follow.\n\n## What you will bring\nA research record in interpretability, neuroscience or a neighbouring field, fluency with modern training tooling, and patience with results that take several attempts to pin down.\n\n## Working with us\nThe group works from Edinburgh with a weekly reading session shared with London.",
      "policy-lead-europe":
        "You will represent Aldermoor Labs to regulators, standards bodies and civil society across Europe, and bring what you hear back into how we release models. You will draft our consultation responses and explain our release record in plain terms.\n\n## What you will bring\nExperience in technology policy or regulation, ideally on the European AI Act or comparable rules, and the ability to translate a technical decision into a public commitment without overstating it. Fluency in English and one further European language.\n\n## Working with us\nThe role is based in Zurich and travels to Brussels and London a few times each quarter.",
      "infrastructure-engineer-toronto":
        "You will run the systems that keep the open record honest: the databases, storage and job queues behind every publication, and the training clusters our researchers depend on. Reliability here is a public commitment, because an embargo that fires late or twice is visible to everyone.\n\n## What you will bring\nProduction experience with PostgreSQL, object storage and container orchestration, a calm approach to incidents, and clear written postmortems.\n\n## Working with us\nThe team works from Toronto and shares an on-call rotation with London during overlapping hours.",
      "operations-coordinator-london":
        "You kept the London office running: visitors, equipment, supplier contracts and the logistics of our quarterly research reviews. You were the first person a new colleague met.\n\n## What you will bring\nExperience coordinating a busy office, good judgement about what can wait, and a friendly, precise way of writing.\n\n## Working with us\nThis London role has been filled and is no longer taking applications.",
      "research-scientist-alignment":
        "You will develop and test methods that keep model behaviour within what we intend and can describe, from training objectives to red-team studies, and you will help decide what a release must show before it ships.\n\n## What you will bring\nA research record in alignment, reinforcement learning or a related area, rigorous experimental habits and a willingness to argue for a delay when the record is not ready.\n\n## Working with us\nThe role is based in London alongside the safety sign-off group.",
    };
    for (const [
      slug,
      title,
      discipline,
      office,
      status,
      opened,
      recruiters,
    ] of requisitions) {
      const requisition: Requisition = {
        id: id(),
        slug,
        title,
        discipline,
        office,
        status,
        opened_at: opened ? `${opened}T08:00:00Z` : null,
        closed_at: status === "closed" ? "2026-09-01T08:00:00Z" : null,
        erase_after:
          status === "closed"
            ? new Date(
                Date.parse("2026-09-01T08:00:00Z") + config.retention * 1000,
              ).toISOString()
            : null,
        recruiters,
        version: 1,
        description: requisitionDescriptions[slug],
      };
      await saveRequisition(db, requisition);
      if (status === "open") await indexRole(db, requisition);
    }
    const entries: [string, string, string][] = [
      [
        "uk",
        "2026-01-01",
        "Private medical cover, 30 days' leave plus bank holidays, 10% pension contribution.",
      ],
      [
        "uk",
        "2027-01-01",
        "Private medical cover, 30 days' leave plus bank holidays, 12% pension contribution.",
      ],
      [
        "europe",
        "2026-04-01",
        "Supplementary health insurance, 28 days' leave, pension under the local plan.",
      ],
      [
        "north-america",
        "2026-07-01",
        "Health, dental and vision cover, 25 days' leave, retirement matching to 6%.",
      ],
    ];
    for (const [region, effective_from, summary] of entries) {
      const entry: Benefits = { id: id(), region, effective_from, summary };
      await saveBenefits(db, entry);
    }
  });
}
