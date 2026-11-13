package main

import (
	"context"
	"encoding/csv"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"sort"
	"strconv"
	"time"
)

const (
	dateLayout      = "2006-01-02"
	analyticsPoll   = 250 * time.Millisecond
	analyticsStep   = time.Second
	defaultRangeLen = 29
	allServices     = "All services"
)

var csvHeader = []string{"name", "incidents", "mtta_minutes", "mttr_minutes"}

// jobView is an analytics job as published; rows and overall are null while it runs.
type jobView struct {
	ID      string         `json:"id"`
	From    string         `json:"from"`
	To      string         `json:"to"`
	State   string         `json:"state"`
	Done    int            `json:"done"`
	Total   int            `json:"total"`
	Cached  bool           `json:"cached"`
	Rows    []measureRow   `json:"rows"`
	Overall *measureTotals `json:"overall"`
}

// dateRange is the days a job covers, both ends included, in the firm's zone.
type dateRange struct {
	from, to string
	zone     *time.Location
}

// bounds are the instants the range starts at (its first midnight) and ends before (the midnight after its last day).
func (r dateRange) bounds() (time.Time, time.Time, error) {
	start, err := time.ParseInLocation(dateLayout, r.from, r.zone)
	if err != nil {
		return time.Time{}, time.Time{}, fmt.Errorf("read range start %q: %w", r.from, err)
	}
	last, err := time.ParseInLocation(dateLayout, r.to, r.zone)
	if err != nil {
		return time.Time{}, time.Time{}, fmt.Errorf("read range end %q: %w", r.to, err)
	}
	year, month, day := last.Date()
	return start, time.Date(year, month, day+1, 0, 0, 0, 0, r.zone), nil
}

func (r dateRange) cacheKey(a *App) string { return a.cfg.cacheKey("cache", "analytics", r.from, r.to) }

// readRange applies the defaults: the end is today in the firm's zone on the server clock, the start 29 days before it.
func (a *App) readRange(from, to *string) (dateRange, error) {
	zone, err := time.LoadLocation(firmZone)
	if err != nil {
		return dateRange{}, fmt.Errorf("load the firm's zone: %w", err)
	}
	problems := map[string]string{}
	parse := func(field string, value *string) (time.Time, bool) {
		if value == nil || *value == "" {
			return time.Time{}, false
		}
		parsed, err := time.ParseInLocation(dateLayout, *value, zone)
		if err != nil {
			problems[field] = "Use the format YYYY-MM-DD."
		}
		return parsed, err == nil
	}
	end, hasEnd := parse("to", to)
	start, hasStart := parse("from", from)
	if len(problems) > 0 {
		return dateRange{}, errFields(problems)
	}
	if !hasEnd {
		end = a.clock.Now().In(zone)
		year, month, day := end.Date()
		end = time.Date(year, month, day, 0, 0, 0, 0, zone)
	}
	if !hasStart {
		start = end.AddDate(0, 0, -defaultRangeLen)
	}
	if end.Before(start) {
		return dateRange{}, errField("to", "The range must end on or after its start.")
	}
	return dateRange{from: start.Format(dateLayout), to: end.Format(dateLayout), zone: zone}, nil
}

// rangeFingerprint is what the measures of a range depend on: the services, and the range's incidents with the timeline
// entries the measures read. It changes whenever an incident opened in the range changes in a way a measure can see.
func (a *App) rangeFingerprint(ctx context.Context, q dbq, from, to time.Time) (string, error) {
	var services string
	var incidents, resolved, entries int
	err := q.QueryRow(ctx, `select (select md5(coalesce(string_agg(id || name || team, ',' order by id), '')) from services),
		count(distinct i.id), count(distinct i.id) filter (where i.status = 'resolved'), count(t.id)
		from incidents i left join timeline t on t.incident_id = i.id and t.from_number is null and t.kind = any($3)
		where i.opened_at >= $1 and i.opened_at < $2`, from, to, measureKinds).Scan(&services, &incidents, &resolved, &entries)
	if err != nil {
		return "", fmt.Errorf("fingerprint the range: %w", err)
	}
	return fmt.Sprintf("%s:%d:%d:%d", services, incidents, resolved, entries), nil
}

