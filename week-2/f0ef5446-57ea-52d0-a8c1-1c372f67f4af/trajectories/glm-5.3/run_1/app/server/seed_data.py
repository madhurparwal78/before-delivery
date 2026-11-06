"""The seeded corpus. Every person, company, product and quote is invented.

Integrations: (slug, name, category, description, published) - 32 rows, 30
published. Articles: (slug, title, category, author, read_time, published_at,
published, body) - 28 rows, 25 public. Press items: (date, category, headline,
published) - 28 rows, 25 public. Jobs: (title, location, is_open) - 6 rows,
4 open. Resource cards: (block, category, title, date, summary, target_link)
- 10 published rows.
"""
from __future__ import annotations

INTEGRATIONS = [
    ("huddleboard", "Huddleboard", "Collaboration", "A shared whiteboard where Relayo posts call summaries and action items as they happen.", True),
    ("threadwork", "Threadwork", "Collaboration", "Team threads that receive Relayo notes and follow-up tasks automatically.", True),
    ("planloop", "Planloop", "Collaboration", "Shared project plans fed by the decisions Relayo hears on calls.", True),
    ("notewell", "Notewell", "Collaboration", "A shared notebook that collects every Relayo meeting record in one place.", True),
    ("pipewell-crm", "Pipewell CRM", "CRM", "Sync Relayo call outcomes, objections and next steps straight to the deal record.", True),
    ("dealmoor", "Dealmoor", "CRM", "Pipeline reviews with the calls behind every stage, searchable through Relayo.", True),
    ("customerbase-crm", "Customerbase CRM", "CRM", "Customer records enriched with meeting history captured by Relayo.", True),
    ("pactline-crm", "Pactline CRM", "CRM", "Contract tracking that links renewal calls to their Relayo summaries.", True),
    ("ledgerline-crm", "Ledgerline CRM", "CRM", "A bookkeeping CRM whose calls Relayo records and files per client.", False),
    ("quotewing-crm", "Quotewing CRM", "CRM", "Quote-to-cash records that link every negotiation call to its Relayo summary.", True),
    ("datebook-calendar", "Datebook Calendar", "Calendar", "Relayo joins the meetings on your calendar and files notes back to the event.", True),
    ("momentum-calendar", "Momentum Calendar", "Calendar", "Team scheduling where Relayo attends, records and summarises every session.", True),
    ("timeslotpro", "Timeslot Pro", "Calendar", "Booking pages that let Relayo sit in on customer calls on request.", True),
    ("relayo-desktop", "Relayo for Desktop", "Desktop App", "The Relayo desktop app: join, record, transcribe and search every call from your desk.", True),
    ("quietcorner-notes", "Quietcorner Notes", "Desktop App", "A desktop notebook that pairs with Relayo meeting records for offline review.", True),
    ("relayo-mobile", "Relayo Mobile", "Mobile", "Take Relayo into every call you join from your phone, with the same notes and follow-ups as on desktop.", True),
    ("pocketpad-mobile", "Pocketpad Mobile", "Mobile", "Mobile meeting capture that hands its recordings to Relayo for notes.", True),
    ("tabnote-extension", "Tabnote Extension", "Browser Extensions", "A browser extension that starts Relayo capture on any web meeting with one click.", True),
    ("marginalia-extension", "Marginalia Extension", "Browser Extensions", "Annotate web pages with Relayo notes and follow-ups as you research.", True),
    ("vaultbox-drive", "Vaultbox Drive", "Storage", "Cloud storage where Relayo keeps recordings, transcripts and notes per team.", True),
    ("coldstore-archive", "Coldstore Archive", "Storage", "Long-term archives for meeting records kept for audit and compliance.", False),
    ("shelfsmith-storage", "Shelfsmith Storage", "Storage", "Team folders that receive Relayo documents and summaries automatically.", True),
    ("archivelight-storage", "Archivelight Storage", "Storage", "Compliance-grade storage that pairs with Relayo retention rules.", True),
    ("signalgraph", "Signalgraph", "Analytics", "Dashboards built from Relayo data: talk time, objections, outcomes and follow-ups.", True),
    ("measurewell", "Measurewell", "Analytics", "Meeting analytics that show which calls convert, scored from Relayo notes.", True),
    ("trendcrate", "Trendcrate", "Analytics", "Reports that trend call topics and outcomes over time, sourced from Relayo.", True),
    ("ringstead-dialer", "Ringstead Dialer", "Dialers", "A sales dialer where Relayo records every connected call and files the notes.", True),
    ("callforge-dialer", "Callforge Dialer", "Dialers", "Outbound calling rooms whose conversations Relayo transcribes and tags.", True),
    ("phoneline-pro", "Phoneline Pro", "Dialers", "Power dialing with live Relayo summaries pushed to the caller's screen.", True),
    ("framecall-video", "Framecall Video", "Video Conferencing", "Video meetings Relayo joins as a participant, taking notes for everyone.", True),
    ("roomlight-video", "Roomlight Video", "Video Conferencing", "Conference rooms where Relayo captures the meeting and shares the recap.", True),
    ("stageside-video", "Stageside Video", "Video Conferencing", "Webinar rooms whose Q&A Relayo records into searchable notes.", True),
]

