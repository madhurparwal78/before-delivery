package web

import (
	"errors"
	"fmt"
	"html/template"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"switchlamp/internal/core"
)

type pageFunc func(w http.ResponseWriter, r *http.Request, s *session) (string, map[string]any, error)

// page renders one screen, sending a person without access where they belong.
func (s *Server) page(access string, fn pageFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !s.app.Ready() {
			http.Error(w, "Starting", http.StatusServiceUnavailable)
			return
		}
		actor, _, authErr := s.actorFor(r)
		if authErr != nil || actor == nil || actor.User == nil {
			http.Redirect(w, r, "/sign-in", http.StatusSeeOther)
			return
		}
		if err := checkAccess(*actor, access); err != nil {
			if actor.User.Role == "stakeholder" {
				http.Redirect(w, r, "/status", http.StatusSeeOther)
				return
			}
			s.renderError(w, r, actor.User, http.StatusForbidden, "We could not find that page.")
			return
		}
		if err := s.app.Tick(r.Context()); err != nil {
			log.Printf("timers: %v", err)
		}
		state := &session{Actor: *actor}
		name, data, err := fn(w, r, state)
		if err != nil {
			var apiErr *core.APIError
			if errors.As(err, &apiErr) && apiErr.Status == 404 {
				s.renderError(w, r, actor.User, http.StatusNotFound, "We could not find that page.")
				return
			}
			log.Printf("render %s: %v", r.URL.Path, err)
			s.renderError(w, r, actor.User, http.StatusInternalServerError, "We could not find that page.")
			return
		}
		if name == "" {
			return
		}
		s.render(w, r, name, s.withChrome(r, actor.User, data))
	}
}

func (s *Server) withChrome(r *http.Request, user *core.User, data map[string]any) map[string]any {
	if data == nil {
		data = map[string]any{}
	}
	notices, err := s.app.NoticesFor(r.Context(), user.ID)
	if err != nil {
		notices = 0
	}
	system := s.app.SystemState()
	data["User"] = user
	data["Notices"] = notices
	data["Now"] = s.app.Clock.Now()
	data["Zone"] = user.Timezone
	data["System"] = system
	data["CacheDown"] = !s.app.CacheUp()
	data["MailDown"] = !s.app.MailUp()
	data["QueueDown"] = !s.app.QueueUp()
	data["ReceiverDown"] = !s.app.ReceiverUp()
	data["Path"] = r.URL.Path
	data["RoleChanged"] = r.URL.Query().Get("role-changed") != ""
	data["LastSeq"] = s.app.LastSeq(r.Context())
	return data
}

func (s *Server) render(w http.ResponseWriter, r *http.Request, name string, data map[string]any) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	if err := s.templates.ExecuteTemplate(w, name, data); err != nil {
		log.Printf("render %s: %v", name, err)
	}
}

func (s *Server) renderError(w http.ResponseWriter, r *http.Request, user *core.User, status int, message string) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	data := map[string]any{"Message": message}
	if user != nil {
		data = s.withChrome(r, user, data)
	}
	if err := s.templates.ExecuteTemplate(w, "notfound.html", data); err != nil {
		log.Printf("render error page: %v", err)
	}
}

func (s *Server) pageRoot(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/" {
		if strings.HasPrefix(r.URL.Path, "/api/") {
			writeJSON(w, 404, map[string]any{"error": "not_found"})
			return
		}
		actor, _, _ := s.actorFor(r)
		var user *core.User
		if actor != nil {
			user = actor.User
		}
		s.renderError(w, r, user, http.StatusNotFound, "We could not find that page.")
		return
	}
	actor, _, _ := s.actorFor(r)
	flag := ""
	if r.URL.Query().Get("role-changed") != "" {
		flag = "?role-changed=1"
	}
	if actor != nil && actor.User != nil {
		if actor.User.Role == "stakeholder" {
			http.Redirect(w, r, "/status"+flag, http.StatusSeeOther)
			return
		}
		http.Redirect(w, r, "/oncall"+flag, http.StatusSeeOther)
		return
	}
	http.Redirect(w, r, "/sign-in", http.StatusSeeOther)
}