// cachedResult reads the range's finished result from Valkey when it still matches the range's incidents.
func (a *App) cachedResult(ctx context.Context, r dateRange, fingerprint string) ([]measureRow, *measureTotals, bool) {
	fields, found := a.cache.Hash(ctx, r.cacheKey(a))
	if !found || fields["fingerprint"] != fingerprint {
		return nil, nil, false
	}
	var rows []measureRow
	var overall measureTotals
	if json.Unmarshal([]byte(fields["rows"]), &rows) != nil || json.Unmarshal([]byte(fields["overall"]), &overall) != nil {
		return nil, nil, false
	}
	return rows, &overall, true
}

func (a *App) hStartJob(rq *Req) error {
	var body struct {
		From *string `json:"from"`
		To   *string `json:"to"`
	}
	if err := rq.Decode(&body); err != nil {
		return fmt.Errorf("read job request: %w", err)
	}
	r, err := a.readRange(body.From, body.To)
	if err != nil {
		return fmt.Errorf("read range: %w", err)
	}
	from, to, err := r.bounds()
	if err != nil {
		return fmt.Errorf("bound range: %w", err)
	}
	fingerprint, err := a.rangeFingerprint(rq.Ctx(), a.db, from, to)
	if err != nil {
		return fmt.Errorf("fingerprint range: %w", err)
	}
	rows, overall, cached := a.cachedResult(rq.Ctx(), r, fingerprint)
	var job jobView
	err = a.Do(rq.Ctx(), func(w *Work) error {
		running, found, err := a.runningJob(w, r)
		if err != nil {
			return fmt.Errorf("check running job: %w", err)
		}
		if found {
			job = running
			return nil
		}
		plan, err := planServices(w)
		if err != nil {
			return fmt.Errorf("plan job: %w", err)
		}
		job = jobView{ID: newID(), From: r.from, To: r.to, State: "running", Total: len(plan)}
		if cached {
			job.State, job.Done, job.Cached, job.Rows, job.Overall = "done", job.Total, true, rows, overall
		}
		_, err = w.Tx.Exec(w.Ctx, `insert into analytics_jobs (id, from_date, to_date, state, done, total, cached, plan, fingerprint,
			rows, overall, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
			job.ID, job.From, job.To, job.State, job.Done, job.Total, job.Cached, plan, fingerprint, job.Rows, job.Overall, w.Now)
		if err != nil {
			return fmt.Errorf("insert analytics job: %w", err)
		}
		return nil
	})
	if err != nil {
		return fmt.Errorf("start analytics job: %w", err)
	}
	if job.Cached {
		return rq.JSON(http.StatusOK, job)
	}
	return rq.JSON(http.StatusAccepted, job)
}

// runningJob is the job already running for the range, if any: one job per range at a time.
func (a *App) runningJob(w *Work, r dateRange) (job jobView, found bool, err error) {
	err = w.Tx.QueryRow(w.Ctx, `select id, from_date, to_date, state, done, total, cached, rows, overall from analytics_jobs
		where from_date = $1 and to_date = $2 and state = 'running'`, r.from, r.to).
		Scan(&job.ID, &job.From, &job.To, &job.State, &job.Done, &job.Total, &job.Cached, &job.Rows, &job.Overall)
	if isNoRows(err) {
		return job, false, nil
	}
	if err != nil {
		return job, false, fmt.Errorf("find running job: %w", err)
	}
	return job, true, nil
}

// planServices lists the services a job will measure, by name.
func planServices(w *Work) ([]plannedService, error) {
	rows, err := w.Tx.Query(w.Ctx, `select id, name, team from services`)
	if err != nil {
		return nil, fmt.Errorf("list services: %w", err)
	}
	defer rows.Close()
	plan := []plannedService{}
	for rows.Next() {
		var service plannedService
		if err := rows.Scan(&service.ID, &service.Name, &service.Team); err != nil {
			return nil, fmt.Errorf("scan service: %w", err)
		}
		plan = append(plan, service)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("list services: %w", err)
	}
	sort.Slice(plan, func(i, j int) bool { return plan[i].Name < plan[j].Name })
	return plan, nil
}

func (a *App) loadJob(ctx context.Context, id string) (jobView, error) {
	var job jobView
	err := a.db.QueryRow(ctx, `select id, from_date, to_date, state, done, total, cached, rows, overall from analytics_jobs where id = $1`, id).
		Scan(&job.ID, &job.From, &job.To, &job.State, &job.Done, &job.Total, &job.Cached, &job.Rows, &job.Overall)
	if err != nil {
		return job, fmt.Errorf("read analytics job %s: %w", id, err)
	}
	return job, nil
}

func (a *App) hJob(rq *Req) error {
	job, err := a.loadJob(rq.Ctx(), rq.Param("id"))
	if err != nil {
		return fmt.Errorf("load job: %w", err)
	}
	return rq.JSON(http.StatusOK, job)
}

// hDownloadJob serves the same strings the table shows.
func (a *App) hDownloadJob(rq *Req) error {
	job, err := a.loadJob(rq.Ctx(), rq.Param("id"))
	if err != nil {
		return fmt.Errorf("load job: %w", err)
	}
	if job.State == "running" {
		return errConflict("job_running")
	}
	rq.W.Header().Set("Content-Type", "text/csv")
	rq.W.Header().Set("Content-Disposition", `attachment; filename="response-measures-`+job.From+`-`+job.To+`.csv"`)
	out := csv.NewWriter(rq.W)
	lines := [][]string{csvHeader}
	for _, row := range job.Rows {
		lines = append(lines, []string{row.Name, strconv.Itoa(row.Incidents), row.MttaMinutes, row.MttrMinutes})
	}
	lines = append(lines, []string{allServices, strconv.Itoa(job.Overall.Incidents), job.Overall.MttaMinutes, job.Overall.MttrMinutes})
	if err := out.WriteAll(lines); err != nil {
		return fmt.Errorf("write response measures: %w", err)
	}
	return nil
}

// analyticsRunner measures running jobs, each in its own goroutine, whether or not anyone has a page open. A job found
// running at start, or left so by a restart, carries on from the services it had already measured.
type analyticsRunner struct {
	a       *App
	started *claimSet
}

func init() {
	workerSetups = append(workerSetups, func(a *App, ctx context.Context) {
		go (&analyticsRunner{a: a, started: newClaimSet()}).run(ctx)
	})
	routeSetups = append(routeSetups, func(a *App) {
		a.route(route{Pattern: "POST /api/analytics/jobs", Access: accStaff, Handler: a.hStartJob})
		a.route(route{Pattern: "GET /api/analytics/jobs/{id}", Access: accStaff, Resource: "job", Handler: a.hJob})
		a.route(route{Pattern: "GET /api/analytics/jobs/{id}/download", Access: accStaff, Resource: "job", Handler: a.hDownloadJob})
	})
}

func (r *analyticsRunner) run(ctx context.Context) {
	ticker := time.NewTicker(analyticsPoll)
	defer ticker.Stop()
	for {
		if err := r.startRunning(ctx); err != nil && ctx.Err() == nil {
			log.Printf("analytics runner: %v", err)
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func (r *analyticsRunner) startRunning(ctx context.Context) error {
	rows, err := r.a.db.Query(ctx, `select id from analytics_jobs where state = 'running' order by created_at`)
	if err != nil {
		return fmt.Errorf("find running jobs: %w", err)
	}
	ids, err := collectIDs(rows)
	if err != nil {
		return fmt.Errorf("find running jobs: %w", err)
	}
	for _, id := range ids {
		if r.started.claim(id) {
			go r.measure(ctx, id)
		}
	}
	return nil
}

func (r *analyticsRunner) measure(ctx context.Context, id string) {
	defer r.started.release(id)
	if err := r.a.runJob(ctx, id); err != nil && ctx.Err() == nil {
		log.Printf("analytics job %s: %v", id, err)
	}
}

// runJob measures the job's services one at a time, taking at least one real second over each and telling every open screen
// the new done count, then totals the rows.
func (a *App) runJob(ctx context.Context, id string) error {
	var r dateRange
	var plan []plannedService
	var measured []serviceMeasure
	var fingerprint string
	err := a.db.QueryRow(ctx, `select from_date, to_date, plan, measured, fingerprint from analytics_jobs where id = $1`, id).
		Scan(&r.from, &r.to, &plan, &measured, &fingerprint)
	if err != nil {
		return fmt.Errorf("load job: %w", err)
	}
	zone, err := time.LoadLocation(firmZone)
	if err != nil {
		return fmt.Errorf("load the firm's zone: %w", err)
	}
	r.zone = zone
	from, to, err := r.bounds()
	if err != nil {
		return fmt.Errorf("bound range: %w", err)
	}
	for _, service := range plan[len(measured):] {
		measure, err := a.measureService(ctx, zone, service, from, to)
		if err != nil {
			return fmt.Errorf("measure service: %w", err)
		}
		select {
		case <-ctx.Done():
			return fmt.Errorf("measure %s: %w", service.Name, ctx.Err())
		case <-time.After(analyticsStep):
		}
		measured = append(measured, measure)
		if err := a.saveProgress(ctx, id, r, plan, measured, fingerprint); err != nil {
			return fmt.Errorf("save job progress: %w", err)
		}
	}
	return nil
}

// saveProgress records a measured service. After the last one the job is done and its result is cached before the
// response of the first request that finds it done.
func (a *App) saveProgress(ctx context.Context, id string, r dateRange, plan []plannedService, measured []serviceMeasure, fingerprint string) error {
	if err := a.Do(ctx, func(w *Work) error {
		state := "running"
		var rows []measureRow
		var overall *measureTotals
		if len(measured) == len(plan) {
			state = "done"
			rows, overall = totalRows(measured)
		}
		_, err := w.Tx.Exec(w.Ctx, `update analytics_jobs set state = $2, done = $3, measured = $4, rows = $5, overall = $6 where id = $1`,
			id, state, len(measured), measured, rows, overall)
		if err != nil {
			return fmt.Errorf("save job progress: %w", err)
		}
		if state == "done" {
			w.After(func(ctx context.Context) { a.cacheResult(ctx, r, fingerprint, rows, overall) })
		}
		w.Publish("analytics", map[string]any{"job_id": id, "state": state, "done": len(measured), "total": len(plan)})
		return nil
	}); err != nil {
		return fmt.Errorf("save analytics progress: %w", err)
	}
	return nil
}

func (a *App) cacheResult(ctx context.Context, r dateRange, fingerprint string, rows []measureRow, overall *measureTotals) {
	encodedRows, err := json.Marshal(rows)
	if err != nil {
		log.Printf("encode analytics rows: %v", err)
		return
	}
	encodedOverall, err := json.Marshal(overall)
	if err != nil {
		log.Printf("encode analytics totals: %v", err)
		return
	}
	a.cache.SetHash(ctx, r.cacheKey(a), map[string]any{
		"fingerprint": fingerprint, "rows": encodedRows, "overall": encodedOverall,
	}, 0)
}

// totalRows builds the table from the services in the plan's order (by name): the services, then each team by name, and the figures of the whole firm. A team's
// figures come from all its incidents' seconds.
func totalRows(measured []serviceMeasure) ([]measureRow, *measureTotals) {
	teams := map[string]*tally{}
	var all tally
	rows := []measureRow{}
	for _, service := range measured {
		rows = append(rows, measureRow{Name: service.Name, Kind: "service", measureTotals: service.totals()})
		if teams[service.Team] == nil {
			teams[service.Team] = &tally{}
		}
		teams[service.Team].add(service.tally)
		all.add(service.tally)
	}
	names := make([]string, 0, len(teams))
	for name := range teams {
		names = append(names, name)
	}
	sort.Strings(names)
	for _, name := range names {
		rows = append(rows, measureRow{Name: name, Kind: "team", measureTotals: teams[name].totals()})
	}
	overall := all.totals()
	return rows, &overall
}