_ARTICLE_SKELETON = [
    ("meeting-notes-that-write-themselves", "Meeting notes that write themselves", "Product Updates", "Nora Vale", 6),
    ("search-every-call-your-team-has-ever-taken", "Search every call your team has ever taken", "Product Updates", "Nora Vale", 4),
    ("follow-ups-that-leave-the-call-with-you", "Follow-ups that leave the call with you", "Product Updates", "Nora Vale", 5),
    ("relayo-joins-your-calendar-silently", "Relayo joins your calendar silently", "Product Updates", "Iris Bender", 4),
    ("sharing-notes-with-the-whole-team", "Sharing notes with the whole team", "Product Updates", "Nora Vale", 4),
    ("your-meeting-history-in-one-place", "Your meeting history, in one place", "Product Updates", "Iris Bender", 5),
    ("a-recap-that-arrives-before-you-stand-up", "A recap that arrives before you stand up", "Product Updates", "Nora Vale", 4),
    ("turning-talk-time-into-a-team-metric", "Turning talk time into a team metric", "Product Updates", "Iris Bender", 6),
    ("relayo-speaks-your-language", "Relayo speaks your language", "Product Updates", "Nora Vale", 5),
    ("notes-you-can-actually-find-again", "Notes you can actually find again", "Product Updates", "Iris Bender", 5),
    ("the-queue-that-keeps-sales-honest", "The queue that keeps sales honest", "Product Updates", "Iris Bender", 4),
    ("connected-to-the-tools-you-already-use", "Connected to the tools you already use", "Product Updates", "Nora Vale", 4),
    ("listening-for-the-objection-under-the-objection", "Listening for the objection under the objection", "Sales", "Marta Crane", 7),
    ("the-first-five-minutes-of-a-discovery-call", "The first five minutes of a discovery call", "Sales", "Marta Crane", 6),
    ("demos-that-answer-the-question-behind-the-question", "Demos that answer the question behind the question", "Sales", "Marta Crane", 5),
    ("when-the-deal-goes-quiet", "When the deal goes quiet", "Sales", "Marta Crane", 6),
    ("handoffs-that-do-not-drop-the-thread", "Handoffs that do not drop the thread", "Sales", "Theo Marsh", 5),
    ("lecture-capture-that-finds-the-exam-questions", "Lecture capture that finds the exam questions", "Education", "Dr. Sanja Ilic", 7),
    ("seminar-notes-for-every-student-at-once", "Seminar notes for every student at once", "Education", "Dr. Sanja Ilic", 6),
    ("office-hours-without-the-queue", "Office hours without the queue", "Education", "Prof. Lena Holt", 5),
    ("the-cut-that-keeps-the-quote", "The cut that keeps the quote", "Media", "Rex Amaya", 4),
    ("transcripts-for-the-edit-suite", "Transcripts for the edit suite", "Media", "Rex Amaya", 5),
    ("hiring-with-a-record-you-can-re-read", "Hiring with a record you can re-read", "Hiring", "Yuki Ono", 6),
    ("debriefs-that-survive-the-weekend", "Debriefs that survive the weekend", "Hiring", "Yuki Ono", 5),
    ("why-we-built-relayo", "Why we built Relayo", "Company", "Ada Falk", 8),
    ("draft-q4-roadmap", "Draft: Q4 roadmap", "Product Updates", "Ada Falk", 9),
    ("unpublished-pricing-notes", "Unpublished: pricing notes", "Sales", "Theo Marsh", 5),
]

