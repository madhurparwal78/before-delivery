# Kinora Video Studio

Build and deploy a working web application from this brief. There is no starting codebase. When you are done, a stranger must be able to open the app in a browser, sign up, start a video generation from the studio composer, and see its exact cost leave the credit balance once while the generation renders to Ready, without hitting an error page. The team invitation and the enterprise enquiry this app sends must each arrive as a real email in the Mailpit inbox of the person it is addressed to; a message the app only shows itself does not count.

## Problem and users

Kinora is an AI video studio for creators and small teams. Build two things that share one look: the public Kinora site, a calm editorial marketing site that explains the studio, compares its credit plans and lets a company ask the sales team for an enterprise quote; and the signed-in studio, where a member writes a prompt, chooses a model, a length and a shape, and starts a generation that is paid for in credits.

Credits are the product's money. Every plan brings a number of credits, every generation costs a fixed number of credits per second of video or per image, and a workspace has exactly one balance that all of its members spend from. A Team workspace shares that one balance between two to nine people: its owner invites teammates by email, and every teammate who joins adds 6,900 credits to the pool the moment they join. Work is organised into projects, and the plan caps how many projects a workspace may have and how many generations may render at the same time.

The studio cannot run real video models, so it renders every generation itself: a short, deterministic abstract film (or still image) drawn from the words of the prompt. What must be real is everything around it. This is not a video editor, a payment checkout, a social network or a file host: there is no online payment, no plan change, no credit top-up, no uploads, no comments and no password reset. The genuinely hard part is that the credit balance is money: a generation is charged exactly once even when the same request arrives twice, the balance never goes below zero even when two teammates start generations at the same moment, a cancelled generation returns exactly what it cost, and the credit history always adds up to the balance shown.

| Role | Can do |
|---|---|
| Visitor (anonymous) | Read every public page, switch the pricing controls, search and copy example prompts, send an enterprise or licensing enquiry, sign up, sign in, and open an invitation link. **Cannot reach any studio page or any studio endpoint, cannot read any workspace's projects, generations, credits or team.** |
| Member | Signed in to exactly one workspace. Create and rename projects, start and cancel generations, read the workspace's projects, generations, credit history and team list, and sign out. **Cannot invite, revoke or remove anyone, cannot read or change another workspace's data.** |
| Owner | Everything a member can do, plus, in a Team workspace only, invite a teammate by email, revoke a pending invitation and remove a member. Every account created by signing up is the owner of its own new workspace. **Cannot remove themselves, cannot change the plan, cannot add credits.** |

Authorization is enforced **server-side on every mutating endpoint**. Hiding a button in the UI is not authorization: a direct API call from a member session to an owner-only endpoint, or from any session to another workspace's records, must be rejected by the server (an unauthorized request is denied, not served), leaving the protected state unchanged.

Anyone may create an account by signing up; there is no other way to create an owner. A member account is created only by accepting an invitation. The app starts with three seeded accounts:

| Email | Name | Role | Workspace |
|---|---|---|---|
| `owner@example.com` | Mara Quinn | Owner | Northlight Studio (Team plan) |
| `member@example.com` | Theo Park | Member | Northlight Studio (Team plan) |
| `creator@example.com` | Ines Duarte | Owner | Ines Duarte's workspace (Standard plan) |

## Journeys

1. A visitor opens `/pricing`, flips the switch to Monthly and sees Standard at `$15` /month, flips back to Yearly and sees `$12` with `$15` struck through, presses "Start Free", signs up as Lena Hart with a new email, and lands on `/studio` with "125 credits" in the sidebar. They write "A paper lantern rising over a quiet harbour at night", choose Vela 4.5 and "10 seconds", see "This will use 120 credits", and press "Generate". The card appears as Queued, the balance reads "5 credits", and within half a minute the card reads Ready and shows its picture. A second Generate for 30 credits is refused with "Not enough credits. This needs 30 and you have 5."
2. Ines Duarte signs in as `creator@example.com` with `deku-demo-pw-2026`, chooses Vela 4 Turbo and "5 seconds" in the project Music video, presses "Generate", sees the balance drop from "595 credits" to "565 credits", opens the project, presses "Cancel" on the new card while it is Rendering, sees "Cancelled. 30 credits returned." and the balance back at "595 credits". On `/studio/credits` the newest two rows read "Refund +30" and "Generation -30".
3. Mara Quinn signs in as `owner@example.com`, opens Team, sees "2 of 9 seats used", presses "Invite teammate" and invites `jo.ellis@example.com`. Jo receives `Mara Quinn invited you to Northlight Studio on Kinora`, follows the link, sets their name and password and presses "Join team", sees "You're in. Welcome to Northlight Studio.", and opens the studio, where the balance reads "20,564 credits" for everyone on the team. Theo Park, signed in as `member@example.com`, sees Jo on the team page but no "Invite teammate" button.
4. A visitor on `/enterprise-contact` presses "Submit" with the form empty and sees a message under every required field; they fill it in for Harbour & Pine and submit. The page shows "Thanks, we will be in touch within two business days."; the sales inbox receives `New enterprise enquiry from Harbour & Pine` and the visitor receives `We received your enquiry`.

Acceptance means a stranger signs up, starts a generation whose exact cost leaves the shared credit balance exactly once and renders to Ready, and gets every credit back by cancelling one still rendering; the balance never goes below zero, and the team invitation and enterprise enquiry each arrive as real email.

## Mandatory requirements

This is the complete list of requirements; the sections after it give the detail each one refers to.

