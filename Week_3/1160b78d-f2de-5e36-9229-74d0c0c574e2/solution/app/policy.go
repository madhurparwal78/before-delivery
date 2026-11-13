package main

import (
	"context"
	"fmt"
	"net/http"
)

const (
	defaultLevelTimeout = 30
	maxRepeats          = 9
	maxLevels           = 20
	maxTargets          = 10

	oneTargetSentence   = "Use at least 1 minute with one target."
	manyTargetsSentence = "Use at least 3 minutes with several targets."
	repeatsSentence     = "A policy repeats at most 9 times."
	levelsSentence      = "A policy has 1 to 20 levels."
	targetsSentence     = "A level has 1 to 10 targets."
)

// storedTarget and storedLevel are a policy's levels as kept in the record; names are looked up when a policy is read.
type storedTarget struct {
	Type string `json:"type"` // person | schedule
	ID   string `json:"id"`
}

type storedLevel struct {
	TimeoutMinutes int            `json:"timeout_minutes"`
	Targets        []storedTarget `json:"targets"`
}

// policyRecord is the published policy.
type policyRecord struct {
	ID string `json:"id"`
	policySnapshot
}

// policySaved is the answer to a PUT: the record and how many running incidents keep the version it replaced.
type policySaved struct {
	policyRecord
	RunningIncidents int `json:"running_incidents"`
}

type policyInput struct {
	Name    string `json:"name"`
	Repeats *int   `json:"repeats"`
	Levels  []struct {
		TimeoutMinutes *int           `json:"timeout_minutes"`
		Targets        []storedTarget `json:"targets"`
	} `json:"levels"`
}

// targetName reads the name of a person or schedule a level targets.
func targetName(ctx context.Context, q dbq, target storedTarget) (string, error) {
	table := map[string]string{"person": "users", "schedule": "schedules"}[target.Type]
	var name string
	if err := q.QueryRow(ctx, `select name from `+table+` where id = $1`, target.ID).Scan(&name); err != nil {
		return "", fmt.Errorf("read %s %s: %w", target.Type, target.ID, err)
	}
	return name, nil
}

// targetExists reports whether a level may name this person or schedule; a removed person cannot be chosen.
func targetExists(ctx context.Context, q dbq, target storedTarget) (bool, error) {
	query := map[string]string{
		"person":   `select exists (select 1 from users where id = $1 and removed_at is null)`,
		"schedule": `select exists (select 1 from schedules where id = $1)`,
	}[target.Type]
	if query == "" {
		return false, nil
	}
	var found bool
	if err := q.QueryRow(ctx, query, target.ID).Scan(&found); err != nil {
		return false, fmt.Errorf("check %s %s: %w", target.Type, target.ID, err)
	}
	return found, nil
}

// loadPolicy reads a policy as it stands, with target names.
func (a *App) loadPolicy(ctx context.Context, q dbq, id string) (policyRecord, error) {
	record := policyRecord{ID: id}
	var levels []storedLevel
	err := q.QueryRow(ctx, `select name, repeats, levels, version from policies where id = $1`, id).
		Scan(&record.Name, &record.Repeats, &levels, &record.Version)
	if err != nil {
		return policyRecord{}, fmt.Errorf("read policy %s: %w", id, err)
	}
	record.Levels = make([]snapshotLevel, 0, len(levels))
	for _, level := range levels {
		published := snapshotLevel{TimeoutMinutes: level.TimeoutMinutes, Targets: make([]snapshotTarget, 0, len(level.Targets))}
		for _, target := range level.Targets {
			name, err := targetName(ctx, q, target)
			if err != nil {
				return policyRecord{}, fmt.Errorf("name policy target: %w", err)
			}
			published.Targets = append(published.Targets, snapshotTarget{Type: target.Type, ID: target.ID, Name: name})
		}
		record.Levels = append(record.Levels, published)
	}
	return record, nil
}

// policySnapshotOf reads a policy as it stands, with target names, for copying into an incident.
func (a *App) policySnapshotOf(ctx context.Context, q dbq, policyID string) (policySnapshot, error) {
	record, err := a.loadPolicy(ctx, q, policyID)
	if err != nil {
		return policySnapshot{}, fmt.Errorf("load policy: %w", err)
	}
	return record.policySnapshot, nil
}

// checkPolicy applies the published limits and returns the repeats and levels to store.
func checkPolicy(ctx context.Context, q dbq, in policyInput) (int, []storedLevel, error) {
	problems := map[string]string{}
	repeats := 0
	if in.Repeats != nil {
		repeats = *in.Repeats
	}
	if repeats < 0 || repeats > maxRepeats {
		problems["repeats"] = repeatsSentence
	}
	if len(in.Levels) < 1 || len(in.Levels) > maxLevels {
		problems["levels"] = levelsSentence
	}
	var levels []storedLevel
	if _, refused := problems["levels"]; !refused {
		for _, level := range in.Levels {
			timeout := defaultLevelTimeout
			if level.TimeoutMinutes != nil {
				timeout = *level.TimeoutMinutes
			}
			stored := storedLevel{TimeoutMinutes: timeout, Targets: level.Targets}
			levels = append(levels, stored)
			if len(level.Targets) < 1 || len(level.Targets) > maxTargets {
				problems["targets"] = targetsSentence
				continue
			}
			for _, target := range level.Targets {
				found, err := targetExists(ctx, q, target)
				if err != nil {
					return 0, nil, fmt.Errorf("check policy target: %w", err)
				}
				if !found {
					problems["targets"] = targetsSentence
				}
			}
			switch {
			case len(level.Targets) == 1 && timeout < 1:
				problems["timeout_minutes"] = oneTargetSentence
			case len(level.Targets) > 1 && timeout < 3:
				problems["timeout_minutes"] = manyTargetsSentence
			}
		}
	}
	if len(problems) > 0 {
		return 0, nil, errFields(problems)
	}
	return repeats, levels, nil
}

