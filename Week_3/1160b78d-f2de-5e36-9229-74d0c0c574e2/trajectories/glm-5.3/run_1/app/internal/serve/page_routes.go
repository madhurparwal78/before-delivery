package serve

import (
	"context"
	"fmt"
	"html/template"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"switchlamp/internal/copytext"
	"switchlamp/internal/domain"
	"switchlamp/internal/store"
)

// statusWord maps an incident status to its published word.
func statusWord(status string) string {
	switch status {
	case domain.StatusTriggered:
		return "Triggered"
	case domain.StatusAcknowledged:
		return "Acknowledged"
	case domain.StatusSnoozed:
		return "Snoozed"
	case domain.StatusResolved:
		return "Resolved"
	}
	return status
}

func stepWord(st domain.Step) string {
	switch st.Status {
	case domain.StepScheduled:
		return "Scheduled"
	case domain.StepSent:
		return "Sent"
	case domain.StepCancelled:
		return "Cancelled"
	case domain.StepQueued:
		return "Queued"
	case domain.StepHeld:
		return "Held"
	}
	return st.Status
}

func deliveryWord(status string) string {
	switch status {
	case domain.DeliveryPending:
		return "Pending"
	case domain.DeliveryRetrying:
		return "Retrying"
	case domain.DeliveryDelivered:
		return "Delivered"
	case domain.DeliveryRejected:
		return "Rejected"
	case domain.DeliveryFailed:
		return "Failed"
	}
	return status
}

// localTimeText renders YYYY-MM-DD HH:MM ZZZ in a zone.
func localTimeText(t time.Time, zone string) string { return domain.LocalTime(t, zone) }

// statusClass turns a word into a tone class.
func statusClass(word string) string {
	w := strings.ToLower(strings.ReplaceAll(word, " ", "-"))
	return "word word-" + w
}

// pageRoutes registers the page handlers.
func (s *Server) pageRoutes(m *http.ServeMux) {
	m.HandleFunc("GET /", s.handleRootRedirect)
	m.HandleFunc("GET /sign-in", s.handleSignInPage)
	m.HandleFunc("GET /status", s.handleStatusPage)
	m.HandleFunc("GET /status/unsubscribe/{token}", s.handleUnsubscribePage)
	m.HandleFunc("GET /oncall", s.require("", s.handleOncallPage))
	m.HandleFunc("GET /incidents", s.require("responder", s.handleIncidentsPage))
	m.HandleFunc("GET /incidents/{id}", s.require("responder", s.handleIncidentPage))
	m.HandleFunc("GET /schedules", s.require("responder", s.handleSchedulesPage))
	m.HandleFunc("GET /schedules/{id}", s.require("responder", s.handleSchedulePage))
	m.HandleFunc("GET /policies", s.require("responder", s.handlePoliciesPage))
	m.HandleFunc("GET /policies/{id}", s.require("responder", s.handlePolicyPage))
	m.HandleFunc("GET /services", s.require("responder", s.handleServicesPage))
	m.HandleFunc("GET /services/{id}", s.require("responder", s.handleServicePage))
	m.HandleFunc("GET /integrations", s.require("responder", s.handleIntegrationsPage))
	m.HandleFunc("GET /integrations/{id}", s.require("responder", s.handleIntegrationPage))
	m.HandleFunc("GET /webhooks", s.require("admin", s.handleWebhooksPage))
	m.HandleFunc("GET /webhooks/{id}", s.require("admin", s.handleWebhookPage))
	m.HandleFunc("GET /status-desk", s.require("lead", s.handleStatusDeskPage))
	m.HandleFunc("GET /analytics", s.require("responder", s.handleAnalyticsPage))
	m.HandleFunc("GET /maintenance", s.require("admin", s.handleMaintenancePage))
	m.HandleFunc("GET /admin", s.require("admin", s.handleAdminPage))
	m.HandleFunc("GET /me", s.require("", s.handleMePage))
}

func (s *Server) handleRootRedirect(w http.ResponseWriter, r *http.Request) {
	http.Redirect(w, r, "/oncall", http.StatusSeeOther)
}

// shellFrame renders the nav, the live region and the footer around body HTML.
func (s *Server) shellFrame(w http.ResponseWriter, r *http.Request, u *SessionUser, active string, body string) {
	navLinks := []struct{ href, label string }{
		{"/oncall", "On call"}, {"/incidents", "Incidents"}, {"/schedules", "Schedules"},
		{"/policies", "Policies"}, {"/services", "Services"}, {"/integrations", "Integrations"},
	}
	if u != nil && roleAtLeast(u.Role, "admin") {
		navLinks = append(navLinks,
			struct{ href, label string }{"/webhooks", "Webhooks"},
			struct{ href, label string }{"/status-desk", "Status desk"},
			struct{ href, label string }{"/analytics", "Analytics"},
			struct{ href, label string }{"/maintenance", "Maintenance"},
			struct{ href, label string }{"/admin", "Admin"})
	} else if u != nil && roleAtLeast(u.Role, "lead") {
		navLinks = append(navLinks,
			struct{ href, label string }{"/status-desk", "Status desk"},
			struct{ href, label string }{"/analytics", "Analytics"})
	}
	links := ""
	for _, l := range navLinks {
		current := ""
		if l.href == active {
			current = ` aria-current="page"`
		}
		links += fmt.Sprintf(`<a href="%s"%s>%s</a>`, l.href, current, l.label)
	}
	signOut := ""
	zone := "America/Chicago"
	if u != nil {
		signOut = `<form method="post" action="/api/session" data-api-delete class="inline"><button type="submit">Sign out</button></form>`
		zone = u.Timezone
	}
	html := `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Switchlamp</title>
<link rel="stylesheet" href="/static/css/switchlamp.css">
</head><body data-zone="` + zone + `">
<nav class="main-nav" aria-label="Main">` + links + `<span class="spacer"></span>` + signOut + `</nav>
<div id="live" role="status" aria-live="polite" aria-label="Live updates" class="visually-hidden"></div>
<div id="notices" role="status" aria-live="polite" aria-label="Notices for you" class="visually-hidden"></div>
<div id="problems" role="alert" aria-label="Problems to fix" class="visually-hidden"></div>
<main class="work">` + body + `</main>
<footer aria-label="Switchlamp"></footer>
<script src="/static/js/app.js" defer></script>
</body></html>`
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	// Pages holding signed-in data are not cached by the browser.
	w.Header().Set("Cache-Control", "no-store")
	fmt.Fprint(w, html)
}

