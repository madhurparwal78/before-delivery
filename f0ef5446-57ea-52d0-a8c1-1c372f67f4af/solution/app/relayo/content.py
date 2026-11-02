"""Marketing copy shared by the home page and the one agent template."""

from __future__ import annotations

OUTBOUND = {
    "start": "https://app.relayo.example/signup",
    "demo": "https://relayo.example/book-a-demo",
    "pricing": "https://relayo.example/pricing",
}

AGENT_ORDER = ("sales", "education", "media", "sdr", "recruiting")

AGENTS: dict[str, dict] = {
    "sales": {
        "name": "Sales Agent",
        "promise": "Walk into every call prepared and leave with the deal notes already written.",
        "slide": "Discovery, demos and negotiations, captured word for word and logged on the right deal.",
        "poster_alt": "A sales call tile turning into a deal card with next steps",
        "before": ("Know the account", "Relayo pulls the last conversation, open questions and stakeholders into a one-page brief before the call."),
        "during": ("Stay with the buyer", "Live notes catch pricing questions, objections and timelines while you keep eye contact."),
        "after": ("Update the deal", "Summaries, next steps and risks land on the opportunity before you open your inbox."),
        "details": (("Deal-ready summaries", "Fields your CRM expects, filled from what the buyer said."),
                    ("Objection tracking", "Every concern tagged and searchable across the pipeline."),
                    ("Coaching moments", "Highlights managers can review in minutes, not hours.")),
    },
    "education": {
        "name": "Education Agent",
        "promise": "Give every student the same clear notes, whether they sat in the front row or joined late.",
        "slide": "Lectures, seminars and office hours turned into study notes students can search.",
        "poster_alt": "A lecture tile turning into a page of study notes with chapters",
        "before": ("Prepare the session", "Share the outline and readings so Relayo can match notes to your syllabus."),
        "during": ("Teach, not transcribe", "Captions and chapters build up as you speak, for students in the room and online."),
        "after": ("Publish study notes", "Review the summary, add links and send it to the class in one step."),
        "details": (("Live captions", "Readable captions for every learner, in the room or remote."),
                    ("Chapters by topic", "Long lectures split where the subject changes."),
                    ("Private office hours", "Answers shared with the class without naming who asked.")),
    },
    "media": {
        "name": "Media Agent",
        "promise": "Keep your eyes on the guest while Relayo keeps the record.",
        "slide": "Interviews and productions with timestamped quotes ready for the edit.",
        "poster_alt": "An interview tile turning into a transcript with marked quotes",
        "before": ("Plan the interview", "Questions and research notes travel with the recording."),
        "during": ("Mark the moments", "Tap to mark a strong answer and keep listening."),
        "after": ("Cut faster", "Quotes, chapters and show notes are ready before the edit begins."),
        "details": (("Speaker labels", "Every voice named, even on a single studio microphone."),
                    ("Quote export", "Timestamped quotes for fact-checking and captions."),
                    ("Show notes", "Chapters and summaries drafted from the recording itself.")),
    },
    "sdr": {
        "name": "SDR Agent",
        "promise": "Qualify inbound interest on the first call and hand over demos with full context.",
        "slide": "Inbound qualification and demo booking with notes the account executive can trust.",
        "poster_alt": "A short qualification call tile turning into a booked demo card",
        "before": ("See the lead", "Form answers and website visits summarised before you dial."),
        "during": ("Qualify naturally", "Relayo tracks budget, need and timing as the conversation flows."),
        "after": ("Hand over cleanly", "A qualified summary and the booked demo arrive with the account executive."),
        "details": (("Qualification fields", "Filled from the call, with the quote that supports each one."),
                    ("Instant handover", "The next owner gets context before the first meeting."),
                    ("Dialer friendly", "Works with the dialers your team already uses.")),
    },
    "recruiting": {
        "name": "Recruiting Agent",
        "promise": "Run fair, structured interviews and decide on evidence, not memory.",
        "slide": "Interviews and hiring debriefs with notes mapped to your scorecard.",
        "poster_alt": "An interview tile turning into a scorecard with evidence notes",
        "before": ("Share the scorecard", "Every interviewer sees the same questions and criteria."),
        "during": ("Listen fully", "Notes map answers to the scorecard while you focus on the candidate."),
        "after": ("Debrief on evidence", "The panel compares like with like and decides in one meeting."),
        "details": (("Scorecard mapping", "Answers linked to the criteria they support."),
                    ("Consistent panels", "The same structure for every candidate."),
                    ("Candidate privacy", "Recordings kept only as long as your policy allows.")),
    },
}

PLANS = (
    ("Team", "For teams getting started with recorded meetings.", ("Unlimited recordings", "Summaries and action items", "Five integrations")),
    ("Business", "For organisations that need controls and scale.", ("Everything in Team", "Admin and privacy controls", "All integrations and single sign-on")),
)
