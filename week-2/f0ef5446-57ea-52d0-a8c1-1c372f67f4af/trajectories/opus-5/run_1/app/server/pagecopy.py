"""Domain copy for the home carousel, the agent template and the careers band."""

from __future__ import annotations

from typing import Any

HOME_SLIDES: tuple[dict[str, str], ...] = (
    {
        "name": "Sales Agent",
        "href": "/sales-agent",
        "eyebrow": "For revenue teams",
        "copy": "Discovery answers, objections and next steps land on the opportunity before "
        "the room has emptied.",
    },
    {
        "name": "Education Agent",
        "href": "/education-agent",
        "eyebrow": "For teaching teams",
        "copy": "Every seminar stays searchable, with revision questions drawn from what was "
        "actually taught.",
    },
    {
        "name": "Media Agent",
        "href": "/media-agent",
        "eyebrow": "For newsrooms and studios",
        "copy": "Accurate quotes, marked takes and a transcript the edit can work from.",
    },
    {
        "name": "SDR Agent",
        "href": "/sdr-agent",
        "eyebrow": "For inbound teams",
        "copy": "Qualify in the first four minutes and hand over a demo nobody has to repeat.",
    },
    {
        "name": "Recruiting Agent",
        "href": "/recruiting-agent",
        "eyebrow": "For hiring panels",
        "copy": "One shared interview record, so the debrief argues about evidence, not memory.",
    },
)


def _agent(
    name: str,
    eyebrow: str,
    promise: str,
    stages: tuple[tuple[str, str, tuple[str, ...]], ...],
    capabilities: tuple[tuple[str, str], ...],
    closing: str,
) -> dict[str, Any]:
    return {
        "name": name,
        "eyebrow": eyebrow,
        "promise": promise,
        "stages": [
            {"title": title, "copy": copy, "points": list(points)}
            for title, copy, points in stages
        ],
        "capabilities": [{"title": title, "copy": copy} for title, copy in capabilities],
        "plans": [
            {
                "name": "Team",
                "price": "Per seat, billed yearly",
                "copy": "For one team that runs its own calls and keeps its own record.",
                "action": "See Team pricing",
            },
            {
                "name": "Company",
                "price": "Per seat, with workspace controls",
                "copy": "For several teams, with retention rules, redaction and reporting.",
                "action": "See Company pricing",
            },
        ],
        "closing": closing,
    }