func (s *Server) handleSignInPage(w http.ResponseWriter, r *http.Request) {
	if u, err := s.auth(r); err == nil && u != nil && u.Role != "stakeholder" {
		http.Redirect(w, r, "/oncall", http.StatusSeeOther)
		return
	}
	plate := "dusk"
	html := `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Switchlamp</title>
<link rel="stylesheet" href="/static/css/switchlamp.css">
</head><body>
<div class="plate-frame" data-plate="` + plate + `">
<img id="plate-desktop" src="/static/img/plate-` + plate + `.png" alt="Freight yard at dusk">
</div>
<div class="entry-band">
<h1 class="entry-name">Switchlamp</h1>
</div>
<main class="signin-frame">
<form id="signin" method="post" action="/api/session">
<h2>Switchlamp</h2>
<div class="field"><label for="email">Email</label><input id="email" name="email" type="email" autocomplete="username"></div>
<div class="field"><label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password"></div>
<button type="submit">Sign in</button>
<p><a href="/status">Status page</a></p>
</form>
</main>
<div id="problems" role="alert" aria-label="Problems to fix" class="visually-hidden"></div>
<script src="/static/js/app.js" defer></script>
</body></html>`
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	fmt.Fprint(w, html)
}

func (s *Server) handleStatusPage(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	body := s.buildStatus(ctx)
	headline, _ := body["headline"].(string)
	plate, _ := body["plate"].(string)
	services, _ := body["services"].([]map[string]any)
	updates, _ := body["updates"].([]map[string]any)
	maintenance, _ := body["maintenance"].([]map[string]any)

	svcList := ""
	for _, svc := range services {
		name, _ := svc["name"].(string)
		status, _ := svc["status"].(string)
		svcList += fmt.Sprintf(`<li>%s <span class="%s">%s</span></li>`, template.HTMLEscapeString(name), statusClass(status), status)
	}
	banners := ""
	for _, m := range maintenance {
		name, _ := m["service"].(string)
		endsAt, _ := m["ends_at"].(string)
		until := ""
		if t, err := time.Parse(time.RFC3339, endsAt); err == nil {
			until = domain.FirmLocal(t)
		}
		banners += fmt.Sprintf(`<p class="notice-bar" role="status" aria-label="Maintenance banner">Maintenance on %s until %s</p>`,
			template.HTMLEscapeString(name), template.HTMLEscapeString(until))
	}
	updList := ""
	for _, u := range updates {
		title, _ := u["title"].(string)
		state, _ := u["state"].(string)
		ubody, _ := u["body"].(string)
		published, _ := u["published_at"].(string)
		updList += fmt.Sprintf(`<li><h3>%s</h3><p class="word">%s</p><p>%s</p><p class="hint">%s</p></li>`,
			template.HTMLEscapeString(title), template.HTMLEscapeString(state), template.HTMLEscapeString(ubody), template.HTMLEscapeString(published))
	}
	if updList == "" {
		updList = `<li class="empty">` + copytext.EmptyUpdates + `</li>`
	}
	slowerBar := ""
	if slower, _ := body["slower"].(bool); slower {
		slowerBar = `<p class="notice-bar">` + copytext.ValkeyNotice + `</p>`
	}
	html := `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Tarecross Software status</title>
<link rel="stylesheet" href="/static/css/switchlamp.css">
</head><body data-page="status">
<div class="plate-frame" data-plate="` + plate + `">
<img src="/static/img/plate-` + plate + `.png" alt="Freight yard at ` + map[bool]string{true: "night", false: "dusk"}[plate == "night"] + `">
</div>
<div class="entry-band">
<h1 class="entry-name">Tarecross Software</h1>
<p class="status-headline" role="status" aria-label="Current status">` + headline + `</p>
</div>
<main class="signin-frame">` + slowerBar + banners + `
<section class="status-section"><h2>Services</h2><ul id="services" aria-label="Services">` + svcList + `</ul></section>
<section class="status-section"><h2>Updates</h2><ul id="updates" aria-label="Status updates">` + updList + `</ul></section>
<form id="subscribe" method="post" action="/api/status/subscribers">
<div class="field"><label for="sub-email">Email for updates</label><input id="sub-email" name="email" type="email"></div>
<button type="submit">Subscribe</button>
</form>
</main>
<script src="/static/js/app.js" defer></script>
</body></html>`
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	fmt.Fprint(w, html)
}

func (s *Server) handleUnsubscribePage(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	token := r.PathValue("token")
	var id string
	err := s.store.Pool().QueryRow(ctx, `SELECT id FROM subscribers WHERE token = $1`, token).Scan(&id)
	if err != nil {
		// The page shape holds a sentence and a link back.
		html := `<main class="signin-frame"><p>That link is not valid.</p><p><a href="/status">Back to the status page</a></p></main>`
		fmt.Fprint(w, html)
		return
	}
	s.store.Pool().Exec(ctx, `DELETE FROM subscribers WHERE id = $1`, id)
	fmt.Fprint(w, `<main class="signin-frame"><p>You will get no more status updates.</p><p><a href="/status">Back to the status page</a></p></main>`)
}

func (s *Server) handleOncallPage(w http.ResponseWriter, r *http.Request, u *SessionUser) {
	ctx := r.Context()
	schedules, _ := s.store.Schedules(ctx)
	now := s.engine.Now()
	first := ""
	rows := ""
	for _, sc := range schedules {
		holder, _ := s.scheduleHolderFor(ctx, sc.ID, now)
		name := "Nobody"
		if holder != nil {
			name = holder.Name
		}
		if first == "" {
			first = name
		}
		rows += fmt.Sprintf(`<div class="row">%s — %s</div>`, template.HTMLEscapeString(sc.Name), template.HTMLEscapeString(name))
	}
	body := `<figure id="oncall-figure">` + template.HTMLEscapeString(first) + `<small id="handoff-countdown" role="timer" aria-label="Handoff countdown">--:--</small></figure>
<section aria-label="On call now" id="oncall-now" class="row-list">` + rows + `</section>`
	s.shellFrame(w, r, u, "/oncall", body)
}

