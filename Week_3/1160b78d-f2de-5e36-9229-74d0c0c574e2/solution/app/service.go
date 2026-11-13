package main

import (
	"context"
	"fmt"
	"net/http"
	"strings"
)

const (
	outOfRange            = "Out of range."
	chooseServiceSentence = "Choose a service."
	loopSentence          = "This would make a loop: "
	maxGroupMinutes       = 1440
	maxAckMinutes         = 1440
	maxAutoResolveMin     = 10080
)

var groupingModes = map[string]bool{"none": true, "window": true, "until_resolved": true}

// serviceRecord is the published service with its own and shown status.
type serviceRecord struct {
	ID                 string   `json:"id"`
	Name               string   `json:"name"`
	Team               string   `json:"team"`
	PolicyID           string   `json:"policy_id"`
	DependsOn          []string `json:"depends_on"`
	GroupingMode       string   `json:"grouping_mode"`
	GroupingMinutes    *int     `json:"grouping_minutes"`
	AckTimeoutMinutes  *int     `json:"ack_timeout_minutes"`
	AutoResolveMinutes *int     `json:"auto_resolve_minutes"`
	OwnStatus          string   `json:"own_status"`
	Status             string   `json:"status"`
	Version            int      `json:"version"`
}

type serviceInput struct {
	Name               string   `json:"name"`
	Team               string   `json:"team"`
	PolicyID           string   `json:"policy_id"`
	DependsOn          []string `json:"depends_on"`
	GroupingMode       string   `json:"grouping_mode"`
	GroupingMinutes    *int     `json:"grouping_minutes"`
	AckTimeoutMinutes  *int     `json:"ack_timeout_minutes"`
	AutoResolveMinutes *int     `json:"auto_resolve_minutes"`
}

const serviceColumns = `id, name, team, policy_id, depends_on, grouping_mode, grouping_minutes, ack_timeout_minutes,
	auto_resolve_minutes, version`

func (r *serviceRecord) scanFrom(row interface{ Scan(...any) error }) error {
	if err := row.Scan(&r.ID, &r.Name, &r.Team, &r.PolicyID, &r.DependsOn, &r.GroupingMode, &r.GroupingMinutes,
		&r.AckTimeoutMinutes, &r.AutoResolveMinutes, &r.Version); err != nil {
		return fmt.Errorf("scan service: %w", err)
	}
	return nil
}

// loadServices reads every service, or the one named, with the status it shows at the server clock.
func (a *App) loadServices(ctx context.Context, q dbq, id string) ([]serviceRecord, error) {
	standings, err := a.serviceStandings(ctx, q, a.clock.Now())
	if err != nil {
		return nil, fmt.Errorf("rate services: %w", err)
	}
	rows, err := q.Query(ctx, `select `+serviceColumns+` from services where $1 = '' or id = $1 order by name, id`, id)
	if err != nil {
		return nil, fmt.Errorf("read services: %w", err)
	}
	defer rows.Close()
	records := []serviceRecord{}
	for rows.Next() {
		var record serviceRecord
		if err := record.scanFrom(rows); err != nil {
			return nil, fmt.Errorf("scan service: %w", err)
		}
		record.OwnStatus, record.Status = standings[record.ID].Own, standings[record.ID].Shown
		records = append(records, record)
	}
	if err := rows.Err(); err != nil {
		return records, fmt.Errorf("read services: %w", err)
	}
	return records, nil
}

func (a *App) loadService(ctx context.Context, q dbq, id string) (serviceRecord, error) {
	records, err := a.loadServices(ctx, q, id)
	if err != nil {
		return serviceRecord{}, fmt.Errorf("load services: %w", err)
	}
	return records[0], nil
}

// loopThrough names the cycle the edited service would join through its new dependencies, from the service back to
// itself, or nil when there is none.
func loopThrough(graph map[string]catalogService, edited string, dependsOn []string) []string {
	for _, dependency := range dependsOn {
		if path := pathBack(graph, dependency, edited, map[string]bool{}); path != nil {
			return append([]string{graph[edited].Name}, path...)
		}
	}
	return nil
}

// pathBack follows dependencies from one service to a target and names every service on the way.
func pathBack(graph map[string]catalogService, from, target string, seen map[string]bool) []string {
	if from == target {
		return []string{graph[from].Name}
	}
	if seen[from] {
		return nil
	}
	seen[from] = true
	for _, next := range graph[from].DependsOn {
		if rest := pathBack(graph, next, target, seen); rest != nil {
			return append([]string{graph[from].Name}, rest...)
		}
	}
	return nil
}

// withinMinutes reports whether an optional value is empty or between 1 and the limit.
func withinMinutes(value *int, limit int) bool {
	return value == nil || (*value >= 1 && *value <= limit)
}

// checkService applies the published limits; editedID is empty for a new service.
func (a *App) checkService(ctx context.Context, q dbq, editedID string, in serviceInput) error {
	problems := map[string]string{}
	switch {
	case !groupingModes[in.GroupingMode]:
		problems["grouping_mode"] = outOfRange
	case in.GroupingMode == "window" && (in.GroupingMinutes == nil || !withinMinutes(in.GroupingMinutes, maxGroupMinutes)):
		problems["grouping_minutes"] = outOfRange
	case in.GroupingMode != "window" && in.GroupingMinutes != nil:
		problems["grouping_minutes"] = outOfRange
	}
	if !withinMinutes(in.AckTimeoutMinutes, maxAckMinutes) {
		problems["ack_timeout_minutes"] = outOfRange
	}
	if !withinMinutes(in.AutoResolveMinutes, maxAutoResolveMin) {
		problems["auto_resolve_minutes"] = outOfRange
	}
	var policyFound bool
	if err := q.QueryRow(ctx, `select exists (select 1 from policies where id = $1)`, in.PolicyID).Scan(&policyFound); err != nil {
		return fmt.Errorf("check policy %s: %w", in.PolicyID, err)
	}
	if !policyFound {
		problems["policy_id"] = outOfRange
	}
	graph, err := loadServiceGraph(ctx, q)
	if err != nil {
		return fmt.Errorf("load service graph: %w", err)
	}
	for _, dependency := range in.DependsOn {
		if _, found := graph[dependency]; !found {
			problems["depends_on"] = outOfRange
		}
	}
	if _, refused := problems["depends_on"]; !refused && editedID != "" {
		if chain := loopThrough(graph, editedID, in.DependsOn); chain != nil {
			problems["depends_on"] = loopSentence + strings.Join(chain, " -> ")
		}
	}
	if len(problems) > 0 {
		return errFields(problems)
	}
	return nil
}