func (s *Server) pageSignIn(w http.ResponseWriter, r *http.Request) {
	if !s.app.Ready() {
		http.Error(w, "Starting", http.StatusServiceUnavailable)
		return
	}
	actor, _, _ := s.actorFor(r)
	if actor != nil && actor.User != nil {
		http.Redirect(w, r, "/oncall", http.StatusSeeOther)
		return
	}
	s.render(w, r, "signin.html", map[string]any{"SignedOut": r.URL.Query().Get("signed-out") != ""})
}

func (s *Server) pageStatus(w http.ResponseWriter, r *http.Request) {
	if !s.app.Ready() {
		http.Error(w, "Starting", http.StatusServiceUnavailable)
		return
	}
	if err := s.app.Tick(r.Context()); err != nil {
		log.Printf("timers: %v", err)
	}
	view, etag, cacheState, err := s.app.StatusPage(r.Context())
	if err != nil {
		http.Error(w, "Status unavailable", http.StatusInternalServerError)
		return
	}
	w.Header().Set("X-Switchlamp-Cache", cacheState)
	w.Header().Set("ETag", etag)
	s.render(w, r, "status.html", map[string]any{
		"Status": view, "Slower": cacheState == "bypass", "FirmZone": core.FirmZoneName,
	})
}

func (s *Server) pageUnsubscribe(w http.ResponseWriter, r *http.Request) {
	token := pathValue(r, "token")
	if err := s.app.Unsubscribe(r.Context(), token); err != nil {
		s.renderError(w, r, nil, http.StatusNotFound, "We could not find that page.")
		return
	}
	s.render(w, r, "unsubscribe.html", map[string]any{"Message": "You will get no more status updates."})
}

func (s *Server) pageAck(w http.ResponseWriter, r *http.Request) {
	if !s.app.Ready() {
		http.Error(w, "Starting", http.StatusServiceUnavailable)
		return
	}
	if err := s.app.Tick(r.Context()); err != nil {
		log.Printf("timers: %v", err)
	}
	page, err := s.app.AckLink(r.Context(), pathValue(r, "token"), r.Method == http.MethodPost)
	if err != nil {
		s.renderError(w, r, nil, http.StatusInternalServerError, "We could not find that page.")
		return
	}
	heading, sentence := ackCopy(page)
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(page.HTTPCode)
	data := map[string]any{"Page": page, "Heading": heading, "Sentence": sentence}
	if err := s.templates.ExecuteTemplate(w, "ack.html", data); err != nil {
		log.Printf("render ack: %v", err)
	}
}

func ackCopy(page core.AckPage) (string, string) {
	switch page.State {
	case "valid":
		return fmt.Sprintf("Acknowledge incident #%d", page.Number), page.Title
	case "done":
		return "Acknowledged.", fmt.Sprintf("Incident #%d is with you now.", page.Number)
	case "used":
		return "This link has already been used.", fmt.Sprintf("Incident #%d was acknowledged by %s.", page.Number, page.Name)
	case "out_of_date":
		return "This link is out of date.", fmt.Sprintf("Incident #%d has moved on. Sign in to see where it stands.", page.Number)
	default:
		return "This link is not valid.", "Ask your lead for help if you expected it to work."
	}
}