func (s *Server) handleIncidentsPage(w http.ResponseWriter, r *http.Request, u *SessionUser) {
	ctx := r.Context()
	services, _ := s.store.Services(ctx)
	filter := `<select id="status-filter" aria-label="Status filter">
<option>Open</option><option>Triggered</option><option>Acknowledged</option><option>Snoozed</option><option>Resolved</option><option>All</option>
</select>
<select id="service-filter" aria-label="Service filter"><option>All services</option>`
	for _, sv := range services {
		filter += fmt.Sprintf(`<option value="%s">%s</option>`, sv.ID, template.HTMLEscapeString(sv.Name))
	}
	filter += `</select>`
	body := `<figure id="incident-total" role="status" aria-label="Incident total">0</figure>
<div class="filters">` + filter + `
<input id="filter-name" aria-label="Filter name" type="text" placeholder="Filter name">
<button id="save-filter" type="button">Save filter</button>
<ul id="saved-filters" aria-label="Saved filters"></ul>
</div>
<p id="empty" class="empty" hidden>Nothing is open.</p>
<table class="incidents" aria-label="Incidents" id="incident-table">
<thead><tr><th class="col-num">#</th><th>Title</th><th>Service</th><th>Status</th><th>Holder</th><th>Opened</th><th></th></tr></thead>
<tbody id="incident-rows"></tbody>
</table>
<div class="paging">
<button id="older" type="button">Older incidents</button>
<button id="newer" type="button">Newer incidents</button>
<button id="show-new" type="button" hidden>Show <span id="new-count">0</span> new incidents</button>
</div>
<div id="bulk-results" role="region" aria-label="Bulk results"></div>
<div class="phone-bar" id="list-actions" role="toolbar" aria-label="List actions" hidden>
<button id="bulk-ack" type="button">Acknowledge selected</button>
<button id="bulk-resolve" type="button">Resolve selected</button>
<button id="first-incident" type="button">First incident</button>
<button id="last-incident" type="button">Last incident</button>
</div>`
	s.shellFrame(w, r, u, "/incidents", body)
}

func (s *Server) handleIncidentPage(w http.ResponseWriter, r *http.Request, u *SessionUser) {
	ctx := r.Context()
	inc, err := s.store.Incident(ctx, r.PathValue("id"))
	if err != nil {
		s.notFoundPage(w, r, u)
		return
	}
	_ = s.engine.ApplyDue(ctx, s.engine.Now())
	inc, _ = s.store.Incident(ctx, inc.ID)
	now := s.engine.Now()
	countdown := countdownFor(ctx, s, inc, now)
	holders := domain.HolderNames(inc.Holders)
	countdownText := "--:--"
	if countdown.DueAt != nil {
		countdownText = formatCountdown(*countdown.DueAt, now)
	}
	label := countdownLabel(countdown.Kind)
	leadExtras := ""
	if roleAtLeast(u.Role, "lead") {
		leadExtras = `<button id="merge-btn" type="button">Merge</button>
<dialog id="merge-dialog" aria-label="Merge incidents">
<form id="merge-form"><div class="field"><label for="merge-ids">Incident numbers</label><input id="merge-ids" name="ids"></div>
<button type="submit">Merge incidents</button><button type="button" data-close>Cancel</button></form></dialog>`
		for _, a := range inc.Alerts {
			leadExtras += fmt.Sprintf(`<button class="split-btn" data-alert="%s" type="button">Split off</button>`, a.ID)
		}
	}
	people, _ := s.store.Users(ctx)
	responderOptions := `<option>Not chosen</option>`
	for _, p := range people {
		if p.Role == "stakeholder" {
			continue
		}
		responderOptions += fmt.Sprintf(`<option value="%s">%s</option>`, p.ID, template.HTMLEscapeString(p.Name))
	}
	services, _ := s.store.Services(ctx)
	serviceOptions := `<option>Not chosen</option>`
	for _, sv := range services {
		serviceOptions += fmt.Sprintf(`<option value="%s">%s</option>`, sv.ID, template.HTMLEscapeString(sv.Name))
	}
	body := `<section class="holder-field" aria-label="Holder" data-level="` + strconv.Itoa(inc.Level) + `" data-cycle="` + strconv.Itoa(inc.Cycle) + `" data-holder="` + template.HTMLEscapeString(holders) + `" data-remaining-seconds="` + strconv.FormatInt(countdown.RemainingSeconds, 10) + `">
<p>` + label + `</p>
<p class="holder-name" id="holder-name">` + template.HTMLEscapeString(holders) + `</p>
<p id="incident-countdown" role="timer" aria-label="Incident countdown" class="timer">` + countdownText + `</p>
</section>
<div class="toolbar" role="toolbar" aria-label="Incident actions">
<button id="ack-btn" type="button">Acknowledge</button>
<button id="snooze-btn" type="button">Snooze</button>
<button id="resolve-btn" type="button">Resolve</button>
<button id="reassign-btn" type="button">Reassign</button>` + leadExtras + `
</div>
<dialog id="snooze-dialog" aria-label="Snooze incident">
<form id="snooze-form">
<div class="field"><input type="radio" id="sn-1" name="preset" value="1"><label for="sn-1">1 hour</label></div>
<div class="field"><input type="radio" id="sn-4" name="preset" value="4"><label for="sn-4">4 hours</label></div>
<div class="field"><input type="radio" id="sn-8" name="preset" value="8"><label for="sn-8">8 hours</label></div>
<div class="field"><input type="radio" id="sn-24" name="preset" value="24"><label for="sn-24">24 hours</label></div>
<div class="field"><input type="radio" id="sn-custom" name="preset" value="custom"><label for="sn-custom">Custom time</label></div>
<div class="field"><label for="snooze-until">Snooze until</label><input id="snooze-until" name="until" type="text"></div>
<button type="submit">Snooze incident</button><button type="button" data-close>Cancel</button>
</form></dialog>
<dialog id="reassign-dialog" aria-label="Reassign incident">
<form id="reassign-form">
<div class="field"><label for="reassign-person">Person</label><select id="reassign-person">` + responderOptions + `</select></div>
<div class="field"><label for="reassign-service">Service</label><select id="reassign-service">` + serviceOptions + `</select></div>
<button type="submit">Reassign incident</button><button type="button" data-close>Cancel</button>
</form></dialog>
<h3>Alerts</h3>
<ul id="alerts" aria-label="Alerts">` + alertsHTML(inc) + `</ul>
<h3>Notification steps</h3>
<ul id="steps" aria-label="Notification steps">` + stepsHTML(inc) + `</ul>
<h3>Opened-with policy</h3>
<section id="policy-snapshot" aria-label="Opened-with policy"><p>` + template.HTMLEscapeString(inc.PolicySnapshot.Name) + ` version ` + strconv.Itoa(inc.PolicySnapshot.Version) + `</p></section>
<h3>Timeline</h3>
<ul id="timeline" aria-label="Timeline">` + timelineHTML(inc) + `</ul>
<h3>Note</h3>
<div class="field"><label for="note">Note</label><textarea id="note" rows="4"></textarea></div>
<button id="add-note" type="button">Add note</button>
<h3>Impacted services</h3>
<ul id="impacted" aria-label="Impacted services">` + servicesRefHTML(inc.ImpactedServices, inc.Service) + `</ul>
<h3>Responders</h3>
<ul id="responders" aria-label="Responders">` + respondersHTML(inc) + `</ul>
<button id="add-responder" type="button">Add responder</button>
<dialog id="responder-dialog" aria-label="Request responder">
<form id="responder-form">
<div class="field"><label for="responder-choice">Responder</label><select id="responder-choice">` + responderOptions + `</select></div>
<button type="submit">Send request</button><button type="button" data-close>Cancel</button>
</form></dialog>
<div class="phone-bar" id="incident-actions" role="toolbar" aria-label="Incident actions">
<button id="ack-btn-2" type="button">Acknowledge</button>
<button id="snooze-btn-2" type="button">Snooze</button>
<button id="resolve-btn-2" type="button">Resolve</button>
<button id="reassign-btn-2" type="button">Reassign</button>
</div>`
	s.shellFrame(w, r, u, "/incidents", body)
}