func (a *App) hListServices(rq *Req) error {
	items, err := a.loadServices(rq.Ctx(), a.db, "")
	if err != nil {
		return fmt.Errorf("list services: %w", err)
	}
	return rq.JSON(http.StatusOK, map[string]any{"items": items})
}

func (a *App) hGetService(rq *Req) error {
	record, err := a.loadService(rq.Ctx(), a.db, rq.Param("id"))
	if err != nil {
		return fmt.Errorf("load service: %w", err)
	}
	return rq.Record(http.StatusOK, record, record.Version)
}

// catalogChanged is what every service or maintenance change does once committed: the cached copies go and open
// screens refetch.
func (w *Work) catalogChanged() {
	w.After(func(ctx context.Context) {
		w.A.clearStatusCache(ctx)
		w.A.clearOncallCache(ctx, "")
	})
	w.Publish("status", map[string]any{})
}

func (a *App) hCreateService(rq *Req) error {
	var in serviceInput
	if err := rq.Decode(&in); err != nil {
		return fmt.Errorf("read service: %w", err)
	}
	var created serviceRecord
	err := a.Do(rq.Ctx(), func(w *Work) error {
		if err := a.checkService(w.Ctx, w.Tx, "", in); err != nil {
			return fmt.Errorf("check service: %w", err)
		}
		id := newID()
		_, err := w.Tx.Exec(w.Ctx, `insert into services (id, name, team, policy_id, depends_on, grouping_mode, grouping_minutes,
			ack_timeout_minutes, auto_resolve_minutes, version, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 1, $10)`,
			id, in.Name, in.Team, in.PolicyID, dependencyIDs(in), in.GroupingMode, in.GroupingMinutes, in.AckTimeoutMinutes,
			in.AutoResolveMinutes, w.Now)
		if err != nil {
			return fmt.Errorf("insert service: %w", err)
		}
		if created, err = a.loadService(w.Ctx, w.Tx, id); err != nil {
			return fmt.Errorf("load created service: %w", err)
		}
		w.catalogChanged()
		return nil
	})
	if err != nil {
		return fmt.Errorf("create service: %w", err)
	}
	return rq.JSON(http.StatusCreated, created)
}

func (a *App) hSaveService(rq *Req) error {
	version, err := rq.IfMatch()
	if err != nil {
		return fmt.Errorf("read service version: %w", err)
	}
	var in serviceInput
	if err := rq.Decode(&in); err != nil {
		return fmt.Errorf("read service: %w", err)
	}
	id := rq.Param("id")
	var saved serviceRecord
	err = a.Do(rq.Ctx(), func(w *Work) error {
		var current int
		if err := w.Tx.QueryRow(w.Ctx, `select version from services where id = $1 for update`, id).Scan(&current); err != nil {
			return fmt.Errorf("lock service %s: %w", id, err)
		}
		if current != version {
			stored, err := a.loadService(w.Ctx, w.Tx, id)
			if err != nil {
				return fmt.Errorf("load stored service: %w", err)
			}
			return errVersionConflict(stored)
		}
		if err := a.checkService(w.Ctx, w.Tx, id, in); err != nil {
			return fmt.Errorf("check service: %w", err)
		}
		_, err := w.Tx.Exec(w.Ctx, `update services set name = $2, team = $3, policy_id = $4, depends_on = $5, grouping_mode = $6,
			grouping_minutes = $7, ack_timeout_minutes = $8, auto_resolve_minutes = $9, version = version + 1 where id = $1`,
			id, in.Name, in.Team, in.PolicyID, dependencyIDs(in), in.GroupingMode, in.GroupingMinutes, in.AckTimeoutMinutes,
			in.AutoResolveMinutes)
		if err != nil {
			return fmt.Errorf("update service %s: %w", id, err)
		}
		if saved, err = a.loadService(w.Ctx, w.Tx, id); err != nil {
			return fmt.Errorf("load saved service: %w", err)
		}
		w.catalogChanged()
		return nil
	})
	if err != nil {
		return fmt.Errorf("save service: %w", err)
	}
	return rq.JSON(http.StatusOK, saved)
}

// dependencyIDs is the input's dependencies, never nil, for the text[] column.
func dependencyIDs(in serviceInput) []string { return append([]string{}, in.DependsOn...) }

func init() {
	routeSetups = append(routeSetups, func(a *App) {
		a.route(route{Pattern: "GET /api/services", Access: accStaff, Handler: a.hListServices})
		a.route(route{Pattern: "GET /api/services/{id}", Access: accStaff, Resource: "service", Handler: a.hGetService})
		a.route(route{Pattern: "POST /api/services", Access: accAdmin, Handler: a.hCreateService})
		a.route(route{Pattern: "PUT /api/services/{id}", Access: accAdmin, Resource: "service", Handler: a.hSaveService})
	})
}
