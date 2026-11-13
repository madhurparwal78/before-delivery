package core

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

type Service struct {
	ID                 string   `json:"id"`
	Name               string   `json:"name"`
	Team               string   `json:"team"`
	PolicyID           *string  `json:"policy_id"`
	DependsOn          []string `json:"depends_on"`
	GroupingMode       string   `json:"grouping_mode"`
	GroupingMinutes    *int     `json:"grouping_minutes"`
	AckTimeoutMinutes  *int     `json:"ack_timeout_minutes"`
	AutoResolveMinutes *int     `json:"auto_resolve_minutes"`
	Version            int      `json:"version"`
	OwnStatus          string   `json:"own_status"`
	Status             string   `json:"status"`
}

type Policy struct {
	ID      string        `json:"id"`
	Name    string        `json:"name"`
	Repeats int           `json:"repeats"`
	Levels  []PolicyLevel `json:"levels"`
	Version int           `json:"version"`
}

type Integration struct {
	ID         string `json:"id"`
	ServiceID  string `json:"service_id"`
	Name       string `json:"name"`
	RoutingKey string `json:"routing_key"`
}

type MaintenanceWindow struct {
	ID        string    `json:"id"`
	ServiceID string    `json:"service_id"`
	Service   string    `json:"service"`
	StartsAt  time.Time `json:"starts_at"`
	EndsAt    time.Time `json:"ends_at"`
	State     string    `json:"state"`
}

const serviceColumns = `id, name, team, policy_id, grouping_mode, grouping_minutes, ack_timeout_minutes, auto_resolve_minutes, version`

func scanService(row pgx.Row) (*Service, error) {
	var s Service
	if err := row.Scan(&s.ID, &s.Name, &s.Team, &s.PolicyID, &s.GroupingMode, &s.GroupingMinutes,
		&s.AckTimeoutMinutes, &s.AutoResolveMinutes, &s.Version); err != nil {
		return nil, err
	}
	s.DependsOn = []string{}
	return &s, nil
}