func countdownLabel(kind string) string {
	switch kind {
	case domain.CountdownSnooze:
		return "Snooze ends in"
	case domain.CountdownAckTimeout:
		return "Back to triggered in"
	case domain.CountdownEscalation:
		return "Escalates in"
	case domain.CountdownAutoResolve:
		return "Auto-resolves in"
	case domain.CountdownNone:
		if kind == domain.CountdownNone {
			return "No timer running"
		}
	}
	return "Escalation finished"
}

func formatCountdown(due, now time.Time) string {
	secs := int64(due.Sub(now).Seconds())
	if secs < 0 {
		secs = 0
	}
	h := secs / 3600
	m := (secs % 3600) / 60
	sc := secs % 60
	if h > 0 {
		return fmt.Sprintf("%d:%02d:%02d", h, m, sc)
	}
	return fmt.Sprintf("%02d:%02d", m, sc)
}

func alertsHTML(inc *domain.Incident) string {
	var b strings.Builder
	for _, a := range inc.Alerts {
		rk := ""
		if a.RoutingKey != nil {
			rk = *a.RoutingKey
		}
		fmt.Fprintf(&b, `<li><span class="dedup">%s</span> <span class="word">%s</span> ×%d <span class="hint">%s</span></li>`,
			template.HTMLEscapeString(a.DedupKey), template.HTMLEscapeString(statusWord(a.Status)), a.EventCount, template.HTMLEscapeString(rk))
	}
	return b.String()
}

func stepsHTML(inc *domain.Incident) string {
	var b strings.Builder
	for _, st := range inc.Steps {
		fmt.Fprintf(&b, `<li>%s %s due %s <span class="word">%s</span></li>`,
			template.HTMLEscapeString(st.Person), template.HTMLEscapeString(st.Channel),
			template.HTMLEscapeString(domain.FirmLocal(st.DueAt)), stepWord(st))
	}
	return b.String()
}

func timelineHTML(inc *domain.Incident) string {
	var b strings.Builder
	for _, e := range inc.Timeline {
		fmt.Fprintf(&b, `<li><span class="hint">%s</span> %s</li>`,
			template.HTMLEscapeString(domain.FirmLocal(e.At)), template.HTMLEscapeString(e.Text))
	}
	return b.String()
}

func servicesRefHTML(refs []domain.ServiceRef, current domain.ServiceRef) string {
	var b strings.Builder
	found := false
	for _, s := range refs {
		if s.ID == current.ID {
			found = true
		}
		fmt.Fprintf(&b, `<li>%s</li>`, template.HTMLEscapeString(s.Name))
	}
	if !found {
		fmt.Fprintf(&b, `<li>%s</li>`, template.HTMLEscapeString(current.Name))
	}
	return b.String()
}

func respondersHTML(inc *domain.Incident) string {
	var b strings.Builder
	for _, p := range inc.Responders {
		fmt.Fprintf(&b, `<li>%s</li>`, template.HTMLEscapeString(p.Name))
	}
	for _, req := range inc.ResponderRequests {
		if req.State != "requested" {
			continue
		}
		fmt.Fprintf(&b, `<li>%s <span class="word">%s</span></li>`, template.HTMLEscapeString(req.Person), "requested")
	}
	if b.Len() == 0 {
		return "<li>No extra responders.</li>"
	}
	return b.String()
}

func (s *Server) notFoundPage(w http.ResponseWriter, r *http.Request, u *SessionUser) {
	s.shellFrame(w, r, u, "", `<main class="empty">`+copytext.NotFound+`</main>`)
}

func (s *Server) handleSchedulesPage(w http.ResponseWriter, r *http.Request, u *SessionUser) {
	ctx := r.Context()
	schedules, _ := s.store.Schedules(ctx)
	var b strings.Builder
	b.WriteString(`<h2>Schedules</h2><div class="row-list">`)
	for _, sc := range schedules {
		fmt.Fprintf(&b, `<div class="row"><a href="/schedules/%s">%s</a> <span class="hint">%s</span></div>`,
			sc.ID, template.HTMLEscapeString(sc.Name), template.HTMLEscapeString(sc.Zone))
	}
	b.WriteString(`</div>`)
	s.shellFrame(w, r, u, "/schedules", b.String())
}

