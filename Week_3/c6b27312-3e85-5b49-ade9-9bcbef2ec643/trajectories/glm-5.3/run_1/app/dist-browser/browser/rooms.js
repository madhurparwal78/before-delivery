import { el, text as t, announce } from "./dom.js";
import { api, ApiError } from "./api.js";
import { mintKey, openEventStream, bumpEpoch, openDialog } from "./part.js";
import { Viewport, defaultPose } from "./viewport.js";
import { formatFixed, formatNumber } from "../shared/numbers.js";
/** Sign in. */
export async function renderSignin(ctx, params) {
    const root = el("div", { class: "form-narrow" });
    ctx.app.replaceChildren(root);
    if (params.get("expired") === "1") {
        root.append(el("p", { class: "muted" }, t("This link has expired or was already used.")));
    }
    root.append(el("h1", {}, t("Sign in")));
    const email = el("input", { type: "email", "aria-label": "Email" });
    const pass = el("input", { type: "password", "aria-label": "Password" });
    const next = params.get("next") ?? "";
    const submit = el("button", { class: "primary" }, t("Sign in"));
    const form = el("form", {}, el("div", { class: "field" }, el("label", {}, t("Email")), email), el("div", { class: "field" }, el("label", {}, t("Password")), pass), submit);
    form.addEventListener("submit", async (e) => {
        e.preventDefault();
        try {
            const res = await api.signin(email.value, pass.value, next || undefined);
            location.href = res.landing;
        }
        catch (err) {
            if (err instanceof ApiError) {
                const note = el("p", { class: "dialog-note" }, t(err.message));
                root.append(note);
            }
        }
    });
    root.append(form, el("p", {}, el("a", { href: "/signup" }, t("Create an account"))));
}
/** Sign up. */
export async function renderSignup(ctx) {
    const root = el("div", { class: "form-narrow" });
    ctx.app.replaceChildren(root);
    root.append(el("h1", {}, t("Create an account")));
    const email = el("input", { type: "email", "aria-label": "Email" });
    const name = el("input", { type: "text", "aria-label": "Display name" });
    const pass = el("input", { type: "password", "aria-label": "Password" });
    const submit = el("button", { class: "primary" }, t("Create account"));
    const form = el("form", {}, el("div", { class: "field" }, el("label", {}, t("Email")), email), el("div", { class: "field" }, el("label", {}, t("Display name")), name), el("div", { class: "field" }, el("label", {}, t("Password")), pass), submit);
    form.addEventListener("submit", async (e) => {
        e.preventDefault();
        try {
            await api.signup(email.value, pass.value, name.value, "/");
            root.append(el("p", {}, t("Check your inbox: we sent a link to your email.")));
            form.remove();
        }
        catch (err) {
            if (err instanceof ApiError && err.errors) {
                for (const [field, message] of Object.entries(err.errors)) {
                    const input = root.querySelector(`[aria-label="${field}"]`);
                    if (input) {
                        input.setAttribute("aria-invalid", "true");
                        const errNode = el("div", { class: "field-error" }, t(message));
                        input.parentElement?.append(errNode);
                    }
                }
            }
        }
    });
    root.append(form);
}
/** Publish a part. */
export async function renderPublish(ctx) {
    const root = el("div", { class: "form-wide publish-form" });
    ctx.app.replaceChildren(root);
    root.append(el("h1", {}, t("Publish a part")));
    const title = el("input", { type: "text", "aria-label": "Title" });
    const category = el("select", { "aria-label": "Category" });
    for (const c of [{ slug: "hardware", name: "Hardware" }, { slug: "organisers", name: "Organisers" }, { slug: "brackets", name: "Brackets" }, { slug: "plumbing", name: "Plumbing" }, { slug: "enclosure-parts", name: "Enclosure parts" }, { slug: "jigs", name: "Jigs" }]) {
        const o = el("option", { value: c.slug });
        o.textContent = c.name;
        category.append(o);
    }
    const visGroup = el("div", { class: "radiogroup", role: "radiogroup", "aria-label": "Visibility" });
    const publicRadio = el("button", { role: "radio", "aria-checked": "true" }, t("Public"));
    const privateRadio = el("button", { role: "radio", "aria-checked": "false" }, t("Private"));
    visGroup.append(publicRadio, privateRadio);
    let visibility = "public";
    publicRadio.addEventListener("click", () => { visibility = "public"; publicRadio.setAttribute("aria-checked", "true"); privateRadio.setAttribute("aria-checked", "false"); });
    privateRadio.addEventListener("click", () => { visibility = "private"; privateRadio.setAttribute("aria-checked", "true"); publicRadio.setAttribute("aria-checked", "false"); });
    const source = el("textarea", { "aria-label": "Source" });
    source.textContent = `# my-part
param width = 60 mm min 20 max 200
param depth = 40 mm min 20 max 200
param thickness = 8 mm min 2 max 30
box width depth thickness
`;
    const publish = el("button", { class: "primary" }, t("Publish"));
    const errorSlot = el("div", {});
    const form = el("form", {}, el("div", { class: "field" }, el("label", {}, t("Title")), title), el("div", { class: "field" }, el("label", {}, t("Category")), category), el("div", { class: "field" }, el("label", {}, t("Visibility")), visGroup), el("div", { class: "field" }, el("label", {}, t("Source")), source), publish, errorSlot);
    form.addEventListener("submit", async (e) => {
        e.preventDefault();
        errorSlot.replaceChildren();
        publish.disabled = true;
        publish.classList.add("progress-line");
        try {
            const res = await fetch("/api/parts", {
                method: "POST",
                headers: { "content-type": "application/json", "Idempotency-Key": mintKey("publish") },
                body: JSON.stringify({ title: title.value, category: category.value, visibility, source: source.value }),
                credentials: "same-origin",
            });
            if (res.status === 201) {
                const body = await res.json();
                location.href = `/parts/${body.slug}`;
                return;
            }
            const body = await res.json();
            if (body.errors) {
                for (const [field, message] of Object.entries(body.errors)) {
                    const input = root.querySelector(`[aria-label="${field}"]`);
                    if (input) {
                        input.setAttribute("aria-invalid", "true");
                        input.parentElement?.append(el("div", { class: "field-error" }, t(message)));
                    }
                }
            }
            if (res.status === 503) {
                errorSlot.append(el("div", { class: "alert", role: "alert" }, t("Saving is paused: part storage is unreachable. Your parts are safe; try again in a few minutes.")));
            }
        }
        catch {
            errorSlot.append(el("div", { class: "alert", role: "alert" }, t("Not sent yet. Try again.")));
        }
        publish.disabled = false;
        publish.classList.remove("progress-line");
    });
    root.append(form);
}
/** The review room. */
export async function renderRoom(ctx, roomId) {
    const data = await api.room(roomId);
    const root = el("div", { class: "room-layout" });
    ctx.app.replaceChildren(root);
    const main = el("div", {});
    root.append(main);
    const room = data.room;
    main.append(el("h1", {}, t(room.title)));
    const stateText = room.state.charAt(0).toUpperCase() + room.state.slice(1);
    const stateLine = el("div", { class: "room-state-row" }, t(`Reviewing r${room.headRevisionId.slice(0, 0)}` || ""));
    stateLine.replaceChildren(el("span", { class: "muted" }, t(`Reviewing head`)), el("span", { class: "state-pill pill" }, t(stateText)), el("span", { class: "muted" }, t(`Approvals ${room.approvals.length} of ${room.requiredApprovals}`)));
    main.append(stateLine);
    // Viewport with comment pins
    const part = await api.part(room.partSlug);
    const viewportRoot = el("div", { "data-ui": "viewport", "data-eval-state": "settled", "data-epoch": "0", "data-viewer-id": "room" });
    viewportRoot.append(el("div", { class: "solid-glow" }));
    main.append(viewportRoot);
    let vp = new Viewport(viewportRoot, defaultPose([60, 40, 8]));
    const paintSolid = async () => {
        const res = await fetch(`/api/solids/${part.revision.geometryDigest}`, { credentials: "same-origin" });
        if (!res.ok)
            return;
        const solid = await res.json();
        vp?.setSolid(solid);
        viewportRoot.dataset.digest = part.revision.geometryDigest;
        bumpEpoch(viewportRoot, `tinework:epoch:part:${room.partSlug}`);
    };
    await paintSolid();
    const side = el("div", {});
    root.append(side);
    // Threads
    const threads = el("div", { class: "threads", role: "listbox", "aria-label": "Threads", tabindex: "0", "data-epoch": "0" });
    const selectedIdx = { value: -1 };
    const renderThreads = () => {
        threads.replaceChildren();
        data.comments.forEach((c, i) => {
            const opt = el("div", { role: "option", "aria-selected": String(selectedIdx.value === i), id: `thread-${i}` }, t(`${c.author.displayName}: ${c.body}`));
            threads.append(opt);
        });
        threads.setAttribute("aria-activedescendant", selectedIdx.value >= 0 ? `thread-${selectedIdx.value}` : "");
        if (data.comments.length > 0)
            bumpEpoch(threads, `tinework:epoch:threads:${roomId}`);
    };
    renderThreads();
    threads.addEventListener("keydown", (e) => {
        const ke = e;
        if (ke.key === "ArrowDown" && selectedIdx.value < data.comments.length - 1) {
            selectedIdx.value += 1;
            renderThreads();
            ke.preventDefault();
        }
        else if (ke.key === "ArrowUp" && selectedIdx.value > 0) {
            selectedIdx.value -= 1;
            renderThreads();
            ke.preventDefault();
        }
        else if ((ke.key === "Enter" || ke.key === " ") && selectedIdx.value >= 0) {
            const comment = data.comments[selectedIdx.value];
            const pose = comment.pose;
            if (pose?.position && pose.target) {
                vp?.glideTo({ position: pose.position, target: pose.target, up: [0, 0, 1], fov: pose.fov ?? 35 });
            }
            ke.preventDefault();
        }
    });
    threads.addEventListener("click", (e) => {
        const opt = e.target.closest('[role="option"]');
        if (!opt)
            return;
        const idx = Array.from(threads.querySelectorAll('[role="option"]')).indexOf(opt);
        selectedIdx.value = idx;
        renderThreads();
        const comment = data.comments[idx];
        const pose = comment.pose;
        if (pose?.position && pose.target) {
            vp?.glideTo({ position: pose.position, target: pose.target, up: [0, 0, 1], fov: pose.fov ?? 35 });
        }
    });
    side.append(el("h2", {}, t("Threads")), threads);
    // Approve / close
    const isOwner = ctx.me?.id === room.createdBy;
    const isReviewer = room.reviewers.some((r) => r.userId === ctx.me?.id);
    const actions = el("div", { class: "alert-actions" });
    if (isReviewer && room.state !== "closed") {
        const approveBtn = el("button", { class: "primary" }, t(`Approve head`));
        approveBtn.addEventListener("click", async () => {
            approveBtn.disabled = true;
            approveBtn.classList.add("progress-line");
            try {
                const roomJson = await api.approve(roomId, room.headRevisionId, mintKey("approve"));
                updateRoomState(roomJson);
                announce("room-activity", `Approvals ${roomJson.approvals.length} of ${roomJson.requiredApprovals}.`);
            }
            catch (err) {
                if (err instanceof ApiError)
                    announce("room-activity", err.message);
                approveBtn.disabled = false;
            }
            approveBtn.classList.remove("progress-line");
        });
        actions.append(approveBtn);
    }
    if (isOwner) {
        const closeBtn = el("button", {}, t("Close room"));
        closeBtn.addEventListener("click", async () => {
            try {
                const roomJson = await api.closeRoom(roomId);
                updateRoomState(roomJson);
            }
            catch { /* already closed */ }
        });
        actions.append(closeBtn);
    }
    side.append(actions);
    // Composer
    const composer = el("div", { class: "composer" });
    const commentBox = el("textarea", { "aria-label": "Comment" });
    const counter = el("div", { class: "counter-row" });
    const postBtn = el("button", { class: "primary" }, t("Post comment"));
    const addCommentBtn = el("button", { "aria-pressed": "false" }, t("Add comment"));
    const commentOnView = el("button", {}, t("Comment on this view"));
    const errorLine = el("div", { class: "comment-error", hidden: "" });
    let pendingAnchor = { kind: "none" };
    const updateCounter = () => {
        const len = [...new Intl.Segmenter("en", { granularity: "grapheme" }).segment(commentBox.value)].length;
        if (len > ctx.config.commentMaxChars) {
            counter.textContent = `${len - ctx.config.commentMaxChars} characters over`;
            postBtn.disabled = true;
        }
        else {
            counter.textContent = `${ctx.config.commentMaxChars - len} characters left`;
            postBtn.disabled = len === 0;
        }
    };
    updateCounter();
    commentBox.addEventListener("input", updateCounter);
    commentOnView.addEventListener("click", () => {
        pendingAnchor = { kind: "none" };
        commentBox.focus();
    });
    addCommentBtn.addEventListener("click", () => {
        const pressed = addCommentBtn.getAttribute("aria-pressed") === "true";
        addCommentBtn.setAttribute("aria-pressed", String(!pressed));
    });
    postBtn.addEventListener("click", async () => {
        errorLine.setAttribute("hidden", "");
        const pose = vp?.pose;
        // House rule H1: camera pose numbers sent in comments keep at most 3 decimals.
        const r3 = (n) => Math.round(n * 1000) / 1000;
        const poseJson = pose
            ? {
                position: pose.position.map(r3),
                target: pose.target.map(r3),
                up: pose.up.map(r3),
                fov: r3(pose.fov),
            }
            : {};
        postBtn.disabled = true;
        postBtn.classList.add("progress-line");
        try {
            const key = mintKey("comment");
            const posted = await api.postComment(roomId, commentBox.value, pendingAnchor, poseJson, key);
            data.comments.push(posted);
            renderThreads();
            commentBox.value = "";
            updateCounter();
            announce("room-activity", "");
        }
        catch (err) {
            if (err instanceof ApiError) {
                errorLine.textContent = err.message;
            }
            else {
                errorLine.textContent = "Not sent yet. Try again.";
            }
            errorLine.removeAttribute("hidden");
        }
        postBtn.classList.remove("progress-line");
        postBtn.disabled = false;
    });
    composer.append(addCommentBtn, commentOnView, commentBox, counter, errorLine, postBtn);
    side.append(composer);
    const updateRoomState = (roomJson) => {
        room.state = roomJson.state;
        room.approvals = roomJson.approvals;
        stateLine.replaceChildren(el("span", { class: "muted" }, t("Reviewing head")), el("span", { class: "state-pill pill" }, t(roomJson.state.charAt(0).toUpperCase() + roomJson.state.slice(1))), el("span", { class: "muted" }, t(`Approvals ${roomJson.approvals.length} of ${roomJson.requiredApprovals}`)));
    };
    // Live room events
    openEventStream(room.partSlug, (event) => {
        if (event.type === "comment") {
            const comment = event.data.comment;
            if (comment.roomId === roomId && !data.comments.some((c) => c.id === comment.id)) {
                data.comments.push(comment);
                selectedIdx.value = data.comments.length - 1;
                renderThreads();
                announce("room-activity", `New comment from ${comment.author.displayName}.`);
            }
        }
        else if (event.type === "approvals") {
            const payload = event.data;
            if (payload.room.id === roomId) {
                updateRoomState(payload.room);
                if (payload.reason === "reset")
                    announce("room-activity", `Approvals reset: ${payload.label} changed the part.`);
                else if (payload.reason === "carried")
                    announce("room-activity", `${payload.label} has the same geometry; approvals carried over.`);
                else if (payload.reason === "matched")
                    announce("room-activity", `${payload.label} matches approved geometry; approvals count again.`);
                else if (payload.reason === "approved")
                    announce("room-activity", `${payload.displayName} approved ${payload.label}.`);
            }
        }
        else if (event.type === "revision") {
            announce("room-activity", "The head revision changed.");
        }
    });
}
/** Compare two revisions. */
export async function renderCompare(ctx, slug, params) {
    const revisions = await api.revisions(slug);
    const head = revisions.revisions[0];
    const defaultBase = revisions.revisions.find((r) => r.id === head.parentRevisionId) ?? revisions.revisions[revisions.revisions.length - 1];
    let baseId = params.get("base") ?? defaultBase.id;
    let headId = params.get("head") ?? head.id;
    if (!revisions.revisions.some((r) => r.id === baseId))
        baseId = defaultBase.id;
    if (!revisions.revisions.some((r) => r.id === headId))
        headId = head.id;
    let view = "overlay";
    const viewParam = params.get("view");
    if (viewParam === "added" || viewParam === "removed" || viewParam === "swipe")
        view = viewParam;
    let selectedHunk = null;
    const root = el("div", { class: "compare-layout" });
    ctx.app.replaceChildren(root);
    const baseRev = revisions.revisions.find((r) => r.id === baseId);
    const headRev = revisions.revisions.find((r) => r.id === headId);
    root.append(el("h1", {}, t(`Compare ${baseRev.label} and ${headRev.label}`)));
    const menus = el("div", { class: "compare-menus" });
    const baseSelect = el("select", { "aria-label": "Base revision" });
    const headSelect = el("select", { "aria-label": "Head revision" });
    for (const rev of [...revisions.revisions].reverse()) {
        const o = el("option", { value: rev.id });
        o.textContent = `${rev.label} \u00b7 ${rev.message}`;
        baseSelect.append(o);
    }
    for (const rev of [...revisions.revisions].reverse()) {
        const o = el("option", { value: rev.id });
        o.textContent = `${rev.label} \u00b7 ${rev.message}`;
        headSelect.append(o);
    }
    baseSelect.value = baseId;
    headSelect.value = headId;
    menus.append(baseSelect, headSelect);
    root.append(menus);
    const viewGroup = el("div", { class: "radiogroup", role: "radiogroup", "aria-label": "View" });
    for (const v of ["overlay", "added", "removed", "swipe"]) {
        const rb = el("button", { role: "radio", "aria-checked": String(view === v) }, t(v.charAt(0).toUpperCase() + v.slice(1)));
        rb.addEventListener("click", () => {
            view = v;
            for (const other of Array.from(viewGroup.children))
                other.setAttribute("aria-checked", String(other === rb));
            replaceAddress();
        });
        viewGroup.append(rb);
    }
    menus.append(viewGroup);
    const cols = el("div", { class: "compare-cols" });
    const main = el("div", {});
    const side = el("div", { class: "compare-col" });
    cols.append(main, side);
    root.append(cols);
    const viewportRoot = el("div", { "data-ui": "viewport", "data-eval-state": "settled", "data-epoch": "0" });
    viewportRoot.append(el("div", { class: "solid-glow" }));
    main.append(viewportRoot);
    const vp = new Viewport(viewportRoot, defaultPose([60, 40, 8]));
    const volumeRegion = el("section", { class: "volume-summary", role: "region", "aria-label": "Volume change" });
    const hunksList = el("ul", { class: "hunks-list", "aria-label": "Hunks" });
    const changesList = el("ul", { class: "changes-list", "aria-label": "Parameter changes" });
    side.append(el("h3", {}, t("Volume change")), volumeRegion, el("h3", {}, t("Hunks")), hunksList, el("h3", {}, t("Parameter changes")), changesList);
    let result = null;
    const load = async () => {
        try {
            result = await api.compare(baseId, headId);
        }
        catch {
            return;
        }
        paint();
    };
    const paint = () => {
        if (!result)
            return;
        if (result.identical) {
            volumeRegion.replaceChildren(t("No geometric change: both revisions evaluate to the same solid."));
        }
        else {
            volumeRegion.replaceChildren(el("div", {}, t(`Added ${formatFixed(result.added, 2)}\u202Fmm\u00b3`)), el("div", {}, t(`Removed ${formatFixed(result.removed, 2)}\u202Fmm\u00b3`)), el("div", {}, t(`Unchanged ${formatFixed(result.unchanged, 2)}\u202Fmm\u00b3`)));
        }
        hunksList.replaceChildren();
        for (const hunk of result.hunks) {
            const btn = el("button", {}, t(`Hunk ${hunk.index} of ${result.hunks.length} \u00b7 ${hunk.kind.charAt(0).toUpperCase() + hunk.kind.slice(1)} \u00b7 ${formatFixed(hunk.volume, 2)}\u202Fmm\u00b3`));
            if (selectedHunk === hunk.index)
                btn.setAttribute("aria-current", "true");
            btn.addEventListener("click", () => {
                selectedHunk = hunk.index;
                replaceAddress();
                paint();
                glideToHunk(hunk);
            });
            hunksList.append(btn);
        }
        changesList.replaceChildren();
        for (const change of result.parameterChanges) {
            changesList.append(el("li", {}, t(`${change.label}: ${String(change.base)} \u2192 ${String(change.head)} ${change.unit}`)));
        }
        // Paint the head solid (overlay view) or added/removed ghosting.
        void fetch(`/api/solids/${headRev.geometryDigest}`, { credentials: "same-origin" })
            .then((r) => (r.ok ? r.json() : null))
            .then((solid) => {
            if (solid)
                vp.setSolid(solid);
        });
        bumpEpoch(viewportRoot, `tinework:epoch:compare:${slug}`);
    };
    const glideToHunk = (hunk) => {
        const diag = Math.hypot(hunk.box.max[0] - hunk.box.min[0], hunk.box.max[1] - hunk.box.min[1], hunk.box.max[2] - hunk.box.min[2]);
        const d = Math.max(40, 2.5 * diag);
        const k = d / Math.sqrt(3);
        const cx = (hunk.box.min[0] + hunk.box.max[0]) / 2;
        const cy = (hunk.box.min[1] + hunk.box.max[1]) / 2;
        const cz = (hunk.box.min[2] + hunk.box.max[2]) / 2;
        vp.glideTo({ position: [cx + k, cy - k, cz + k], target: [cx, cy, cz], up: [0, 0, 1], fov: 35 });
    };
    const replaceAddress = () => {
        const p = new URLSearchParams({ base: baseId, head: headId, view });
        if (selectedHunk !== null)
            p.set("hunk", String(selectedHunk));
        history.replaceState(null, "", `${location.pathname}?${p.toString()}`);
    };
    baseSelect.addEventListener("change", () => {
        baseId = baseSelect.value;
        selectedHunk = null;
        history.pushState(null, "", `${location.pathname}?${new URLSearchParams({ base: baseId, head: headId, view })}`);
        void load();
    });
    headSelect.addEventListener("change", () => {
        headId = headSelect.value;
        selectedHunk = null;
        history.pushState(null, "", `${location.pathname}?${new URLSearchParams({ base: baseId, head: headId, view })}`);
        void load();
    });
    // J and K walk hunks from any non-text control.
    window.addEventListener("keydown", (e) => {
        const ke = e;
        if (ke.isComposing)
            return;
        const target = ke.target;
        if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)
            return;
        if (!result || result.hunks.length === 0)
            return;
        if (ke.key === "j" || ke.key === "J") {
            const next = selectedHunk === null ? 1 : Math.min(result.hunks.length, selectedHunk + 1);
            selectedHunk = next;
            replaceAddress();
            paint();
            const hunk = result.hunks.find((hh) => hh.index === next);
            if (hunk)
                glideToHunk(hunk);
        }
        else if (ke.key === "k" || ke.key === "K") {
            if (selectedHunk !== null && selectedHunk > 1) {
                selectedHunk -= 1;
                replaceAddress();
                paint();
                const hunk = result.hunks.find((hh) => hh.index === selectedHunk);
                if (hunk)
                    glideToHunk(hunk);
            }
        }
    });
    // The address's hunk decides the starting selection; then it is removed.
    const hunkParam = params.get("hunk");
    if (hunkParam && /^\d+$/.test(hunkParam)) {
        const k = Number(hunkParam);
        if (k >= 1)
            selectedHunk = k;
    }
    await load();
    const current = result;
    if (selectedHunk !== null && current && !current.hunks.some((hh) => hh.index === selectedHunk)) {
        selectedHunk = null;
    }
    paint();
    if (params.has("hunk")) {
        replaceAddress();
    }
    // Live revisions arrive in both menus.
    openEventStream(slug, (event) => {
        if (event.type === "revision") {
            const rev = event.data.revision;
            for (const select of [baseSelect, headSelect]) {
                const o = el("option", { value: rev.id });
                o.textContent = `${rev.label} \u00b7 ${rev.message ?? ""}`;
                select.append(o);
            }
            announce("part-activity", `New revision ${rev.label}.`);
        }
    });
}
/** The build tape page: viewport, tape, readout and source pane. */
export async function renderTape(ctx, revisionId) {
    const tape = await api.tape(revisionId);
    const part = await api.part(tape.partSlug);
    const root = el("div", {});
    ctx.app.replaceChildren(root);
    root.append(el("h1", {}, t(`${part.title} \u00b7 r? build tape`.replace("r?", part.revision.label))));
    // Viewport
    const viewportRoot = el("div", { "data-ui": "viewport", "data-eval-state": "settled", "data-epoch": "0", "data-viewer-id": "tape" });
    viewportRoot.append(el("div", { class: "solid-glow" }));
    root.append(viewportRoot);
    let vp = new Viewport(viewportRoot, defaultPose([60, 40, 8]));
    const solidCache = new Map();
    const drawAt = async (k) => {
        const op = tape.operations[k];
        if (!op)
            return;
        if (!solidCache.has(op.digest)) {
            const res = await fetch(`/api/solids/${op.digest}`, { credentials: "same-origin" });
            if (res.ok)
                solidCache.set(op.digest, await res.json());
        }
        const solid = solidCache.get(op.digest);
        if (solid && vp) {
            vp.setSolid(solid);
            viewportRoot.dataset.digest = op.digest;
            viewportRoot.dataset.volume = formatFixed(op.volume, 2);
            viewportRoot.dataset.bbox = op.bbox.join(",");
            viewportRoot.dataset.tapeOperation = String(k);
            bumpEpoch(viewportRoot, `tinework:epoch:tape:${revisionId}`);
        }
    };
    // Tape slider
    const slider = el("div", { class: "tape", role: "slider", "aria-label": "Build tape", tabindex: "0", "aria-valuemin": "0", "aria-valuemax": String(tape.n), "aria-valuenow": String(tape.n) });
    const readout = el("div", { "data-ui": "tape-readout" });
    const track = el("div", { class: "tape-track" });
    track.style.position = "absolute";
    track.style.inset = "8px 0";
    for (let i = 0; i <= tape.n; i++) {
        const tick = el("div", { class: "tick" });
        tick.style.left = `${(i / tape.n) * 100}%`;
        track.append(tick);
    }
    const playhead = el("div", { class: "playhead" });
    playhead.style.left = "100%";
    track.append(playhead);
    slider.append(track);
    root.append(el("div", { class: "build-tape" }, slider, readout));
    const readoutText = (k) => {
        const op = tape.operations[k];
        if (!op)
            return "";
        if (op.kind === "start")
            return `Operation 0 of ${tape.n} \u00b7 empty`;
        if (op.kind === "params")
            return `Operation ${k} of ${tape.n} \u00b7 ${op.op}`;
        const change = op.delta / 1000;
        const sign = change > 0 ? "+" : change < 0 ? "\u2212" : "\u00b1";
        return `Operation ${k} of ${tape.n} \u00b7 ${op.op} \u00b7 ${sign}${formatNumber(Math.abs(change), 2, { exact: true })} cm\u00b3`;
    };
    const moveTo = async (k) => {
        if (forkBtn)
            forkBtn.textContent = `Fork from operation ${k}`;
        slider.setAttribute("aria-valuenow", String(k));
        slider.setAttribute("aria-valuetext", `Operation ${k} of ${tape.n} \u00b7 ${tape.operations[k]?.kind ?? "start"} \u00b7 ${tape.operations[k]?.op ?? "empty"}`);
        playhead.style.left = `${(k / Math.max(1, tape.n)) * 100}%`;
        readout.textContent = readoutText(k);
        document.querySelectorAll(".source-line[aria-current]").forEach((n) => n.removeAttribute("aria-current"));
        const line = opLine.get(k);
        if (line) {
            line.setAttribute("aria-current", "true");
            line.scrollIntoView({ block: "nearest" });
        }
        await drawAt(k);
    };
    // Keyboard: Left/Right one op; Shift jumps geometry; Home/End ends; Enter forks (owner).
    slider.addEventListener("keydown", (e) => {
        const ke = e;
        if (ke.isComposing)
            return;
        const current = Number(slider.getAttribute("aria-valuenow"));
        if (ke.key === "ArrowRight" || ke.key === "ArrowUp") {
            void moveTo(Math.min(tape.n, current + 1));
            ke.preventDefault();
        }
        else if (ke.key === "ArrowLeft" || ke.key === "ArrowDown") {
            void moveTo(Math.max(0, current - 1));
            ke.preventDefault();
        }
        else if (ke.key === "Home") {
            void moveTo(0);
            ke.preventDefault();
        }
        else if (ke.key === "End") {
            void moveTo(tape.n);
            ke.preventDefault();
        }
        else if (ke.shiftKey && (ke.key === "ArrowRight" || ke.key === "ArrowLeft")) {
            const geometry = tape.operations.map((o, i) => o.kind === "body" || o.kind === "cut" || o.kind === "join" ? i : -1).filter((i) => i >= 0);
            const next = ke.key === "ArrowRight" ? geometry.find((g) => g > current) : [...geometry].reverse().find((g) => g < current);
            if (next !== undefined)
                void moveTo(next);
            ke.preventDefault();
        }
    });
    // Drag by pointer: the playhead follows tick by tick and settles on release.
    let dragging = false;
    let startTick = tape.n;
    slider.addEventListener("pointerdown", (e) => {
        dragging = true;
        startTick = Number(slider.getAttribute("aria-valuenow"));
        slider.setPointerCapture(e.pointerId);
        slider.dataset.settling = "true";
    });
    slider.addEventListener("pointermove", (e) => {
        if (!dragging)
            return;
        const rect = slider.getBoundingClientRect();
        const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        void moveTo(Math.round(ratio * tape.n));
    });
    const endDrag = () => {
        dragging = false;
        slider.dataset.settling = "false";
    };
    slider.addEventListener("pointerup", endDrag);
    slider.addEventListener("pointercancel", () => {
        dragging = false;
        void moveTo(startTick);
    });
    // Source pane
    const sourceLines = part.source.split("\n");
    const sourcePane = el("div", { class: "source-pane" });
    const opLine = new Map();
    tape.operations.forEach((op) => {
        if (op.line !== null)
            opLine.set(op.index, op.index);
    });
    sourceLines.forEach((line, i) => {
        const row = el("div", { class: "source-line", "data-line": String(i + 1) });
        row.append(el("span", { class: "line-no" }, t(String(i + 1))), t(line || " "));
        sourcePane.append(row);
    });
    root.append(sourcePane);
    for (const [k, op] of tape.operations.entries()) {
        if (op.line !== null)
            opLine.set(k, sourcePane.children[op.line - 1]);
    }
    // The owner's fork control, following the playhead.
    const isOwner = ctx.me?.id === part.owner.id;
    let forkBtn = null;
    if (isOwner) {
        forkBtn = el("button", {}, t(`Fork from operation ${tape.n}`));
        forkBtn.addEventListener("click", () => {
            const op = Number(slider.getAttribute("aria-valuenow"));
            const dlg = openDialog(`Fork from operation ${op}?`, (close) => {
                const fork = el("button", { class: "primary" }, t("Fork"));
                const cancel = el("button", {}, t("Cancel"));
                const note = el("p", { class: "dialog-note" }, t(`The new revision keeps operations 0 to ${op} and drops the rest.`));
                fork.addEventListener("click", async () => {
                    fork.disabled = true;
                    fork.classList.add("progress-line");
                    try {
                        const etag = await fetch(`/api/parts/${part.slug}`, { credentials: "same-origin" }).then((r) => r.headers.get("etag"));
                        const res = await fetch(`/api/revisions/${revisionId}/fork`, {
                            method: "POST",
                            headers: { "content-type": "application/json", "If-Match": etag ?? "", "Idempotency-Key": mintKey("fork") },
                            body: JSON.stringify({ operation: op }),
                            credentials: "same-origin",
                        });
                        if (res.status === 201) {
                            const body = await res.json();
                            close();
                            location.href = `/parts/${part.slug}?revision=${body.id}&operation=${op}`;
                        }
                        else {
                            fork.disabled = false;
                            fork.classList.remove("progress-line");
                        }
                    }
                    catch {
                        note.textContent = "Not sent yet. Try again.";
                        fork.disabled = false;
                        fork.classList.remove("progress-line");
                    }
                });
                cancel.addEventListener("click", close);
                return el("div", {}, note, el("div", { class: "dialog-actions" }, cancel, fork));
            });
            void dlg;
        });
        root.append(forkBtn);
    }
    await moveTo(tape.n);
}
