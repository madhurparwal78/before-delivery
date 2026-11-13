package main

import "fmt"

var seedServices = []struct {
	name, team, policy string
	dependsOn          []string
	grouping           string
	groupingMinutes    *int
	ackTimeout         *int
	autoResolve        *int
}{
	{"Transport Management", "Freight Core", "Transport escalation", []string{"Carrier Data Exchange"}, "none", nil, intPtr(30), nil},
	{"Carrier Data Exchange", "Freight Core", "Carrier escalation", nil, "window", intPtr(5), nil, intPtr(240)},
	{"Shipment Tracking", "Customer Visibility", "Tracking escalation", []string{"Carrier Data Exchange"}, "none", nil, nil, nil},
	{"Customer Portal", "Customer Visibility", "Portal escalation", []string{"Shipment Tracking", "Transport Management"}, "until_resolved", nil, nil, nil},
}

func intPtr(n int) *int { return &n }

func init() {
	seeders = append(seeders, seeder{order: 40, name: "services", fn: seedServiceRows})
}

func seedServiceRows(a *App, w *Work) error {
	ids := map[string]string{}
	for _, service := range seedServices {
		ids[service.name] = newID()
	}
	for _, service := range seedServices {
		var policyID string
		if err := w.Tx.QueryRow(w.Ctx, `select id from policies where name = $1`, service.policy).Scan(&policyID); err != nil {
			return fmt.Errorf("find policy %s: %w", service.policy, err)
		}
		dependsOn := []string{}
		for _, name := range service.dependsOn {
			dependsOn = append(dependsOn, ids[name])
		}
		_, err := w.Tx.Exec(w.Ctx, `insert into services (id, name, team, policy_id, depends_on, grouping_mode, grouping_minutes,
			ack_timeout_minutes, auto_resolve_minutes, version, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 1, $10)`,
			ids[service.name], service.name, service.team, policyID, dependsOn, service.grouping, service.groupingMinutes,
			service.ackTimeout, service.autoResolve, w.Now)
		if err != nil {
			return fmt.Errorf("insert service %s: %w", service.name, err)
		}
	}
	return nil
}