// handleSchedulePage renders the schedule grid with layers and the final row.
func (s *Server) handleSchedulePage(w http.ResponseWriter, r *http.Request, u *SessionUser) {
	ctx := r.Context()
	sc, err := s.store.Schedule(ctx, r.PathValue("id"))
	if err != nil {
		s.notFoundPage(w, r, u)
		return
	}
	now := s.engine.Now()
	holder, _ := s.scheduleHolderFor(ctx, sc.ID, now)
	name := "Nobody"
	if holder != nil {
		name = holder.Name
	}
	q := r.URL.Query()
	fromStr := q.Get("from")
	days, _ := strconv.Atoi(q.Get("days"))
	zone := q.Get("zone")
	if zone == "" {
		zone = sc.Zone
	}
	if days < 1 || days > 35 {
		days = 7
	}
	loc, lerr := time.LoadLocation(zone)
	if lerr != nil {
		zone = sc.Zone
		loc, _ = time.LoadLocation(zone)
	}
	var from time.Time
	if fromStr == "" {
		// The default is 7 days from the Monday of the current week in the
		// schedule's own zone.
		t := now.In(loc)
		d := time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, loc)
		offset := (int(d.Weekday()) + 6) % 7
		from = d.AddDate(0, 0, -offset)
	} else {
		parsed, perr := time.ParseInLocation("2006-01-02", fromStr, loc)
		if perr != nil {
			from = now.In(loc)
		} else {
			from = parsed
		}
	}
	to := from.AddDate(0, 0, days)

	people, _ := s.store.Users(ctx)
	peopleOptions := ""
	for _, p := range people {
		if p.Role == "stakeholder" {
			continue
		}
		peopleOptions += fmt.Sprintf(`<option value="%s"%s>%s</option>`, p.ID, selected(p.ID == u.ID), template.HTMLEscapeString(p.Name))
	}
	peopleOptions += `<option value="">Nobody</option>`

	zoneList := s.zoneOptions()
	body := `<figure id="oncall-figure">` + template.HTMLEscapeString(name) + `<small>On call now</small></figure>
<div class="filters">
<label for="range-start">Range start</label><input id="range-start" type="text" value="` + from.Format("2006-01-02") + `">
<button id="prev-week" type="button">Previous week</button>
<button id="next-week" type="button">Next week</button>
<label for="view-zone">View zone</label><select id="view-zone" aria-label="View zone">` + zoneList + `</select>
</div>
<section id="on-call-now" aria-label="On call now" hidden></section>
<div id="schedule-body" data-schedule="` + sc.ID + `" data-from="` + from.UTC().Format(time.RFC3339) + `" data-to="` + to.UTC().Format(time.RFC3339) + `" data-zone="` + zone + `" data-days="` + strconv.Itoa(days) + `"></div>
<div class="toolbar">
<label for="cut-for">Cut for</label><select id="cut-for" aria-label="Cut for">` + peopleOptions + `</select>
<button id="override-btn" type="button" class="tangerine">Schedule an override</button>
</div>
<section id="cut-preview" aria-label="Cut preview" role="region"></section>
<dialog id="override-dialog" aria-label="Schedule an override">
<form id="override-form">
<div class="field"><label for="override-person">Person</label><select id="override-person" aria-label="Person">` + peopleOptions + `</select></div>
<div class="field"><label for="override-start">Starts</label><input id="override-start" type="text"></div>
<div class="field"><label for="override-end">Ends</label><input id="override-end" type="text"></div>
<button type="submit">Save override</button><button type="button" data-close>Cancel</button>
</form></dialog>`
	s.shellFrame(w, r, u, "/schedules", body)
}

func selected(b bool) string {
	if b {
		return " selected"
	}
	return ""
}

// zoneOptions lists IANA zones alphabetically.
func (s *Server) zoneOptions() string {
	names := []string{"Africa/Cairo", "America/Chicago", "America/New_York", "America/Los_Angeles", "Asia/Kolkata", "Asia/Tokyo", "Europe/Berlin", "Europe/Lisbon", "Europe/London", "Pacific/Auckland"}
	sort.Strings(names)
	out := ""
	for _, z := range names {
		out += fmt.Sprintf(`<option value="%s">%s</option>`, z, z)
	}
	return out
}

func (s *Server) handlePoliciesPage(w http.ResponseWriter, r *http.Request, u *SessionUser) {
	policies, _ := s.store.Policies(r.Context())
	var b strings.Builder
	b.WriteString(`<h2>Policies</h2><div class="row-list">`)
	for _, p := range policies {
		fmt.Fprintf(&b, `<div class="row"><a href="/policies/%s">%s</a> <span class="hint">version %d</span></div>`,
			p.ID, template.HTMLEscapeString(p.Name), p.Version)
	}
	b.WriteString(`</div>`)
	s.shellFrame(w, r, u, "/policies", b.String())
}

func (s *Server) handlePolicyPage(w http.ResponseWriter, r *http.Request, u *SessionUser) {
	ctx := r.Context()
	p, err := s.store.Policy(ctx, r.PathValue("id"))
	if err != nil {
		s.notFoundPage(w, r, u)
		return
	}
	editable := roleAtLeast(u.Role, "lead")
	levels := `<ol id="levels" aria-label="Levels">`
	for i, lvl := range p.Levels {
		levels += levelItem(i+1, lvl)
	}
	levels += `</ol>`
	controls := ""
	if editable {
		controls = `<div class="toolbar"><button id="add-level" type="button">Add level</button><button id="save-policy" type="button">Save policy</button></div>`
	} else {
		levels = strings.ReplaceAll(levels, `<button`, `<button disabled `)
	}
	body := `<h2>` + template.HTMLEscapeString(p.Name) + `</h2>
<form id="policy-form" data-policy="` + p.ID + `" data-version="` + strconv.Itoa(p.Version) + `" data-editable="` + map[bool]string{true: "true", false: "false"}[editable] + `">
<label for="repeats">Repeats</label><input id="repeats" type="number" value="` + strconv.Itoa(p.Repeats) + `" ` + disabledAttr(editable) + `>
` + levels + `
` + controls + `
<p id="policy-notice" role="region" aria-label="Policy notice"></p>
</form>`
	s.shellFrame(w, r, u, "/policies", body)
}