func (a *App) ListServices(ctx context.Context) ([]*Service, error) {
	rows, err := a.pool.Query(ctx, `SELECT `+serviceColumns+` FROM services ORDER BY name`)
	if err != nil {
		return nil, fmt.Errorf("list services: %w", err)
	}
	defer rows.Close()
	var out []*Service
	byID := map[string]*Service{}
	for rows.Next() {
		s, err := scanService(rows)
		if err != nil {
			return nil, fmt.Errorf("read service: %w", err)
		}
		out = append(out, s)
		byID[s.ID] = s
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	deps, err := a.pool.Query(ctx, `SELECT service_id, depends_on_id FROM service_deps`)
	if err != nil {
		return nil, fmt.Errorf("read dependencies: %w", err)
	}
	defer deps.Close()
	for deps.Next() {
		var id, dep string
		if err := deps.Scan(&id, &dep); err != nil {
			return nil, fmt.Errorf("read dependency: %w", err)
		}
		if s, ok := byID[id]; ok {
			s.DependsOn = append(s.DependsOn, dep)
		}
	}
	if err := deps.Err(); err != nil {
		return nil, err
	}
	if err := a.fillStatus(ctx, out); err != nil {
		return nil, err
	}
	return out, nil
}

func (a *App) GetService(ctx context.Context, id string) (*Service, error) {
	services, err := a.ListServices(ctx)
	if err != nil {
		return nil, err
	}
	for _, s := range services {
		if s.ID == id {
			return s, nil
		}
	}
	return nil, errNotFound
}

var statusOrder = []string{"Major outage", "Partial outage", "Degraded", "Maintenance", "Operational"}

func worstStatus(a, b string) string {
	for _, s := range statusOrder {
		if a == s || b == s {
			return s
		}
	}
	return "Operational"
}

// fillStatus works out each service's own status and rolls it up by the
// worst-of rule over everything it depends on.
func (a *App) fillStatus(ctx context.Context, services []*Service) error {
	severities := map[string]map[string]bool{}
	rows, err := a.pool.Query(ctx, `SELECT service_id, severity FROM alerts WHERE status <> 'resolved'`)
	if err != nil {
		return fmt.Errorf("read open alerts: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var serviceID, severity string
		if err := rows.Scan(&serviceID, &severity); err != nil {
			return fmt.Errorf("read open alert: %w", err)
		}
		if severities[serviceID] == nil {
			severities[serviceID] = map[string]bool{}
		}
		severities[serviceID][severity] = true
	}
	if err := rows.Err(); err != nil {
		return err
	}
	windows, err := a.RunningMaintenance(ctx)
	if err != nil {
		return err
	}
	inMaintenance := map[string]bool{}
	for _, w := range windows {
		inMaintenance[w.ServiceID] = true
	}
	byID := map[string]*Service{}
	for _, s := range services {
		sev := severities[s.ID]
		switch {
		case sev["critical"]:
			s.OwnStatus = "Major outage"
		case sev["error"]:
			s.OwnStatus = "Partial outage"
		case sev["warning"] || sev["info"]:
			s.OwnStatus = "Degraded"
		case inMaintenance[s.ID]:
			s.OwnStatus = "Maintenance"
		default:
			s.OwnStatus = "Operational"
		}
		byID[s.ID] = s
	}
	var rollup func(id string, seen map[string]bool) string
	rollup = func(id string, seen map[string]bool) string {
		s, ok := byID[id]
		if !ok || seen[id] {
			return "Operational"
		}
		seen[id] = true
		status := s.OwnStatus
		for _, dep := range s.DependsOn {
			status = worstStatus(status, rollup(dep, seen))
		}
		return status
	}
	for _, s := range services {
		s.Status = rollup(s.ID, map[string]bool{})
	}
	return nil
}

func (a *App) saveServiceDeps(ctx context.Context, id string, deps []string) error {
	if _, err := a.pool.Exec(ctx, `DELETE FROM service_deps WHERE service_id=$1`, id); err != nil {
		return fmt.Errorf("clear dependencies: %w", err)
	}
	for _, dep := range deps {
		if _, err := a.pool.Exec(ctx, `INSERT INTO service_deps (service_id, depends_on_id) VALUES ($1,$2)
			ON CONFLICT DO NOTHING`, id, dep); err != nil {
			return fmt.Errorf("save dependency: %w", err)
		}
	}
	return nil
}

type ServiceInput struct {
	Name               string   `json:"name"`
	Team               string   `json:"team"`
	PolicyID           *string  `json:"policy_id"`
	DependsOn          []string `json:"depends_on"`
	GroupingMode       string   `json:"grouping_mode"`
	GroupingMinutes    *int     `json:"grouping_minutes"`
	AckTimeoutMinutes  *int     `json:"ack_timeout_minutes"`
	AutoResolveMinutes *int     `json:"auto_resolve_minutes"`
}

func (a *App) validateService(ctx context.Context, id string, in ServiceInput) error {
	errs := map[string]string{}
	if strings.TrimSpace(in.Name) == "" {
		errs["name"] = "Enter a name."
	}
	if !contains([]string{"none", "window", "until_resolved"}, in.GroupingMode) {
		errs["grouping_mode"] = "Out of range."
	}
	if in.GroupingMode == "window" {
		if in.GroupingMinutes == nil || *in.GroupingMinutes < 1 || *in.GroupingMinutes > 1440 {
			errs["grouping_minutes"] = "Out of range."
		}
	} else if in.GroupingMinutes != nil {
		errs["grouping_minutes"] = "Out of range."
	}
	if in.AckTimeoutMinutes != nil && (*in.AckTimeoutMinutes < 1 || *in.AckTimeoutMinutes > 1440) {
		errs["ack_timeout_minutes"] = "Out of range."
	}
	if in.AutoResolveMinutes != nil && (*in.AutoResolveMinutes < 1 || *in.AutoResolveMinutes > 10080) {
		errs["auto_resolve_minutes"] = "Out of range."
	}
	if len(errs) > 0 {
		return errFieldMap(errs)
	}
	if cycle := a.findCycle(ctx, id, in.Name, in.DependsOn); cycle != "" {
		return errFields("depends_on", "This would make a loop: "+cycle)
	}
	return nil
}

// findCycle names a dependency loop from the edited service back to itself.
func (a *App) findCycle(ctx context.Context, id, name string, dependsOn []string) string {
	services, err := a.ListServices(ctx)
	if err != nil {
		return ""
	}
	names := map[string]string{}
	edges := map[string][]string{}
	for _, s := range services {
		names[s.ID] = s.Name
		edges[s.ID] = s.DependsOn
	}
	if id == "" {
		id = "new-service"
	}
	names[id] = name
	edges[id] = dependsOn
	var path []string
	var walk func(cur string) []string
	visiting := map[string]bool{}
	walk = func(cur string) []string {
		if cur == id && len(path) > 0 {
			return append([]string{}, path...)
		}
		if visiting[cur] {
			return nil
		}
		visiting[cur] = true
		defer func() { visiting[cur] = false }()
		for _, dep := range edges[cur] {
			path = append(path, dep)
			if found := walk(dep); found != nil {
				return found
			}
			path = path[:len(path)-1]
		}
		return nil
	}
	found := walk(id)
	if found == nil {
		return ""
	}
	parts := []string{names[id]}
	for _, step := range found {
		parts = append(parts, names[step])
	}
	return strings.Join(parts, " -> ")
}

func (a *App) CreateService(ctx context.Context, in ServiceInput) (*Service, error) {
	if err := a.validateService(ctx, "", in); err != nil {
		return nil, err
	}
	id := newID()
	if _, err := a.pool.Exec(ctx, `INSERT INTO services (id, name, team, policy_id, grouping_mode, grouping_minutes,
		ack_timeout_minutes, auto_resolve_minutes, version, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,1,$9)`,
		id, in.Name, in.Team, in.PolicyID, in.GroupingMode, in.GroupingMinutes, in.AckTimeoutMinutes,
		in.AutoResolveMinutes, a.Clock.Now()); err != nil {
		return nil, fmt.Errorf("create service: %w", err)
	}
	if err := a.saveServiceDeps(ctx, id, in.DependsOn); err != nil {
		return nil, err
	}
	a.clearStatusCache(ctx)
	return a.GetService(ctx, id)
}

func (a *App) UpdateService(ctx context.Context, id string, in ServiceInput, ifMatch int) (*Service, error) {
	current, err := a.GetService(ctx, id)
	if err != nil {
		return nil, err
	}
	if ifMatch != current.Version {
		return nil, versionConflict(map[string]any{"id": current.ID, "name": current.Name, "version": current.Version})
	}
	if err := a.validateService(ctx, id, in); err != nil {
		return nil, err
	}
	if _, err := a.pool.Exec(ctx, `UPDATE services SET name=$1, team=$2, policy_id=$3, grouping_mode=$4,
		grouping_minutes=$5, ack_timeout_minutes=$6, auto_resolve_minutes=$7, version=version+1 WHERE id=$8`,
		in.Name, in.Team, in.PolicyID, in.GroupingMode, in.GroupingMinutes, in.AckTimeoutMinutes,
		in.AutoResolveMinutes, id); err != nil {
		return nil, fmt.Errorf("save service: %w", err)
	}
	if err := a.saveServiceDeps(ctx, id, in.DependsOn); err != nil {
		return nil, err
	}
	a.clearStatusCache(ctx)
	a.publishStatus(ctx)
	return a.GetService(ctx, id)
}

func versionConflict(current map[string]any) *APIError {
	return &APIError{Status: 412, Body: map[string]any{"error": "version_conflict", "current": current}}
}

func (a *App) ListPolicies(ctx context.Context) ([]*Policy, error) {
	rows, err := a.pool.Query(ctx, `SELECT id, name, repeats, levels, version FROM policies ORDER BY name`)
	if err != nil {
		return nil, fmt.Errorf("list policies: %w", err)
	}
	defer rows.Close()
	var out []*Policy
	for rows.Next() {
		var p Policy
		var levels []byte
		if err := rows.Scan(&p.ID, &p.Name, &p.Repeats, &levels, &p.Version); err != nil {
			return nil, fmt.Errorf("read policy: %w", err)
		}
		if err := json.Unmarshal(levels, &p.Levels); err != nil {
			return nil, fmt.Errorf("read policy levels: %w", err)
		}
		out = append(out, &p)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if err := a.fillTargetNames(ctx, out); err != nil {
		return nil, err
	}
	return out, nil
}

func (a *App) fillTargetNames(ctx context.Context, policies []*Policy) error {
	people, err := a.personNames(ctx)
	if err != nil {
		return err
	}
	schedules, err := a.ListSchedules(ctx)
	if err != nil {
		return err
	}
	scheduleNames := map[string]string{}
	for _, s := range schedules {
		scheduleNames[s.ID] = s.Name
	}
	for _, p := range policies {
		for i := range p.Levels {
			for j := range p.Levels[i].Targets {
				t := &p.Levels[i].Targets[j]
				if t.Type == "person" {
					t.Name = people[t.ID]
				} else {
					t.Name = scheduleNames[t.ID]
				}
			}
		}
	}
	return nil
}

func (a *App) GetPolicy(ctx context.Context, id string) (*Policy, error) {
	policies, err := a.ListPolicies(ctx)
	if err != nil {
		return nil, err
	}
	for _, p := range policies {
		if p.ID == id {
			return p, nil
		}
	}
	return nil, errNotFound
}

type PolicyInput struct {
	Name    string        `json:"name"`
	Repeats int           `json:"repeats"`
	Levels  []PolicyLevel `json:"levels"`
}

func validatePolicy(in PolicyInput) error {
	if strings.TrimSpace(in.Name) == "" {
		return errFields("name", "Enter a name.")
	}
	if len(in.Levels) < 1 || len(in.Levels) > 20 {
		return errFields("levels", "A policy has 1 to 20 levels.")
	}
	if in.Repeats < 0 || in.Repeats > 9 {
		return errFields("repeats", "A policy repeats at most 9 times.")
	}
	for _, level := range in.Levels {
		if len(level.Targets) < 1 || len(level.Targets) > 10 {
			return errFields("targets", "A level has 1 to 10 targets.")
		}
		if len(level.Targets) == 1 && level.TimeoutMinutes < 1 {
			return errFields("timeout_minutes", "Use at least 1 minute with one target.")
		}
		if len(level.Targets) > 1 && level.TimeoutMinutes < 3 {
			return errFields("timeout_minutes", "Use at least 3 minutes with several targets.")
		}
	}
	return nil
}

func normalisePolicyInput(in *PolicyInput) {
	for i := range in.Levels {
		if in.Levels[i].TimeoutMinutes == 0 {
			in.Levels[i].TimeoutMinutes = 30
		}
	}
}

func (a *App) CreatePolicy(ctx context.Context, in PolicyInput) (*Policy, error) {
	normalisePolicyInput(&in)
	if err := validatePolicy(in); err != nil {
		return nil, err
	}
	id := newID()
	levels, err := json.Marshal(in.Levels)
	if err != nil {
		return nil, fmt.Errorf("write policy levels: %w", err)
	}
	if _, err := a.pool.Exec(ctx, `INSERT INTO policies (id, name, repeats, levels, version, created_at)
		VALUES ($1,$2,$3,$4,1,$5)`, id, in.Name, in.Repeats, levels, a.Clock.Now()); err != nil {
		return nil, fmt.Errorf("create policy: %w", err)
	}
	return a.GetPolicy(ctx, id)
}

// UpdatePolicy saves a new version. Running incidents keep the version they
// opened with; later incidents take the edit.
func (a *App) UpdatePolicy(ctx context.Context, id string, in PolicyInput, ifMatch int) (*Policy, int, error) {
	normalisePolicyInput(&in)
	current, err := a.GetPolicy(ctx, id)
	if err != nil {
		return nil, 0, err
	}
	if ifMatch != current.Version {
		return nil, 0, versionConflict(map[string]any{"id": current.ID, "name": current.Name, "version": current.Version})
	}
	if err := validatePolicy(in); err != nil {
		return nil, 0, err
	}
	levels, err := json.Marshal(in.Levels)
	if err != nil {
		return nil, 0, fmt.Errorf("write policy levels: %w", err)
	}
	if _, err := a.pool.Exec(ctx, `UPDATE policies SET name=$1, repeats=$2, levels=$3, version=version+1 WHERE id=$4`,
		in.Name, in.Repeats, levels, id); err != nil {
		return nil, 0, fmt.Errorf("save policy: %w", err)
	}
	var running int
	if err := a.pool.QueryRow(ctx, `SELECT count(*) FROM incidents
		WHERE status <> 'resolved' AND policy_snapshot->>'id' = $1`, id).Scan(&running); err != nil {
		return nil, 0, fmt.Errorf("count running incidents: %w", err)
	}
	updated, err := a.GetPolicy(ctx, id)
	if err != nil {
		return nil, 0, err
	}
	return updated, running, nil
}

func (a *App) ListIntegrations(ctx context.Context) ([]Integration, error) {
	rows, err := a.pool.Query(ctx, `SELECT id, service_id, name, routing_key FROM integrations ORDER BY name`)
	if err != nil {
		return nil, fmt.Errorf("list integrations: %w", err)
	}
	defer rows.Close()
	out := []Integration{}
	for rows.Next() {
		var i Integration
		if err := rows.Scan(&i.ID, &i.ServiceID, &i.Name, &i.RoutingKey); err != nil {
			return nil, fmt.Errorf("read integration: %w", err)
		}
		out = append(out, i)
	}
	return out, rows.Err()
}

func (a *App) GetIntegration(ctx context.Context, id string) (*Integration, error) {
	var i Integration
	err := a.pool.QueryRow(ctx, `SELECT id, service_id, name, routing_key FROM integrations WHERE id=$1`, id).
		Scan(&i.ID, &i.ServiceID, &i.Name, &i.RoutingKey)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, errNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("read integration: %w", err)
	}
	return &i, nil
}

func (a *App) integrationByRoutingKey(ctx context.Context, routingKey string) (*Integration, error) {
	var i Integration
	err := a.pool.QueryRow(ctx, `SELECT id, service_id, name, routing_key FROM integrations WHERE routing_key=$1`, routingKey).
		Scan(&i.ID, &i.ServiceID, &i.Name, &i.RoutingKey)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read integration: %w", err)
	}
	return &i, nil
}

func (a *App) CreateIntegration(ctx context.Context, serviceID, name string) (*Integration, error) {
	if strings.TrimSpace(name) == "" {
		return nil, errFields("name", "Enter a name.")
	}
	if _, err := a.GetService(ctx, serviceID); err != nil {
		return nil, errFields("service_id", "Choose a service.")
	}
	id := newID()
	key := "rk_" + strings.ToLower(randomHex(8))
	if _, err := a.pool.Exec(ctx, `INSERT INTO integrations (id, service_id, name, routing_key, created_at)
		VALUES ($1,$2,$3,$4,$5)`, id, serviceID, name, key, a.Clock.Now()); err != nil {
		return nil, fmt.Errorf("create integration: %w", err)
	}
	return a.GetIntegration(ctx, id)
}

// ListMaintenance lists every window with the word it shows.
func (a *App) ListMaintenance(ctx context.Context) ([]MaintenanceWindow, error) {
	rows, err := a.pool.Query(ctx, `SELECT m.id, m.service_id, s.name, m.starts_at, m.ends_at, m.cancelled_at
		FROM maintenance_windows m JOIN services s ON s.id = m.service_id ORDER BY m.starts_at`)
	if err != nil {
		return nil, fmt.Errorf("list maintenance: %w", err)
	}
	defer rows.Close()
	now := a.Clock.Now()
	out := []MaintenanceWindow{}
	for rows.Next() {
		var w MaintenanceWindow
		var cancelled *time.Time
		if err := rows.Scan(&w.ID, &w.ServiceID, &w.Service, &w.StartsAt, &w.EndsAt, &cancelled); err != nil {
			return nil, fmt.Errorf("read window: %w", err)
		}
		w.StartsAt, w.EndsAt = w.StartsAt.UTC(), w.EndsAt.UTC()
		switch {
		case cancelled != nil || !now.Before(w.EndsAt):
			w.State = "Ended"
		case now.Before(w.StartsAt):
			w.State = "Upcoming"
		default:
			w.State = "Running"
		}
		out = append(out, w)
	}
	return out, rows.Err()
}

func (a *App) RunningMaintenance(ctx context.Context) ([]MaintenanceWindow, error) {
	windows, err := a.ListMaintenance(ctx)
	if err != nil {
		return nil, err
	}
	out := []MaintenanceWindow{}
	for _, w := range windows {
		if w.State == "Running" {
			out = append(out, w)
		}
	}
	return out, nil
}

func (a *App) inMaintenance(ctx context.Context, serviceID string) (bool, error) {
	windows, err := a.RunningMaintenance(ctx)
	if err != nil {
		return false, err
	}
	for _, w := range windows {
		if w.ServiceID == serviceID {
			return true, nil
		}
	}
	return false, nil
}

func (a *App) CreateMaintenance(ctx context.Context, serviceID string, starts, ends time.Time) (*MaintenanceWindow, error) {
	if _, err := a.GetService(ctx, serviceID); err != nil {
		return nil, errFields("service_id", "Choose a service.")
	}
	if !ends.After(starts) {
		return nil, errFields("ends_at", "The window must end after it starts.")
	}
	if starts.Before(a.Clock.Now()) {
		return nil, errFields("starts_at", "The window cannot start in the past.")
	}
	id := newID()
	if _, err := a.pool.Exec(ctx, `INSERT INTO maintenance_windows (id, service_id, starts_at, ends_at, created_at)
		VALUES ($1,$2,$3,$4,$5)`, id, serviceID, starts, ends, a.Clock.Now()); err != nil {
		return nil, fmt.Errorf("create window: %w", err)
	}
	a.clearStatusCache(ctx)
	a.publishStatus(ctx)
	windows, err := a.ListMaintenance(ctx)
	if err != nil {
		return nil, err
	}
	for _, w := range windows {
		if w.ID == id {
			return &w, nil
		}
	}
	return nil, errNotFound
}

func (a *App) DeleteMaintenance(ctx context.Context, id string) error {
	tag, err := a.pool.Exec(ctx, `UPDATE maintenance_windows SET cancelled_at=$1, ends_at=$1
		WHERE id=$2 AND cancelled_at IS NULL`, a.Clock.Now(), id)
	if err != nil {
		return fmt.Errorf("end window: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return errNotFound
	}
	a.clearStatusCache(ctx)
	a.publishStatus(ctx)
	return nil
}

// ServiceTreeNode is one item of the service map.
type ServiceTreeNode struct {
	Service  *Service
	Children []*ServiceTreeNode
}

// ServiceTree builds the map: each top item is a service nothing depends on,
// and each child is a service its parent depends on.
func (a *App) ServiceTree(ctx context.Context) ([]*ServiceTreeNode, error) {
	services, err := a.ListServices(ctx)
	if err != nil {
		return nil, err
	}
	byID := map[string]*Service{}
	dependedOn := map[string]bool{}
	for _, s := range services {
		byID[s.ID] = s
	}
	for _, s := range services {
		for _, dep := range s.DependsOn {
			dependedOn[dep] = true
		}
	}
	var build func(s *Service, depth int) *ServiceTreeNode
	build = func(s *Service, depth int) *ServiceTreeNode {
		node := &ServiceTreeNode{Service: s}
		if depth > 6 {
			return node
		}
		deps := append([]string{}, s.DependsOn...)
		sort.Slice(deps, func(i, j int) bool { return byID[deps[i]].Name < byID[deps[j]].Name })
		for _, dep := range deps {
			if child, ok := byID[dep]; ok {
				node.Children = append(node.Children, build(child, depth+1))
			}
		}
		return node
	}
	var roots []*ServiceTreeNode
	for _, s := range services {
		if !dependedOn[s.ID] {
			roots = append(roots, build(s, 0))
		}
	}
	return roots, nil
}
