package main

import "fmt"

type seedTarget struct{ kind, name string }

type seedLevel struct {
	timeout int
	targets []seedTarget
}

var seedPolicies = []struct {
	name    string
	repeats int
	levels  []seedLevel
}{
	{"Transport escalation", 0, []seedLevel{
		{30, []seedTarget{{"schedule", "Transport Primary"}}},
		{30, []seedTarget{{"person", "Sunniva Okoye"}}},
	}},
	{"Carrier escalation", 0, []seedLevel{
		{10, []seedTarget{{"schedule", "Carrier Data"}}},
		{5, []seedTarget{{"person", "Dario Mbeki"}, {"person", "Sunniva Okoye"}}},
	}},
	{"Tracking escalation", 2, []seedLevel{
		{30, []seedTarget{{"schedule", "Tracking Nights"}}},
		{30, []seedTarget{{"schedule", "Transport Primary"}}},
	}},
	{"Portal escalation", 0, []seedLevel{
		{30, []seedTarget{{"person", "Priya Lindqvist"}}},
	}},
}

func init() {
	seeders = append(seeders, seeder{order: 30, name: "policies", fn: seedPolicyRows})
}

// seedTargetRef resolves a seeded person or schedule by name.
func seedTargetRef(w *Work, target seedTarget) (storedTarget, error) {
	if target.kind == "person" {
		return storedTarget{Type: "person", ID: seededUserIDs[target.name]}, nil
	}
	var id string
	if err := w.Tx.QueryRow(w.Ctx, `select id from schedules where name = $1`, target.name).Scan(&id); err != nil {
		return storedTarget{}, fmt.Errorf("find schedule %s: %w", target.name, err)
	}
	return storedTarget{Type: "schedule", ID: id}, nil
}

func seedPolicyRows(a *App, w *Work) error {
	for _, policy := range seedPolicies {
		levels := make([]storedLevel, 0, len(policy.levels))
		for _, level := range policy.levels {
			stored := storedLevel{TimeoutMinutes: level.timeout}
			for _, target := range level.targets {
				ref, err := seedTargetRef(w, target)
				if err != nil {
					return fmt.Errorf("resolve seed policy target: %w", err)
				}
				stored.Targets = append(stored.Targets, ref)
			}
			levels = append(levels, stored)
		}
		_, err := w.Tx.Exec(w.Ctx, `insert into policies (id, name, repeats, levels, version, created_at) values ($1, $2, $3, $4, 1, $5)`,
			newID(), policy.name, policy.repeats, levels, w.Now)
		if err != nil {
			return fmt.Errorf("insert policy %s: %w", policy.name, err)
		}
	}
	return nil
}
