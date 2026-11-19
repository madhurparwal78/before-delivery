package main

import (
	"context"
	"log"
	"strconv"
	"strings"
	"sync/atomic"
	"time"
)

// dependencies tracks which backing services answered their last probe.
type dependencies struct {
	postgres atomic.Bool
	valkey   atomic.Bool
	mail     atomic.Bool
}

const (
	leaseSeconds     = 5
	graceSeconds     = 30
	roomLingerSecond = 60
)

// registry mirrors live rooms into Valkey: the room hash, seat leases, reconnect graces and
// the report dedupe hash. The game server's memory holds the live simulation.
type registry struct {
	client   *valkeyClient
	deps     *dependencies
	instance string
}

func roomKey(code string) string            { return "hf:room:" + code }
func seatKey(code, playerID string) string  { return "hf:seat:" + code + ":" + playerID }
func graceKey(code, playerID string) string { return "hf:grace:" + code + ":" + playerID }
func reportsKey(code string) string         { return "hf:reports:" + code }
func instanceKey(instance string) string    { return "hf:instance:" + instance }

func (g *registry) available() bool { return g.client != nil && g.deps.valkey.Load() }

// run sends commands and flips the Valkey flag down on a transport failure.
func (g *registry) run(commands ...[]string) error {
	if !g.available() {
		return errValkeyDown
	}
	if _, err := g.client.pipe(commands); err != nil {
		if isValkeyDown(err) {
			g.deps.valkey.Store(false)
		}
		return err
	}
	return nil
}

func isValkeyDown(err error) bool {
	_, replied := err.(valkeyReplyError)
	return err != nil && !replied
}

// roomFields is what the registry hash holds for a room.
type roomFields struct {
	code, mode, host, phase    string
	createdAt, inviteExpiresAt time.Time
}

func (g *registry) hashCommand(f roomFields) []string {
	return []string{"HSET", roomKey(f.code),
		"mode", f.mode, "host", f.host, "phase", f.phase,
		"created_at", formatInstant(f.createdAt), "invite_expires_at", formatInstant(f.inviteExpiresAt),
		"instance", g.instance}
}

// claimCode reserves a room code if no live room holds it.
func (g *registry) claimCode(f roomFields) (bool, error) {
	if !g.available() {
		return false, errValkeyDown
	}
	reply, err := g.client.do("HSETNX", roomKey(f.code), "mode", f.mode)
	if err != nil {
		if isValkeyDown(err) {
			g.deps.valkey.Store(false)
		}
		return false, err
	}
	if n, _ := reply.(int64); n != 1 {
		return false, nil
	}
	return true, g.run(g.hashCommand(f))
}

func (g *registry) syncRoom(f roomFields) error { return g.run(g.hashCommand(f)) }

func (g *registry) renewLease(code, playerID string) error {
	return g.run([]string{"SET", seatKey(code, playerID), "1", "EX", strconv.Itoa(leaseSeconds)})
}

func (g *registry) dropLease(code, playerID string) error {
	return g.run([]string{"DEL", seatKey(code, playerID)})
}

func (g *registry) startGrace(code, playerID string) error {
	return g.run([]string{"SET", graceKey(code, playerID), "1", "EX", strconv.Itoa(graceSeconds)})
}

func (g *registry) endGrace(code, playerID string) error {
	return g.run([]string{"DEL", graceKey(code, playerID)})
}

func (g *registry) storeReport(code, reportID, result string) error {
	return g.run([]string{"HSET", reportsKey(code), reportID, result})
}

// retire lets the room's keys expire after it ends.
func (g *registry) retire(code string, playerIDs []string) error {
	commands := [][]string{
		{"EXPIRE", roomKey(code), strconv.Itoa(roomLingerSecond)},
		{"EXPIRE", reportsKey(code), strconv.Itoa(roomLingerSecond)},
	}
	for _, id := range playerIDs {
		commands = append(commands, []string{"DEL", seatKey(code, id)}, []string{"DEL", graceKey(code, id)})
	}
	return g.run(commands...)
}

func (g *registry) remove(code string) error {
	return g.run([]string{"DEL", roomKey(code)}, []string{"DEL", reportsKey(code)})
}

// mirror records a failed registry write that is not an outage.
func (g *registry) mirror(err error) {
	if err != nil && !isValkeyDown(err) {
		log.Printf("registry: %v", err)
	}
}

// announce keeps this instance's liveness key fresh so another instance sharing the Valkey
// never clears this instance's rooms as stale.
func (g *registry) announce() error {
	return g.run([]string{"SET", instanceKey(g.instance), "1", "EX", "10"})
}

// clearStale removes registry keys of rooms whose owning instance is gone.
func (g *registry) clearStale() error {
	rooms, err := g.client.scan("hf:room:*")
	if err != nil {
		return err
	}
	for _, key := range rooms {
		code := strings.TrimPrefix(key, "hf:room:")
		reply, err := g.client.do("HGET", key, "instance")
		if err != nil {
			return err
		}
		owner, _ := reply.(string)
		if owner == g.instance {
			continue
		}
		if owner != "" {
			alive, err := g.client.do("EXISTS", instanceKey(owner))
			if err != nil {
				return err
			}
			if n, _ := alive.(int64); n == 1 {
				continue
			}
		}
		stale := []string{key, reportsKey(code)}
		for _, pattern := range []string{"hf:seat:" + code + ":*", "hf:grace:" + code + ":*"} {
			found, err := g.client.scan(pattern)
			if err != nil {
				return err
			}
			stale = append(stale, found...)
		}
		if _, err := g.client.do(append([]string{"DEL"}, stale...)...); err != nil {
			return err
		}
	}
	return nil
}

// probe pings every second, announces this instance and clears stale keys once Valkey answers.
func (g *registry) probe(ctx context.Context) {
	if g.client == nil {
		return
	}
	cleared := false
	tick := time.NewTicker(time.Second)
	defer tick.Stop()
	for {
		pingCtx, cancel := context.WithTimeout(ctx, 1500*time.Millisecond)
		err := g.client.ping(pingCtx)
		cancel()
		g.deps.valkey.Store(err == nil)
		if err == nil {
			if !cleared {
				cleared = g.clearStale() == nil
			}
			g.mirror(g.announce())
		}
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
		}
	}
}