func (s *Server) pageOnCall(w http.ResponseWriter, r *http.Request, state *session) (string, map[string]any, error) {
	schedules, err := s.app.ListSchedules(r.Context())
	if err != nil {
		return "", nil, err
	}
	chosen := r.URL.Query().Get("schedule")
	type holderRow struct {
		Schedule *core.Schedule
		OnCall   *core.OnCall
		Until    string
		Seconds  int
	}
	rows := []holderRow{}
	now := s.app.Clock.Now()
	for _, schedule := range schedules {
		oncall, _, _, err := s.app.OnCallCached(r.Context(), schedule.ID)
		if err != nil {
			return "", nil, err
		}
		seconds := 0
		until := ""
		if oncall.Until != nil {
			seconds = int(oncall.Until.Sub(now) / time.Second)
			until = core.LocalTime(*oncall.Until, zoneFor(state.Actor.User.Timezone))
		}
		rows = append(rows, holderRow{Schedule: schedule, OnCall: oncall, Until: until, Seconds: seconds})
	}
	current := rows
	if chosen != "" {
		for _, row := range rows {
			if row.Schedule.ID == chosen {
				current = []holderRow{row}
			}
		}
	}
	figure := "Nobody"
	seconds := 0
	scheduleID := ""
	if len(current) > 0 {
		if current[0].OnCall.Holder != nil {
			figure = current[0].OnCall.Holder.Name
		}
		seconds = current[0].Seconds
		scheduleID = current[0].Schedule.ID
	}
	return "oncall.html", map[string]any{
		"Rows": rows, "Figure": figure, "Seconds": seconds, "ScheduleID": scheduleID,
		"Chosen": chosen,
	}, nil
}

func zoneFor(name string) *time.Location {
	loc, err := time.LoadLocation(name)
	if err != nil {
		return time.UTC
	}
	return loc
}

func (s *Server) pageIncidents(w http.ResponseWriter, r *http.Request, state *session) (string, map[string]any, error) {
	status := r.URL.Query().Get("status")
	if status == "" {
		status = "open"
	}
	serviceID := r.URL.Query().Get("service")
	page, err := s.app.ListIncidents(r.Context(), core.IncidentQuery{
		Status: status, ServiceID: serviceID, Limit: queryInt(r, "limit", 25),
		After: r.URL.Query().Get("after"), Before: r.URL.Query().Get("before"),
	})
	if err != nil {
		return "", nil, err
	}
	services, err := s.app.ListServices(r.Context())
	if err != nil {
		return "", nil, err
	}
	filters, err := s.app.SavedFilters(r.Context(), state.Actor.User.ID)
	if err != nil {
		return "", nil, err
	}
	return "incidents.html", map[string]any{
		"Page": page, "Services": services, "Status": status, "ServiceID": serviceID,
		"SavedFilters": filters,
	}, nil
}

func (s *Server) pageIncident(w http.ResponseWriter, r *http.Request, state *session) (string, map[string]any, error) {
	incident, err := s.app.Incident(r.Context(), pathValue(r, "id"))
	if err != nil {
		return "", nil, err
	}
	draft, _, err := s.app.NoteDraft(r.Context(), incident.ID, state.Actor.User.ID)
	if err != nil {
		return "", nil, err
	}
	people, err := s.app.ListUsers(r.Context())
	if err != nil {
		return "", nil, err
	}
	services, err := s.app.ListServices(r.Context())
	if err != nil {
		return "", nil, err
	}
	queued, err := s.app.QueuedStepCount(r.Context())
	if err != nil {
		return "", nil, err
	}
	var myRequest *core.ResponderRequest
	for i := range incident.ResponderRequests {
		if incident.ResponderRequests[i].State == "requested" && incident.ResponderRequests[i].Person == state.Actor.User.Name {
			myRequest = &incident.ResponderRequests[i]
		}
	}
	return "incident.html", map[string]any{
		"Incident": incident, "Draft": draft, "People": people, "Services": services,
		"QueuedSteps": queued, "MyRequest": myRequest,
		"CanLead": state.Actor.Role() == "lead" || state.Actor.Role() == "admin",
	}, nil
}

func (s *Server) pageSchedules(w http.ResponseWriter, r *http.Request, state *session) (string, map[string]any, error) {
	schedules, err := s.app.ListSchedules(r.Context())
	if err != nil {
		return "", nil, err
	}
	return "schedules.html", map[string]any{"Schedules": schedules}, nil
}