func disabledAttr(editable bool) string {
	if editable {
		return ""
	}
	return "disabled"
}

func levelItem(pos int, lvl domain.PolicyLevel) string {
	targets := ""
	for _, t := range lvl.Targets {
		targets += template.HTMLEscapeString(t.Name) + " "
	}
	return fmt.Sprintf(`<li data-level="%d"><span class="handle" role="button" tabindex="0" aria-label="Move level %d">⠿</span>
<input class="timeout" type="number" value="%d" aria-label="Timeout for level %d" min="1">
<span class="targets">%s</span></li>`, pos, pos, lvl.TimeoutMinutes, pos, targets)
}

func (s *Server) handleServicesPage(w http.ResponseWriter, r *http.Request, u *SessionUser) {
	ctx := r.Context()
	services, _ := s.store.Services(ctx)
	byID := map[string]*store.ServiceRecord{}
	for _, sv := range services {
		byID[sv.ID] = sv
	}
	tree := serviceTree(ctx, s, services, byID)
	body := `<h2>Service map</h2><ul role="tree" aria-label="Service map" id="service-map">` + tree + `</ul>
<p class="notice-bar" id="maintenance-banner" role="status" aria-label="Maintenance banner" hidden></p>
<h2>Services</h2><div class="row-list">`
	for _, sv := range services {
		own, shown := s.serviceStatus(ctx, sv, byID)
		body += fmt.Sprintf(`<div class="row"><a href="/services/%s">%s</a> <span class="%s">%s</span> <span class="hint">own %s</span></div>`,
			sv.ID, template.HTMLEscapeString(sv.Name), statusClass(shown), shown, own)
	}
	body += `</div>`
	s.shellFrame(w, r, u, "/services", body)
}

// serviceTree builds the map tree: each top item is a service nothing depends
// on, and each child is a service its parent depends on.
func serviceTree(ctx context.Context, s *Server, services []*store.ServiceRecord, byID map[string]*store.ServiceRecord) string {
	// Count reverse dependencies.
	depCount := map[string]int{}
	for _, sv := range services {
		for _, d := range sv.DependsOn {
			depCount[d]++
		}
	}
	var b strings.Builder
	var render func(sv *store.ServiceRecord, depth int)
	render = func(sv *store.ServiceRecord, depth int) {
		_, shown := s.serviceStatus(ctx, sv, byID)
		fmt.Fprintf(&b, `<li role="treeitem" data-service="%s" data-status="%s" aria-expanded="true" tabindex="-1">%s %s`,
			template.HTMLEscapeString(sv.Name), shown, template.HTMLEscapeString(sv.Name), shown)
		children := sv.DependsOn
		if len(children) > 0 {
			b.WriteString(`<ul role="group">`)
			for _, c := range children {
				if child, ok := byID[c]; ok {
					render(child, depth+1)
				}
			}
			b.WriteString(`</ul>`)
		}
		b.WriteString(`</li>`)
	}
	for _, sv := range services {
		if depCount[sv.ID] == 0 {
			render(sv, 0)
		}
	}
	return b.String()
}

func (s *Server) handleServicePage(w http.ResponseWriter, r *http.Request, u *SessionUser) {
	ctx := r.Context()
	sv, err := s.store.Service(ctx, r.PathValue("id"))
	if err != nil {
		s.notFoundPage(w, r, u)
		return
	}
	services, _ := s.store.Services(ctx)
	byID := map[string]*store.ServiceRecord{}
	for _, s2 := range services {
		byID[s2.ID] = s2
	}
	own, shown := s.serviceStatus(ctx, sv, byID)
	body := `<h2>` + template.HTMLEscapeString(sv.Name) + `</h2>
<p>Team: ` + template.HTMLEscapeString(sv.Team) + `</p>
<p>Grouping: ` + sv.GroupingMode + `</p>
<p>Own status: <span class="` + statusClass(own) + `">` + own + `</span></p>
<p>Shown status: <span class="` + statusClass(shown) + `">` + shown + `</span></p>`
	s.shellFrame(w, r, u, "/services", body)
}

func (s *Server) handleIntegrationsPage(w http.ResponseWriter, r *http.Request, u *SessionUser) {
	integrations, _ := s.store.Integrations(r.Context())
	var b strings.Builder
	b.WriteString(`<h2>Integrations</h2><div class="row-list">`)
	for _, i := range integrations {
		fmt.Fprintf(&b, `<div class="row"><a href="/integrations/%s">%s</a> <code class="key">%s</code></div>`,
			i.ID, template.HTMLEscapeString(i.Name), template.HTMLEscapeString(i.RoutingKey))
	}
	b.WriteString(`</div><h3>Dead letters</h3><p class="empty">No dead letters.</p>`)
	s.shellFrame(w, r, u, "/integrations", b.String())
}

func (s *Server) handleIntegrationPage(w http.ResponseWriter, r *http.Request, u *SessionUser) {
	ctx := r.Context()
	i, err := s.store.Integration(ctx, r.PathValue("id"))
	if err != nil {
		s.notFoundPage(w, r, u)
		return
	}
	body := `<h2>` + template.HTMLEscapeString(i.Name) + `</h2>
<figure id="counter-figure"><span id="events-this-minute" role="status" aria-label="Events this minute">0 / 120</span><small>Events this minute</small></figure>
<p id="retry-after" role="timer" aria-label="Retry-After countdown">Accepting events</p>
<p><code class="key">` + template.HTMLEscapeString(i.RoutingKey) + `</code></p>
<h3>Event log</h3>
<table id="event-log" aria-label="Event log"><thead><tr><th>At</th><th>Action</th><th>Dedup key</th><th>Outcome</th><th>Reason</th><th>Incident</th></tr></thead><tbody></tbody></table>
<h3>Dead letters</h3>
<table id="dead-letters" aria-label="Dead letters"><thead><tr><th>At</th><th>Routing key</th><th>Reason</th><th></th></tr></thead><tbody></tbody></table>
<dialog id="replay-dialog" aria-label="Replay dead letter">
<form id="replay-form">
<div class="field"><label for="corrected">Corrected message</label><textarea id="corrected" rows="6"></textarea></div>
<button type="submit">Replay message</button><button type="button" data-close>Cancel</button>
</form></dialog>`
	s.shellFrame(w, r, u, "/integrations", body)
}