- **DP-01 — Health endpoint.** `GET /api/health` answers 200 on the published port once the app can reach PostgreSQL.
- **DP-02 — Public pages in the first HTML.** Every public page sends its headings and copy in the first HTML response, and the home page has exactly one level-one heading.
- **DP-03 — Not-found page.** Any address that is not a page answers 404 with the public chrome, "Page not found", "We could not find that page." and a "Back to home" link.
- **DP-04 — Privacy page.** `/privacy` states what an account, an enquiry and an invitation store, who reads them, and that the only cookie keeps a person signed in.
- **DP-05 — Accessible pages.** Every public page, sign in, sign up and the studio pages pass a WCAG 2.2 AA audit, and every generated picture carries alternative text.
- **DP-06 — Keyboard and focus.** Every control reached by keyboard shows a visible focus ring, and dialogs trap focus, close on Escape and return focus to the control that opened them.
- **DP-07 — Phone layout.** At phone width no page scrolls sideways, the public header and the studio sidebar open as Menu drawers, the enquiry panel sits above the form, the composer spans the width and cards flow into one or two columns.
- **DP-08 — Reduced motion.** With `prefers-reduced-motion: reduce` no endless animation runs on the home page, the pricing page or a studio project with a rendering generation.
- **DP-09 — Self-contained pages.** Pages call no outside network service, show no cookie banner or upload control, and set at most one cookie, the session.
- **DP-10 — Nothing beyond scope.** No checkout, plan change, top-up, password reset, social sign in, upload, comment or account deletion address answers success, and none changes a balance.
- **DP-11 — Public site motion.** The home hero settles from slightly enlarged, the partner strip glides in an endless steady loop of about half a minute with faded edges, header menus fade in, and pricing prices cross-fade when the billing switch flips.
- **DP-12 — Studio motion.** Dialogs open with a soft zoom over a dimmed page, toasts rise and leave on their own, cards lift when pointed at, the phone drawer slides in from the left, and a saving Generate is unavailable with a turning spinner.
- **DP-13 — Generation motion.** A rendering card's bar fills while its placeholder breathes under a light sweep, a new card lands with a springy overshoot, and the finished picture fades in.
- **DP-14 — Light palette.** Grounds, ink, the single blue-violet accent, the soft highlights, the red errors, the green success note, the band gradient and the near-black footer follow Visual design.
- **DP-15 — Type and figures.** One neutral grotesk sans sets headlines and text, and credit balances, costs and history amounts sit in a monospace with aligned digits.
- **DP-16 — Components and icons.** Buttons wear the three skins, the named pills are fully round, cards float on a faint shadow, the composer is generously rounded, and icons are thin line drawings in the text colour.
- **DP-17 — Editorial lobby and tidy desk.** The public site breathes with rounded drawn frames under a frosted header, the studio is a slim sidebar beside a compact work area with the composer in the middle, and drawn pictures share one soft abstract language.
- **DP-18 — Rules held by the server.** Charges, refunds and idempotency are held by the database, email leaves over SMTP, roles and workspaces come from the token, and the server moves generations to Ready.
- **DP-19 — Global chrome.** The announcement band, the sticky header with its four menus and three buttons, and the footer carry the links and behaviour in Public site.
- **DP-20 — Public page controls.** The home tabs, the product tool tabs, the team plan questions, the licensing call to action and the research and resource cards behave as described in Public site.
- **DP-21 — Pricing controls.** `/pricing` opens on Individual and Yearly, the billing switch swaps yearly and monthly prices, the plan family tabs swap the cards, and each plan button leads where Public site says.
- **DP-22 — Plan and model catalogue.** `GET /api/plans` and `GET /api/models` return the six plans and three models with their whole-number prices, credits and limits.
- **DP-23 — Prompt library.** `/examples` and `GET /api/examples` narrow the eight examples by category and search, copy a prompt, and carry it into the studio through sign in.
- **DP-24 — Sign up.** Signing up creates an owner with a Free workspace, 125 recorded plan credits and "My first project", refuses a taken email in any case and invalid fields, and sends no email.
- **DP-25 — Sign in and sign out.** Seeded accounts sign in case-insensitively, wrong credentials get one message, studio pages need a session, and logging out ends the token.
- **DP-26 — Hashed passwords.** No users row holds a password in plain text.
- **DP-27 — Seed data.** The three accounts, two workspaces, three projects, three Ready generations and their credit histories are seeded once and send no email.
- **DP-28 — Studio needs a token.** Every studio endpoint answers 401 to a missing or malformed token, whatever the body claims, and changes nothing.
- **DP-29 — Workspaces kept apart.** Another workspace's projects, generations and outputs answer 404 and stay unchanged.
- **DP-30 — Projects.** Projects are created, listed newest first and renamed with names unique in any letter case, within the plan's project limit, from the New project dialog or the API.
- **DP-31 — Composer.** The studio home composer offers its named choices and defaults, follows every choice with its cost line, fills starter prompts from templates and lists the five newest generations.
- **DP-32 — Start and charge.** Starting a generation charges the server-computed cost once, lowers the shared balance at once and refuses invalid fields with 422.
- **DP-33 — Refused starts.** A start the balance cannot cover answers 402 and one beyond the parallel limit answers 409, each changing nothing.
- **DP-34 — Charged exactly once.** Repeats with one idempotency key, simultaneous same-key starts, simultaneous over-balance starts and a double click each leave one generation and one charge.
- **DP-35 — Rendering and output.** A generation is Ready 8 to 30 seconds after its start with no browser open, and its output is a deterministic SVG drawn from the prompt at its aspect, unavailable before Ready and to other workspaces.
- **DP-36 — Looping video and still image.** A Ready video's picture loops over its stated length and a Ready image's picture holds still.
- **DP-37 — Generation cards and cancel.** Generation cards show their details and update without a reload, and Cancel shows "Cancelled. <n> credits returned."
- **DP-38 — Refund once.** Cancelling a Queued or Rendering generation refunds its full cost exactly once, even under simultaneous cancels, and cancelling a Ready or cancelled one answers 409.
- **DP-39 — Credit history.** The balance always equals the sum of its entries with running balances never below zero, and `/studio/credits` shows the balance, the plan line and signed rows newest first.
- **DP-40 — Team page.** `/studio/team` shows seats, members and pending invitations, gives the Team owner Invite teammate and Revoke, hides them from members, and tells other plans that teams come from sales.
- **DP-41 — Invitation email.** Inviting sends exactly one email with the exact subject and the full join link, and refuses taken addresses and a tenth seat without sending.
- **DP-42 — Joining a team.** Accepting an invitation creates a Member, adds one 6,900 credit seat to the shared balance once, shows the full-page welcome, and leaves the link invalid.
- **DP-43 — Revoke and remove.** Revoked links stop working, removed members lose their session and sign in, nothing is refunded, and the owner cannot remove themselves.
- **DP-44 — Owner-only team management.** Members and owners of workspaces not on the Team plan are denied inviting, revoking and removing with 403, and nothing changes.
- **DP-45 — Enquiry form.** The enterprise and licensing forms show their fields and options, mark every failing field with an announced message, keep typed values and finish on a full-page confirmation.
- **DP-46 — Enquiry emails.** A valid enquiry is stored and sends exactly one sales email and one acknowledgement, a licensing enquiry is stored with its source, and an invalid one stores and sends nothing.
- **DP-47 — Stored change survives mail failure.** With mail undeliverable an invitation and an enquiry are still stored and answer success.

## Frontend

### Screens and layout (DP-02, DP-03, DP-07, DP-17, DP-25)

The information architecture is a top-navigated public site and a sidebar-navigated studio behind a sign in. Routes carry no locale prefix and there is one language.

| Route | Purpose | Auth |
|---|---|---|
| `/` | home | public |
| `/product` | the creative suite | public |
| `/pricing` | plans, with plan family tabs and the billing switch | public |
| `/team-plan` | the Team plan | public |
| `/enterprise` | enterprise pitch and enquiry form | public |
| `/enterprise-contact` | the enterprise enquiry form | public |
| `/model-licensing` | model licensing and its enquiry form | public |
| `/examples` | the prompt library | public |
| `/use-cases` | use cases | public |
| `/workflows` | the Workflows story | public |
| `/research` | research papers | public |
| `/resources` | articles | public |
| `/privacy` | privacy page | public |
| `/signup` | create an account | public |
| `/login` | sign in | public |
| `/invite/<token>` | accept a team invitation | public |
| `/studio` | studio home with the composer | member |
| `/studio/projects` | the projects | member |
| `/studio/projects/<id>` | one project's generation timeline | member |
| `/studio/generations/<id>` | one generation | member |
| `/studio/credits` | the balance and the credit history | member |
| `/studio/team` | members, invitations and seats | member |

The public pages render their headings and copy as real text in the first HTML response from the server. Any address that is not a page of the site or the studio returns status `404` with a not-found page that keeps the public chrome, shows the heading "Page not found" and the line "We could not find that page." with a link "Back to home" to `/`.

**The studio layout.** Every studio page has a fixed left sidebar: the wordmark with the word "Creative", a primary pill "New generation" (with a plus in a blue-violet circle) that goes to `/studio` and puts focus in the prompt box, the navigation Home (`/studio`), Projects, Credits and Team, and, at the bottom, the signed-in person's name, the workspace name, the plan name, the credit balance written like "13,664 credits" and "Log out". The current page's sidebar row is marked as the current page. Creating a project, inviting a teammate and removing a member happen in dialogs over the page; an enquiry and a team join finish on a full-page confirmation.

**Responsive layout** holds at every width from a phone to a wide desktop: on a narrow viewport such as a phone the public header shows the wordmark and a "Menu" button that opens a drawer with every menu link and the three header buttons, the plan cards stack in one column, the enquiry page puts the media panel above the form, the footer columns stack, the studio sidebar becomes a drawer opened by a "Menu" button, the composer spans the width, and project and template cards flow into one or two columns. No page ever scrolls sideways on a phone; tab rows scroll inside themselves.

### Public screens and controls: Public site (DP-02, DP-04, DP-19, DP-20, DP-21)

Global chrome of the public site:

1. A full-width announcement band on a blue-violet gradient carries the centred line "Enterprises get 2 months of usage free. Sign by 10/31.", an underlined link "See terms" (to `/team-plan`) and an outlined pill "Contact sales" with a chevron, linking to `/enterprise-contact`.
2. A header that sticks to the top of the window once the band has scrolled away, on a frosted near-white ground. At the left the wordmark "kinora" linking to `/` (its accessible name is exactly "Kinora"). In the centre the menus "Creative", "Research", "Resources" and "Enterprise", each a button with a chevron that opens a small panel of links, and the plain link "Pricing" to `/pricing`. Creative lists Overview (`/product`), Use Cases (`/use-cases`), Examples (`/examples`), Pricing, Team Plan (`/team-plan`) and Login (`/login`); Research lists Research Hub (`/research`); Resources lists Resource Hub (`/resources`) and Workflows (`/workflows`); Enterprise lists Overview (`/enterprise`), Contact Sales (`/enterprise-contact`) and Model Licensing (`/model-licensing`). At the right three buttons: "Enterprise Sales" (to `/enterprise-contact`) and "Login" (to `/login`) on a light ground, and "Try Kinora" (to `/signup`) on a near-black ground. A menu panel closes on Escape, on a click outside it and when another opens.
3. A near-black footer with four columns headed Creative, Research, Resources and Company, carrying the same links as the menus plus "Privacy Policy" (to `/privacy`), and a bottom row with the wordmark and "©2026 Kinora AI, Inc.".