_PUBLISHED_AT = [
    "2026-10-01T09:00:00Z", "2026-09-24T09:00:00Z", "2026-09-17T09:00:00Z",
    "2026-09-03T09:00:00Z", "2026-08-27T09:00:00Z", "2026-08-13T09:00:00Z",
    "2026-07-30T09:00:00Z", "2026-07-16T09:00:00Z", "2026-06-25T09:00:00Z",
    "2026-06-11T09:00:00Z", "2026-05-28T09:00:00Z", "2026-09-24T09:00:00Z", "2026-05-28T09:00:00Z",
    "2026-05-14T09:00:00Z", "2026-04-30T09:00:00Z", "2026-04-16T09:00:00Z",
    "2026-04-02T09:00:00Z", "2026-03-26T09:00:00Z", "2026-02-12T09:00:00Z",
    "2026-02-05T09:00:00Z", "2026-01-22T09:00:00Z", "2026-01-08T09:00:00Z",
    "2025-12-11T09:00:00Z", "2025-11-20T09:00:00Z", "2025-10-30T09:00:00Z",
    "2025-10-02T09:00:00Z",
]

_OPENERS = {
    "Product Updates": "This release came straight out of the conversations our team was having with customers every week.",
    "Sales": "The best sales teams we meet treat every call as a source of advantage, not a box to tick.",
    "Education": "Teaching is a practice of listening, and every cohort deserves a record it can return to.",
    "Media": "An interview is only as good as what you can find again afterwards.",
    "Hiring": "A fair process starts with an accurate memory of what was actually said.",
    "Company": "Relayo began with a simple observation about how teams lose what their meetings produce.",
}


def _body(category: str, slug: str) -> str:
    opener = _OPENERS[category]
    return (
        f"{opener} We built this around the way teams actually work: calls happen, "
        "notes get lost, and the follow-up lands somewhere nobody looks. Relayo "
        "joins the call, records it, and turns it into notes you can search and "
        "follow-ups you can act on. Nothing in this piece is a promise about "
        "features that do not exist; it is a description of the product as it "
        "ships today. Teams that adopt the habit tell us the same thing: the "
        "value is not in the recording, it is in the retrieval. A decision that "
        "was made three weeks ago becomes a search away instead of a memory "
        "contest. If any of this sounds like your week, read on. There is more "
        "on how the agents handle the moments before, during and after a call."
    )


def _articles() -> list[tuple]:
    rows: list[tuple] = []
    published_index = 0
    for slug, title, category, author, read_time in _ARTICLE_SKELETON:
        unpublished = slug in ("draft-q4-roadmap", "unpublished-pricing-notes")
        scheduled = slug == "scheduled-2099-launch"
        if unpublished:
            published_at = "2026-09-10T09:00:00Z"
            published = False
        elif scheduled:
            published_at = "2099-01-01T09:00:00Z"
            published = True
        else:
            published_at = _PUBLISHED_AT[published_index]
            published = True
            published_index += 1
        rows.append((slug, title, category, author, read_time, published_at,
                     published, _body(category, slug)))
    rows.append((
        "scheduled-2099-launch", "Relayo at the 2099 partner summit",
        "Product Updates", "Ada Falk", 4, "2099-01-01T09:00:00Z", True,
        _body("Product Updates", "scheduled-2099-launch"),
    ))
    return rows


ARTICLES = _articles()