func (s *Server) pageSchedule(w http.ResponseWriter, r *http.Request, state *session) (string, map[string]any, error) {
	schedule, err := s.app.GetSchedule(r.Context(), pathValue(r, "id"))
	if err != nil {
		return "", nil, err
	}
	zone := r.URL.Query().Get("zone")
	if zone == "" {
		zone = schedule.Zone
	}
	if _, err := time.LoadLocation(zone); err != nil {
		zone = schedule.Zone
	}
	days := queryInt(r, "days", 7)
	if days < 1 || days > 35 {
		days = 7
	}
	loc := zoneFor(zone)
	now := s.app.Clock.Now()
	from := mondayOf(now, zoneFor(schedule.Zone))
	rangeStart := r.URL.Query().Get("from")
	if rangeStart != "" {
		if parsed, err := time.ParseInLocation("2006-01-02", rangeStart, loc); err == nil {
			from = parsed
		}
	}
	to := from.AddDate(0, 0, days)
	final, err := s.app.FinalSchedule(r.Context(), schedule.ID, from.UTC(), to.UTC(), zone)
	if err != nil {
		return "", nil, err
	}
	oncall, _, _, err := s.app.OnCallCached(r.Context(), schedule.ID)
	if err != nil {
		return "", nil, err
	}
	people, err := s.app.ListUsers(r.Context())
	if err != nil {
		return "", nil, err
	}
	zones, err := s.app.ListSchedules(r.Context())
	if err != nil {
		return "", nil, err
	}
	figure := "Nobody"
	if oncall.Holder != nil {
		figure = oncall.Holder.Name
	}
	totalMinutes := int(to.Sub(from) / time.Minute)
	return "schedule.html", map[string]any{
		"Schedule": schedule, "Final": final, "Figure": figure, "People": people,
		"Zone": zone, "Days": days, "From": from.Format("2006-01-02"), "Schedules": zones,
		"TotalMinutes": totalMinutes, "RangeStart": from.UTC(), "RangeEnd": to.UTC(),
		"CanLead": state.Actor.Role() == "lead" || state.Actor.Role() == "admin",
		"Zones":   core.KnownZones(),
	}, nil
}

func mondayOf(now time.Time, loc *time.Location) time.Time {
	local := now.In(loc)
	day := time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, loc)
	offset := (int(day.Weekday()) + 6) % 7
	return day.AddDate(0, 0, -offset)
}

func (s *Server) pagePolicies(w http.ResponseWriter, r *http.Request, state *session) (string, map[string]any, error) {
	policies, err := s.app.ListPolicies(r.Context())
	if err != nil {
		return "", nil, err
	}
	return "policies.html", map[string]any{"Policies": policies}, nil
}

func (s *Server) pagePolicy(w http.ResponseWriter, r *http.Request, state *session) (string, map[string]any, error) {
	policy, err := s.app.GetPolicy(r.Context(), pathValue(r, "id"))
	if err != nil {
		return "", nil, err
	}
	people, err := s.app.ListUsers(r.Context())
	if err != nil {
		return "", nil, err
	}
	schedules, err := s.app.ListSchedules(r.Context())
	if err != nil {
		return "", nil, err
	}
	return "policy.html", map[string]any{
		"Policy": policy, "People": people, "Schedules": schedules,
		"CanEdit": state.Actor.Role() == "lead" || state.Actor.Role() == "admin",
	}, nil
}

func (s *Server) pageServices(w http.ResponseWriter, r *http.Request, state *session) (string, map[string]any, error) {
	tree, err := s.app.ServiceTree(r.Context())
	if err != nil {
		return "", nil, err
	}
	services, err := s.app.ListServices(r.Context())
	if err != nil {
		return "", nil, err
	}
	windows, err := s.app.RunningMaintenance(r.Context())
	if err != nil {
		return "", nil, err
	}
	policies, err := s.app.ListPolicies(r.Context())
	if err != nil {
		return "", nil, err
	}
	return "services.html", map[string]any{
		"Tree": tree, "Services": services, "Maintenance": windows, "Policies": policies,
		"CanEdit": state.Actor.Role() == "admin",
	}, nil
}

