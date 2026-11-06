"""The invented seed corpus: integrations, articles, press items, jobs, resources."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class IntegrationSeed:
    slug: str
    name: str
    category: str
    description: str
    published: bool = True


@dataclass(frozen=True)
class ArticleSeed:
    slug: str
    title: str
    category: str
    summary: str
    author: str
    read_time: int
    published_at: str
    published: bool = True


@dataclass(frozen=True)
class PressSeed:
    date: str
    category: str
    headline: str
    published: bool = True


@dataclass(frozen=True)
class JobSeed:
    title: str
    location: str
    is_open: bool


@dataclass(frozen=True)
class ResourceSeed:
    block: str
    category: str
    title: str
    date: str
    summary: str


INTEGRATIONS: tuple[IntegrationSeed, ...] = (
    IntegrationSeed(
        "huddleboard",
        "Huddleboard",
        "Collaboration",
        "Post meeting notes and follow-ups into the Huddleboard channel that asked for them.",
    ),
    IntegrationSeed(
        "threadloom-chat",
        "Threadloom Chat",
        "Collaboration",
        "Share a recap thread in Threadloom the moment a call ends.",
    ),
    IntegrationSeed(
        "noteframe-workspace",
        "Noteframe Workspace",
        "Collaboration",
        "File every transcript into the Noteframe page for that account.",
    ),
    IntegrationSeed(
        "clearloop-tasks",
        "Clearloop Tasks",
        "Collaboration",
        "Turn each spoken commitment into a Clearloop task with an owner and a date.",
    ),
    IntegrationSeed(
        "pipewell-crm",
        "Pipewell CRM",
        "CRM",
        "Write call summaries and next steps onto the Pipewell opportunity record.",
    ),
    IntegrationSeed(
        "beaconline-crm",
        "Beaconline CRM",
        "CRM",
        "Keep Beaconline contacts current with what was actually said on the call.",
    ),
    IntegrationSeed(
        "clientgrove",
        "Clientgrove",
        "CRM",
        "Attach recordings and notes to the Clientgrove account timeline.",
    ),
    IntegrationSeed(
        "orchardtree-sales",
        "Orchardtree Sales",
        "CRM",
        "Log discovery answers against Orchardtree deal stages without typing them twice.",
    ),
    IntegrationSeed(
        "quillbase-crm",
        "Quillbase CRM",
        "CRM",
        "Sync Relayo follow-ups into Quillbase sequences and reminders.",
    ),
    IntegrationSeed(
        "ledgerline-crm",
        "Ledgerline CRM",
        "CRM",
        "Connect Relayo notes to Ledgerline revenue records.",
        published=False,
    ),
    IntegrationSeed(
        "datebook-calendar",
        "Datebook Calendar",
        "Calendar",
        "Relayo reads your Datebook invitations and joins the calls that need it.",
    ),
    IntegrationSeed(
        "clockwise-meet",
        "Clockwise Meet",
        "Calendar",
        "Agendas from Clockwise Meet arrive in the room before the first hello.",
    ),
    IntegrationSeed(
        "almanac-scheduler",
        "Almanac Scheduler",
        "Calendar",
        "Book follow-up time from Almanac straight out of a meeting recap.",
    ),
    IntegrationSeed(
        "relayo-desktop",
        "Relayo for Desktop",
        "Desktop App",
        "Record room audio, see live notes and tag moments from your desktop.",
    ),
    IntegrationSeed(
        "deskmate-recorder",
        "Deskmate Recorder",
        "Desktop App",
        "Capture local audio when a call happens outside your calendar.",
    ),
    IntegrationSeed(
        "relayo-mobile",
        "Relayo Mobile",
        "Mobile",
        "Catch a corridor conversation on your phone and keep the notes with the account.",
    ),
    IntegrationSeed(
        "pocketscribe-mobile",
        "Pocketscribe Mobile",
        "Mobile",
        "Review recaps and approve follow-ups between meetings on the move.",
    ),
    IntegrationSeed(
        "tabnote-extension",
        "Tabnote Extension",
        "Browser Extensions",
        "Start a Relayo note from any browser tab, including web meeting rooms.",
    ),
    IntegrationSeed(
        "sidecar-for-browsers",
        "Sidecar for Browsers",
        "Browser Extensions",
        "Keep the live transcript beside the call in a slim browser panel.",
    ),
    IntegrationSeed(
        "vaultbox-drive",
        "Vaultbox Drive",
        "Storage",
        "Archive recordings and transcripts into the Vaultbox folder you choose.",
    ),
    IntegrationSeed(
        "driftfile-store",
        "Driftfile Store",
        "Storage",
        "Keep long-term copies of meeting media in Driftfile with your own retention.",
    ),
    IntegrationSeed(
        "stonebox-archive",
        "Stonebox Archive",
        "Storage",
        "Move finished meeting records into Stonebox for cold storage.",
    ),
    IntegrationSeed(
        "coldstore-archive",
        "Coldstore Archive",
        "Storage",
        "Hold meeting records in Coldstore for long retention windows.",
        published=False,
    ),
    IntegrationSeed(
        "signalgraph",
        "Signalgraph",
        "Analytics",
        "Send talk ratios, topics and objection counts into Signalgraph dashboards.",
    ),
    IntegrationSeed(
        "metricfold",
        "Metricfold",
        "Analytics",
        "Model meeting outcomes in Metricfold next to your pipeline numbers.",
    ),
    IntegrationSeed(
        "brightlens-analytics",
        "Brightlens Analytics",
        "Analytics",
        "Compare how teams run calls with Brightlens cohort reports.",
    ),
    IntegrationSeed(
        "ringstead-dialer",
        "Ringstead Dialer",
        "Dialers",
        "Relayo captures every Ringstead call and writes the summary back to it.",
    ),
    IntegrationSeed(
        "calltrail-voice",
        "Calltrail Voice",
        "Dialers",
        "Match Calltrail recordings with Relayo notes and next steps.",
    ),
    IntegrationSeed(
        "dialcrest",
        "Dialcrest",
        "Dialers",
        "Dial from a recap and keep the thread of the conversation intact.",
    ),
    IntegrationSeed(
        "framecall-video",
        "Framecall Video",
        "Video Conferencing",
        "Relayo joins Framecall rooms as a guest and takes notes for everyone.",
    ),
    IntegrationSeed(
        "loftroom-meetings",
        "Loftroom Meetings",
        "Video Conferencing",
        "Recordings and chapters arrive minutes after a Loftroom call ends.",
    ),
    IntegrationSeed(
        "beamhall-video",
        "Beamhall Video",
        "Video Conferencing",
        "Keep Beamhall webinars searchable with speaker-aware transcripts.",
    ),
)

ARTICLES: tuple[ArticleSeed, ...] = (
    ArticleSeed(
        "meeting-notes-that-write-themselves",
        "Meeting notes that write themselves",
        "Product Updates",
        "Relayo now drafts the recap while the call is still running, so the notes are "
        "waiting when you leave the room.",
        "Marta Holloway",
        6,
        "2026-09-24T09:00:00Z",
    ),
    ArticleSeed(
        "live-follow-ups-in-the-recap",
        "Live follow-ups in the recap",
        "Product Updates",
        "Every commitment spoken on a call becomes an owned follow-up with a date you can edit.",
        "Marta Holloway",
        5,
        "2026-09-10T09:00:00Z",
    ),
    ArticleSeed(
        "search-across-every-meeting",
        "Search across every meeting",
        "Product Updates",
        "Ask a question once and read the answer from the three calls where it came up.",
        "Idris Vance",
        7,
        "2026-08-27T09:00:00Z",
    ),
    ArticleSeed(
        "speaker-labels-you-can-trust",
        "Speaker labels you can trust",
        "Product Updates",
        "Relayo learns the voices on your team so transcripts name the right person.",
        "Idris Vance",
        4,
        "2026-08-13T09:00:00Z",
    ),
    ArticleSeed(
        "chapters-for-long-calls",
        "Chapters for long calls",
        "Product Updates",
        "Ninety-minute reviews now open as chapters, so nobody scrubs a recording again.",
        "Noor Albright",
        5,
        "2026-07-30T09:00:00Z",
    ),
    ArticleSeed(
        "recaps-in-your-own-words",
        "Recaps in your own words",
        "Product Updates",
        "Choose the shape of your summary once and Relayo keeps to it on every call.",
        "Noor Albright",
        6,
        "2026-07-16T09:00:00Z",
    ),
    ArticleSeed(
        "quieter-notifications",
        "Quieter notifications",
        "Product Updates",
        "One digest after the meeting instead of five alerts during it.",
        "Teodor Rask",
        3,
        "2026-06-25T09:00:00Z",
    ),
    ArticleSeed(
        "a-calmer-home-for-recordings",
        "A calmer home for recordings",
        "Product Updates",
        "Recordings, transcripts and notes now sit together on one account page.",
        "Teodor Rask",
        5,
        "2026-06-25T09:00:00Z",
    ),
    ArticleSeed(
        "offline-capture-on-mobile",
        "Offline capture on mobile",
        "Product Updates",
        "Record a corridor conversation with no signal and let it sync when you are back.",
        "Priya Marchetti",
        4,
        "2026-05-21T09:00:00Z",
    ),
    ArticleSeed(
        "redaction-for-sensitive-moments",
        "Redaction for sensitive moments",
        "Product Updates",
        "Mark a passage and Relayo removes it from the transcript, the audio and the recap.",
        "Priya Marchetti",
        6,
        "2026-04-23T09:00:00Z",
    ),
    ArticleSeed(
        "shared-vocabularies",
        "Shared vocabularies",
        "Product Updates",
        "Teach Relayo your product names once and read them spelled correctly everywhere.",
        "Marta Holloway",
        4,
        "2026-03-19T09:00:00Z",
    ),
    ArticleSeed(
        "a-faster-first-meeting",
        "A faster first meeting",
        "Product Updates",
        "New workspaces now reach their first searchable recap in under ten minutes.",
        "Idris Vance",
        5,
        "2026-02-12T09:00:00Z",
    ),
    ArticleSeed(
        "what-good-discovery-sounds-like",
        "What good discovery sounds like",
        "Sales",
        "Five questions that move a first call from a demo request to a real plan.",
        "Rowan Ashby",
        8,
        "2026-09-17T09:00:00Z",
    ),
    ArticleSeed(
        "handing-over-a-deal-cleanly",
        "Handing over a deal cleanly",
        "Sales",
        "What the next owner of an account needs from the last three conversations.",
        "Rowan Ashby",
        6,
        "2026-08-20T09:00:00Z",
    ),
    ArticleSeed(
        "objections-are-a-gift",
        "Objections are a gift",
        "Sales",
        "A quieter way to answer price questions without conceding the room.",
        "Selina Boateng",
        7,
        "2026-07-09T09:00:00Z",
    ),
    ArticleSeed(
        "the-follow-up-that-closes",
        "The follow-up that closes",
        "Sales",
        "Send one message that repeats the buyer's own words back to them.",
        "Selina Boateng",
        5,
        "2026-05-07T09:00:00Z",
    ),
    ArticleSeed(
        "pipeline-reviews-without-the-theatre",
        "Pipeline reviews without the theatre",
        "Sales",
        "Review the calls, not the slide about the calls.",
        "Rowan Ashby",
        6,
        "2026-03-05T09:00:00Z",
    ),
    ArticleSeed(
        "seminars-that-stay-searchable",
        "Seminars that stay searchable",
        "Education",
        "How a small faculty keeps two hundred hours of seminars usable for students.",
        "Dr. Amara Feld",
        7,
        "2026-09-03T09:00:00Z",
    ),
    ArticleSeed(
        "study-notes-after-class",
        "Study notes after class",
        "Education",
        "Turning a lecture recording into revision questions the same evening.",
        "Dr. Amara Feld",
        6,
        "2026-06-04T09:00:00Z",
    ),
    ArticleSeed(
        "accessible-by-default",
        "Accessible by default",
        "Education",
        "Transcripts and captions as a first draft of an accessible course.",
        "Hollis Nkemdirim",
        5,
        "2026-02-26T09:00:00Z",
    ),
    ArticleSeed(
        "interviews-without-the-retype",
        "Interviews without the retype",
        "Media",
        "A two-person newsroom keeps its quotes accurate and its deadlines intact.",
        "Jonas Pettigrew",
        6,
        "2026-08-06T09:00:00Z",
    ),
    ArticleSeed(
        "production-notes-for-the-edit",
        "Production notes for the edit",
        "Media",
        "Mark the take you want while it is still fresh in the room.",
        "Jonas Pettigrew",
        5,
        "2026-04-02T09:00:00Z",
    ),
    ArticleSeed(
        "hiring-notes-every-panel-can-read",
        "Hiring notes every panel can read",
        "Hiring",
        "One shared record of an interview beats five private sets of scribbles.",
        "Beatrix Olumide",
        6,
        "2026-07-23T09:00:00Z",
    ),
    ArticleSeed(
        "debriefs-in-ten-minutes",
        "Debriefs in ten minutes",
        "Hiring",
        "Run a decision meeting from evidence instead of memory.",
        "Beatrix Olumide",
        4,
        "2026-01-15T09:00:00Z",
    ),
    ArticleSeed(
        "why-we-started-relayo",
        "Why we started Relayo",
        "Company",
        "We kept losing the best part of our week to writing up the week.",
        "Mira Sandoval",
        5,
        "2024-10-03T09:00:00Z",
    ),
    ArticleSeed(
        "draft-q4-roadmap",
        "Draft: the next quarter of Relayo",
        "Product Updates",
        "An internal draft of the next roadmap, not for publication.",
        "Marta Holloway",
        4,
        "2026-10-01T09:00:00Z",
        published=False,
    ),
    ArticleSeed(
        "unpublished-pricing-notes",
        "Notes on how we talk about price",
        "Sales",
        "Working notes on pricing language, still with the team.",
        "Selina Boateng",
        3,
        "2026-09-29T09:00:00Z",
        published=False,
    ),
    ArticleSeed(
        "scheduled-2099-launch",
        "The 2099 launch, under embargo",
        "Product Updates",
        "An embargoed launch story that becomes public at its appointed moment.",
        "Mira Sandoval",
        5,
        "2099-01-01T09:00:00Z",
    ),
)

PRESS_ITEMS: tuple[PressSeed, ...] = (
    PressSeed("2026-09-30", "News", "Relayo opens a partner program for integration builders"),
    PressSeed("2026-09-30", "News", "Relayo names Priya Marchetti head of product"),
    PressSeed("2026-09-12", "News", "Relayo passes one million meetings captured"),
    PressSeed("2026-09-01", "Press Releases", "Relayo raises a Series A to grow its partner network"),
    PressSeed("2026-08-25", "News", "Relayo brings speaker-aware transcripts to webinars"),
    PressSeed("2026-08-14", "News", "Relayo joins the Framecall marketplace"),
    PressSeed("2026-08-02", "News", "Relayo publishes its meeting data retention guide"),
    PressSeed("2026-07-21", "News", "Relayo adds German and Dutch meeting summaries"),
    PressSeed("2026-07-07", "Press Releases", "Relayo and Pipewell CRM announce a joint recap workflow"),
    PressSeed("2026-06-28", "News", "Relayo opens an office in Lisbon"),
    PressSeed("2026-06-16", "News", "Relayo rolls out redaction for sensitive passages"),
    PressSeed("2026-06-03", "News", "Relayo reaches a thousand education workspaces"),
    PressSeed("2026-05-19", "News", "Relayo ships offline capture for phones"),
    PressSeed("2026-05-05", "Press Releases", "Relayo publishes its first transparency report"),
    PressSeed("2026-04-22", "News", "Relayo adds chapters for long review calls"),
    PressSeed("2026-04-08", "News", "Relayo partners with Signalgraph on meeting analytics"),
    PressSeed("2026-03-24", "News", "Relayo hires a head of partnerships"),
    PressSeed("2026-03-10", "News", "Relayo brings shared vocabularies to every workspace"),
    PressSeed("2026-02-17", "News", "Relayo supports room audio on desktop"),
    PressSeed("2026-02-03", "Press Releases", "Relayo announces its education program"),
    PressSeed("2026-01-20", "News", "Relayo adds a recruiting agent for interview panels"),
    PressSeed("2025-12-09", "News", "Relayo closes the year with a quieter notification digest"),
    PressSeed("2025-10-14", "News", "Relayo launches its SDR agent"),
    PressSeed("2025-04-15", "News", "Relayo opens its public API to integration partners"),
    PressSeed("2024-10-08", "News", "Relayo leaves beta with its first hundred teams"),
    PressSeed("2026-10-01", "News", "Relayo internal briefing note", published=False),
    PressSeed("2026-09-20", "Press Releases", "Relayo draft release, pending review", published=False),
    PressSeed("2099-01-01", "News", "Relayo at the 2099 partner summit"),
)

JOBS: tuple[JobSeed, ...] = (
    JobSeed("Senior Backend Engineer", "Berlin or remote in Europe", True),
    JobSeed("Partner Solutions Engineer", "Berlin", True),
    JobSeed("Accessibility Engineer", "Remote in Europe", True),
    JobSeed("Customer Education Lead", "Lisbon", True),
    JobSeed("Head of Revenue Operations", "Berlin", False),
    JobSeed("Technical Writer", "Remote in Europe", False),
)

RESOURCE_CARDS: tuple[ResourceSeed, ...] = (
    ResourceSeed(
        "Updates",
        "Product Updates",
        "What shipped in Relayo this quarter",
        "2026-09-26",
        "A short tour of the recap, search and redaction work from the last three months.",
    ),
    ResourceSeed(
        "Updates",
        "Product Updates",
        "The road to a quieter workspace",
        "2026-07-18",
        "Why we cut meeting alerts down to one digest, and what changed for teams.",
    ),
    ResourceSeed(
        "Case Studies",
        "Sales",
        "How Orchardtree cut handover time in half",
        "2026-08-29",
        "A twelve-person sales team replaced written handovers with searchable calls.",
    ),
    ResourceSeed(
        "Case Studies",
        "Education",
        "Two hundred seminar hours, still searchable",
        "2026-06-20",
        "A faculty of nine keeps every seminar usable for students who missed it.",
    ),
    ResourceSeed(
        "Webinars",
        "Sales",
        "Running discovery calls that earn a second meeting",
        "2026-09-08",
        "Forty minutes on question design, with three recorded examples.",
    ),
    ResourceSeed(
        "Webinars",
        "Hiring",
        "Interview debriefs from evidence",
        "2026-05-14",
        "How hiring panels use one shared record instead of five sets of notes.",
    ),
    ResourceSeed(
        "Guides",
        "Company",
        "The Relayo meeting notes handbook",
        "2026-08-11",
        "A practical guide to recaps, owners and dates that people actually read.",
    ),
    ResourceSeed(
        "Guides",
        "Product Updates",
        "Setting up Relayo for a new workspace",
        "2026-04-16",
        "From the first calendar connection to the first searchable recap.",
    ),
    ResourceSeed(
        "Videos",
        "Media",
        "A two-minute tour of the Relayo recap",
        "2026-09-19",
        "Watch a finished recap, its follow-ups and the transcript behind it.",
    ),
    ResourceSeed(
        "Videos",
        "Education",
        "Turning a lecture into revision questions",
        "2026-03-12",
        "A five-minute walkthrough for teaching teams.",
    ),
)

RESOURCE_BLOCKS = ("Updates", "Case Studies", "Webinars", "Guides", "Videos")


def article_body(article: ArticleSeed) -> str:
    """The article body, built from its own summary and subject."""
    return "\n\n".join(
        (
            article.summary,
            f"Teams come to Relayo because the work after a meeting is the work that "
            f"slips. {article.title} is our answer to one part of that problem, written "
            f"for the people who run these conversations every day.",
            "Relayo joins the call, keeps a speaker-aware transcript, and hands back a "
            "recap with the commitments made in the room. Nothing leaves your workspace "
            "unless you send it.",
            f"Written by {article.author} for the Relayo {article.category.lower()} "
            "collection. If you run calls like these and want to build on Relayo, the "
            "partner program is open.",
        )
    )