The public pages:

1. `/` (home) has exactly one level-one heading, "Building Real-World Intelligence", in a full-width rounded hero frame, with the paragraph "Kinora is building foundational Real-World Intelligence that can understand, simulate and act in the world. We offer products and services built on-top of this intelligence to empower individuals and organizations to do more in the world." and a light pill "Try Kinora for free" linking to `/signup`. Below it: the line "We partner with the world's leading organizations to advance their industries:" over a partner strip that glides sideways without end; the heading "Three platforms built on-top of the same Real-World Intelligence models" with three columns, "Kinora Creative" (the line "Your complete Creative Suite with everything you need, to make anything you want.", buttons "Try now" to `/signup`, "Learn more" to `/product` and "For Enterprise" to `/enterprise`, and the caption "Used by 60m+ creatives around the world. Try free, cancel anytime."), "Kinora Dev" and "Kinora Robotics" (each with a short line and a "Contact Sales" button to `/enterprise-contact`); a tab list "How Kinora is Used", "Create with Agent", "Build your own Workflows", "Enterprise-grade" and "The World's Best Models", where choosing a tab shows its own panel and the unchosen tabs are dimmed; a dark "Kinora Research" band with three linked rows (Vela 4.5, General World Models, Research Hub) leading to `/research`; and the heading "See the latest from Kinora" over four news cards, each a title and a summary.
2. `/product` has the level-one heading "A new frontier for video generation.", a "Get Started" button to `/signup` and the caption "Used by 60M+ users globally - try today and cancel anytime"; the heading "Every model you need to make anything you want." over the three Vela models; the heading "Dozens of tools. Endless ways to create." over a tab list Transform Video, Mood Boards, Virtual Staging, Character Performance, Virtual Try-On, Design Explorations, Storyboarding, Animatics, Generate Yourself and Visual Effects, each tab showing its own description; and "Explore other apps", nine tiles Remove from Video, Reshoot Product, Upscale Video, Add Dialogue, Change Image Style, Add Performance, Change Backdrop, Change Time of Day and Relight Scene, each with its one line ("Remove anything from any video with a simple prompt." for the first).
3. `/pricing` has the level-one heading "Choose the Right Plan for You", the caption "Trusted by 60M+ creators and leading enterprises", a segmented control (a group of three tabs) "Individual", "Team & Enterprise" and "API", and a switch named "Yearly billing" between the words "Monthly" and "Yearly" with the badge "2 months free"; Individual and Yearly are chosen when the page opens. Individual shows four plan cards, Free, Standard, Pro (with the tab "Popular") and Max (with the tab "Best value" and the badge "Credits roll over 1 mo."), each with its price, its credits line, its call to action and its features, as given in Content. With Yearly on, each paid card shows the monthly price struck through beside the yearly price and the line "Billed annually. Save $<n>/year."; with Monthly on it shows only the monthly price. Each credits line has an information button whose tip explains what the credits buy. "Team & Enterprise" shows a Team card and an Enterprise card; "API" shows one card, "API access is arranged with our sales team.", with "Contact sales". "Start Free" goes to `/signup`; every other plan button goes to `/enterprise-contact`.
4. `/team-plan` has the level-one heading "Kinora Team", the line "Grow your business faster with more on-brand campaigns, product shots and social, made in a fraction of the time." and "Get Team" (to `/enterprise-contact`); the blocks "One place for your team's work", "Manage the whole team from one balance" (with "Every seat adds 6,900 credits a month to a single shared pool, and they land the moment you add the seat.") and "Bring Kinora to the tools you already use"; "For every team with creative needs" with Marketing teams, Studios and agencies, and In-house creative; the Team and Enterprise cards; and a "Frequently asked questions" list of disclosure rows, each opening and closing its answer: "What is the Team plan?" ("Team is a plan for groups of two to nine people who create together in one Kinora workspace."), "How does the shared credit pool work?", "Can I change the number of seats?" and "When should we consider Enterprise instead?".
5. `/enterprise` has the two-line level-one heading "Production-ready AI" / "Made for Enterprise", the line "Our full suite of creative AI tools can help your teams realize bigger ideas with smaller budgets and timelines.", a "Contact Sales" button to `/enterprise-contact`, "Why Enterprises Choose Kinora" with stat cards "2 weeks" ("Saved on production timeline despite no access to on-camera talent") and "80%" ("Cost savings vs traditional VFX Pipeline") under invented studio names, and "Built for Enterprise" listing "We don't train on your data", "SOC 2 Type 2", "Customizable access & permissions", "Full ownership of your outputs" and "Single Sign On (SSO)".
6. `/enterprise-contact` is the enterprise enquiry page (Enquiry forms).
7. `/model-licensing` has the label "Model licensing", the level-one heading "Create your own frontier.", the line "License state of the art Kinora model weights. Fine-tune on your own data, self-host on your infrastructure and commercialize what you create.", a "Talk to our team" button to `/enterprise-contact`, four cards "Start at the frontier.", "Tune it to you.", "Run within your walls." and "White glove service.", and the licensing enquiry form (Enquiry forms).
8. `/examples` is the prompt library (Prompt library).
9. `/use-cases` has the level-one heading "AI video for whatever you make" and, under "Find your use case", cards for Social Media Content Creation, Product shots, Packaging & Retail Visualization, Automotive Product Photography and UGC ads, each with a line of its own.
10. `/workflows` has the heading "Introducing Kinora Workflows", "Why Workflows?" with three reasons ("Combine multiple models, modalities and tasks", "Create reusable templates", "Automate repetitive tasks"), "Featured Workflows" naming Image Style Generator, Image Variations, Storyboard Creator, Virtual Try On, Custom Instructions Workshop, Image to Text, Hair Salon, Animatic Generator and Style Blend, and a FAQ answering "Do workflows take credits?" with "Yes. Media model nodes and LLM nodes use credits when they run." It describes a future feature; the studio has no workflow editor.
11. `/research` has the two-line heading "Building general-purpose multimodal" / "simulators of the world." and three dated paper cards with a title, an author line and an abstract; `/resources` has the heading "Featured" over three article cards and "All Resources" over dated article rows, each with an author and a date. These cards are not links.
12. `/privacy` is the privacy page. It states what an account stores (name, email, a hashed password, the workspace, its projects, generations and credit history), what an enquiry stores (the form's fields), that an invitation stores the invited email address, that only Kinora staff and the workspace's own members read them, and that the app sets at most one cookie, to keep a person signed in, and no tracking cookie.

### Sign up and sign in (DP-24, DP-25)

1. `/signup` shows the heading "Create your account", the fields "Name", "Email" and "Password", and the button "Sign up". A name is 1 to 80 characters after trimming, the email must be a valid address, and a password is at least 10 characters. An email that already has an account, in any letter case, is refused with "An account with this email already exists." Signing up creates the account, a new workspace named "<Name>'s workspace" on the Free plan with its 125 one-time credits recorded as plan credits, and one project named "My first project", and signs the person in.
2. `/login` shows "Welcome to Kinora", "Don't have an account? Sign up for free" (linking to `/signup`; the sign-up link gains an underline when pointed at), the fields "Email" and "Password" and the button "Log in". A wrong password or an unknown email is refused with the same message, "Email or password is incorrect.", which never says which of the two was wrong. Emails are compared case-insensitively.
3. Signing up, signing in or joining a team lands on `/studio`. Opening any `/studio` page without a session goes to `/login`; a signed-in person opening `/login` or `/signup` goes to `/studio`. "Log out" in the studio sidebar ends the session and returns to `/login`.

### Studio (DP-30, DP-31, DP-37, DP-39, DP-40)

**Credits page.** `/studio/credits` shows the heading "Credits", the balance large in the monospace ("13,664 credits"), the plan name with its credits ("Standard, 625 credits a month", "Free, 125 credits once", "Team, 6,900 credits per seat"), and the credit history newest first: each row shows its date and time in UTC, its kind in words (Plan credits, Seat added, Generation or Refund), the name of the person who caused it, the signed change ("+6,900", "-120", "+120") and the balance after it.

**Projects.** `/studio/projects` shows the workspace's projects as cards, newest first, each with its name, its number of generations and the date of its latest generation (or "No generations yet"), and a "New project" button that opens a dialog labelled "New project" with the field "Project name" and the buttons "Create" and "Cancel". `/studio/projects/<id>` shows the project's name, which can be renamed in place under the same rules, and its generations as a timeline: newest first, grouped under day headings ("Today", "Yesterday", then dates written like "22 October 2026"), each a generation card. A project of another workspace, or one that does not exist, is not found: its page shows "That project does not exist."

**The composer.** `/studio` is the studio home. It shows the heading "What will you create today?" and the composer: a prompt box labelled "Prompt" with the placeholder "Type your thoughts...", a radio group "Model" with Vela 4.5, Vela 4 Turbo and Vela Image 4 (Vela 4.5 chosen first), a radio group "Length" with "5 seconds" and "10 seconds" (shown for the two video models, "5 seconds" chosen first), a number field "Images" from 1 to 4 (shown instead of Length for Vela Image 4, starting at 1; it sets the cost and the card's image count, and the generation still has one picture, as Output describes), a radio group "Aspect" with 16:9, 9:16 and 1:1 (16:9 chosen first), a select list "Project" listing the workspace's projects (the newest chosen first), a live cost line "This will use <n> credits" that follows every choice, and the button "Generate".

Under the composer a tab list "Marketing campaigns", "Movies", "Social media", "Educational content", "Experimental art" and "Other" shows template cards; choosing a card puts its starter prompt in the prompt box. The Marketing campaigns cards are given in Content; each other tab shows at least two cards of your own writing. Under the templates sits "Recent generations", the workspace's five newest generation cards.

Pressing "Generate" with an empty prompt shows "Write a prompt first." next to the box and starts nothing. While the generation is being started, "Generate" dims, becomes unavailable and a spinner turns. On success the page shows the generation card at the top of "Recent generations" with status "Queued", and the balance in the sidebar is lower by its cost at once. "Generate" becomes unavailable the moment it is pressed and the composer sends one fresh idempotency key per start, so a double click starts one generation. A short balance shows "Not enough credits. This needs <n> and you have <m>."; a reached parallel limit shows "Your plan runs <n> generations at a time. Wait for one to finish."

**Generation cards.** A generation card shows the preview (a placeholder that breathes gently while the generation is not yet Ready), the prompt, the model, the length ("10 s") or image count ("2 images"), the aspect, the status in words (Queued, Rendering, Ready or Cancelled), the cost ("120 credits") and the name of the person who started it. While Queued or Rendering a bar under the preview fills and a "Cancel" button is shown; an open page updates the card's status without a reload. "Cancel" shows the toast "Cancelled. <n> credits returned." A Ready generation's card shows its one drawn picture with the prompt as its alternative text, whatever its image count. `/studio/generations/<id>` shows one generation large with all its details and its charge (and refund, if any). A generation of another workspace, or one that does not exist, shows "That generation does not exist."

**Team page.** `/studio/team` exists for every workspace. For a Team workspace it shows the heading "Team", the line "<n> of 9 seats used" (seats used counts the members plus the pending invitations), the members (name, email, role Owner or Member, and the date they joined) and the pending invitations (email, the date sent and, for the owner, "Revoke"). For a workspace on any other plan it shows "Teams share one credit balance. Team workspaces are set up by our sales team." with a link to `/team-plan`. The owner of a Team workspace sees an "Invite teammate" button that opens a dialog with the field "Email" and the button "Send invite", and a "Remove" button beside each member, with a confirmation dialog "Remove member" whose confirm button is "Remove".

**Invitation page.** `/invite/<token>` (open without signing in) shows "Join <workspace name> on Kinora", the invited email (fixed, not editable), the fields "Name" and "Password" under the same rules as sign up, and the button "Join team". Joining shows a full-page confirmation "You're in. Welcome to <workspace name>." with "Open the studio". An accepted, revoked or unknown invitation shows "This invitation is no longer valid."

### Enquiry forms (DP-45)

1. `/enterprise-contact` shows, on the left, a rounded media panel with "Contact our enterprise team." and "Tell us what you're working on - we'll be in touch within two business days."; on the right, the heading "Tell us more about your use case." and the form: "First Name" (required, 1 to 80 characters), "Last Name" (required, 1 to 80), "Business Email" (required, a valid address), "Company" (required, 1 to 120), "Company Size" (required, a select list with the prompt "Select an option" and exactly `1-200`, `201-1,000`, `1,001-5,000`, `5,001-10,000` and `10,001+`), "Industry" (required, a select list with the prompt "Select an option" and exactly Architecture & Real Estate, Automotive, Creative Agency, Financial Services, Gaming, Healthcare, Media & Entertainment, Professional Services, Consumer Goods & Retail, Software & Telecom, Travel & Hospitality and Other), the checkbox group "What Kinora products are you interested in?" (Creative Platform, API, Model Weights Licensing with the tip "License Kinora's underlying AI model weights for your bespoke requirements. Custom pricing.", and Kinora Ads; at least one), "Message" (required, 10 to 2,000 characters) and the button "Submit". Required labels end with an asterisk. `/enterprise` repeats the same form.
2. The `/model-licensing` form has "Full Name" (required, 1 to 120), "Business Email", "Company", "Company Size", "Industry" and "Message" under the same rules, and "Submit".
3. A field that fails its rule shows its message under it, the message is announced to assistive technology, every typed value is kept, and nothing is stored or sent.
4. A valid enquiry is replaced by a full-page confirmation with the heading "Thanks, we will be in touch within two business days." and a link "Back to home".

### Prompt library (DP-23)

`/examples` shows the heading "Explore all examples", a tab list "All", "Product ads", "Animated stories", "UGC" and "From a link" (All chosen first), a search field labelled "Search examples", the count "<n> examples" and one card per example: its heading, its full prompt text, "Try in Studio" and "Copy prompt". A tab shows only its category's examples; the search keeps the examples whose heading or prompt contains the trimmed text, ignoring letter case, within the chosen tab; the count follows both. When nothing matches, the page shows "No examples match <text>." "Copy prompt" puts the prompt on the clipboard and shows the toast "Prompt copied". "Try in Studio" opens `/studio` with the prompt in the prompt box; signed out, it goes to `/login` first and then on to `/studio` with the prompt. The eight examples are given in Content.

### Interactions (DP-06, DP-12, DP-19, DP-20, DP-21, DP-23, DP-31, DP-34)

1. **Pointer and touch.** Every link, button, tab, switch and card control acts on a click or a tap; nothing depends on hovering, dragging or a long press. Pointed at, buttons change shade and template and project cards lift; touch screens get the same result from a tap.
2. **Header menus.** Pressing a header menu button opens its panel of links; pressing it again, pressing Escape, clicking outside or opening another menu closes it, and Escape returns focus to the menu button.
3. **Tabs, the switch and disclosure rows.** Choosing a tab, by click, tap or the arrow keys, shows its own panel; flipping the "Yearly billing" switch, by click, tap, Space or Enter, swaps the prices; pressing a question on `/team-plan` opens or closes its answer.
4. **Dialogs and drawers.** Opening a dialog or a phone drawer moves focus inside it; Tab and Shift+Tab stay inside while it is open; Escape, "Cancel" or the close cross closes it and focus returns to the control that opened it.
5. **Keyboard order.** Tab moves through the controls in reading order: on public pages the band, the header, the page and then the footer; in the studio the sidebar and then the work area. Enter activates links and buttons, and Enter in a single-line form field submits its form.
6. **Generate.** Pressing "Generate" makes it unavailable at once until the start answers, so a second press or a double click starts nothing more.
7. **Copying and trying a prompt.** "Copy prompt" copies at once and shows its toast; "Try in Studio" carries the prompt as described in Prompt library.

### Visual design (DP-05, DP-06, DP-14, DP-15, DP-16, DP-17)

The north star is that the public site reads like a confident, quiet film studio's lobby and the studio feels like a tidy desk where the one thing you need, the prompt box, is always in the middle and the money is always in view. The public site is editorial, white and spacious, with large calm headlines and rounded media frames; the studio is a light workspace with a slim sidebar, dense enough to scan projects and credit history quickly. Calm and confidence over spectacle on the site; clarity about credits over decoration in the studio.

The palette is near-monochrome with one saturated accent. The page ground is white; panels and secondary buttons sit on a near-white neutral grey, and the studio ground is a near-white cool grey with a slightly deeper cool grey for the current sidebar row. Primary ink is a near-black neutral; body text is a deep neutral grey; muted text and captions are mid cool greys; hairlines and borders are a near-white cool grey. The single accent is a mid, vivid blue-violet, used for the studio's primary action, "Sign up", links inside forms and the focus ring. A light, soft indigo and a light, soft orange appear only as soft highlights on plan badges and template art. Errors are a mid, vivid red and there is no separate warning colour: every refusal uses that red; success notes are a mid green. Pointed at, the near-black buttons turn fully black, the near-white buttons turn pure white and the blue-violet button turns a shade deeper. The announcement band runs from deep blue to violet. The footer is near-black with white and mid grey text. The exact shades are yours, so long as text holds at least WCAG 2.2 AA contrast against every surface it sits on.

Typography is one neutral grotesk sans for everything, Inter, self-hosted, set large and tight for headlines and never in capitals, with a monospace, JetBrains Mono, for credit balances, costs, prices per second and credit history amounts so their digits line up. Body text is comfortable and the studio's labels are small and clear.

Light is the only mode. Buttons are softly rounded rectangles in three skins, near-black with white words, near-white with near-black words, and blue-violet with white words for the studio's primary action; pills (the hero buttons, "Contact sales", "New generation", "Log in") are fully round at the ends; cards are rounded and float on a faint shadow; the composer and promo panels are generously rounded; fields are softly rounded. Every component has resting, pointed-at, pressed, focused and unavailable states, and unavailable is never shown by colour alone. Credit amounts are written with commas for thousands and a sign in the history ("+6,900", "-120"); prices are written in whole US dollars like `$28`.

**Iconography.** Every icon is drawn inline by the app in the current text colour, with thin even strokes: a chevron-down (one thin bent line) on header menus and selects; a chevron pointing right on pill links; three thin horizontal lines for "Menu"; a magnifying glass (a circle with a short diagonal handle) in the examples search; two overlapping rounded sheets for "Copy prompt"; a circle with a small "i" for information tips; a small house for Home; a plus for "New generation" and "New project"; a cross for closing; a refresh mark of two curved arrows beside each template card's "Try" affordance. The partner strip shows invented wordmarks set in the sans, never logos of real companies.

**Consistent components.** A generation card looks and behaves the same on the studio home, the project timeline and the generation page; the plan card, the enquiry form fields, the dialogs, the toasts, the sidebar and the credit history row likewise look and behave the same on every page that shows them.

**Generated pictures** are drawn by the app (a zero-asset build): soft abstract bands, glows and simple shapes whose palette and composition are derived from the prompt, at the generation's aspect. The public site's hero frames, product cards, enquiry panel and template cards use the same drawn language, rendered from fixed phrases of their own. No photograph, video, logo or font file from any other site is used.

**Accessibility** is a floor, not a feature: every page meets WCAG 2.2 AA, including contrast, touch targets of at least 24 by 24 CSS pixels, full keyboard navigation with a visible focus ring on every control (two pixels, blue-violet, offset from the control), labels on every icon-only control, alternative text on every generated picture (its prompt), status words beside every status colour, and errors tied to their fields. Dialogs, header menus and the mobile drawers trap focus while open, close on Escape and return focus to the control that opened them; a generation's change of status is announced politely.

**Accessible names.** These controls carry exactly these accessible names: the wordmark link "Kinora"; the header menu buttons "Creative", "Research", "Resources" and "Enterprise"; the mobile menu button "Menu"; the billing switch "Yearly billing"; the plan family tabs "Individual", "Team & Enterprise" and "API"; the prompt box "Prompt"; the radio groups "Model", "Length" and "Aspect"; the number field "Images"; the select list "Project"; the button "Generate"; each card's "Cancel"; the sidebar link "New generation"; the dialogs "New project", "Invite teammate" and "Remove member"; the field "Project name"; the examples search "Search examples"; "Copy prompt" and "Try in Studio" on each example. Every form field is labelled with the words shown in this brief. These controls also carry fixed roles: tab lists are tabs; the billing switch is a switch that reports whether it is on; the model, length and aspect choices are radio buttons named by their labels; "Company Size", "Industry" and "Project" are select lists; the product interests are checkboxes; dialogs and the mobile menu drawers are dialogs; toasts are status messages announced politely; a refused action's message is an alert; generation status changes are announced politely.

### Motion and effects (DP-08, DP-11, DP-12, DP-13)

Motion character is quick and quiet: controls answer in the blink of an eye, and only a few things travel. These moments exist and are named: the home hero picture settles from very slightly enlarged to its size; header menus and the information tips fade in; dialogs open with a soft zoom from just smaller than their size while the page behind dims; toasts slide up a little and leave on their own; template cards and project cards lift slightly when pointed at; a generation's bar fills while it renders, its placeholder breathes and a light sweep passes over it, and its finished picture fades in; a spinner turns on any button that is saving; the partner strip glides sideways without end, fading out at both edges; pricing cards swap their prices with a short cross-fade when the billing switch flips.

Colour changes on links and buttons are brisk on a gentle in-out curve; menus and tips fade quickly; cards lift on a soft, settling curve at an unhurried pace; the hero settle is long and slow. A dialog opens at a slightly smaller scale and grows to full scale while its opacity rises from clear to solid, a soft modal zoom. The mobile drawers slide in from the left edge over an overlay that fades in behind them. Toasts and popovers rise a few pixels and come to rest as they fade in. The loading spinner makes one full turn after another at an even, linear speed, for as long as it is shown. The placeholder shimmer is a soft light sweeping across it from side to side. The partner marquee glides sideways at a steady linear pace, an infinite loop that takes about half a minute to pass once. A successful "Generate" gives the new card a small springy overshoot as it lands, the one springy confirm in the app.

The app must honour the `prefers-reduced-motion: reduce` media setting everywhere motion is used, in every block of the site. When the visitor has asked for reduced motion, every animation and transition is replaced by its final state and nothing moves on its own, including the partner strip and the placeholder.

### Content (DP-02, DP-21, DP-23, DP-31)

**Plans.** These exact words and numbers appear on the plan cards:

| Plan | Yearly price | Monthly price | Yearly note | Credits line | Description | Button |
|---|---|---|---|---|---|---|
| Free | `$0` /month | `$0` /month | Free forever. | 125 credits (one time) | For people looking to explore Kinora's AI Tools | Start Free |
| Standard | `$12` /month | `$15` /month | Billed annually. Save $36/year. | 625 credits /mo | For curious creators trying AI video | Get Standard |
| Pro | `$28` /month | `$35` /month | Billed annually. Save $84/year. | 2,250 credits /mo | For creators leveling up their craft | Get Pro |
| Max | `$76` /month | `$95` /month | Billed annually. Save $228/year. | 9,500 credits /mo | Best value for heavy solo usage | Get Max |
| Team | `$55` per seat per month | `$69` per seat per month | billed yearly, 20% off | 6,900 credits per seat per month, pooled across the workspace | Best for fast-moving teams with high production needs | Get Team |
| Enterprise | Custom | Custom | | Pricing and credits sized to your organization | Built for organizations: security, privacy, admin controls and SSO | Talk to Sales |

The information tips read: Free "125 one-time credits to explore Kinora's AI tools."; Standard "625 credits monthly = 52s of Vela 4.5, 104s of Vela 4 Turbo, or 78 Vela Image 4 images."; Pro "2,250 credits monthly = 187s of Vela 4.5, 375s of Vela 4 Turbo, or 281 Vela Image 4 images."; Max "9,500 credits monthly = 791s of Vela 4.5, 1,583s of Vela 4 Turbo, or 1,187 Vela Image 4 images." Feature lists: Free "A selection of generative creative models to test concepts", "Up to 1 project", "2 generations at a time"; Standard "Access to all Vela models", "5 generations at a time", "Up to 3 projects", "No watermarks"; Pro "Everything in Standard", "15 generations at a time", "Up to 5 projects"; Max "Early access to new models", "20 generations at a time", "Up to 10 projects"; Team "Everything in Max", "Up to 100 shared projects", "One shared credit pool", "24 parallel generations", "Two to nine seats"; Enterprise "Everything in Team", "Unlimited members and workspaces", "Custom SSO, SOC 2 and ISO/IEC 27001, no training on your data".

**Starter templates.** The Marketing campaigns tab shows five cards, in order, with these starter prompts: "Make video ad for socials" ("A fifteen second vertical ad for a reusable water bottle: a cyclist pauses at golden hour, drinks, and rides on"); "Reshoot your product" ("A glass perfume bottle on wet black stone, slow orbit, soft rim light"); "Build creative from a brief" ("A cosy autumn launch film for a knitwear label: a cabin porch, falling leaves, warm window light"); "Generate A/B variants" ("A sneaker on a concrete plinth, first in hard noon light, then in soft overcast light"); "Create seasonal campaign" ("A winter window display for a bookshop, snow drifting past warm lamplight").

**Examples.** The prompt library holds these eight examples, in this order:

| Heading | Category | Prompt |
|---|---|---|
| Product shot to finished commercial | Product ads | Make one complete stovetop coffee commercial for this kettle: onto the blue flame, water in, the steam curling up, then the pour and the cup in morning light. One kitchen, every shot in the same light. |
| Five-shot brand film from one cup | Product ads | A five-shot sequence: a coffee cup on a sunlit café table, small clouds rising from the steam and carrying the camera over misty hills of coffee plants, then back to the table. |
| Product sheet to brand spot | Product ads | Make a thirty-second cereal ad from these three boxes: a child's imagination turns the cereal rings into giant hoops rolling across a beach at sunset, then back to the breakfast table. |
| Animated story with consistent characters | Animated stories | Turn this tomato soldier into a twenty-second animated parody: he storms the beach with his vegetable squad to get the ketchup to the fries. Keep the characters consistent in every shot, no text on screen. |
| Animated comedy scene | Animated stories | An undercover escape scene in a soft animated style: the chicken looks both ways, runs over to a sleeping dog, looks around, then taps him with its beak. |
| UGC-style product video | UGC | Make a fifteen-second vertical ad for this chair: a guy films himself in his apartment, flops into it, hard cuts, handheld, real reactions. |
| UGC demo video | UGC | Make a fifteen-second clip for this hose-end lawn sprayer: a person filming himself in his own front yard at golden hour, hooking it up, spraying the lawn and talking to camera. |
| Product page to cinematic spot | From a link | Make a fifteen-second cinematic commercial from this product page for a running shoe: macro details, a slow orbit, dramatic red and black lighting, ending on the full silhouette. |

### Feedback states (DP-24, DP-30, DP-31, DP-33, DP-37, DP-41, DP-45)

The projects page of a workspace with no projects shows "No projects yet" with a "New project" button; a project with no generations shows "No generations yet. Start one from the composer." with a link to `/studio`; the credit history of a new account shows its single plan credits row. A refused action never crashes the page: nothing changes and a field message or toast says why. A form never loses typed values on a failure. The exact refusal messages are: "An account with this email already exists.", "Email or password is incorrect.", "A project with this name already exists.", "Your plan allows up to <n> projects." (on Free "Your plan allows up to 1 project."), "Write a prompt first.", "Not enough credits. This needs <n> and you have <m>.", "Your plan runs <n> generations at a time. Wait for one to finish.", "That person already has an account or an invitation.", "Your team already uses all 9 seats." and "This invitation is no longer valid."

## Backend

### API (DP-01, DP-22, DP-23, DP-28, DP-29, DP-32, DP-33, DP-35, DP-38)

The JSON API, in full:

| Endpoint | Request body / query | Returns |
|---|---|---|
| `GET /api/health` | none | `200` |
| `GET /api/plans` | none | array of the six plans `{id, name, monthly_price, yearly_price, credits, parallel_limit, project_limit}` in the order Free, Standard, Pro, Max, Team, Enterprise |
| `GET /api/models` | none | array of the three models `{id, name, kind, credits_per_unit}` |
| `GET /api/examples` | optional `category`, `search` | `{items, total}` |
| `POST /api/enquiries` | `{source, first_name, last_name, full_name, email, company, company_size, industry, products, message}` | the stored enquiry with `201` |
| `POST /api/auth/signup` | `{name, email, password}` | `{token, user}` with `201` |
| `POST /api/auth/login` | `{email, password}` | `{token, user}` |
| `POST /api/auth/logout` | none | success with no body required |
| `GET /api/me` | none | `{user, workspace, balance}` |
| `GET /api/projects` | none | array of the workspace's projects, newest first |
| `POST /api/projects` | `{name}` | the created project with `201` |
| `PATCH /api/projects/{id}` | `{name}` | the updated project |
| `GET /api/projects/{id}/generations` | none | array of the project's generations, newest first |
| `POST /api/generations` | `{project_id, model, prompt, duration, image_count, aspect}`, optional header `Idempotency-Key` | the generation with `201`, or the earlier one with `200` |
| `GET /api/generations/{id}` | none | the generation |
| `POST /api/generations/{id}/cancel` | none | the updated generation |
| `GET /api/generations/{id}/output` | none | the generation's one picture as `image/svg+xml`, for every model and image count |
| `GET /api/credits` | none | `{balance, entries}`, entries newest first |
| `GET /api/team` | none | `{members, invitations, seats_used, seat_limit}` |
| `POST /api/team/invitations` | `{email}` | the invitation with `201` |
| `DELETE /api/team/invitations/{id}` | none | success with no body required |
| `DELETE /api/team/members/{id}` | none | success with no body required |
| `GET /api/invitations/{token}` | none | `{workspace_name, email}` |
| `POST /api/invitations/{token}` | `{name, password}` | `{token, user}` with `201` |

Every endpoint under `/api/me`, `/api/projects`, `/api/generations`, `/api/credits`, `/api/team` and logout requires `Authorization: Bearer <token>` (the studio pages may hold the same token in an HTTP-only cookie); every other endpoint is public. The model ids are `vela-4.5`, `vela-4-turbo` and `vela-image-4`, with `kind` `video`, `video` and `image` and `credits_per_unit` `12`, `6` and `8`; the plan ids are `free`, `standard`, `pro`, `max`, `team` and `enterprise`, where Enterprise has `null` prices, credits and limits and Team's `credits` is the per seat amount `6900`. A user is `{id, name, email, role}` with `role` `owner` or `member`; a workspace is `{id, name, plan}`. A project is `{id, name, generation_count, created_at}`. A generation is `{id, project_id, model, prompt, duration, image_count, aspect, cost, status, started_by, created_at, finished_at}`, where `duration` is `5` or `10` for video and `null` for images, `image_count` is `1` to `4` for images and `null` for video, `aspect` is `16:9`, `9:16` or `1:1`, `status` is `queued`, `rendering`, `ready` or `cancelled`, and `started_by` is the person's name. A credit entry is `{id, kind, amount, balance_after, user_name, generation_id, created_at}`, where `kind` is `plan`, `seat`, `charge` or `refund`, `amount` is signed (negative for a charge) and `generation_id` is `null` for plan and seat entries. A team member is `{id, name, email, role, joined_at}` and an invitation `{id, email, created_at}`; `seats_used` is the number of members plus pending invitations and `seat_limit` is `9`. An example is `{heading, category, prompt}` with `category` one of `product-ads`, `animated-stories`, `ugc` and `from-a-link`. An enquiry's `source` is `contact` (first and last name and at least one of the products `creative-platform`, `api`, `model-weights-licensing` and `kinora-ads`) or `licensing` (full name, products absent); absent optional values are `null`. `company_size` and `industry` take the display strings exactly as the form lists them (for example `201-1,000` and `Gaming`); any other value answers `422`.

Credits are whole numbers. Every credit amount, cost, balance and history amount in the API is an integer number of credits; every price in the API is an integer number of US cents per month (`1200` is `$12`); `yearly_price` is the price per month when billed yearly (`1200` for Standard), never the total for a year.

A short balance answers `402` with `{"error": "insufficient_credits", "needed", "balance"}`; a reached parallel limit answers `409` with `{"error": "parallel_limit", "limit"}`; a reached project limit answers `409` with `{"error": "project_limit", "limit"}`; a duplicate project name answers `409` with `{"error": "duplicate_name"}`; cancelling a generation that is Ready or Cancelled answers `409`; the owner removing themselves answers `409` with `{"error": "cannot_remove_self"}`; when a start is both short of credits and over the parallel limit, the short balance (`402`) is the answer; reading the output of a generation that is not Ready answers `409`; an existing email at sign up, an invited address that already has an account or invitation, and a full team answer `409`; invalid input answers `422` with `{"errors": {"<field>": "<message>"}}` naming every failing field; a wrong sign in answers `401` with `{"error": "Email or password is incorrect."}`; a missing, malformed, signed-out or removed member's token answers `401`; a member calling an owner-only endpoint, or any owner of a workspace not on the Team plan inviting, answers `403`; a project, generation or team member of another workspace, an unknown id, revoking an invitation that is not pending, and an accepted, revoked or unknown invitation token answer `404`. For inviting, revoking and removing, the role and plan check comes first: a member, or an owner of a workspace not on the Team plan, gets `403` before any id is looked up. Every `POST` not marked `201` in the table, including login and cancel, answers `200`. A successful call returns the named resource or shape; an invalid or unauthorized call is rejected as a client error (never a server error, never a silent success).

### Plans and credit prices (DP-22, DP-33)

Every workspace has exactly one plan: Free, Standard, Pro, Max or Team. The plan fixes its credits, how many generations may be Queued or Rendering at the same time (its parallel limit) and how many projects the workspace may hold:

| Plan | Credits | Parallel limit | Project limit |
|---|---|---|---|
| Free | 125, once, at sign up | 2 | 1 |
| Standard | 625 | 5 | 3 |
| Pro | 2,250 | 15 | 5 |
| Max | 9,500 | 20 | 10 |
| Team | 6,900 per seat | 24 | 100 |

There are exactly three models. Vela 4.5 makes video at 12 credits per second; Vela 4 Turbo makes video at 6 credits per second; Vela Image 4 makes still images at 8 credits per image. A video is 5 or 10 seconds long; an image generation is charged for 1 to 4 images, and that count prices it and labels its card but never changes its output, which is always one picture. So a 10 second Vela 4.5 video costs 120 credits, a 5 second Vela 4 Turbo video costs 30 credits and two Vela Image 4 images cost 16 credits.

A plan's credits arrive only as written above: Free once at sign up, and a Team workspace one seat of 6,900 credits each time a person joins. The seeded workspaces start with the history given in Seed data. Nothing in the app changes a plan, renews credits, rolls them over or sells more.

### Business rules (DP-18, DP-24, DP-30, DP-32, DP-33, DP-34, DP-35, DP-36, DP-38, DP-39, DP-41, DP-42, DP-43, DP-44, DP-46)

The critical rules, in short: starting a generation computes its cost on the server, checks it against the balance and the plan's parallel limit, writes the generation and its charge, and lowers the balance, all at once or not at all; a repeated request carrying the same idempotency key is charged once; two generations that together exceed the balance leave exactly one generation; cancelling returns the full cost exactly once; joining a team adds exactly one seat of credits; a refused action changes nothing and charges nothing.

- **Projects.** A project name is 1 to 80 characters after trimming and unique within its workspace, compared ignoring letter case; a duplicate is refused with "A project with this name already exists." A workspace that already holds as many projects as its plan allows is refused with "Your plan allows up to <n> projects." A refused create changes nothing. A project of another workspace, or one that does not exist, answers `404` on its API read.
- **Starting a generation.** A prompt is 1 to 1,000 characters after trimming. Starting a generation is one all-or-nothing change: the server computes the cost from the model and the length or image count (never trusting a cost sent by the browser), checks that the balance covers it and that the workspace has fewer generations Queued or Rendering than its parallel limit, writes the generation with status `queued`, records a charge of the full cost in the credit history and lowers the balance by the same amount. If the balance is short, or the parallel limit is reached, nothing changes.
- **Idempotency.** A start request may carry an `Idempotency-Key` header. A second start with the same key from the same workspace, sent later or at the same moment, returns the generation the first one created and charges nothing more; the workspace ends with one generation and one charge for that key.
- **Concurrency.** Two starts that together cost more than the balance, sent at the same moment, leave exactly one generation and one charge, and the balance never goes below zero.
- **Rendering.** A generation moves from Queued to Rendering to Ready on its own, whether or not any page is open. It becomes Rendering within 2 seconds of being started and stays Rendering until it is Ready. It never becomes Ready sooner than 8 seconds after it was started, and it is Ready no later than 30 seconds after it was started.
- **Cancelling.** "Cancel" on a Queued or Rendering generation sets its status to `cancelled`, records a refund of its full cost in the credit history and raises the balance by the same amount. A generation is refunded at most once. Cancelling a Ready or already Cancelled generation is refused and changes nothing. A cancelled generation never becomes Ready.
- **Output.** When a generation is Ready, its output is exactly one picture drawn by the app from the prompt: for an image generation, one still SVG whatever its image count of 1 to 4 (no montage, no separate pictures and no per-image address); for a video, one animated picture that loops over the stated length. It is drawn at the chosen aspect from soft bands and shapes whose colours and arrangement are taken from the prompt text, so the same prompt and settings always produce the same picture, and it carries the prompt as its alternative text. The output is served by the app as an SVG image and is available only to members of the generation's workspace; before Ready it is not available. A generation of another workspace, or one that does not exist, answers `404` on its API reads.
- **Inviting.** Inviting creates a pending invitation and sends one invitation email to that address. An address that already has an account, or already has a pending invitation to this workspace, is refused with "That person already has an account or an invitation."; when members plus pending invitations already number nine, inviting is refused with "Your team already uses all 9 seats." A member, or the owner of a workspace that is not on the Team plan, is denied.
- **Joining.** Joining, in one all-or-nothing change, creates the account as a Member of that workspace, marks the invitation accepted, records "Seat added" of +6,900 credits in the workspace's credit history and raises the shared balance by 6,900. An invitation can be accepted once; an accepted, revoked or unknown invitation answers `404` on its API read.
- **Revoking and removing.** The owner can revoke a pending invitation, after which its link no longer works, and remove a member. A removed member's session ends at once and they can no longer sign in; their generations and the credits they used stay in the workspace's history; nothing is refunded and no seat credits are taken back. The owner cannot remove themselves: the attempt is refused and changes nothing. Revoking an invitation that is no longer pending is not found.
- **Enquiries.** The licensing enquiry is stored with the source `licensing`, which stands for an interest in Model Weights Licensing (no product list is sent). A field that fails its rule stores and sends nothing.
- **Passwords** are stored hashed, never in plain text.

### Services: email over Mailpit (DP-41, DP-43, DP-46, DP-47)

The app sends real email over SMTP to Mailpit at `SMTP_HOST`:`SMTP_PORT`, from `studio@example.com`. Every message is addressed to exactly one recipient, with no cc and no bcc.

1. An invitation sends exactly one email to the invited address, whose subject is exactly `<owner name> invited you to <workspace name> on Kinora` (for example `Mara Quinn invited you to Northlight Studio on Kinora`) and whose body contains the full join link `<APP_PUBLIC_URL>/invite/<token>`.
2. A valid enquiry is stored and then sends exactly two emails: one to `sales@example.com` whose subject is exactly `New enterprise enquiry from <Company>` and whose body names the person, their business email, company, company size, industry, the products of interest and the message; and one to the business email given, whose subject is exactly `We received your enquiry` and whose body says the team will be in touch within two business days.
3. Signing up, starting, finishing or cancelling a generation, creating a project, revoking an invitation, removing a member and any refused action send no email.
4. A stored change stands even if its email cannot be delivered: the invitation or enquiry is still stored and the response is still a success.

### Data model (DP-18, DP-26, DP-39)

Seven tables. All timestamps are UTC.

- `workspaces`: `id`, `name`, `plan` (one of `free`, `standard`, `pro`, `max`, `team`), `created_at`.
- `users`: `id`, `workspace_id`, `name`, `email` (unique, compared case-insensitively), a hashed password, `role` (`owner` or `member`), `created_at`, `removed_at`.
- `projects`: `id`, `workspace_id`, `name` (unique within the workspace, compared case-insensitively), `created_at`.
- `generations`: `id`, `workspace_id`, `project_id`, `user_id`, `model`, `prompt`, `duration`, `image_count`, `aspect`, `cost`, `status` (`queued`, `rendering`, `ready` or `cancelled`), `idempotency_key` (unique within the workspace when present), `created_at`, `finished_at`. `finished_at` is set exactly when the status is `ready` or `cancelled`.
- `credit_entries`: `id`, `workspace_id`, `kind` (`plan`, `seat`, `charge` or `refund`), `amount` (signed whole credits), `balance_after`, `user_id`, `generation_id`, `created_at`. Entries are only ever added, never changed or deleted. Each generation has exactly one `charge` entry of minus its cost and at most one `refund` entry of plus its cost, and only a cancelled generation has a refund.
- `invitations`: `id`, `workspace_id`, `email`, `token` (unique, unguessable), `status` (`pending`, `accepted` or `revoked`), `created_at`, `accepted_at`.
- `enquiries`: `id`, `source` (`contact` or `licensing`), `first_name`, `last_name`, `full_name`, `email`, `company`, `company_size`, `industry`, `products`, `message`, `created_at`.

A workspace's balance always equals the sum of its credit entries, each entry's `balance_after` equals the sum of the entries up to and including it, and the balance is never below zero. Two starts that together exceed the balance, two starts carrying the same idempotency key, and two cancels of the same generation, arriving at the same moment, must each leave exactly one charge or one refund. This must hold under real concurrency, not merely in application-level checks.

The plans, models, templates, examples and public page copy are fixed content shipped with the app; they may live in tables or in the app's own content files.

### Seed data (DP-27)

On first start the app seeds the three accounts, the two workspaces with their projects, generations (as Ready, with their pictures available) and credit histories below. Seeding must be idempotent: restarting the app must not duplicate rows. All seed times are before the app first starts, in UTC; the seed rows send no email.

**Every seeded account uses the password `deku-demo-pw-2026`.** It is benchmark fixture data, not a secret. Hash it as normal; the exact literal must work at login, and it must be written into `/app/USER_README.md` alongside each account so a grader can sign in.

- Northlight Studio, Team plan, owner Mara Quinn and member Theo Park (2 of 9 seats). Projects: "Spring campaign" and "Brand film". Generations, both Ready, in "Spring campaign": Mara Quinn, Vela 4.5, 10 s, 16:9, "A paper boat drifting down a rain-soaked street at dusk, cinematic", 120 credits; Theo Park, Vela Image 4, 2 images, 1:1, "A ceramic mug on a linen table in soft morning light", 16 credits. Credit history, oldest first: Seat added +6,900 (Mara Quinn); Seat added +6,900 (Theo Park); Generation -120 (Mara Quinn); Generation -16 (Theo Park). Balance 13,664.
- Ines Duarte's workspace, Standard plan, owner Ines Duarte. Project: "Music video". Generation, Ready: Ines Duarte, Vela 4 Turbo, 5 s, 9:16, "Neon reflections on a wet dance floor, slow camera push", 30 credits. Credit history: Plan credits +625; Generation -30. Balance 595.

## Technical requirements

### Stack and libraries (DP-02, DP-18)

The stack is a single-page app with a JSON API: a NestJS server on Node.js serves the JSON API under `/api` and the production build of a Preact app built with Vite, on the same origin. The public pages listed under Screens and layout return their headings and copy in the first HTML response for that address (the build may write them out ahead of time or the server may fill them in), and then become interactive. Data lives in PostgreSQL at `DATABASE_URL`; email goes to Mailpit over SMTP at `SMTP_HOST` and `SMTP_PORT`, with no authentication. Authentication is app-implemented email and password with bearer tokens. The app logs to standard output, one line per HTTP request naming its method and path. Generations keep moving from Queued to Ready while no browser is open, inside the same server.

The libraries are NestJS (`@nestjs/core`, `@nestjs/common`, `@nestjs/platform-express`), the `pg` PostgreSQL client, `nodemailer` for SMTP, `bcryptjs` for password hashing, `preact` with `preact-iso` for routing in the browser, and the self-hosted font packages `@fontsource/inter` and `@fontsource/jetbrains-mono`; `cookie-parser`, `@nestjs/serve-static` and `preact-render-to-string` may also be used. Vite builds the browser app. Use only the libraries named here plus their direct dependencies at run time (the packages listed under `dependencies` in `package.json`); build and check tooling under `devDependencies` is free. Do not introduce a second database, cache, queue, object store, identity provider, payment provider or mail vendor; the only backing services available in this environment are PostgreSQL and Mailpit, and reaching for anything else is a contract violation.

Media substitution: no product photography, video, logo or font file is supplied, so every picture is drawn by the app itself (a zero-asset build) and the fonts come from self-hosted open-licence font packages.

### Deployment (DP-01)

- The app must be reachable at `APP_PUBLIC_URL`. The server listens on `0.0.0.0` at the port given in `APP_PUBLIC_PORT` (`4173` by default). The grader may start more copies of the app at the same time, each with its own `APP_PUBLIC_PORT`, so read both variables from the environment at start and never hard-code the port.
- The HTTP API is served on that same origin under the `/api` prefix.
- `GET /api/health` returns `200` once the app is ready and can reach the database.
- The app starts from the environment image with no manual steps.
- Serve a production build behind a static or preview server, never a dev server.
- `/app/run.json` must hold `{"install": "<command>", "build": "<command>", "serve": "<command>"}`: commands that, run in a fresh copy of `/app` against empty backing services, install the dependencies, produce the production build and start the server in the foreground.
- The server must keep running after this session ends and must not be a child of the shell. An ordinary background job dies with its shell, and the app will not be running when it is next opened.
- Bind `0.0.0.0`, never `127.0.0.1` or `localhost`. A loopback only listener is unreachable from outside the container.
- The backing services named in this brief are already running and reachable at their environment variables. Do not download, install, compile or start a copy of any of them.
- Use only the providers named in this brief. No edge functions.
- No persistent volumes, no fixed container names, no custom networks.

### Configuration and secrets (DP-18, DP-47)

The PostgreSQL database is reached at `DATABASE_URL` (also provided as `DB_URL`). The Mailpit SMTP server is reached at `SMTP_HOST` and `SMTP_PORT`; `SMTP_USER` and `SMTP_PASS` are provided empty because Mailpit takes no login. The public address is `APP_PUBLIC_URL` and the published port `APP_PUBLIC_PORT`. Every one of these is read from the environment at start, never hard-coded and never sent to the browser.

**No mocks.** These are violations however good the UI looks: a balance kept in memory or in the browser that a restart or a second tab forgets; a balance checked in one step and lowered in another so two starts can both spend the last credits; a cost taken from the request instead of computed from the model and length; a repeated idempotency key that charges again; a refund that can be given twice; an email "sent" by writing to a log, a file or a table instead of over SMTP to Mailpit; an owner-only endpoint that trusts a role or workspace sent in the request body instead of the token; a generation marked Ready by the browser rather than by the server. The named provider is the fact: the app's UI and its own tables can only reflect what lives in PostgreSQL and what reached Mailpit, never substitute for it.

### Server boundary (DP-09, DP-10, DP-28)

- The browser app and the JSON API share one origin; the API answers only under `/api` and the server calls no outside network service.
- The server serves the built app, its self-hosted fonts and the API, and never serves source files, `.env` files or any credential.
- Every studio endpoint checks the bearer token before reading the body, as stated under API.
- While PostgreSQL cannot be reached, `GET /api/health` does not answer 200.

The scope of the app is bounded as follows:

- One language (English), one currency for prices (US dollars) and credits as whole numbers; no plan changes, renewals, rollovers, top-ups, refunds of money or online payment of any kind.
- No social sign in, no single sign-on, no password reset, no email verification, no account deletion and no staff or admin area in the app.
- No uploads of reference images, sketches or any other file; no comments; no workflow editor, agent chat, apps, plugins or brand kits; no connection to outside chat assistants; no article, paper or story detail pages.
- Where this brief leaves a gap, for example an exact shade, a spacing value or the wording of a message it does not quote, the choice is yours; no further evidence about the original site is available.
- No cookie banner, no analytics, no tracker or measurement id of any kind ships, and no call to any outside network service at runtime; fonts, pictures and scripts are served by the app. The only cookie the app sets is the session cookie. No native app.

### Browser support and performance (DP-02, DP-07)

The app works in current desktop and mobile browsers, with a mouse, a keyboard or touch, at every width from a phone (375 by 812) through a tablet (768 by 1024) to a desktop (1280 by 800) and wider, with no sideways scrolling.

Performance: the public pages carry their words in the first HTML response, so they read before any picture is drawn; the studio shows the balance and the project list before any preview finishes drawing.

## Working rules

- IF-01: `/app/run.json` holds non-empty `install`, `build` and `serve` commands, and no `Dockerfile`, `start.sh` or compose file sits at the root of `/app`.
- IF-02: `/app/USER_README.md` lists the three seeded accounts with the password `deku-demo-pw-2026`.
- IF-03: The reserved `.browser_screenshots/` and `.downloads/` directories exist at the app root, empty.
- IF-04: `/app/package.json` names the stated libraries and builds with Vite, brings no second database, cache, queue, object store, identity, payment or mail provider, and its runtime `dependencies` are only the named libraries and their direct dependencies.
- IF-05: The app logs to standard output one line per HTTP request naming its method and path.

## Engineering standards

- The code is idiomatic TypeScript or JavaScript for NestJS and Preact, with one consistent style.
- Names in code match the domain terms in this brief: workspace, project, generation, credit entry, charge, refund, seat, invitation, enquiry, plan and model.
- Each domain rule is decided in exactly one place in the source: the cost of a generation, the plan limits, the balance check and charge, the refund, the seat grant, and the field checks of each form.
- Every API error uses one shape per kind: `{"error"}` for `401`, `402`, `403`, `404` and `409`, and `{"errors": {"<field>": "<message>"}}` for `422`.
- No abstraction has a single implementation and no function only forwards its arguments to another call.
- There is no dead, commented-out or unreachable code, and no defensive check for a state the database constraints already rule out.
- The app exposes no route, setting or screen beyond this brief.