AGENTS: dict[str, dict[str, Any]] = {
    "sales-agent": _agent(
        "Sales Agent",
        "For revenue teams",
        "Relayo sits in your sales calls, writes the recap your CRM wants and never lets a "
        "commitment go unwritten.",
        (
            (
                "Before the call",
                "Relayo gathers the account's last three conversations, the open follow-ups "
                "and the questions nobody answered yet.",
                (
                    "Account brief from past calls",
                    "Open follow-ups with owners",
                    "The buyer's own words on price and timing",
                ),
            ),
            (
                "During the call",
                "A speaker-aware transcript runs quietly while you talk. Objections and next "
                "steps are marked as they are said.",
                (
                    "No note-taking seat needed",
                    "Objections tagged live",
                    "Pricing questions captured verbatim",
                ),
            ),
            (
                "After the call",
                "The recap, the next steps and the deal fields are written back before you "
                "reach your next meeting.",
                (
                    "Recap in your team's shape",
                    "Next steps with dates",
                    "CRM fields updated once, correctly",
                ),
            ),
        ),
        (
            (
                "Discovery scorecards",
                "See which questions earned a second meeting, across the whole team.",
            ),
            (
                "Handover packs",
                "Give the next owner the three calls that matter, not the whole folder.",
            ),
            (
                "Objection library",
                "Collect the answers that worked and share them with new sellers.",
            ),
        ),
        "Run your next discovery call with Relayo",
    ),
    "education-agent": _agent(
        "Education Agent",
        "For teaching teams",
        "Relayo keeps seminars, lectures and tutorials searchable, accessible and usable long "
        "after the room empties.",
        (
            (
                "Before class",
                "Relayo pulls the reading list and the last session's open questions into one "
                "page for the teaching team.",
                (
                    "Session plan from your calendar",
                    "Last week's unanswered questions",
                    "Terms and names spelled your way",
                ),
            ),
            (
                "During class",
                "A captioned transcript runs for everybody in the room, including students who "
                "need it to follow along.",
                (
                    "Live captions",
                    "Speaker labels for seminars",
                    "Moments marked for revision",
                ),
            ),
            (
                "After class",
                "Students get a summary and revision questions the same evening, drawn from "
                "what was actually taught.",
                (
                    "Summary per session",
                    "Revision questions from the transcript",
                    "Searchable archive across a term",
                ),
            ),
        ),
        (
            ("Accessible by default", "Captions and transcripts as a first draft of access."),
            ("Term-wide search", "Ask one question and read the three sessions that answer it."),
            ("Quiet in the room", "One guest, no prompts, nothing asked of the students."),
        ),
        "Bring Relayo to your next seminar",
    ),
    "media-agent": _agent(
        "Media Agent",
        "For newsrooms and studios",
        "Relayo gives interviews and production calls an accurate record, so quotes hold and "
        "the edit starts sooner.",
        (
            (
                "Before the interview",
                "Question lists, background notes and past interviews with the same subject sit "
                "in one place.",
                (
                    "Question list to hand",
                    "Past interviews with the same subject",
                    "Names and titles spelled correctly",
                ),
            ),
            (
                "During the interview",
                "Relayo keeps a verbatim transcript and marks the takes you point at, without "
                "interrupting the conversation.",
                ("Verbatim transcript", "Takes marked as they happen", "Timecodes for the edit"),
            ),
            (
                "After the interview",
                "Quotes come back with their timecodes, and the transcript is ready for the "
                "edit within minutes.",
                (
                    "Quote list with timecodes",
                    "Transcript for the edit suite",
                    "Archive that stays searchable",
                ),
            ),
        ),
        (
            ("Verbatim mode", "Keep the words as spoken, including the pauses that matter."),
            ("Redaction", "Remove a passage from transcript, audio and recap together."),
            ("Embargo care", "Keep unpublished work unreachable until its moment arrives."),
        ),
        "Record your next interview with Relayo",
    ),
    "sdr-agent": _agent(
        "SDR Agent",
        "For inbound teams",
        "Relayo qualifies inbound calls, books the demo and hands the account over without a "
        "second discovery.",
        (
            (
                "Before the call",
                "Relayo reads the form, the website and the past touches, and puts the three "
                "questions that matter on screen.",
                ("Inbound context in one panel", "Routing rules applied", "Three questions ready"),
            ),
            (
                "During the call",
                "Qualification answers are captured as they are given, so the next step is "
                "agreed inside four minutes.",
                ("Qualification captured live", "Demo booked in the call", "No forms afterwards"),
            ),
            (
                "After the call",
                "The account executive gets the recap, the recording and the agreed next step "
                "before the calendar invitation lands.",
                ("Handover recap", "Recording with chapters", "Next step with an owner"),
            ),
        ),
        (
            ("Routing notes", "Keep the reason for a handover with the handover."),
            ("Demo prep packs", "Give the next call everything the first one learned."),
            ("Coaching clips", "Short clips from real calls for new starters."),
        ),
        "Qualify your next inbound call with Relayo",
    ),
    "recruiting-agent": _agent(
        "Recruiting Agent",
        "For hiring panels",
        "Relayo gives every interview one shared record, so panels decide from evidence and "
        "candidates get a fair reading.",
        (
            (
                "Before the interview",
                "The panel sees the role, the scorecard and what earlier rounds already asked.",
                ("Scorecard to hand", "Earlier rounds summarised", "No repeated questions"),
            ),
            (
                "During the interview",
                "Relayo keeps a transcript with speaker labels, so the panel can listen instead "
                "of writing.",
                ("Transcript with labels", "Answers matched to the scorecard", "Quiet capture"),
            ),
            (
                "After the interview",
                "The debrief runs from one record: answers, evidence and a recommendation per "
                "panellist.",
                ("Shared interview record", "Evidence per criterion", "Debrief in ten minutes"),
            ),
        ),
        (
            ("Structured scorecards", "Same questions, same reading, every candidate."),
            ("Panel debriefs", "One record the whole panel can quote from."),
            ("Candidate care", "Notes that make a kind, specific reply easy to write."),
        ),
        "Run your next interview panel with Relayo",
    ),
}

CAREERS_BANDS: tuple[dict[str, Any], ...] = (
    {
        "alt": "Two colleagues reviewing a meeting recap together",
        "back": "#eef2ff",
        "ink": "#1b4dff",
        "cx": 90,
        "bar": 150,
        "bar2": 110,
    },
    {
        "alt": "A quiet desk with a notebook and a phone",
        "back": "#e7edff",
        "ink": "#0d1326",
        "cx": 140,
        "bar": 120,
        "bar2": 80,
    },
    {
        "alt": "The Berlin office window at dusk",
        "back": "#f3f6ff",
        "ink": "#1b4dff",
        "cx": 170,
        "bar": 180,
        "bar2": 140,
    },
    {
        "alt": "A whiteboard after a planning session",
        "back": "#eaf0ff",
        "ink": "#0d1326",
        "cx": 70,
        "bar": 140,
        "bar2": 100,
    },
)