func (s *Server) pageService(w http.ResponseWriter, r *http.Request, state *session) (string, map[string]any, error) {
	service, err := s.app.GetService(r.Context(), pathValue(r, "id"))
	if err != nil {
		return "", nil, err
	}
	name, data, err := s.pageServices(w, r, state)
	if err != nil {
		return "", nil, err
	}
	data["Service"] = service
	return name, data, nil
}

func (s *Server) pageIntegrations(w http.ResponseWriter, r *http.Request, state *session) (string, map[string]any, error) {
	integrations, err := s.app.ListIntegrations(r.Context())
	if err != nil {
		return "", nil, err
	}
	dead, err := s.app.ListDeadLetters(r.Context(), "")
	if err != nil {
		return "", nil, err
	}
	services, err := s.app.ListServices(r.Context())
	if err != nil {
		return "", nil, err
	}
	return "integrations.html", map[string]any{
		"Integrations": integrations, "DeadLetters": dead, "Services": services,
		"CanReplay": state.Actor.Role() == "lead" || state.Actor.Role() == "admin",
	}, nil
}

func (s *Server) pageIntegration(w http.ResponseWriter, r *http.Request, state *session) (string, map[string]any, error) {
	integration, err := s.app.GetIntegration(r.Context(), pathValue(r, "id"))
	if err != nil {
		return "", nil, err
	}
	events, err := s.app.EventLog(r.Context(), integration.ID, 50)
	if err != nil {
		return "", nil, err
	}
	dead, err := s.app.ListDeadLetters(r.Context(), integration.ID)
	if err != nil {
		return "", nil, err
	}
	counter := s.app.Counter(r.Context(), integration.RoutingKey)
	return "integration.html", map[string]any{
		"Integration": integration, "Events": events, "DeadLetters": dead, "Counter": counter,
		"CanReplay": state.Actor.Role() == "lead" || state.Actor.Role() == "admin",
	}, nil
}

func (s *Server) pageWebhooks(w http.ResponseWriter, r *http.Request, state *session) (string, map[string]any, error) {
	endpoints, err := s.app.ListWebhooks(r.Context())
	if err != nil {
		return "", nil, err
	}
	services, err := s.app.ListServices(r.Context())
	if err != nil {
		return "", nil, err
	}
	deliveries := map[string][]core.WebhookDelivery{}
	for _, endpoint := range endpoints {
		items, err := s.app.Deliveries(r.Context(), endpoint.ID, 25)
		if err != nil {
			return "", nil, err
		}
		deliveries[endpoint.ID] = items
	}
	return "webhooks.html", map[string]any{
		"Endpoints": endpoints, "Services": services, "Deliveries": deliveries,
		"EventTypes": core.WebhookEventTypes(),
	}, nil
}

func (s *Server) pageWebhook(w http.ResponseWriter, r *http.Request, state *session) (string, map[string]any, error) {
	endpoint, err := s.app.GetWebhook(r.Context(), pathValue(r, "id"))
	if err != nil {
		return "", nil, err
	}
	name, data, err := s.pageWebhooks(w, r, state)
	if err != nil {
		return "", nil, err
	}
	data["Endpoint"] = endpoint
	return name, data, nil
}

func (s *Server) pageStatusDesk(w http.ResponseWriter, r *http.Request, state *session) (string, map[string]any, error) {
	updates, err := s.app.ListStatusUpdates(r.Context(), false)
	if err != nil {
		return "", nil, err
	}
	services, err := s.app.ListServices(r.Context())
	if err != nil {
		return "", nil, err
	}
	queued, err := s.app.QueuedSubscriberCount(r.Context())
	if err != nil {
		return "", nil, err
	}
	return "statusdesk.html", map[string]any{"Updates": updates, "Services": services, "QueuedNotices": queued}, nil
}

