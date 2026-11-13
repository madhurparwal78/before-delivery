package main

import "fmt"

func init() {
	seeders = append(seeders, seeder{order: 45, name: "integrations", fn: seedIntegrations})
}

var seedMonitors = []struct{ service, name, routingKey string }{
	{"Transport Management", "Transport monitor", "rk_transport_0001"},
	{"Carrier Data Exchange", "Carrier monitor", "rk_carrier_0002"},
	{"Shipment Tracking", "Tracking monitor", "rk_tracking_0003"},
	{"Customer Portal", "Portal monitor", "rk_portal_0004"},
}

// seedIntegrations adds the four monitors of the seed data, each on the service it watches.
func seedIntegrations(_ *App, w *Work) error {
	for _, m := range seedMonitors {
		var serviceID string
		if err := w.Tx.QueryRow(w.Ctx, `select id from services where name = $1`, m.service).Scan(&serviceID); err != nil {
			return fmt.Errorf("find service %s: %w", m.service, err)
		}
		_, err := w.Tx.Exec(w.Ctx, `insert into integrations (id, service_id, name, routing_key, created_at) values ($1, $2, $3, $4, $5)`,
			newID(), serviceID, m.name, m.routingKey, w.Now)
		if err != nil {
			return fmt.Errorf("seed integration %s: %w", m.name, err)
		}
	}
	return nil
}
