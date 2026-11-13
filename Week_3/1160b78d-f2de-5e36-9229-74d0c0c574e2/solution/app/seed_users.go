package main

import "fmt"

// seededPassword is the password of every seeded account.
const seededPassword = "yard-lamp-2026"

type seedPerson struct {
	name, email, role, zone, quietStart, quietEnd string
}

var seedPeople = []seedPerson{
	{"Rowan Achterberg", "rowan@tarecross.example", "admin", "America/Chicago", "", ""},
	{"Sunniva Okoye", "sunniva@tarecross.example", "lead", "America/Chicago", "", ""},
	{"Dario Mbeki", "dario@tarecross.example", "lead", "Europe/Lisbon", "", ""},
	{"Ines Varga", "ines@tarecross.example", "responder", "America/Chicago", "22:00", "07:00"},
	{"Tomasz Reyes", "tomasz@tarecross.example", "responder", "America/Chicago", "22:00", "07:00"},
	{"Priya Lindqvist", "priya@tarecross.example", "responder", "Asia/Kolkata", "22:00", "07:00"},
	{"Mateus Oyelaran", "mateus@tarecross.example", "responder", "Europe/Berlin", "23:00", "07:00"},
	{"Hana Castellanos", "hana@tarecross.example", "stakeholder", "America/Chicago", "", ""},
}

// seededUserIDs maps a seeded person's name to their id, for the seeders that run after this one.
var seededUserIDs = map[string]string{}

func init() {
	seeders = append(seeders, seeder{order: 10, name: "people", fn: seedPeopleRows})
}

func seedPeopleRows(a *App, w *Work) error {
	for _, p := range seedPeople {
		hash, err := hashPassword(seededPassword)
		if err != nil {
			return fmt.Errorf("hash seed password: %w", err)
		}
		var quietStart, quietEnd *string
		if p.quietStart != "" {
			quietStart, quietEnd = &p.quietStart, &p.quietEnd
		}
		id := newID()
		_, err = w.Tx.Exec(w.Ctx, `insert into users (id, name, email, password_hash, role, timezone, quiet_start, quiet_end, created_at)
			values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`, id, p.name, p.email, hash, p.role, p.zone, quietStart, quietEnd, w.Now)
		if err != nil {
			return fmt.Errorf("insert %s: %w", p.name, err)
		}
		seededUserIDs[p.name] = id
	}
	return nil
}