func (s *Server) handleWebhooksPage(w http.ResponseWriter, r *http.Request, u *SessionUser) {
	ctx := r.Context()
	services, _ := s.store.Services(ctx)
	types := `incident.triggered incident.acknowledged incident.snoozed incident.unacknowledged incident.escalated incident.reassigned incident.merged incident.resolved`
	typeBoxes := ""
	for _, t := range strings.Fields(types) {
		typeBoxes += fmt.Sprintf(`<label><input type="checkbox" value="%s"> %s</label>`, t, t)
	}
	svcBoxes := ""
	for _, sv := range services {
		svcBoxes += fmt.Sprintf(`<label><input type="checkbox" value="%s"> %s</label>`, sv.ID, template.HTMLEscapeString(sv.Name))
	}
	body := `<h2>Webhooks</h2>
<form id="webhook-form" class="row">
<div class="field"><label for="endpoint-name">Endpoint name</label><input id="endpoint-name"></div>
<div class="field"><label for="receiver-path">Receiver path</label><input id="receiver-path" placeholder="/hooks/..."></div>
<fieldset><legend>Event types</legend>` + typeBoxes + `</fieldset>
<fieldset><legend>Scope</legend>` + svcBoxes + `</fieldset>
<button type="submit">Add endpoint</button>
</form>
<div class="row-list" id="webhook-list"></div>
<h3>Deliveries</h3>
<p class="empty">Nothing has been sent yet.</p>`
	s.shellFrame(w, r, u, "/webhooks", body)
}

func (s *Server) handleWebhookPage(w http.ResponseWriter, r *http.Request, u *SessionUser) {
	body := `<h2>Deliveries</h2>
<table id="deliveries" aria-label="Deliveries"><thead><tr><th>Event id</th><th>Type</th><th>Status</th><th>Next attempt</th></tr></thead><tbody></tbody></table>
<h3>Attempts</h3>
<table id="attempts" aria-label="Attempts"><thead><tr><th>Attempt</th><th>At</th><th>Status</th><th>Body</th></tr></thead><tbody></tbody></table>
<button id="replay-delivery" type="button">Replay delivery</button>`
	s.shellFrame(w, r, u, "/webhooks", body)
}

func (s *Server) handleStatusDeskPage(w http.ResponseWriter, r *http.Request, u *SessionUser) {
	ctx := r.Context()
	services, _ := s.store.Services(ctx)
	boxes := ""
	for _, sv := range services {
		boxes += fmt.Sprintf(`<label><input type="checkbox" value="%s"> %s</label>`, sv.ID, template.HTMLEscapeString(sv.Name))
	}
	rows, _ := s.store.Pool().Query(ctx, `SELECT title, state, published_at FROM status_updates ORDER BY created_at DESC`)
	defer rows.Close()
	list := ""
	for rows.Next() {
		var title, state string
		var published *time.Time
		if rows.Scan(&title, &state, &published) == nil {
			status := "draft"
			if published != nil {
				status = "published " + domain.FirmLocal(*published)
			}
			list += fmt.Sprintf(`<div class="row">%s <span class="hint">%s</span></div>`, template.HTMLEscapeString(title), template.HTMLEscapeString(status))
		}
	}
	body := `<h2>Status desk</h2>
<form id="update-form" class="row">
<div class="field"><label for="update-title">Update title</label><input id="update-title"></div>
<div class="field"><label for="update-body">Update body</label><textarea id="update-body" rows="4"></textarea></div>
<div class="field"><label for="update-state">Update state</label><select id="update-state" aria-label="Update state">
<option>Investigating</option><option>Identified</option><option>Monitoring</option><option>Resolved</option></select></div>
<fieldset><legend>Affected services</legend>` + boxes + `</fieldset>
<button id="save-draft" type="button">Save draft</button>
<button id="publish-update" type="button">Publish update</button>
</form>
<div class="row-list">` + list + `</div>`
	s.shellFrame(w, r, u, "/status-desk", body)
}

func (s *Server) handleAnalyticsPage(w http.ResponseWriter, r *http.Request, u *SessionUser) {
	now := s.engine.Now()
	to := now.In(domain.FirmLoc()).Format("2006-01-02")
	body := `<h2>Analytics</h2>
<figure id="analytics-figure"><span id="overall-mtta">n/a</span><small>Time to acknowledge</small></figure>
<div class="filters">
<label for="from">From</label><input id="from" type="text" value="">
<label for="to">To</label><input id="to" type="text" value="` + to + `">
<button id="run-analytics" type="button">Run analytics</button>
</div>
<progress id="analytics-progress" role="progressbar" aria-label="Analytics progress" max="0" value="0"></progress>
<table id="measures" aria-label="Response measures"><thead><tr><th>Name</th><th>Kind</th><th>Incidents</th><th>MTTA</th><th>MTTR</th></tr></thead><tbody></tbody></table>
<p><a id="download-csv" href="#" aria-label="Download CSV">Download CSV</a></p>`
	s.shellFrame(w, r, u, "/analytics", body)
}

func (s *Server) handleMaintenancePage(w http.ResponseWriter, r *http.Request, u *SessionUser) {
	ctx := r.Context()
	services, _ := s.store.Services(ctx)
	options := ""
	for _, sv := range services {
		options += fmt.Sprintf(`<option value="%s">%s</option>`, sv.ID, template.HTMLEscapeString(sv.Name))
	}
	rows, _ := s.store.Pool().Query(ctx, `SELECT sv.name, w.starts_at, w.ends_at FROM maintenance_windows w
		JOIN services sv ON sv.id = w.service_id ORDER BY w.starts_at`)
	defer rows.Close()
	list := ""
	for rows.Next() {
		var name string
		var startsAt, endsAt time.Time
		if rows.Scan(&name, &startsAt, &endsAt) == nil {
			state := domain.WindowUpcoming
			now := s.engine.Now()
			if !startsAt.After(now) && now.Before(endsAt) {
				state = domain.WindowRunning
			} else if !now.Before(endsAt) {
				state = domain.WindowEnded
			}
			list += fmt.Sprintf(`<div class="row">%s %s to %s <span class="word">%s</span></div>`,
				template.HTMLEscapeString(name), domain.FirmLocal(startsAt), domain.FirmLocal(endsAt), state)
		}
	}
	body := `<h2>Maintenance windows</h2>
<form id="window-form" class="row">
<div class="field"><label for="window-start">Starts</label><input id="window-start" type="text" placeholder="YYYY-MM-DD HH:MM"></div>
<div class="field"><label for="window-end">Ends</label><input id="window-end" type="text" placeholder="YYYY-MM-DD HH:MM"></div>
<div class="field"><label for="window-service">Service</label><select id="window-service" aria-label="Service">` + options + `</select></div>
<button type="submit">Add window</button>
</form>
<div class="row-list">` + list + `</div>`
	s.shellFrame(w, r, u, "/maintenance", body)
}

