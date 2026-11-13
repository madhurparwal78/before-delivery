package main

import "fmt"

// seedLayer is one layer of a seeded schedule; People are names resolved through seededUserIDs.
type seedLayer struct {
	name         string
	order        int
	shiftDays    int
	handoff      string
	start        string
	people       []string
	restrictions []restrictionSpec
}

type seedSchedule struct {
	name, zone   string
	recordFormat int
	layers       []seedLayer
}

var everyDay = []string{"mon", "tue", "wed", "thu", "fri", "sat", "sun"}

var seedSchedules = []seedSchedule{
	{"Transport Primary", "America/Chicago", 2, []seedLayer{
		{"Primary days", 1, 1, "08:00", "2026-01-05", []string{"Ines Varga", "Tomasz Reyes", "Priya Lindqvist", "Mateus Oyelaran"}, nil},
	}},
	{"Carrier Data", "America/Chicago", 2, []seedLayer{
		{"Base week", 1, 7, "09:00", "2026-01-05", []string{"Tomasz Reyes", "Ines Varga"}, nil},
		{"Weekend cover", 2, 7, "00:00", "2026-01-03", []string{"Mateus Oyelaran", "Priya Lindqvist"},
			[]restrictionSpec{{Days: []string{"sat", "sun"}, Start: "00:00", End: "24:00"}}},
	}},
	{"Tracking Nights", "Europe/Berlin", 2, []seedLayer{
		{"Nights", 1, 1, "20:00", "2026-01-05", []string{"Mateus Oyelaran", "Priya Lindqvist"},
			[]restrictionSpec{{Days: everyDay, Start: "20:00", End: "06:00"}}},
	}},
	// The older record keeps its handoff as a UTC time: 14:00 UTC is 08:00 in America/Chicago once upgraded.
	{"Legacy Yard Rota", "America/Chicago", 1, []seedLayer{
		{"Yard week", 1, 7, "14:00", "2026-01-05", []string{"Ines Varga", "Tomasz Reyes"}, nil},
	}},
}

func init() {
	seeders = append(seeders, seeder{order: 20, name: "schedules", fn: seedScheduleRows})
}

func seedScheduleRows(a *App, w *Work) error {
	for _, s := range seedSchedules {
		scheduleID := newID()
		_, err := w.Tx.Exec(w.Ctx, `insert into schedules (id, name, zone, record_format, created_at) values ($1, $2, $3, $4, $5)`,
			scheduleID, s.name, s.zone, s.recordFormat, w.Now)
		if err != nil {
			return fmt.Errorf("insert schedule %s: %w", s.name, err)
		}
		for _, l := range s.layers {
			layerID := newID()
			if _, err := w.Tx.Exec(w.Ctx, `insert into schedule_layers (id, schedule_id, created_at) values ($1, $2, $3)`,
				layerID, scheduleID, w.Now); err != nil {
				return fmt.Errorf("insert layer %s: %w", l.name, err)
			}
			people := make([]string, 0, len(l.people))
			for _, name := range l.people {
				people = append(people, seededUserIDs[name])
			}
			restrictions := l.restrictions
			if restrictions == nil {
				restrictions = []restrictionSpec{}
			}
			form := layerForm{Name: l.name, Order: l.order, ShiftDays: l.shiftDays, HandoffTime: l.handoff, StartDate: l.start,
				People: people, Restrictions: restrictions}
			if err := insertRevision(w, layerID, 1, nil, form); err != nil {
				return fmt.Errorf("seed layer %s: %w", l.name, err)
			}
		}
		m, err := a.loadScheduleModel(w.Ctx, w.Tx, scheduleID)
		if err != nil {
			return fmt.Errorf("read seeded schedule %s: %w", s.name, err)
		}
		if err := a.armHandoff(w, m, w.Now); err != nil {
			return fmt.Errorf("arm seeded schedule %s: %w", s.name, err)
		}
	}
	return nil
}
