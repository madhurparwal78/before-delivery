(function () {

const moduleFactories = {};
const moduleCache = {};
function resolveModule(id) {
  if (moduleCache[id] !== undefined) return moduleCache[id];
  const factory = moduleFactories[id];
  if (factory === undefined) throw new Error("missing module " + id);
  const exports = {};
  moduleCache[id] = exports;
  factory((dep) => resolveModule(dep), exports);
  return exports;
}
const define = (id, factory) => { moduleFactories[id] = factory; };

"use strict";
define("copy", ["require", "exports"], function (require, exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.COPY = void 0;
    exports.COPY = {
        signedOut: "Your desk session has ended. Sign in again.",
        badCode: "That code does not open a desk.",
        checkingCode: "Checking code",
        sendingAnswers: "Sending answers",
        answersIn: (n) => `Answers in for round ${n}.`,
        answersOverLimit: "Answers can be up to 120 characters.",
        roundClosed: (n) => `Round ${n} is closed. Answers are no longer taken.`,
        tooManySubmits: (s) => `Too many submits. Please wait ${s} s and try again.`,
        waiting: "No round is open. The quizmaster will call the next one.",
        savingName: "Saving name",
        nameSaved: "Team name saved.",
        nameEmpty: "A team needs a name.",
        nameTooLong: "Team names can be up to 40 characters.",
        nameTaken: "Another team already has that name.",
        storingSheet: "Storing sheet",
        sheetStored: (n) => `Sheet stored for round ${n}.`,
        noFile: "Choose a sheet image to upload.",
        sheetType: "Sheets must be PNG or JPEG images.",
        sheetTooLarge: "Sheets can be up to 5,000,000 bytes.",
        sheetDimensions: "Sheets must be 200 to 4,000 pixels on each side.",
        sheetOutage: "Sheet not stored — storage is unreachable. This round cannot open yet.",
        opening: (n) => `Opening round ${n}`,
        roundOpen: (n) => `Round ${n} is open.`,
        sheetMissing: (n) => `Upload and store the picture sheet before opening round ${n}.`,
        anotherOpen: "Close the open round before opening another.",
        closing: (n) => `Closing round ${n}`,
        roundClosedByQuizmaster: (n) => `Round ${n} closed by the quizmaster.`,
        markCorrect: (team, q) => `${team}, question ${q}: correct.`,
        markWrong: (team, q) => `${team}, question ${q}: wrong.`,
        finishing: (n) => `Finishing round ${n}`,
        roundMarked: (n) => `Round ${n} is marked.`,
        unmarkedLeft: (n, count) => `Answers left to mark in round ${n}: ${count}.`,
        loadingAnswers: "Loading answers",
        noNewerAnswers: "No newer answers yet.",
        searching: "Searching",
        answersMatching: (count) => `Answers matching: ${count}.`,
        noMatches: (query) => `No answers match "${query}".`,
        emptySearch: "Type something to search for.",
        searchTooLong: "Searches can be up to 80 characters.",
        searchTimeout: "That search took too long. Try a shorter spelling.",
        sendingDispute: "Sending dispute",
        disputeSent: "Dispute sent to the quizmaster.",
        disputeReasonEmpty: "Say what was wrong with the mark.",
        disputeReasonTooLong: "Reasons can be up to 280 characters.",
        disputesClosed: (n) => `Disputes for round ${n} are closed.`,
        disputeRuled: (ruling, n, q) => `Dispute ruled: ${ruling} for round ${n}, question ${q}.`,
        savingRuling: "Saving ruling",
        rulingSaved: "Ruling saved. The captain's note is on its way.",
        alreadyRuled: "This dispute was already ruled.",
        publishing: (n) => `Publishing round ${n}`,
        publishedNews: (n, team, total) => `Round ${n} published. Leader: ${team} on ${total} points.`,
        disputesOpen: (n, count) => `Open disputes left on round ${n}: ${count}. Rule on them before publishing.`,
        unreachable: "The desk can't reach the server. Trying again.",
        notFoundHeading: "No such page in the quiz book.",
        backToTable: "Back to the league table",
    };
});
define("util", ["require", "exports"], function (require, exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.MESSAGE_LIFETIME_MS = exports.POLL_DELAY_MS = exports.STATUS_LABEL = exports.LIMITS = void 0;
    exports.normalise = normalise;
    exports.countText = countText;
    exports.timeSent = timeSent;
    exports.formatCountdown = formatCountdown;
    exports.prefersReducedMotion = prefersReducedMotion;
    function normalise(text) {
        return text.normalize("NFC").trim();
    }
    /** The one counting rule, shared with the server: NFC, trim, then code points. */
    function countText(text) {
        return [...normalise(text)].length;
    }
    exports.LIMITS = { name: 40, answer: 120, query: 80, reason: 280 };
    exports.STATUS_LABEL = {
        drafted: "Drafted",
        open: "Open",
        closed: "Closed",
        marked: "Marked",
        published: "Published",
    };
    /** The one archive time-sent format: the UTC HH:MM:SS of submitted_at. */
    function timeSent(iso) {
        return iso.slice(11, 19);
    }
    function formatCountdown(seconds) {
        const safe = Math.max(0, seconds);
        const minutes = Math.floor(safe / 60);
        const rest = safe % 60;
        return `${minutes}:${rest.toString().padStart(2, "0")} left`;
    }
    function prefersReducedMotion() {
        return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    }
    exports.POLL_DELAY_MS = 3000;
    exports.MESSAGE_LIFETIME_MS = 6000;
});
define("api", ["require", "exports"], function (require, exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.getRounds = getRounds;
    exports.getTable = getTable;
    exports.getRound = getRound;
    exports.postSession = postSession;
    exports.getSession = getSession;
    exports.deleteSession = deleteSession;
    exports.getRoundAnswers = getRoundAnswers;
    exports.submitRoundAnswers = submitRoundAnswers;
    exports.putMark = putMark;
    exports.postMarked = postMarked;
    exports.openRound = openRound;
    exports.closeRound = closeRound;
    exports.publishRound = publishRound;
    exports.uploadSheet = uploadSheet;
    exports.patchTeam = patchTeam;
    exports.postDispute = postDispute;
    exports.getDisputes = getDisputes;
    exports.postRuling = postRuling;
    exports.getArchive = getArchive;
    exports.searchAnswers = searchAnswers;
    exports.isApiError = isApiError;
    async function request(path, init, idempotencyKey) {
        const headers = new Headers(init.headers);
        if (init.body !== undefined && typeof init.body === "string") {
            headers.set("Content-Type", "application/json");
        }
        if (idempotencyKey !== undefined) {
            headers.set("Idempotency-Key", idempotencyKey);
        }
        const response = await fetch(path, { ...init, headers, credentials: "same-origin" });
        const replayed = response.headers.get("Idempotent-Replayed") === "true";
        if (response.status === 204) {
            return { status: 204, body: undefined, replayed };
        }
        let body;
        try {
            body = (await response.json());
        }
        catch {
            body = { status: response.status, code: "network_error" };
        }
        return { status: response.status, body, replayed };
    }
    function getRounds() {
        return request("/api/rounds", { method: "GET" });
    }
    function getTable() {
        return request("/api/table", { method: "GET" });
    }
    function getRound(n) {
        return request(`/api/rounds/${n}`, { method: "GET" });
    }
    function postSession(code) {
        return request("/api/session", { method: "POST", body: JSON.stringify({ code }) });
    }
    function getSession() {
        return request("/api/session", { method: "GET" });
    }
    function deleteSession() {
        return request("/api/session", { method: "DELETE" });
    }
    function getRoundAnswers(n) {
        return request(`/api/rounds/${n}/answers`, { method: "GET" });
    }
    function submitRoundAnswers(n, answers, key) {
        return request(`/api/rounds/${n}/answers`, { method: "POST", body: JSON.stringify({ answers }) }, key);
    }
    function putMark(n, answerId, points) {
        return request(`/api/rounds/${n}/marks`, {
            method: "PUT",
            body: JSON.stringify({ answer_id: answerId, points }),
        });
    }
    function postMarked(n) {
        return request(`/api/rounds/${n}/marked`, { method: "POST" });
    }
    function openRound(n) {
        return request(`/api/rounds/${n}/open`, { method: "POST" });
    }
    function closeRound(n) {
        return request(`/api/rounds/${n}/close`, { method: "POST" });
    }
    function publishRound(n) {
        return request(`/api/rounds/${n}/publish`, { method: "POST" });
    }
    function uploadSheet(n, file) {
        return request(`/api/rounds/${n}/sheet`, { method: "PUT", body: file });
    }
    function patchTeam(id, name) {
        return request(`/api/teams/${id}`, { method: "PATCH", body: JSON.stringify({ name }) });
    }
    function postDispute(answerId, reason) {
        return request("/api/disputes", { method: "POST", body: JSON.stringify({ answer_id: answerId, reason }) });
    }
    function getDisputes() {
        return request("/api/disputes", { method: "GET" });
    }
    function postRuling(id, ruling) {
        return request(`/api/disputes/${id}/ruling`, { method: "POST", body: JSON.stringify({ ruling }) });
    }
    function getArchive(limit, cursor) {
        const params = new URLSearchParams();
        params.set("limit", String(limit));
        if (cursor !== null)
            params.set("cursor", cursor);
        return request(`/api/answers?${params.toString()}`, { method: "GET" });
    }
    function searchAnswers(query, round) {
        return request("/api/answers/search", {
            method: "POST",
            body: JSON.stringify(round === undefined ? { query } : { query, round }),
        });
    }
    function isApiError(body) {
        return typeof body === "object" && body !== null && "error" in body;
    }
});
define("shell", ["require", "exports", "copy", "util"], function (require, exports, copy_1, util_1) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.TableNews = exports.DeskMessages = void 0;
    exports.el = el;
    exports.icon = icon;
    exports.renderRoundStrip = renderRoundStrip;
    exports.renderTileGrid = renderTileGrid;
    exports.renderTileContainer = renderTileContainer;
    exports.counterText = counterText;
    exports.fieldCounter = fieldCounter;
    exports.countdownText = countdownText;
    exports.notFoundScreen = notFoundScreen;
    exports.limits = limits;
    function el(tag, attrs = {}, text) {
        const node = document.createElement(tag);
        for (const [key, value] of Object.entries(attrs)) {
            if (value === null)
                continue;
            if (key === "class") {
                node.className = value;
            }
            else if (key === "text") {
                node.textContent = value;
            }
            else {
                node.setAttribute(key, value);
            }
        }
        if (text !== undefined)
            node.textContent = text;
        return node;
    }
    function icon() {
        return document;
    }
    /** The one 6-second Desk messages lifetime: a newer message replaces the one showing and restarts it. */
    class DeskMessages {
        constructor(parent) {
            const region = el("div", {
                role: "status",
                "aria-live": "polite",
                "aria-label": "Desk messages",
                id: "desk-messages",
                class: "desk-messages",
            });
            parent.appendChild(region);
            this.node = region;
        }
        show(text, pending = false) {
            if (this.timer !== undefined)
                window.clearTimeout(this.timer);
            this.node.textContent = text;
            if (!pending) {
                this.timer = window.setTimeout(() => {
                    this.node.textContent = "";
                    this.timer = undefined;
                }, 6000);
            }
        }
        clearPending() {
            if (this.timer !== undefined) {
                window.clearTimeout(this.timer);
                this.timer = undefined;
            }
        }
    }
    exports.DeskMessages = DeskMessages;
    class TableNews {
        constructor(parent) {
            const region = el("div", {
                role: "status",
                "aria-live": "polite",
                "aria-label": "Table news",
                id: "table-news",
                class: "table-news",
            });
            parent.appendChild(region);
            this.node = region;
        }
        announce(text) {
            this.node.textContent = text;
        }
    }
    exports.TableNews = TableNews;
    function renderRoundStrip(container, rounds) {
        const strip = container.querySelector("#round-strip");
        if (strip === null)
            return;
        strip.textContent = "";
        for (const round of rounds) {
            const chip = el("li", {
                role: "listitem",
                class: "chip",
                "data-status": round.status,
                "data-round": String(round.number),
            });
            const roundSpan = el("span", { class: "chip-round num" }, `Round ${round.number}`);
            const statusSpan = el("span", {}, `· ${util_1.STATUS_LABEL[round.status]}`);
            chip.appendChild(roundSpan);
            chip.appendChild(statusSpan);
            strip.appendChild(chip);
        }
        if (window.innerWidth < 600) {
            strip.classList.add("two-rows");
        }
        else {
            strip.classList.remove("two-rows");
        }
    }
    function renderTileGrid(container, table, tableNews, announce) {
        const grid = container.querySelector("#tile-grid");
        if (grid === null)
            return;
        grid.textContent = "";
        for (const team of table.teams) {
            const item = el("li", { class: "tile", "data-position": String(team.position), "data-team-id": String(team.team_id) });
            const article = el("article", { tabindex: "0", "aria-label": team.name });
            const heading = el("h3", {}, team.name);
            const meta = el("div", { class: "tile-meta" });
            meta.appendChild(el("span", { class: "tile-position num" }, String(team.position)));
            meta.appendChild(el("span", { class: "tile-total num" }, `${team.total} pts`));
            if (team.last_round !== null) {
                meta.appendChild(el("span", { class: "tile-round num" }, `Round ${team.last_round.round}: ${team.last_round.score}`));
            }
            article.appendChild(heading);
            article.appendChild(meta);
            item.appendChild(article);
            grid.appendChild(item);
        }
        if (announce !== undefined) {
            tableNews.announce(announce);
        }
    }
    function renderTileContainer(container) {
        const grid = el("ul", { id: "tile-grid", class: "tile-grid", role: "list", "aria-label": "League table" });
        const heading = el("h2", {}, "League table");
        container.appendChild(heading);
        container.appendChild(grid);
        return grid;
    }
    function counterText(text, limit) {
        return `${(0, util_1.countText)(text)}/${limit}`;
    }
    function fieldCounter(input, limit) {
        const wrap = el("div", { class: "field" });
        const counter = el("span", { class: "counter num" }, counterText(input.value, limit));
        const error = el("span", { class: "field-error", role: "status" }, "");
        error.style.display = "none";
        const update = () => {
            counter.textContent = counterText(input.value, limit);
            const over = (0, util_1.countText)(input.value) > limit;
            counter.classList.toggle("over", over);
            error.style.display = over ? "block" : "none";
        };
        input.addEventListener("input", update);
        wrap.appendChild(input);
        wrap.appendChild(counter);
        wrap.appendChild(error);
        input.dataset["limit"] = String(limit);
        return wrap;
    }
    function countdownText(seconds) {
        return (0, util_1.formatCountdown)(seconds);
    }
    function notFoundScreen(main) {
        main.textContent = "";
        const card = el("section", { class: "card" });
        const heading = el("h1", {}, copy_1.COPY.notFoundHeading);
        const link = el("a", { href: "/" }, copy_1.COPY.backToTable);
        card.appendChild(heading);
        card.appendChild(link);
        main.appendChild(card);
    }
    function limits() {
        return util_1.LIMITS;
    }
});
define("signin", ["require", "exports", "copy", "api", "shell"], function (require, exports, copy_2, api_1, shell_1) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.renderSignIn = renderSignIn;
    function renderSignIn(main, messages) {
        main.textContent = "";
        const card = (0, shell_1.el)("section", { class: "card signin-card" });
        const form = (0, shell_1.el)("form", { "aria-label": "Sign in", id: "sign-in-form" });
        const codeField = (0, shell_1.el)("input", {
            type: "text",
            id: "desk-code",
            name: "code",
            autocomplete: "off",
            "aria-label": "Desk code",
        });
        const label = (0, shell_1.el)("label", { for: "desk-code" }, "Desk code");
        const submit = (0, shell_1.el)("button", { type: "submit", id: "sign-in" }, "Sign in");
        form.appendChild(label);
        form.appendChild(codeField);
        form.appendChild(submit);
        card.appendChild(form);
        main.appendChild(card);
        form.addEventListener("submit", (event) => {
            event.preventDefault();
            void (async () => {
                messages.show(copy_2.COPY.checkingCode, true);
                const result = await (0, api_1.postSession)(codeField.value);
                if (result.status === 201) {
                    const body = result.body;
                    const desk = body.role === "quizmaster" ? "/quizmaster" : body.role === "marker" ? "/marker" : "/captain";
                    window.location.assign(desk);
                    return;
                }
                messages.show(copy_2.COPY.badCode);
                codeField.focus();
            })();
        });
        codeField.focus();
    }
});
define("captain", ["require", "exports", "copy", "api", "shell", "util"], function (require, exports, copy_3, api_2, shell_2, util_2) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.CaptainDesk = void 0;
    function newKey() {
        const bytes = new Uint8Array(12);
        crypto.getRandomValues(bytes);
        return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    }
    class CaptainDesk {
        constructor(main, messages, tableNews, state) {
            this.form = null;
            this.answers = [];
            this.disputes = [];
            this.rounds = [];
            this.closedAnnounced = new Set();
            this.openRoundSeen = null;
            this.secondsLeft = 0;
            this.main = main;
            this.messages = messages;
            this.tableNews = tableNews;
            this.state = state;
        }
        start() {
            this.renderShell();
            void this.poll();
            window.setInterval(() => void this.poll(), 3000);
            window.setInterval(() => this.tickCountdown(), 1000);
        }
        renderShell() {
            this.main.textContent = "";
            const heading = (0, shell_2.el)("h1", {}, "Answer desk");
            const headingWrap = (0, shell_2.el)("div", {});
            headingWrap.appendChild(heading);
            this.main.appendChild(headingWrap);
            const signOut = (0, shell_2.el)("button", { class: "secondary", id: "sign-out" }, "Sign out");
            signOut.addEventListener("click", () => {
                void (async () => {
                    await (0, api_2.deleteSession)();
                    window.location.assign("/sign-in");
                })();
            });
            this.main.appendChild(signOut);
            const teamRow = (0, shell_2.el)("div", { class: "team-row" });
            const teamName = (0, shell_2.el)("span", { id: "team-name" }, this.state.teamName);
            const rename = (0, shell_2.el)("button", { id: "rename-team" }, "Rename team");
            rename.addEventListener("click", () => this.openRename());
            teamRow.appendChild(teamName);
            teamRow.appendChild(rename);
            this.main.appendChild(teamRow);
            const formSlot = (0, shell_2.el)("div", { id: "answer-form-slot" });
            this.main.appendChild(formSlot);
            const marks = (0, shell_2.el)("section", { id: "your-marks", role: "region", "aria-label": "Your marks" });
            const marksHeading = (0, shell_2.el)("h2", {}, "Your marks");
            marks.appendChild(marksHeading);
            const marksBody = (0, shell_2.el)("div", { id: "marks-body" });
            marks.appendChild(marksBody);
            this.main.appendChild(marks);
            (0, shell_2.renderTileContainer)(this.main);
        }
        async poll() {
            const [roundsResult, tableResult, answersResult, disputesResult] = await Promise.all([
                new Promise((resolve_1, reject_1) => { require(["api"], resolve_1, reject_1); }).then((m) => m.getRounds()),
                new Promise((resolve_2, reject_2) => { require(["api"], resolve_2, reject_2); }).then((m) => m.getTable()),
                new Promise((resolve_3, reject_3) => { require(["api"], resolve_3, reject_3); }).then((m) => m.getSession()),
                (0, api_2.getDisputes)(),
            ]);
            if (roundsResult.status === 401) {
                window.location.assign("/sign-in?signed-out=1");
                return;
            }
            if (roundsResult.status !== 200 || tableResult.status !== 200) {
                this.messages.show(copy_3.COPY.unreachable);
                return;
            }
            const rounds = roundsResult.body.rounds;
            const table = tableResult.body;
            this.rounds = rounds;
            this.disputes = disputesResult.status === 200 ? disputesResult.body.disputes : [];
            const open = rounds.find((r) => r.status === "open");
            this.renderForm(open ?? null);
            this.syncCountdown(open ?? null);
            await this.renderMarks();
            const { renderTileGrid } = await new Promise((resolve_4, reject_4) => { require(["shell"], resolve_4, reject_4); });
            const grid = this.main.querySelector("#tile-grid");
            if (grid !== null) {
                renderTileGrid(this.main, table, this.tableNews, undefined);
            }
            const session = answersResult.status === 200 ? answersResult.body : null;
            if (session !== null && session.team_name !== null) {
                const nameNode = this.main.querySelector("#team-name");
                if (nameNode !== null)
                    nameNode.textContent = session.team_name;
            }
        }
        syncCountdown(open) {
            if (open === null) {
                this.secondsLeft = 0;
                return;
            }
            this.secondsLeft = open.seconds_left ?? 0;
        }
        tickCountdown() {
            if (this.secondsLeft > 0) {
                this.secondsLeft -= 1;
            }
            const node = this.main.querySelector("#countdown");
            if (node !== null) {
                node.textContent = countFormat(this.secondsLeft);
            }
        }
        renderForm(open) {
            const slot = this.main.querySelector("#answer-form-slot");
            if (slot === null)
                return;
            const closedRound = this.rounds.find((r) => r.number === this.form?.round && r.status !== "open" && r.status !== "drafted");
            if (open === null && this.form === null) {
                if (this.openRoundSeen === null) {
                    slot.textContent = "";
                    const waiting = (0, shell_2.el)("section", { class: "card", id: "waiting-card" }, copy_3.COPY.waiting);
                    slot.appendChild(waiting);
                }
                return;
            }
            if (open !== null && this.form !== null && open.number !== this.form.round) {
                this.form = null;
                this.closedAnnounced.clear();
            }
            if (open !== null && this.form === null) {
                this.openRoundSeen = open.number;
                this.buildForm(open);
                return;
            }
            if (open === null && this.form !== null) {
                this.lockForm();
                if (closedRound !== undefined && !this.closedAnnounced.has(closedRound.number)) {
                    this.closedAnnounced.add(closedRound.number);
                    this.messages.show(copy_3.COPY.roundClosed(this.form.round));
                }
                const node = this.main.querySelector("#countdown");
                if (node !== null)
                    node.textContent = countFormat(0);
                this.secondsLeft = 0;
            }
        }
        buildForm(round) {
            const slot = this.main.querySelector("#answer-form-slot");
            if (slot === null)
                return;
            slot.textContent = "";
            const form = (0, shell_2.el)("form", { id: "answer-form", "aria-label": `Round ${round.number} answers` });
            const countdown = (0, shell_2.el)("div", {
                id: "countdown",
                class: "countdown num",
                role: "timer",
                "aria-label": "Time left",
            }, countFormat(round.seconds_left ?? 0));
            form.appendChild(countdown);
            const fields = (0, shell_2.el)("div", { class: "answer-fields", id: "answer-fields" });
            for (let q = 1; q <= 8; q++) {
                const label = (0, shell_2.el)("label", { for: `q${q}` }, `Question ${q}`);
                const input = (0, shell_2.el)("input", { type: "text", id: `q${q}`, name: `q${q}`, "aria-label": `Question ${q}` });
                const wrapped = (0, shell_2.fieldCounter)(input, util_2.LIMITS.answer);
                fields.appendChild(label);
                fields.appendChild(wrapped);
                input.addEventListener("keydown", (event) => {
                    if (event.key === "Enter") {
                        event.preventDefault();
                        if (q < 8) {
                            this.main.querySelector(`#q${q + 1}`)?.focus();
                        }
                        else {
                            form.requestSubmit();
                        }
                    }
                });
            }
            form.appendChild(fields);
            if (round.kind === "picture") {
                const image = (0, shell_2.el)("img", { src: `/api/rounds/${round.number}/sheet`, alt: `Picture sheet for round ${round.number}`, class: "picture-sheet" });
                const wrap = (0, shell_2.el)("div", { class: "picture-sheet" });
                wrap.appendChild(image);
                form.appendChild(wrap);
            }
            const submit = (0, shell_2.el)("button", { type: "submit", id: "submit-answers" }, "Submit answers");
            form.appendChild(submit);
            const accepted = (0, shell_2.el)("ul", { id: "accepted-answers", "aria-label": "Accepted answers", class: "fade-in" });
            accepted.style.display = "none";
            const acceptedWrap = (0, shell_2.el)("div", {});
            acceptedWrap.appendChild(accepted);
            slot.appendChild(form);
            slot.appendChild(acceptedWrap);
            this.form = { round: round.number, idempotencyKey: newKey() };
            this.answers = [];
            form.addEventListener("submit", (event) => {
                event.preventDefault();
                void this.submit(form, accepted);
            });
            const first = this.main.querySelector("#q1");
            if (first !== null)
                first.focus();
        }
        async submit(form, acceptedList) {
            if (this.form === null)
                return;
            if (form.dataset["closed"] === "1")
                return;
            const items = [];
            for (let q = 1; q <= 8; q++) {
                const input = form.querySelector(`#q${q}`);
                if (input === null)
                    continue;
                const value = input.value;
                if (value.trim() === "")
                    continue;
                items.push({ question: q, text: value });
            }
            this.messages.show(copy_3.COPY.sendingAnswers, true);
            const key = this.form.idempotencyKey;
            const result = await (0, api_2.submitRoundAnswers)(this.form.round, items, key);
            if (result.status === 201) {
                const body = result.body;
                this.answers = body.accepted;
                this.messages.show(copy_3.COPY.answersIn(body.round));
                acceptedList.textContent = "";
                for (const answer of body.accepted) {
                    acceptedList.appendChild((0, shell_2.el)("li", {}, `Question ${answer.question}: ${answer.text}`));
                }
                acceptedList.style.display = "block";
                this.form = { round: this.form.round, idempotencyKey: newKey() };
                return;
            }
            const error = result.body;
            if (result.status === 429) {
                this.messages.show(copy_3.COPY.tooManySubmits(error.retryAfter ?? 1));
                return;
            }
            if (error.code === "round_closed") {
                this.messages.show(copy_3.COPY.roundClosed(this.form.round));
                this.lockForm();
                return;
            }
            if (error.code === "round_not_open") {
                this.messages.show(copy_3.COPY.roundClosed(this.form.round));
                this.lockForm();
                return;
            }
            if (result.status === 422) {
                this.messages.show(copy_3.COPY.answersOverLimit);
                return;
            }
            this.messages.show(copy_3.COPY.unreachable);
        }
        lockForm() {
            const form = this.main.querySelector("#answer-form");
            if (form === null)
                return;
            form.dataset["closed"] = "1";
            for (let q = 1; q <= 8; q++) {
                const input = form.querySelector(`#q${q}`);
                if (input !== null)
                    input.readOnly = true;
            }
        }
        async renderMarks() {
            const body = this.main.querySelector("#marks-body");
            if (body === null)
                return;
            const marked = this.rounds.filter((r) => r.status === "marked" || r.status === "published");
            const focusTarget = document.activeElement;
            body.textContent = "";
            if (marked.length === 0) {
                body.appendChild((0, shell_2.el)("p", {}, "No rounds are marked yet."));
                void focusTarget;
                return;
            }
            for (const round of marked) {
                const group = (0, shell_2.el)("div", { role: "group", "aria-label": `Round ${round.number}` });
                group.appendChild((0, shell_2.el)("h3", {}, `Round ${round.number}`));
                const answersResult = await (0, api_2.getRoundAnswers)(round.number);
                if (answersResult.status !== 200)
                    continue;
                const answers = answersResult.body.answers;
                const detailed = await (0, api_2.getRoundAnswers)(round.number);
                void detailed;
                for (const answer of answers) {
                    const row = (0, shell_2.el)("div", { class: "mark-row", "data-answer-id": String(answer.id) });
                    row.appendChild((0, shell_2.el)("span", {}, `Question ${answer.question}: ${answer.text}`));
                    const status = (0, shell_2.el)("span", {}, "");
                    const dispute = this.disputes.find((d) => d.answer_id === answer.id);
                    if (round.status === "marked" && dispute === undefined && answer.mark === 0) {
                        const button = (0, shell_2.el)("button", { class: "secondary" }, `Dispute question ${answer.question}`);
                        button.addEventListener("click", () => this.openDispute(answer, button));
                        row.appendChild(button);
                    }
                    else if (dispute !== undefined) {
                        status.textContent = dispute.status === "raised" ? "Raised" : dispute.status === "upheld" ? "Upheld" : "Dismissed";
                        row.appendChild(status);
                    }
                    else {
                        status.textContent = `Mark ${answer.mark ?? 0}`;
                        row.appendChild(status);
                    }
                    group.appendChild(row);
                }
                body.appendChild(group);
            }
            if (focusTarget instanceof HTMLElement && body.contains(focusTarget)) {
                focusTarget.focus();
            }
        }
        openRename() {
            const dialog = (0, shell_2.el)("div", { role: "dialog", "aria-label": "Rename team", class: "pane" });
            const backdrop = (0, shell_2.el)("div", { class: "pane-backdrop" });
            const panel = (0, shell_2.el)("div", { class: "pane-panel" });
            const title = (0, shell_2.el)("h2", {}, "Rename team");
            const input = (0, shell_2.el)("input", { type: "text", id: "team-name-field", "aria-label": "Team name" });
            input.value = this.state.teamName ?? "";
            const wrapped = (0, shell_2.fieldCounter)(input, util_2.LIMITS.name);
            const save = (0, shell_2.el)("button", { id: "save-name" }, "Save name");
            const cancel = (0, shell_2.el)("button", { class: "secondary", id: "cancel-rename" }, "Cancel");
            const actions = (0, shell_2.el)("div", { class: "pane-actions" });
            actions.appendChild(save);
            actions.appendChild(cancel);
            panel.appendChild(title);
            panel.appendChild(wrapped);
            panel.appendChild(actions);
            dialog.appendChild(backdrop);
            dialog.appendChild(panel);
            document.getElementById("modal-root")?.appendChild(dialog);
            const close = () => {
                dialog.remove();
                this.main.querySelector("#rename-team")?.focus();
            };
            save.addEventListener("click", () => void this.saveName(input));
            input.addEventListener("keydown", (event) => {
                if (event.key === "Enter") {
                    event.preventDefault();
                    void this.saveName(input);
                }
            });
            cancel.addEventListener("click", close);
            dialog.addEventListener("keydown", (event) => {
                if (event.key === "Escape")
                    close();
                if (event.key === "Tab") {
                    const stops = [input, save, cancel];
                    trapTab(event, stops);
                }
            });
            input.focus();
        }
        async saveName(input) {
            const value = input.value;
            if (value.trim() === "") {
                this.messages.show(copy_3.COPY.nameEmpty);
                return;
            }
            if ((0, util_2.countText)(value) > util_2.LIMITS.name) {
                this.messages.show(copy_3.COPY.nameTooLong);
                return;
            }
            this.messages.show(copy_3.COPY.savingName, true);
            const result = await (0, api_2.patchTeam)(this.state.teamId, value);
            if (result.status === 200) {
                this.messages.show(copy_3.COPY.nameSaved);
                document.getElementById("modal-root")?.querySelector("[role=dialog]")?.remove();
                const nameNode = this.main.querySelector("#team-name");
                if (nameNode !== null) {
                    nameNode.textContent = result.body.team.name;
                }
                this.main.querySelector("#rename-team")?.focus();
                return;
            }
            const error = result.body;
            if (error.code === "name_taken") {
                this.messages.show(copy_3.COPY.nameTaken);
                return;
            }
            this.messages.show(copy_3.COPY.nameTooLong);
        }
        openDispute(answer, opener) {
            const dialog = (0, shell_2.el)("div", { role: "dialog", "aria-label": "Raise a dispute", class: "pane" });
            const backdrop = (0, shell_2.el)("div", { class: "pane-backdrop" });
            const panel = (0, shell_2.el)("div", { class: "pane-panel" });
            const title = (0, shell_2.el)("h2", {}, `Raise a dispute`);
            const detail = (0, shell_2.el)("p", {}, `Question ${answer.question}: ${answer.text}`);
            const input = (0, shell_2.el)("textarea", { id: "dispute-reason", "aria-label": "Reason", rows: "4" });
            const wrapped = (0, shell_2.fieldCounter)(input, util_2.LIMITS.reason);
            const send = (0, shell_2.el)("button", { id: "send-dispute" }, "Send dispute");
            const cancel = (0, shell_2.el)("button", { class: "secondary", id: "cancel-dispute" }, "Cancel");
            const actions = (0, shell_2.el)("div", { class: "pane-actions" });
            actions.appendChild(send);
            actions.appendChild(cancel);
            panel.appendChild(title);
            panel.appendChild(detail);
            panel.appendChild(wrapped);
            panel.appendChild(actions);
            dialog.appendChild(backdrop);
            dialog.appendChild(panel);
            document.getElementById("modal-root")?.appendChild(dialog);
            const close = () => {
                dialog.remove();
                const next = this.main.querySelector(`[data-answer-id="${answer.id}"] button`);
                (next ?? this.main.querySelector("#your-marks"))?.focus();
            };
            send.addEventListener("click", () => void this.sendDispute(answer, input, send));
            cancel.addEventListener("click", close);
            dialog.addEventListener("keydown", (event) => {
                if (event.key === "Escape")
                    close();
                if (event.key === "Tab")
                    trapTab(event, [input, send, cancel]);
            });
            input.focus();
            void opener;
        }
        async sendDispute(answer, input, send) {
            const value = input.value;
            if (value.trim() === "") {
                this.messages.show(copy_3.COPY.disputeReasonEmpty);
                return;
            }
            if ((0, util_2.countText)(value) > util_2.LIMITS.reason) {
                this.messages.show(copy_3.COPY.disputeReasonTooLong);
                return;
            }
            this.messages.show(copy_3.COPY.sendingDispute, true);
            const result = await (0, api_2.postDispute)(answer.id, value);
            if (result.status === 201) {
                this.messages.show(copy_3.COPY.disputeSent);
                document.getElementById("modal-root")?.querySelector("[role=dialog]")?.remove();
                await this.renderMarks();
                const rows = Array.from(this.main.querySelectorAll("[data-answer-id]"));
                const index = rows.findIndex((row) => row.dataset["answerId"] === String(answer.id));
                const nextButton = rows.slice(index + 1).find((row) => row.querySelector("button") !== null)?.querySelector("button");
                (nextButton ?? this.main.querySelector("#your-marks"))?.focus();
                return;
            }
            const error = result.body;
            if (error.code === "dispute_window_closed") {
                this.messages.show(copy_3.COPY.disputesClosed(answer.round));
                send.focus();
                return;
            }
            this.messages.show(copy_3.COPY.disputeReasonEmpty);
            send.focus();
        }
    }
    exports.CaptainDesk = CaptainDesk;
    function trapTab(event, stops) {
        const active = document.activeElement;
        const index = stops.indexOf(active);
        if (index < 0) {
            event.preventDefault();
            stops[0]?.focus();
            return;
        }
        if (!event.shiftKey && index === stops.length - 1) {
            event.preventDefault();
            stops[0]?.focus();
        }
        if (event.shiftKey && index === 0) {
            event.preventDefault();
            stops[stops.length - 1]?.focus();
        }
    }
    function countFormat(seconds) {
        const safe = Math.max(0, seconds);
        const minutes = Math.floor(safe / 60);
        const rest = safe % 60;
        return `${minutes}:${rest.toString().padStart(2, "0")} left`;
    }
});
define("marker", ["require", "exports", "copy", "api", "shell"], function (require, exports, copy_4, api_3, shell_3) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.MarkerDesk = void 0;
    class MarkerDesk {
        constructor(main, messages) {
            this.rounds = [];
            this.paneRound = null;
            this.currentIndex = 0;
            this.main = main;
            this.messages = messages;
        }
        start() {
            this.renderShell();
            void this.poll();
            window.setInterval(() => void this.poll(), 3000);
        }
        renderShell() {
            this.main.textContent = "";
            const heading = (0, shell_3.el)("h1", { id: "marking-heading" }, "Marking");
            const headingWrap = (0, shell_3.el)("div", {});
            headingWrap.appendChild(heading);
            this.main.appendChild(headingWrap);
            const signOut = (0, shell_3.el)("button", { class: "secondary", id: "sign-out" }, "Sign out");
            signOut.addEventListener("click", () => {
                void (async () => {
                    const { deleteSession } = await new Promise((resolve_5, reject_5) => { require(["api"], resolve_5, reject_5); });
                    await deleteSession();
                    window.location.assign("/sign-in");
                })();
            });
            this.main.appendChild(signOut);
            const roundList = (0, shell_3.el)("section", { id: "round-list" });
            this.main.appendChild(roundList);
            const archiveLink = (0, shell_3.el)("a", { href: "/archive", id: "archive-link" }, "Answer archive");
            this.main.appendChild(archiveLink);
        }
        async poll() {
            const { getRounds } = await new Promise((resolve_6, reject_6) => { require(["api"], resolve_6, reject_6); });
            const result = await getRounds();
            if (result.status === 401) {
                window.location.assign("/sign-in?signed-out=1");
                return;
            }
            if (result.status !== 200) {
                this.messages.show(copy_4.COPY.unreachable);
                return;
            }
            this.rounds = result.body.rounds;
            this.renderRounds();
            if (this.paneRound !== null) {
                await this.refreshPane(this.paneRound);
            }
        }
        renderRounds() {
            const list = this.main.querySelector("#round-list");
            if (list === null)
                return;
            list.textContent = "";
            for (const round of this.rounds) {
                const card = (0, shell_3.el)("section", { class: "card", "data-round": String(round.number) });
                card.appendChild((0, shell_3.el)("h3", {}, `Round ${round.number}: ${round.title}`));
                card.appendChild((0, shell_3.el)("span", {}, round.status));
                if (round.status === "closed") {
                    const button = (0, shell_3.el)("button", {}, `Mark round ${round.number}`);
                    button.addEventListener("click", () => void this.openPane(round.number));
                    card.appendChild(button);
                }
                list.appendChild(card);
            }
        }
        async openPane(round) {
            const result = await (0, api_3.getRoundAnswers)(round);
            if (result.status !== 200)
                return;
            const answers = result.body.answers;
            this.paneRound = round;
            this.currentIndex = answers.findIndex((a) => a.mark === null);
            if (this.currentIndex < 0)
                this.currentIndex = 0;
            this.renderPane(round, answers);
        }
        async refreshPane(round) {
            const result = await (0, api_3.getRoundAnswers)(round);
            if (result.status !== 200)
                return;
            const answers = result.body.answers;
            this.updatePaneRows(answers);
        }
        renderPane(round, answers) {
            document.getElementById("modal-root")?.querySelector("#mark-pane")?.remove();
            const dialog = (0, shell_3.el)("div", { role: "dialog", "aria-label": `Mark round ${round}`, class: "pane", id: "mark-pane" });
            const backdrop = (0, shell_3.el)("div", { class: "pane-backdrop" });
            const panel = (0, shell_3.el)("div", { class: "pane-panel" });
            const title = (0, shell_3.el)("h2", {}, `Mark round ${round}`);
            const rows = (0, shell_3.el)("div", { class: "mark-pane-rows", id: "mark-rows" });
            panel.appendChild(title);
            panel.appendChild(rows);
            const finish = (0, shell_3.el)("button", { id: "finish-marking" }, "Finish marking");
            const close = (0, shell_3.el)("button", { class: "secondary", id: "close-marking" }, "Close");
            const actions = (0, shell_3.el)("div", { class: "pane-actions" });
            actions.appendChild(finish);
            actions.appendChild(close);
            panel.appendChild(actions);
            dialog.appendChild(backdrop);
            dialog.appendChild(panel);
            document.getElementById("modal-root")?.appendChild(dialog);
            this.updatePaneRows(answers);
            const stops = () => {
                const list = [];
                for (const group of Array.from(rows.querySelectorAll(".radios"))) {
                    const checked = group.querySelector("input:checked") ?? group.querySelector("input");
                    if (checked !== null)
                        list.push(checked);
                }
                list.push(finish);
                list.push(close);
                return list;
            };
            dialog.addEventListener("keydown", (event) => {
                if (event.ctrlKey || event.metaKey || event.altKey)
                    return;
                const key = event.key.toLowerCase();
                if (key === "c") {
                    event.preventDefault();
                    void this.markCurrent(1);
                }
                else if (key === "x") {
                    event.preventDefault();
                    void this.markCurrent(0);
                }
                else if (key === "j") {
                    event.preventDefault();
                    this.moveRow(1, stops().length - 2);
                }
                else if (key === "k") {
                    event.preventDefault();
                    this.moveRow(-1, stops().length - 2);
                }
                else if (event.key === "Escape") {
                    this.closePane(round);
                }
                else if (event.key === "Tab") {
                    trapTab(event, stops());
                }
            });
            finish.addEventListener("click", () => void this.finishMarking(round, finish));
            close.addEventListener("click", () => this.closePane(round));
            const first = stops()[0];
            first?.focus();
        }
        updatePaneRows(answers) {
            const rows = document.getElementById("mark-rows");
            if (rows === null)
                return;
            const existing = Array.from(rows.querySelectorAll(".mark-row"));
            for (let index = 0; index < answers.length; index++) {
                const answer = answers[index];
                const row = existing[index];
                if (row === undefined) {
                    this.appendRow(rows, answer);
                    continue;
                }
                const mark = answer.mark ?? null;
                const correct = row.querySelector("input[value='1']");
                const wrong = row.querySelector("input[value='0']");
                if (correct !== null)
                    correct.checked = mark === 1;
                if (wrong !== null)
                    wrong.checked = mark === 0;
                row.classList.toggle("current", index === this.currentIndex);
            }
        }
        appendRow(rows, answer) {
            const row = (0, shell_3.el)("div", { class: "mark-row", "data-answer-id": String(answer.id) });
            const text = (0, shell_3.el)("span", {}, answer.text);
            const radios = (0, shell_3.el)("div", { class: "radios", role: "radiogroup", "aria-label": `${answer.team_name}, question ${answer.question}` });
            const correctLabel = (0, shell_3.el)("label", {}, "Correct");
            const correct = (0, shell_3.el)("input", { type: "radio", name: `mark-${answer.id}`, value: "1" });
            const wrongLabel = (0, shell_3.el)("label", {}, "Wrong");
            const wrong = (0, shell_3.el)("input", { type: "radio", name: `mark-${answer.id}`, value: "0" });
            if (answer.mark === 1)
                correct.checked = true;
            if (answer.mark === 0)
                wrong.checked = true;
            correctLabel.prepend(correct);
            wrongLabel.prepend(wrong);
            radios.appendChild(correctLabel);
            radios.appendChild(wrongLabel);
            row.appendChild(text);
            row.appendChild(radios);
            const answerId = answer.id;
            const round = answer.round;
            const index = rows.children.length;
            const save = (points) => {
                void (async () => {
                    const result = await (0, api_3.putMark)(round, answerId, points);
                    if (result.status === 200) {
                        const team = answer.team_name;
                        const q = answer.question;
                        this.messages.show(points === 1 ? copy_4.COPY.markCorrect(team, q) : copy_4.COPY.markWrong(team, q));
                    }
                    else {
                        this.messages.show(copy_4.COPY.unreachable);
                    }
                })();
            };
            correct.addEventListener("change", () => {
                this.currentIndex = index;
                save(1);
            });
            wrong.addEventListener("change", () => {
                this.currentIndex = index;
                save(0);
            });
            radios.addEventListener("keydown", (event) => {
                if (event.key === "ArrowDown" || event.key === "ArrowRight") {
                    correct.checked = true;
                    correct.dispatchEvent(new Event("change"));
                }
                else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
                    wrong.checked = true;
                    wrong.dispatchEvent(new Event("change"));
                }
            });
            row.classList.toggle("current", index === this.currentIndex);
            rows.appendChild(row);
        }
        async markCurrent(points) {
            if (this.paneRound === null)
                return;
            const rows = document.getElementById("mark-rows");
            if (rows === null)
                return;
            const row = rows.children[this.currentIndex];
            if (row === undefined)
                return;
            const answerId = Number(row.dataset["answerId"]);
            const result = await (0, api_3.putMark)(this.paneRound, answerId, points);
            if (result.status === 200) {
                const input = row.querySelector(`input[value='${points}']`);
                if (input !== null)
                    input.checked = true;
                const rowsAll = Array.from(rows.children);
                const next = rowsAll.findIndex((r, i) => i > this.currentIndex && r.querySelector("input:checked") === null);
                if (next > 0)
                    this.currentIndex = next;
                const answer = result.body.answer;
                this.messages.show(points === 1 ? copy_4.COPY.markCorrect(answer.team_name, answer.question) : copy_4.COPY.markWrong(answer.team_name, answer.question));
            }
            else {
                this.messages.show(copy_4.COPY.unreachable);
            }
        }
        moveRow(delta, maxRows) {
            const next = this.currentIndex + delta;
            if (next < 0 || next >= maxRows)
                return;
            this.currentIndex = next;
            const rows = document.getElementById("mark-rows");
            if (rows === null)
                return;
            Array.from(rows.children).forEach((row, index) => {
                row.classList.toggle("current", index === this.currentIndex);
            });
            const target = rows.children[this.currentIndex];
            target?.querySelector(".radios input")?.focus();
            target?.scrollIntoView({ block: "nearest" });
        }
        async finishMarking(round, finish) {
            this.messages.show(copy_4.COPY.finishing(round), true);
            const result = await (0, api_3.postMarked)(round);
            if (result.status === 200) {
                this.messages.show(copy_4.COPY.roundMarked(round));
                this.closePane(round, true);
                return;
            }
            const error = result.body;
            if (error.code === "unmarked_answers") {
                this.messages.show(copy_4.COPY.unmarkedLeft(round, error.count ?? 0));
                finish.focus();
                return;
            }
            this.messages.show(copy_4.COPY.unreachable);
            finish.focus();
        }
        closePane(round, focusHeading = false) {
            document.getElementById("mark-pane")?.remove();
            this.paneRound = null;
            if (focusHeading) {
                this.main.querySelector("#marking-heading")?.focus();
            }
            else {
                this.main.querySelector(`[data-round='${round}'] button`)?.focus();
            }
        }
    }
    exports.MarkerDesk = MarkerDesk;
    function trapTab(event, stops) {
        const active = document.activeElement;
        const index = stops.indexOf(active);
        if (index < 0) {
            event.preventDefault();
            stops[0]?.focus();
            return;
        }
        if (!event.shiftKey && index === stops.length - 1) {
            event.preventDefault();
            stops[0]?.focus();
        }
        if (event.shiftKey && index === 0) {
            event.preventDefault();
            stops[stops.length - 1]?.focus();
        }
    }
});
define("quizmaster", ["require", "exports", "copy", "api", "shell"], function (require, exports, copy_5, api_4, shell_4) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.QuizmasterDesk = void 0;
    class QuizmasterDesk {
        constructor(main, messages, tableNews) {
            this.rounds = [];
            this.table = null;
            this.disputes = [];
            this.outageShown = new Set();
            this.main = main;
            this.messages = messages;
            this.tableNews = tableNews;
        }
        start() {
            this.renderShell();
            void this.poll();
            window.setInterval(() => void this.poll(), 3000);
        }
        renderShell() {
            this.main.textContent = "";
            const headingWrap = (0, shell_4.el)("div", {});
            const heading = (0, shell_4.el)("h1", { id: "quizmaster-heading" }, "Quizmaster's desk");
            headingWrap.appendChild(heading);
            this.main.appendChild(headingWrap);
            const signOut = (0, shell_4.el)("button", { class: "secondary", id: "sign-out" }, "Sign out");
            signOut.addEventListener("click", () => {
                void (async () => {
                    const { deleteSession } = await new Promise((resolve_7, reject_7) => { require(["api"], resolve_7, reject_7); });
                    await deleteSession();
                    window.location.assign("/sign-in");
                })();
            });
            this.main.appendChild(signOut);
            const cards = (0, shell_4.el)("section", { id: "round-cards", class: "round-cards" });
            this.main.appendChild(cards);
            const disputesRegion = (0, shell_4.el)("section", { id: "disputes", class: "disputes", role: "region", "aria-label": "Disputes" });
            const disputesHeading = (0, shell_4.el)("h2", {}, "Disputes");
            disputesRegion.appendChild(disputesHeading);
            const disputesBody = (0, shell_4.el)("div", { id: "disputes-body" });
            disputesRegion.appendChild(disputesBody);
            this.main.appendChild(disputesRegion);
            (0, shell_4.renderTileContainer)(this.main);
        }
        async poll() {
            const { getRounds, getTable } = await new Promise((resolve_8, reject_8) => { require(["api"], resolve_8, reject_8); });
            const [roundsResult, tableResult, disputesResult] = await Promise.all([
                getRounds(),
                getTable(),
                (0, api_4.getDisputes)(),
            ]);
            if (roundsResult.status === 401) {
                window.location.assign("/sign-in?signed-out=1");
                return;
            }
            if (roundsResult.status !== 200 || tableResult.status !== 200) {
                this.messages.show(copy_5.COPY.unreachable);
                return;
            }
            this.rounds = roundsResult.body.rounds;
            this.table = tableResult.body;
            this.disputes = disputesResult.status === 200 ? disputesResult.body.disputes : [];
            this.renderCards();
            this.renderDisputes();
            const { renderTileGrid } = await new Promise((resolve_9, reject_9) => { require(["shell"], resolve_9, reject_9); });
            renderTileGrid(this.main, this.table, this.tableNews, undefined);
        }
        renderCards() {
            const cards = this.main.querySelector("#round-cards");
            if (cards === null)
                return;
            const focusActive = document.activeElement;
            const chosenFiles = new Map();
            for (const card of Array.from(cards.children)) {
                const round = Number(card.dataset["round"]);
                const input = card.querySelector("input[type=file]");
                if (input?.files?.[0] !== undefined)
                    chosenFiles.set(round, input.files[0]);
            }
            cards.textContent = "";
            for (const round of this.rounds) {
                const card = (0, shell_4.el)("article", { class: "round-card", "data-round": String(round.number), "aria-label": `Round ${round.number}`, tabindex: "0" });
                const title = (0, shell_4.el)("h3", {}, `Round ${round.number}: ${round.title}`);
                card.appendChild(title);
                card.appendChild((0, shell_4.el)("span", { class: "status" }, round.status));
                if (round.kind === "picture") {
                    const sheetStatus = round.sheet?.status === "stored" ? "Sheet stored" : "Sheet not stored";
                    card.appendChild((0, shell_4.el)("span", { class: "sheet-status" }, sheetStatus));
                    if (this.outageShown.has(round.number)) {
                        card.appendChild((0, shell_4.el)("span", { class: "field-error outage-line" }, copy_5.COPY.sheetOutage));
                    }
                }
                if (round.status === "drafted") {
                    const openButton = (0, shell_4.el)("button", {}, `Open round ${round.number}`);
                    openButton.addEventListener("click", () => void this.openRound(round, card));
                    card.appendChild(openButton);
                    if (round.kind === "picture") {
                        const fileInput = (0, shell_4.el)("input", { type: "file", accept: "image/png,image/jpeg", id: `sheet-${round.number}`, "aria-label": `Picture sheet for round ${round.number}` });
                        const upload = (0, shell_4.el)("button", { class: "secondary" }, `Upload sheet for round ${round.number}`);
                        upload.addEventListener("click", () => void this.upload(round, fileInput, card));
                        card.appendChild(fileInput);
                        card.appendChild(upload);
                        const chosen = chosenFiles.get(round.number);
                        if (chosen !== undefined) {
                            const transfer = new DataTransfer();
                            transfer.items.add(chosen);
                            fileInput.files = transfer.files;
                        }
                    }
                }
                else if (round.status === "open") {
                    const closeButton = (0, shell_4.el)("button", {}, `Close round ${round.number}`);
                    closeButton.addEventListener("click", () => void this.closeRound(round, card));
                    card.appendChild(closeButton);
                }
                else if (round.status === "marked") {
                    const publish = (0, shell_4.el)("button", {}, `Publish round ${round.number}`);
                    publish.addEventListener("click", () => void this.publish(round));
                    card.appendChild(publish);
                }
                cards.appendChild(card);
            }
            if (focusActive instanceof HTMLElement && cards.contains(focusActive)) {
                const selector = focusActive.getAttribute("aria-label") ?? focusActive.textContent ?? "";
                void selector;
            }
        }
        async openRound(round, card) {
            this.messages.show(copy_5.COPY.opening(round.number), true);
            const result = await (0, api_4.openRound)(round.number);
            if (result.status === 200) {
                this.messages.show(copy_5.COPY.roundOpen(round.number));
                this.outageShown.delete(round.number);
                await this.poll();
                const close = this.main.querySelector(`[data-round='${round.number}'] button`);
                close?.focus();
                return;
            }
            const error = result.body;
            if (error.code === "sheet_not_stored") {
                this.messages.show(copy_5.COPY.sheetMissing(round.number));
                card.querySelector("[aria-label^='Picture sheet']")?.focus();
                return;
            }
            if (error.code === "another_round_open") {
                this.messages.show(copy_5.COPY.anotherOpen);
                return;
            }
            if (error.code === "storage_unavailable") {
                this.messages.show(copy_5.COPY.sheetOutage);
                this.outageShown.add(round.number);
                this.renderCards();
                return;
            }
            if (error.code === "round_not_drafted") {
                await this.poll();
                return;
            }
            this.messages.show(copy_5.COPY.unreachable);
        }
        async closeRound(round, card) {
            this.messages.show(copy_5.COPY.closing(round.number), true);
            const result = await (0, api_4.closeRound)(round.number);
            if (result.status === 200) {
                this.messages.show(copy_5.COPY.roundClosedByQuizmaster(round.number));
                await this.poll();
                card.focus();
                return;
            }
            this.messages.show(copy_5.COPY.unreachable);
        }
        async publish(round) {
            this.messages.show(copy_5.COPY.publishing(round.number), true);
            const result = await (0, api_4.publishRound)(round.number);
            if (result.status === 200) {
                const body = result.body;
                const leader = body.table.teams[0];
                this.messages.show(copy_5.COPY.publishedNews(round.number, leader.name, leader.total));
                this.tableNews.announce(copy_5.COPY.publishedNews(round.number, leader.name, leader.total));
                await this.poll();
                const card = this.main.querySelector(`[data-round='${round.number}']`);
                card?.focus();
                return;
            }
            const error = result.body;
            if (error.code === "disputes_pending") {
                this.messages.show(copy_5.COPY.disputesOpen(round.number, error.count ?? 0));
                return;
            }
            this.messages.show(copy_5.COPY.unreachable);
        }
        async upload(round, input, card) {
            const file = input.files?.[0];
            if (file === undefined) {
                this.messages.show(copy_5.COPY.noFile);
                input.focus();
                return;
            }
            this.messages.show(copy_5.COPY.storingSheet, true);
            const result = await (0, api_4.uploadSheet)(round.number, file);
            if (result.status === 201) {
                this.messages.show(copy_5.COPY.sheetStored(round.number));
                this.outageShown.delete(round.number);
                await this.poll();
                this.main.querySelector(`[data-round='${round.number}'] .upload`)?.focus();
                void card;
                return;
            }
            const error = result.body;
            if (result.status === 413) {
                this.messages.show(copy_5.COPY.sheetTooLarge);
                input.focus();
                return;
            }
            if (result.status === 415) {
                this.messages.show(copy_5.COPY.sheetType);
                input.focus();
                return;
            }
            if (result.status === 422) {
                this.messages.show(copy_5.COPY.sheetDimensions);
                input.focus();
                return;
            }
            if (error.code === "storage_unavailable") {
                this.messages.show(copy_5.COPY.sheetOutage);
                this.outageShown.add(round.number);
                this.renderCards();
                this.main.querySelector(`[data-round='${round.number}'] .upload`)?.focus();
                return;
            }
            if (error.code === "not_picture_round" || error.code === "round_not_drafted") {
                await this.poll();
                return;
            }
            this.messages.show(copy_5.COPY.unreachable);
        }
        renderDisputes() {
            const body = this.main.querySelector("#disputes-body");
            if (body === null)
                return;
            body.textContent = "";
            const raised = this.disputes.filter((d) => d.status === "raised");
            if (raised.length === 0) {
                body.appendChild((0, shell_4.el)("p", {}, "No open disputes."));
                return;
            }
            for (const dispute of raised) {
                const row = (0, shell_4.el)("div", { class: "card", "data-dispute-id": String(dispute.id) });
                row.appendChild((0, shell_4.el)("span", {}, `Round ${dispute.round}, question ${dispute.question}: ${dispute.answer_text}`));
                row.appendChild((0, shell_4.el)("span", {}, dispute.reason));
                const button = (0, shell_4.el)("button", {}, `Rule on ${dispute.team_id}, round ${dispute.round}, question ${dispute.question}`);
                button.addEventListener("click", () => void this.openRuling(dispute, button));
                row.appendChild(button);
                body.appendChild(row);
            }
        }
        async openRuling(dispute, opener) {
            const dialog = (0, shell_4.el)("div", { role: "dialog", "aria-label": "Rule on dispute", class: "pane", id: "ruling-pane" });
            const backdrop = (0, shell_4.el)("div", { class: "pane-backdrop" });
            const panel = (0, shell_4.el)("div", { class: "pane-panel" });
            const title = (0, shell_4.el)("h2", {}, "Rule on dispute");
            const detail = (0, shell_4.el)("p", {}, `Answer: ${dispute.answer_text}`);
            const reason = (0, shell_4.el)("p", {}, `Reason: ${dispute.reason}`);
            const radios = (0, shell_4.el)("div", { class: "radios", role: "radiogroup", "aria-label": "Ruling" });
            const upholdLabel = (0, shell_4.el)("label", {}, "Uphold");
            const uphold = (0, shell_4.el)("input", { type: "radio", name: "ruling", value: "uphold" });
            const dismissLabel = (0, shell_4.el)("label", {}, "Dismiss");
            const dismiss = (0, shell_4.el)("input", { type: "radio", name: "ruling", value: "dismiss" });
            uphold.checked = true;
            upholdLabel.prepend(uphold);
            dismissLabel.prepend(dismiss);
            radios.appendChild(upholdLabel);
            radios.appendChild(dismissLabel);
            const save = (0, shell_4.el)("button", { id: "save-ruling" }, "Save ruling");
            const cancel = (0, shell_4.el)("button", { class: "secondary", id: "cancel-ruling" }, "Cancel");
            const actions = (0, shell_4.el)("div", { class: "pane-actions" });
            actions.appendChild(save);
            actions.appendChild(cancel);
            panel.appendChild(title);
            panel.appendChild(detail);
            panel.appendChild(reason);
            panel.appendChild(radios);
            panel.appendChild(actions);
            dialog.appendChild(backdrop);
            dialog.appendChild(panel);
            document.getElementById("modal-root")?.appendChild(dialog);
            const close = () => {
                dialog.remove();
                opener.focus();
            };
            const saveRuling = () => {
                void (async () => {
                    this.messages.show(copy_5.COPY.savingRuling, true);
                    const ruling = uphold.checked ? "upheld" : "dismissed";
                    const result = await (0, api_4.postRuling)(dispute.id, ruling);
                    if (result.status === 200) {
                        this.messages.show(copy_5.COPY.rulingSaved);
                        await this.poll();
                        dialog.remove();
                        const buttons = Array.from(this.main.querySelectorAll("[data-dispute-id] button"));
                        const index = buttons.findIndex((b) => b === opener);
                        const next = buttons[index + 1] ?? buttons[0];
                        (next ?? this.main.querySelector("#disputes"))?.focus();
                        return;
                    }
                    const error = result.body;
                    if (error.code === "dispute_already_ruled") {
                        this.messages.show(copy_5.COPY.alreadyRuled);
                        dialog.remove();
                        const buttons = Array.from(this.main.querySelectorAll("[data-dispute-id] button"));
                        const index = buttons.findIndex((b) => b === opener);
                        const next = buttons[index + 1] ?? buttons[0];
                        (next ?? this.main.querySelector("#disputes"))?.focus();
                        return;
                    }
                    this.messages.show(copy_5.COPY.unreachable);
                })();
            };
            save.addEventListener("click", saveRuling);
            cancel.addEventListener("click", close);
            dialog.addEventListener("keydown", (event) => {
                if (event.ctrlKey || event.metaKey || event.altKey)
                    return;
                const key = event.key.toLowerCase();
                if (key === "u") {
                    event.preventDefault();
                    uphold.checked = true;
                }
                else if (key === "d") {
                    event.preventDefault();
                    dismiss.checked = true;
                }
                else if (event.key === "Enter" && document.activeElement === save) {
                    saveRuling();
                }
                else if (event.key === "Escape") {
                    close();
                }
                else if (event.key === "Tab") {
                    trapTab(event, [radios, save, cancel]);
                }
            });
            uphold.focus();
        }
    }
    exports.QuizmasterDesk = QuizmasterDesk;
    function trapTab(event, stops) {
        const active = document.activeElement;
        const index = stops.indexOf(active);
        if (index < 0) {
            event.preventDefault();
            stops[0]?.focus();
            return;
        }
        if (!event.shiftKey && index === stops.length - 1) {
            event.preventDefault();
            stops[0]?.focus();
        }
        if (event.shiftKey && index === 0) {
            event.preventDefault();
            stops[stops.length - 1]?.focus();
        }
    }
});
define("archive", ["require", "exports", "copy", "api", "shell", "util"], function (require, exports, copy_6, api_5, shell_5, util_3) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.ArchiveScreen = void 0;
    class ArchiveScreen {
        constructor(main, messages) {
            this.loadedIds = new Set();
            this.cursor = null;
            this.hasMore = true;
            this.searched = false;
            this.queryValue = "";
            this.roundValue = "";
            this.main = main;
            this.messages = messages;
        }
        start() {
            this.renderShell();
            void this.loadPage();
            window.setInterval(() => undefined, 3000);
        }
        renderShell() {
            this.main.textContent = "";
            const headingWrap = (0, shell_5.el)("div", {});
            headingWrap.appendChild((0, shell_5.el)("h1", {}, "Answer archive"));
            this.main.appendChild(headingWrap);
            const signOut = (0, shell_5.el)("button", { class: "secondary", id: "sign-out" }, "Sign out");
            signOut.addEventListener("click", () => {
                void (async () => {
                    const { deleteSession } = await new Promise((resolve_10, reject_10) => { require(["api"], resolve_10, reject_10); });
                    await deleteSession();
                    window.location.assign("/sign-in");
                })();
            });
            this.main.appendChild(signOut);
            const bar = (0, shell_5.el)("div", { class: "search-bar", id: "search-bar" });
            const search = (0, shell_5.el)("input", { type: "search", id: "search-answers", "aria-label": "Search answers" });
            const wrapped = (0, shell_5.fieldCounter)(search, util_3.LIMITS.query);
            const round = (0, shell_5.el)("select", { id: "round-filter", "aria-label": "Round" });
            round.appendChild((0, shell_5.el)("option", { value: "" }, "All rounds"));
            for (let n = 1; n <= 8; n++) {
                round.appendChild((0, shell_5.el)("option", { value: String(n) }, `Round ${n}`));
            }
            const button = (0, shell_5.el)("button", { id: "search-button" }, "Search");
            bar.appendChild(wrapped);
            bar.appendChild(round);
            bar.appendChild(button);
            this.main.appendChild(bar);
            const results = (0, shell_5.el)("section", { id: "search-results" });
            const resultsTable = (0, shell_5.el)("table", { id: "search-results-table", "aria-label": "Search results", class: "archive-table" });
            results.appendChild(resultsTable);
            results.style.display = "none";
            this.main.appendChild(results);
            const archive = (0, shell_5.el)("section", { id: "archive" });
            const table = (0, shell_5.el)("table", { id: "archive-table", "aria-label": "Answer archive", class: "archive-table" });
            archive.appendChild(table);
            const more = (0, shell_5.el)("button", { class: "secondary", id: "more-answers" }, "More answers");
            more.addEventListener("click", () => void this.loadPage());
            archive.appendChild(more);
            this.main.appendChild(archive);
            search.addEventListener("keydown", (event) => {
                if (event.key === "Enter") {
                    event.preventDefault();
                    this.queryValue = search.value;
                    this.roundValue = round.value;
                    void this.runSearch(search, resultsTable);
                }
                else if (event.key === "ArrowDown") {
                    const firstRow = resultsTable.querySelector("tbody tr");
                    if (firstRow !== null) {
                        event.preventDefault();
                        firstRow.focus();
                    }
                }
            });
            button.addEventListener("click", () => {
                this.queryValue = search.value;
                this.roundValue = round.value;
                void this.runSearch(search, resultsTable);
            });
            resultsTable.addEventListener("keydown", (event) => {
                const rows = Array.from(resultsTable.querySelectorAll("tbody tr"));
                const active = document.activeElement;
                const index = active === null ? -1 : rows.indexOf(active);
                if (event.key === "ArrowDown") {
                    event.preventDefault();
                    rows[Math.min(index + 1, rows.length - 1)]?.focus();
                }
                else if (event.key === "ArrowUp") {
                    event.preventDefault();
                    rows[Math.max(index - 1, 0)]?.focus();
                }
                else if (event.key === "Home") {
                    event.preventDefault();
                    rows[0]?.focus();
                }
                else if (event.key === "End") {
                    event.preventDefault();
                    rows[rows.length - 1]?.focus();
                }
                else if (event.key === "Escape") {
                    event.preventDefault();
                    search.focus();
                }
            });
        }
        async loadPage() {
            const more = this.main.querySelector("#more-answers");
            this.messages.show(copy_6.COPY.loadingAnswers, true);
            const result = await (0, api_5.getArchive)(25, this.cursor);
            if (result.status !== 200) {
                this.messages.show(copy_6.COPY.unreachable);
                return;
            }
            const body = result.body;
            const fresh = body.answers.filter((a) => !this.loadedIds.has(a.id));
            for (const answer of fresh)
                this.loadedIds.add(answer.id);
            if (body.answers.length === 0) {
                this.messages.show(copy_6.COPY.noNewerAnswers);
                more?.focus();
                return;
            }
            this.messages.show(copy_6.COPY.loadingAnswers, true);
            const table = this.main.querySelector("#archive-table");
            if (table !== null) {
                if (table.querySelector("thead") === null) {
                    const head = (0, shell_5.el)("thead", {});
                    const headRow = (0, shell_5.el)("tr", {});
                    for (const label of ["Round", "Question", "Team", "Answer", "Time sent", "Mark"]) {
                        headRow.appendChild((0, shell_5.el)("th", { scope: "col", class: label === "Time sent" ? "archive-time-head" : "" }, label));
                    }
                    head.appendChild(headRow);
                    table.appendChild(head);
                }
                if (table.querySelector("tbody") === null) {
                    table.appendChild((0, shell_5.el)("tbody", {}));
                }
                const tbody = table.querySelector("tbody");
                for (const answer of fresh) {
                    tbody?.appendChild(this.answerRow(answer));
                }
            }
            this.cursor = body.next_cursor;
            this.hasMore = body.has_more;
            const firstFresh = this.main.querySelector(`#archive-table tbody tr[data-id='${fresh[0]?.id}']`);
            firstFresh?.focus();
            this.messages.show(copy_6.COPY.loadingAnswers, true);
        }
        answerRow(answer) {
            const row = (0, shell_5.el)("tr", { tabindex: "0", "data-id": String(answer.id), role: "row" });
            row.appendChild((0, shell_5.el)("td", { class: "num" }, String(answer.round)));
            row.appendChild((0, shell_5.el)("td", { class: "num" }, String(answer.question)));
            row.appendChild((0, shell_5.el)("td", {}, answer.team_name));
            const answerCell = (0, shell_5.el)("td", {}, answer.text);
            const timeLine = (0, shell_5.el)("span", { class: "archive-time num" }, (0, util_3.timeSent)(answer.submitted_at));
            answerCell.appendChild((0, shell_5.el)("br"));
            answerCell.appendChild(timeLine);
            row.appendChild(answerCell);
            const timeCell = (0, shell_5.el)("td", { class: "archive-time num" }, (0, util_3.timeSent)(answer.submitted_at));
            row.appendChild(timeCell);
            row.appendChild((0, shell_5.el)("td", { class: "num" }, answer.mark === null ? "" : String(answer.mark)));
            return row;
        }
        async runSearch(search, resultsTable) {
            const query = this.queryValue;
            if (query.trim() === "") {
                this.messages.show(copy_6.COPY.emptySearch);
                search.focus();
                return;
            }
            if ((0, util_3.countText)(query) > util_3.LIMITS.query) {
                this.messages.show(copy_6.COPY.searchTooLong);
                search.focus();
                return;
            }
            this.messages.show(copy_6.COPY.searching, true);
            const round = this.roundValue === "" ? undefined : Number(this.roundValue);
            const result = await (0, api_5.searchAnswers)(query, round);
            if (result.status !== 200) {
                const error = result.body;
                if (error.code === "search_timeout") {
                    this.messages.show(copy_6.COPY.searchTimeout);
                }
                else if (result.status === 422) {
                    this.messages.show(copy_6.COPY.searchTooLong);
                }
                else {
                    this.messages.show(copy_6.COPY.unreachable);
                }
                search.focus();
                return;
            }
            const body = result.body;
            this.searched = true;
            const section = this.main.querySelector("#search-results");
            if (section !== null)
                section.style.display = "block";
            resultsTable.textContent = "";
            const head = (0, shell_5.el)("thead", {});
            const headRow = (0, shell_5.el)("tr", {});
            for (const label of ["Round", "Question", "Team", "Answer", "Time sent", "Mark"]) {
                headRow.appendChild((0, shell_5.el)("th", { scope: "col" }, label));
            }
            head.appendChild(headRow);
            resultsTable.appendChild(head);
            const tbody = (0, shell_5.el)("tbody", {});
            for (const answer of body.answers) {
                tbody.appendChild(this.answerRow(answer));
            }
            resultsTable.appendChild(tbody);
            if (body.count === 0) {
                this.messages.show(copy_6.COPY.noMatches(query));
            }
            else {
                this.messages.show(copy_6.COPY.answersMatching(body.count));
            }
            search.focus();
        }
    }
    exports.ArchiveScreen = ArchiveScreen;
});
define("app", ["require", "exports", "api", "copy", "shell", "signin", "captain", "marker", "quizmaster", "archive"], function (require, exports, api_6, copy_7, shell_6, signin_1, captain_1, marker_1, quizmaster_1, archive_1) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    let activePoller;
    function startTable(main, messages, tableNews) {
        main.textContent = "";
        (0, shell_6.renderTileContainer)(main);
        const read = async () => {
            const { getRounds, getTable } = await new Promise((resolve_11, reject_11) => { require(["api"], resolve_11, reject_11); });
            const [roundsResult, tableResult, sessionResult] = await Promise.all([getRounds(), getTable(), (0, api_6.getSession)()]);
            if (roundsResult.status !== 200 || tableResult.status !== 200) {
                messages.show(copy_7.COPY.unreachable);
                return;
            }
            const rounds = roundsResult.body.rounds;
            const table = tableResult.body;
            (0, shell_6.renderRoundStrip)(document.body, rounds);
            const previousVersion = Number(main.dataset["tableVersion"] ?? "0");
            if (previousVersion !== table.version && main.dataset["tableVersion"] !== undefined) {
                const leader = table.teams[0];
                tableNews.announce(copy_7.COPY.publishedNews(table.last_published_round ?? 0, leader.name, leader.total));
            }
            main.dataset["tableVersion"] = String(table.version);
            (0, shell_6.renderTileGrid)(main, table, tableNews, undefined);
            if (sessionResult.status === 200) {
                const body = sessionResult.body;
                void body;
            }
        };
        void read();
        window.setInterval(() => void read(), 3000);
    }
    function startDesk() {
        const main = document.getElementById("app-root");
        const modal = document.getElementById("modal-root");
        if (main === null || modal === null)
            return;
        const messages = new shell_6.DeskMessages(main);
        const tableNews = new shell_6.TableNews(main);
        const path = window.location.pathname;
        void (async () => {
            const session = await (0, api_6.getSession)();
            if (session.status === 401) {
                if (path === "/captain" || path === "/marker" || path === "/quizmaster" || path === "/archive") {
                    window.location.assign("/sign-in");
                    return;
                }
            }
            const role = session.status === 200 ? session.body.role : "none";
            switch (path) {
                case "/":
                    startTable(main, messages, tableNews);
                    break;
                case "/sign-in": {
                    (0, signin_1.renderSignIn)(main, messages);
                    break;
                }
                case "/captain": {
                    if (role !== "captain") {
                        window.location.assign("/sign-in");
                        return;
                    }
                    const body = session.body;
                    const desk = new captain_1.CaptainDesk(main, messages, tableNews, { teamId: body.team_id, teamName: body.team_name ?? "" });
                    desk.start();
                    break;
                }
                case "/marker": {
                    if (role !== "marker") {
                        window.location.assign("/sign-in");
                        return;
                    }
                    new marker_1.MarkerDesk(main, messages).start();
                    break;
                }
                case "/quizmaster": {
                    if (role !== "quizmaster") {
                        window.location.assign("/sign-in");
                        return;
                    }
                    new quizmaster_1.QuizmasterDesk(main, messages, tableNews).start();
                    break;
                }
                case "/archive": {
                    if (role !== "marker" && role !== "quizmaster") {
                        window.location.assign("/sign-in");
                        return;
                    }
                    new archive_1.ArchiveScreen(main, messages).start();
                    break;
                }
                default:
                    (0, shell_6.notFoundScreen)(main);
                    break;
            }
            const { getRounds } = await new Promise((resolve_12, reject_12) => { require(["api"], resolve_12, reject_12); });
            const roundsResult = await getRounds();
            if (roundsResult.status === 200) {
                (0, shell_6.renderRoundStrip)(document.body, roundsResult.body.rounds);
            }
        })();
    }
    window.addEventListener("DOMContentLoaded", () => {
        startDesk();
        void activePoller;
    });
});
const rkDefine = window.rkDefine;
if (rkDefine !== undefined) {
    rkDefine("bootstrap", (require) => {
        void require("app");
        return {};
    });
}

resolveModule("bootstrap");
})();