func (s *Server) handleAdminPage(w http.ResponseWriter, r *http.Request, u *SessionUser) {
	ctx := r.Context()
	people, _ := s.store.Users(ctx)
	now := s.engine.Now()
	rowsHTML := ""
	for _, p := range people {
		roles := ""
		for _, role := range []string{"Responder", "Lead", "Admin", "Stakeholder"} {
			value := strings.ToLower(role)
			roles += fmt.Sprintf(`<option value="%s"%s>%s</option>`, value, selected(p.Role == value), role)
		}
		rowsHTML += fmt.Sprintf(`<tr><td>%s</td><td><select aria-label="Role for %s" data-user="%s">%s</select></td>
<td><button data-signout="%s" type="button">Sign %s out</button></td>
<td><button data-remove="%s" type="button">Remove %s</button></td></tr>`,
			template.HTMLEscapeString(p.Name), template.HTMLEscapeString(p.Name), p.ID, roles,
			p.ID, template.HTMLEscapeString(p.Name), p.ID, template.HTMLEscapeString(p.Name))
	}
	keys, _ := s.store.Pool().Query(ctx, `SELECT id, name, scope, grace_ends_at, revoked_at FROM api_keys`)
	defer keys.Close()
	keyRows := ""
	for keys.Next() {
		var id, name, scope string
		var grace, revoked *time.Time
		if keys.Scan(&id, &name, &scope, &grace, &revoked) == nil {
			keyRows += fmt.Sprintf(`<tr><td>%s</td><td>%s</td><td>%s</td><td><button data-rotate="%s" type="button">Rotate %s</button></td>
<td><button data-revoke="%s" type="button">Revoke %s</button></td></tr>`,
				template.HTMLEscapeString(name), scope, fmtTimePtr(grace), id, template.HTMLEscapeString(name), id, template.HTMLEscapeString(name))
		}
	}
	body := `<h2>People</h2>
<table id="people" aria-label="People"><thead><tr><th>Name</th><th>Role</th><th></th><th></th></tr></thead><tbody>` + rowsHTML + `</tbody></table>
<ul id="removal-breaks" aria-label="What this removal breaks"></ul>
<h2>API keys</h2>
<form id="key-form" class="row">
<div class="field"><label for="key-name">Key name</label><input id="key-name"></div>
<div class="field"><label for="key-scope">Key scope</label><select id="key-scope" aria-label="Key scope"><option>Read</option><option>Write</option></select></div>
<button type="submit">Create key</button>
</form>
<table id="api-keys" aria-label="API keys"><thead><tr><th>Name</th><th>Scope</th><th>Grace ends</th><th></th><th></th></tr></thead><tbody>` + keyRows + `</tbody></table>
<h2>Operator clock</h2>
<section id="operator-clock" aria-label="Operator clock">
<p id="clock-now">` + now.UTC().Format("2006-01-02T15:04:05Z") + `</p>
<div class="field"><label for="advance-seconds">Advance by seconds</label><input id="advance-seconds" type="number" value="60"></div>
<button id="advance-clock" type="button">Advance clock</button>
<label><input type="checkbox" id="hold-clock"> Hold clock</label>
</section>`
	s.shellFrame(w, r, u, "/admin", body)
}

func fmtTimePtr(t *time.Time) string {
	if t == nil {
		return ""
	}
	return t.UTC().Format(time.RFC3339)
}

func (s *Server) handleMePage(w http.ResponseWriter, r *http.Request, u *SessionUser) {
	if u.Role == "stakeholder" {
		// A stakeholder sees only sign-out here and is otherwise sent to /status.
		http.Redirect(w, r, "/status", http.StatusSeeOther)
		return
	}
	full, _ := s.store.User(r.Context(), u.ID)
	quietStart, quietEnd := "", ""
	if full.QuietStart != nil {
		quietStart = *full.QuietStart
	}
	if full.QuietEnd != nil {
		quietEnd = *full.QuietEnd
	}
	delays := strings.Trim(strings.Join(intsToStrings(full.NotificationDelays), ", "), "[]")
	zones := s.zoneOptions()
	body := `<h2>Your settings</h2>
<form id="me-form" class="row">
<div class="field"><label for="timezone">Time zone</label><select id="timezone" aria-label="Time zone">` + zones + `</select></div>
<div class="field"><label for="quiet-start">Quiet hours start</label><input id="quiet-start" type="text" value="` + quietStart + `" placeholder="HH:MM"></div>
<div class="field"><label for="quiet-end">Quiet hours end</label><input id="quiet-end" type="text" value="` + quietEnd + `" placeholder="HH:MM"></div>
<div class="field"><label for="delays">Notification delays</label><input id="delays" type="text" value="` + delays + `"></div>
<div class="field"><label for="low-delay">Low urgency delay</label><input id="low-delay" type="number" value="` + strconv.Itoa(full.LowUrgencyDelay) + `"></div>
<button type="submit">Save settings</button>
</form>
<h3>Calendar feed</h3>
<p id="calendar-url" class="key"></p>
<div class="toolbar">
<button id="create-calendar" type="button">Create calendar link</button>
<button id="regen-calendar" type="button" hidden>Regenerate calendar link</button>
<button id="revoke-calendar" type="button" hidden>Revoke calendar link</button>
</div>`
	s.shellFrame(w, r, u, "/me", body)
}

func intsToStrings(list []int) []string {
	out := make([]string, 0, len(list))
	for _, v := range list {
		out = append(out, strconv.Itoa(v))
	}
	return out
}
