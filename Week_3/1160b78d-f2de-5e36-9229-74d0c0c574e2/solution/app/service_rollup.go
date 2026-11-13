package main

import (
	"context"
	"fmt"
	"time"
)

// The five status words, worst first. This list and worse are the only place the worst-of order lives.
const (
	statusMajor       = "Major outage"
	statusPartial     = "Partial outage"
	statusDegraded    = "Degraded"
	statusMaintenance = "Maintenance"
	statusOperational = "Operational"
)

var statusRank = map[string]int{statusMajor: 0, statusPartial: 1, statusDegraded: 2, statusMaintenance: 3, statusOperational: 4}

// severityStatus is the status an open alert of each severity gives its service.
var severityStatus = map[string]string{"critical": statusMajor, "error": statusPartial, "warning": statusDegraded, "info": statusDegraded}

// worse is the worse of two status words; an empty word stands for no status yet.
func worse(a, b string) string {
	if a == "" || statusRank[b] < statusRank[a] {
		return b
	}
	return a
}

// catalogService is a service as the dependency graph sees it.
type catalogService struct {
	ID        string
	Name      string
	DependsOn []string
}

// loadServiceGraph reads every service with its dependencies, by id.
func loadServiceGraph(ctx context.Context, q dbq) (map[string]catalogService, error) {
	rows, err := q.Query(ctx, `select id, name, depends_on from services`)
	if err != nil {
		return nil, fmt.Errorf("read services: %w", err)
	}
	defer rows.Close()
	graph := map[string]catalogService{}
	for rows.Next() {
		var service catalogService
		if err := rows.Scan(&service.ID, &service.Name, &service.DependsOn); err != nil {
			return nil, fmt.Errorf("scan service: %w", err)
		}
		graph[service.ID] = service
	}
	if err := rows.Err(); err != nil {
		return graph, fmt.Errorf("read service graph: %w", err)
	}
	return graph, nil
}

// standing is a service's own and shown status.
type standing struct {
	Name  string
	Own   string
	Shown string
}

// serviceStandings is THE status rollup: each service's own status from its open alerts and running maintenance at an
// instant, and its shown status, the worst of its own and every service it depends on, directly or not.
func (a *App) serviceStandings(ctx context.Context, q dbq, at time.Time) (map[string]standing, error) {
	graph, err := loadServiceGraph(ctx, q)
	if err != nil {
		return nil, fmt.Errorf("load service graph: %w", err)
	}
	own := map[string]string{}
	rows, err := q.Query(ctx, `select distinct i.service_id, a.severity from alerts a join incidents i on i.id = a.incident_id
		where i.status <> 'resolved' and a.status <> 'resolved'`)
	if err != nil {
		return nil, fmt.Errorf("read open alerts: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var serviceID, severity string
		if err := rows.Scan(&serviceID, &severity); err != nil {
			return nil, fmt.Errorf("scan open alert: %w", err)
		}
		own[serviceID] = worse(own[serviceID], severityStatus[severity])
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("read open alerts: %w", err)
	}
	windows, err := loadWindows(ctx, q, "")
	if err != nil {
		return nil, fmt.Errorf("load maintenance windows: %w", err)
	}
	for _, window := range windows {
		if window.stateAt(at) == windowRunning && own[window.ServiceID] == "" {
			own[window.ServiceID] = statusMaintenance
		}
	}
	shown := map[string]string{}
	var shownOf func(id string) string
	shownOf = func(id string) string {
		if status, done := shown[id]; done {
			return status
		}
		status := worse(own[id], statusOperational)
		for _, dependency := range graph[id].DependsOn {
			status = worse(status, shownOf(dependency))
		}
		shown[id] = status
		return status
	}
	standings := make(map[string]standing, len(graph))
	for id, service := range graph {
		standings[id] = standing{Name: service.Name, Own: worse(own[id], statusOperational), Shown: shownOf(id)}
	}
	return standings, nil
}