PRESS_ITEMS = [
    ("2026-09-30", "News", "Relayo closes a growth round led by Terracotta Ventures", True),
    ("2026-09-12", "News", "Relayo opens a partner program for consultancies", True),
    ("2026-08-28", "News", "Relayo and Datebook Calendar ship one-click capture", True),
    ("2026-08-14", "News", "Relayo passes its second independent security review", True),
    ("2026-07-31", "News", "Relayo appoints Iris Bender as Head of Product", True),
    ("2026-07-17", "News", "Relayo and Pipewell CRM connect calls to deals", True),
    ("2026-06-26", "News", "Relayo reaches fifty thousand recorded meetings", True),
    ("2026-06-12", "News", "Relayo adds search across every past meeting", True),
    ("2026-05-29", "News", "Relayo opens a Berlin office for the partner team", True),
    ("2026-05-15", "News", "Relayo joins the Framecall Video partner council", True),
    ("2026-04-24", "News", "Relayo publishes its meeting data charter", True),
    ("2026-04-10", "News", "Relayo and Signalgraph connect notes to dashboards", True),
    ("2026-03-27", "News", "Relayo doubles its education practice", True),
    ("2026-03-13", "News", "Relayo named a rising tool in team productivity", True),
    ("2026-02-27", "News", "Relayo and Ringstead Dialer ship live call summaries", True),
    ("2026-02-13", "News", "Relayo expands to eleven European markets", True),
    ("2026-01-30", "News", "Relayo and Vaultbox Drive secure archive storage", True),
    ("2025-12-19", "News", "Relayo previews the media agent for production teams", False),
    ("2025-11-21", "News", "Relayo adds the education agent to its lineup", True),
    ("2025-11-21", "News", "Relayo hires its first partner engineer", True),
    ("2025-10-24", "News", "Relayo launches with a meeting-first promise", True),
    ("2026-01-16", "News", "Relayo records its ten thousandth sales call", True),
    ("2099-01-01", "News", "Relayo at the 2099 partner summit", True),
    ("2026-09-05", "Press Releases", "Relayo partner program opens for applications", True),
    ("2026-06-20", "Press Releases", "Relayo announces its Berlin headquarters", True),
    ("2026-03-06", "Press Releases", "Relayo publishes its first transparency report", True),
    ("2025-12-05", "Press Releases", "Relayo releases its integration directory", True),
    ("2025-12-05", "Press Releases", "Relayo signs its first reseller agreement", False),
]

JOBS = [
    ("Partner Manager", "Berlin (hybrid)", True),
    ("Partner Engineer", "Berlin (hybrid)", True),
    ("Product Engineer, Notes and Search", "Remote (Europe)", True),
    ("Education Lead", "Amsterdam", True),
    ("Office Coordinator", "Berlin", False),
    ("Brand Designer", "Remote", False),
]

RESOURCE_CARDS = [
    ("Updates", "Product Updates", "Meeting notes that write themselves", "2026-10-01",
     "The release note behind the headline feature, with the thinking that shaped it.", "/blog/meeting-notes-that-write-themselves"),
    ("Updates", "Product Updates", "Search every call your team has ever taken", "2026-09-24",
     "A short guide to the search model, and what it can find in a long meeting history.", "/blog/search-every-call-your-team-has-ever-taken"),
    ("Case Studies", "Case Studies", "How Nordhall shortened its deal cycle", "2026-07-16",
     "A sales team that stopped losing objections between calls, and what it measured.", "/blog/turning-talk-time-into-a-team-metric"),
    ("Case Studies", "Case Studies", "A university seminar that keeps its own record", "2026-01-22",
     "Dr. Ilic's seminar notes, from the first recording to the searchable archive.", "/blog/seminar-notes-for-every-student-at-once"),
    ("Webinars", "Webinars", "The partner program, explained in twenty minutes", "2026-09-12",
     "A recorded walkthrough of the ways to partner, from referrals to integrations.", "/partner-program"),
    ("Webinars", "Webinars", "Before, during and after: the agent tour", "2026-05-28",
     "A guided tour of the five agents, with a live call and a live recap.", "/sales-agent"),
    ("Guides", "Guides", "Writing follow-ups people actually action", "2026-04-30",
     "The anatomy of a follow-up that moves work forward, with worked examples.", "/blog/follow-ups-that-leave-the-call-with-you"),
    ("Guides", "Guides", "Choosing a meeting assistant for your team", "2026-03-26",
     "A plain-language checklist for evaluating recording, notes, search and follow-ups.", "/blog/connected-to-the-tools-you-already-use"),
    ("Videos", "Videos", "Relayo in ninety seconds", "2026-10-01",
     "The whole story, from the calendar invite to the follow-up, in one short film.", "/sales-agent"),
    ("Videos", "Videos", "The recruiter's debrief, recorded", "2026-10-30",
     "How hiring teams use the recorded debrief to keep interviews fair and comparable.", "/recruiting-agent"),
]