func (a *App) hListPolicies(rq *Req) error {
	rows, err := a.db.Query(rq.Ctx(), `select id from policies order by name, created_at, id`)
	if err != nil {
		return fmt.Errorf("list policies: %w", err)
	}
	ids, err := collectIDs(rows)
	if err != nil {
		return fmt.Errorf("list policies: %w", err)
	}
	items := make([]policyRecord, 0, len(ids))
	for _, id := range ids {
		record, err := a.loadPolicy(rq.Ctx(), a.db, id)
		if err != nil {
			return fmt.Errorf("load policy: %w", err)
		}
		items = append(items, record)
	}
	return rq.JSON(http.StatusOK, map[string]any{"items": items})
}

func (a *App) hGetPolicy(rq *Req) error {
	record, err := a.loadPolicy(rq.Ctx(), a.db, rq.Param("id"))
	if err != nil {
		return fmt.Errorf("load policy: %w", err)
	}
	return rq.Record(http.StatusOK, record, record.Version)
}

func (a *App) hCreatePolicy(rq *Req) error {
	var in policyInput
	if err := rq.Decode(&in); err != nil {
		return fmt.Errorf("read policy: %w", err)
	}
	var created policyRecord
	err := a.Do(rq.Ctx(), func(w *Work) error {
		repeats, levels, err := checkPolicy(w.Ctx, w.Tx, in)
		if err != nil {
			return fmt.Errorf("check policy: %w", err)
		}
		id := newID()
		_, err = w.Tx.Exec(w.Ctx, `insert into policies (id, name, repeats, levels, version, created_at) values ($1, $2, $3, $4, 1, $5)`,
			id, in.Name, repeats, levels, w.Now)
		if err != nil {
			return fmt.Errorf("insert policy: %w", err)
		}
		created, err = a.loadPolicy(w.Ctx, w.Tx, id)
		if err != nil {
			return fmt.Errorf("load created policy: %w", err)
		}
		return nil
	})
	if err != nil {
		return fmt.Errorf("create policy: %w", err)
	}
	return rq.JSON(http.StatusCreated, created)
}

func (a *App) hSavePolicy(rq *Req) error {
	version, err := rq.IfMatch()
	if err != nil {
		return fmt.Errorf("read policy version: %w", err)
	}
	var in policyInput
	if err := rq.Decode(&in); err != nil {
		return fmt.Errorf("read policy: %w", err)
	}
	id := rq.Param("id")
	var saved policySaved
	err = a.Do(rq.Ctx(), func(w *Work) error {
		var current int
		var replacedName string
		err := w.Tx.QueryRow(w.Ctx, `select version, name from policies where id = $1 for update`, id).Scan(&current, &replacedName)
		if err != nil {
			return fmt.Errorf("lock policy %s: %w", id, err)
		}
		if current != version {
			stored, err := a.loadPolicy(w.Ctx, w.Tx, id)
			if err != nil {
				return fmt.Errorf("load stored policy: %w", err)
			}
			return errVersionConflict(stored)
		}
		repeats, levels, err := checkPolicy(w.Ctx, w.Tx, in)
		if err != nil {
			return fmt.Errorf("check policy: %w", err)
		}
		err = w.Tx.QueryRow(w.Ctx, `select count(*) from incidents where status <> 'resolved'
			and policy_snapshot ->> 'name' = $1 and (policy_snapshot ->> 'version')::int = $2`, replacedName, current).
			Scan(&saved.RunningIncidents)
		if err != nil {
			return fmt.Errorf("count running incidents: %w", err)
		}
		_, err = w.Tx.Exec(w.Ctx, `update policies set name = $2, repeats = $3, levels = $4, version = version + 1 where id = $1`,
			id, in.Name, repeats, levels)
		if err != nil {
			return fmt.Errorf("update policy %s: %w", id, err)
		}
		if saved.policyRecord, err = a.loadPolicy(w.Ctx, w.Tx, id); err != nil {
			return fmt.Errorf("load saved policy: %w", err)
		}
		w.After(func(ctx context.Context) { a.clearOncallCache(ctx, "") })
		return nil
	})
	if err != nil {
		return fmt.Errorf("save policy: %w", err)
	}
	return rq.JSON(http.StatusOK, saved)
}

func init() {
	routeSetups = append(routeSetups, func(a *App) {
		a.route(route{Pattern: "GET /api/policies", Access: accStaff, Handler: a.hListPolicies})
		a.route(route{Pattern: "GET /api/policies/{id}", Access: accStaff, Resource: "policy", Handler: a.hGetPolicy})
		a.route(route{Pattern: "POST /api/policies", Access: accLead, Handler: a.hCreatePolicy})
		a.route(route{Pattern: "PUT /api/policies/{id}", Access: accLead, Resource: "policy", Handler: a.hSavePolicy})
	})
}
