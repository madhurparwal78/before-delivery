"""The safety library: original articles with a category and a topic."""

from __future__ import annotations

CATEGORIES = ["Guides", "Families", "Tools", "Trust"]
TOPICS = ["Moderation", "Privacy", "Wellbeing"]

ARTICLES: list[dict] = [
    {"slug": "reporting-and-blocking", "title": "Reporting and blocking", "category": "Tools", "topic": "Moderation",
     "summary": "Use the report flow and block controls to keep conversations healthy.",
     "body": ["Every message carries a report action that sends it to the community owner.",
              "Blocking a member hides their messages from you everywhere in the product."]},
    {"slug": "setting-up-a-safe-community", "title": "Setting up a safe community", "category": "Guides",
     "topic": "Moderation",
     "summary": "Roles, slowmode and a calm moderation baseline for brand new spaces.",
     "body": ["Start with a short set of house rules pinned in an announcements channel.",
              "Turn on slowmode in busy channels so every voice has room."]},
    {"slug": "talking-with-young-members", "title": "Talking with young members", "category": "Families",
     "topic": "Wellbeing",
     "summary": "How to open an honest conversation at home about online communities.",
     "body": ["Ask which communities they enjoy and what makes them feel welcome.",
              "Agree together on what to do when something feels wrong."]},
    {"slug": "understanding-verification", "title": "Understanding verification", "category": "Trust",
     "topic": "Privacy",
     "summary": "What verified and partnered badges mean and how a community earns them.",
     "body": ["A verified badge confirms a community is run by the creator it names.",
              "Partnered communities meet activity and safety standards each quarter."]},
    {"slug": "private-by-default", "title": "Private by default", "category": "Guides", "topic": "Privacy",
     "summary": "Control who can see your status and find your profile.",
     "body": ["Set your status to invisible to read without appearing online.",
              "Other members only ever see your public name and picture."]},
    {"slug": "taking-a-break", "title": "Taking a break", "category": "Families", "topic": "Wellbeing",
     "summary": "Mute busy communities and set quiet hours when you need some space.",
     "body": ["Muting a community keeps mentions while silencing everything else.",
              "Notifications can be cleared all at once from the bell."]},
    {"slug": "spotting-scams", "title": "Spotting scams", "category": "Tools", "topic": "Privacy",
     "summary": "Recognise fake giveaways and links that ask for your password.",
     "body": ["Community Hub staff will never ask for your password in a message.",
              "Report giveaway links that promise free membership."]},
    {"slug": "how-we-handle-reports", "title": "How we handle reports", "category": "Trust", "topic": "Moderation",
     "summary": "What happens after you send a report and who sees it.",
     "body": ["Reports go to the community owner and the moderators they trust.",
              "Reporters stay anonymous to the person they reported."]},
]
