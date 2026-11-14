package main

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
)

// person is someone the club writes to.
type person struct {
	Username string
	Name     string
	Email    string
}

func (id *Identity) asPerson() person { return person{id.Username, id.Name, id.Email} }

func loadPerson(ctx context.Context, q querier, username string) (person, error) {
	var p person
	err := q.QueryRow(ctx, "SELECT username, name, email FROM people WHERE username = $1", username).Scan(&p.Username, &p.Name, &p.Email)
	if errors.Is(err, pgx.ErrNoRows) {
		return person{}, fail(codeNotFound)
	}
	if err != nil {
		return person{}, fmt.Errorf("load person %s: %w", username, err)
	}
	return p, nil
}

// clubPlayersByEmail finds exactly the registered players the emails name, in the order given; it reports false
// when an email is unknown, repeated or the organiser's own.
func (a *App) clubPlayersByEmail(ctx context.Context, me *Identity, emails []string) ([]person, bool, error) {
	seen := map[string]bool{trimLower(me.Email): true}
	lowered := make([]string, 0, len(emails))
	for _, email := range emails {
		email = trimLower(email)
		if seen[email] {
			return nil, false, nil
		}
		seen[email] = true
		lowered = append(lowered, email)
	}
	rows, err := a.pool.Query(ctx, "SELECT username, name, email FROM people WHERE is_player AND lower(email) = ANY($1)", lowered)
	if err != nil {
		return nil, false, fmt.Errorf("look up club players: %w", err)
	}
	defer rows.Close()
	byEmail := map[string]person{}
	for rows.Next() {
		var p person
		if err := rows.Scan(&p.Username, &p.Name, &p.Email); err != nil {
			return nil, false, fmt.Errorf("read club player: %w", err)
		}
		byEmail[trimLower(p.Email)] = p
	}
	if err := rows.Err(); err != nil {
		return nil, false, fmt.Errorf("look up club players: %w", err)
	}
	players := make([]person, 0, len(lowered))
	for _, email := range lowered {
		p, found := byEmail[email]
		if !found {
			return nil, false, nil
		}
		players = append(players, p)
	}
	return players, true, nil
}

func trimLower(text string) string { return strings.ToLower(strings.TrimSpace(text)) }