func (s *Server) pageAnalytics(w http.ResponseWriter, r *http.Request, state *session) (string, map[string]any, error) {
	defaultFrom, defaultTo := s.app.DefaultAnalyticsRange()
	from := r.URL.Query().Get("from")
	to := r.URL.Query().Get("to")
	if from == "" {
		from = defaultFrom
	}
	if to == "" {
		to = defaultTo
	}
	jobID := r.URL.Query().Get("job")
	var job *core.AnalyticsJob
	var err error
	if jobID != "" {
		job, err = s.app.AnalyticsJob(r.Context(), jobID)
		if err != nil {
			job = nil
		}
	}
	if job == nil {
		job, _, err = s.app.StartAnalyticsJob(r.Context(), from, to)
		if err != nil {
			return "", nil, err
		}
	}
	return "analytics.html", map[string]any{"Job": job, "From": from, "To": to}, nil
}

func (s *Server) pageMaintenance(w http.ResponseWriter, r *http.Request, state *session) (string, map[string]any, error) {
	windows, err := s.app.ListMaintenance(r.Context())
	if err != nil {
		return "", nil, err
	}
	services, err := s.app.ListServices(r.Context())
	if err != nil {
		return "", nil, err
	}
	return "maintenance.html", map[string]any{"Windows": windows, "Services": services}, nil
}

func (s *Server) pageAdmin(w http.ResponseWriter, r *http.Request, state *session) (string, map[string]any, error) {
	people, err := s.app.ListUsers(r.Context())
	if err != nil {
		return "", nil, err
	}
	keys, err := s.app.ListAPIKeys(r.Context())
	if err != nil {
		return "", nil, err
	}
	return "admin.html", map[string]any{
		"People": people, "Keys": keys, "Clock": s.clockState(),
	}, nil
}

func (s *Server) pageMe(w http.ResponseWriter, r *http.Request, state *session) (string, map[string]any, error) {
	user := state.Actor.User
	if user.Role == "stakeholder" {
		return "me.html", map[string]any{"StakeholderOnly": true}, nil
	}
	url, expires, err := s.app.CalendarTokenURL(r.Context(), user.ID)
	if err != nil {
		return "", nil, err
	}
	delays := make([]string, 0, len(user.NotificationDelays))
	for _, delay := range user.NotificationDelays {
		delays = append(delays, strconv.Itoa(delay))
	}
	return "me.html", map[string]any{
		"CalendarURL": url, "CalendarExpires": expires, "Delays": strings.Join(delays, ", "),
		"Zones": core.KnownZones(),
	}, nil
}

func templateFuncs() template.FuncMap {
	return template.FuncMap{
		"localTime": func(t time.Time, zone string) string {
			return core.LocalTime(t, zoneFor(zone))
		},
		"localTimePtr": func(t *time.Time, zone string) string {
			if t == nil {
				return ""
			}
			return core.LocalTime(*t, zoneFor(zone))
		},
		"instant": func(t time.Time) string { return t.UTC().Format(time.RFC3339) },
		"instantPtr": func(t *time.Time) string {
			if t == nil {
				return ""
			}
			return t.UTC().Format(time.RFC3339)
		},
		"holderNames": func(people []core.PersonRef) string {
			if len(people) == 0 {
				return "Nobody"
			}
			names := make([]string, 0, len(people))
			for _, p := range people {
				names = append(names, p.Name)
			}
			return strings.Join(names, ", ")
		},
		"roleLabel":  core.RoleLabel,
		"stateLabel": core.UpdateStateLabel,
		"add":        func(a, b int) int { return a + b },
		"percent":    func(part, whole int) string { return fmt.Sprintf("%.4f", float64(part)/float64(whole)*100) },
		"countdown":  core.CountdownText,
		"dict": func(values ...any) map[string]any {
			out := map[string]any{}
			for i := 0; i+1 < len(values); i += 2 {
				key, _ := values[i].(string)
				out[key] = values[i+1]
			}
			return out
		},
	}
}
