package main

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"regexp"
	"strconv"
	"strings"
)

var reportIDPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{1,64}$`)

type targetBody struct {
	X *float64 `json:"x"`
	Z *float64 `json:"z"`
}

type reportBody struct {
	ReportID     string      `json:"report_id"`
	Type         string      `json:"type"`
	Aim          *float64    `json:"aim"`
	Target       *targetBody `json:"target"`
	TargetPlayer string      `json:"target_player"`
}

type reportResult struct {
	ReportID string  `json:"report_id"`
	Type     string  `json:"type"`
	Accepted bool    `json:"accepted"`
	Reason   *string `json:"reason"`
	Tick     int     `json:"tick"`
	Outcome  any     `json:"outcome"`
}

type storedReport struct {
	fingerprint string
	resultJSON  string
}

// validate checks the report's own fields and returns its field errors.
func (b reportBody) validate() map[string]string {
	fields := map[string]string{}
	if !reportIDPattern.MatchString(b.ReportID) {
		fields["report_id"] = "Use 1 to 64 letters, digits, underscores or hyphens."
	}
	switch b.Type {
	case "shot":
		if b.Aim == nil || *b.Aim < 0 || *b.Aim > 360 {
			fields["aim"] = "Use an aim from 0 to 360."
		}
	case "reload":
	case "grenade":
		if b.Target == nil || b.Target.X == nil || b.Target.Z == nil {
			fields["target"] = "Send a target with x and z."
		}
	case "revive":
		if b.TargetPlayer == "" {
			fields["target_player"] = "Send the player to revive."
		}
	default:
		fields["type"] = "Use shot, reload, grenade or revive."
	}
	return fields
}

// fingerprint is the report's type and fields without its id; the same id with another
// fingerprint is a conflict.
func (b reportBody) fingerprint() string {
	aim, x, z := "-", "-", "-"
	if b.Aim != nil {
		aim = strconv.FormatFloat(*b.Aim, 'g', -1, 64)
	}
	if b.Target != nil && b.Target.X != nil && b.Target.Z != nil {
		x, z = strconv.FormatFloat(*b.Target.X, 'g', -1, 64), strconv.FormatFloat(*b.Target.Z, 'g', -1, 64)
	}
	return strings.Join([]string{b.Type, aim, x, z, b.TargetPlayer}, "|")
}

const (
	replay   = "replay"
	conflict = "conflict"
	unseen   = "unseen"
)

func (r *room) lookupReport(b reportBody) (*storedReport, string) {
	known, seen := r.reports[b.ReportID]
	switch {
	case !seen:
		return nil, unseen
	case known.fingerprint == b.fingerprint():
		return known, replay
	default:
		return known, conflict
	}
}

func reject(reason string) (bool, *string, any) { return false, &reason, nil }

// judge applies one new report and stores its result.
func (r *room) judge(s *seat, b reportBody) (*storedReport, error) {
	var accepted bool
	var reason *string
	var outcome any
	switch b.Type {
	case "shot":
		accepted, reason, outcome = r.judgeShot(s, *b.Aim)
	case "reload":
		accepted, reason, outcome = r.judgeReload(s)
	case "grenade":
		accepted, reason, outcome = r.judgeGrenade(s, *b.Target.X, *b.Target.Z)
	default:
		accepted, reason, outcome = r.judgeRevive(s, b.TargetPlayer)
	}
	result := reportResult{ReportID: b.ReportID, Type: b.Type, Accepted: accepted, Reason: reason, Tick: r.tick, Outcome: outcome}
	payload, err := json.Marshal(result)
	if err != nil {
		return nil, err
	}
	stored := &storedReport{fingerprint: b.fingerprint(), resultJSON: string(payload)}
	r.reports[b.ReportID] = stored
	r.mirror(r.srv.reg.storeReport(r.code, b.ReportID, stored.resultJSON))
	return stored, nil
}

func (r *room) judgeShot(s *seat, aim float64) (bool, *string, any) {
	switch {
	case !r.inWave():
		return reject("not_in_wave")
	case s.status != statusUp:
		return reject("not_up")
	case s.reloading:
		return reject("reloading")
	case s.mag == 0:
		return reject("empty")
	case s.hasShot && r.clockNow-s.lastShotAt < fireInterval:
		return reject("fire_interval")
	}
	s.mag--
	s.lastShotAt, s.hasShot = r.clockNow, true
	outcome := map[string]any{"hit": nil, "mag": s.mag}
	if hit := r.castRay(s, aim); hit != nil {
		outcome["hit"] = hit
	}
	r.checkWaveEnd()
	return true, nil, outcome
}

// castRay finds the first enemy or intact barrel along the aim before a solid block.
func (r *room) castRay(s *seat, aim float64) map[string]any {
	rad := aim * math.Pi / 180
	dx, dz := math.Cos(rad), math.Sin(rad)
	limit := shotRange
	if d := r.gmap.firstBlock(s.x, s.z, s.x+dx*shotRange, s.z+dz*shotRange); d >= 0 {
		limit = d
	}
	entry := func(cx, cz, radius float64) (float64, bool) {
		vx, vz := cx-s.x, cz-s.z
		along := vx*dx + vz*dz
		perp := math.Abs(vx*dz - vz*dx)
		if perp > radius || (along < 0 && math.Hypot(vx, vz) > radius) {
			return 0, false
		}
		t := math.Max(0, along-math.Sqrt(radius*radius-perp*perp))
		return t, t <= limit
	}
	bestT := math.Inf(1)
	var target *enemy
	var hitBarrel *barrel
	for _, e := range r.enemies {
		if e.state == "dead" {
			continue
		}
		if t, ok := entry(e.x, e.z, enemyKinds[e.kind].radius); ok && t < bestT {
			bestT, target, hitBarrel = t, e, nil
		}
	}
	for _, b := range r.barrels {
		if b.destroyed {
			continue
		}
		if t, ok := entry(b.x, b.z, barrelRadiusHit); ok && t < bestT {
			bestT, target, hitBarrel = t, nil, b
		}
	}
	switch {
	case target != nil:
		applied, killed := r.damageEnemy(target, shotDamage, s)
		return map[string]any{"id": target.id, "kind": target.kind, "damage": applied, "hp_after": target.hp, "killed": killed}
	case hitBarrel != nil:
		applied := min(shotDamage, hitBarrel.hp)
		hitBarrel.hp -= applied
		killed := hitBarrel.hp == 0
		hit := map[string]any{"id": hitBarrel.id, "kind": "barrel", "damage": applied, "hp_after": hitBarrel.hp, "killed": killed}
		if killed {
			hitBarrel.destroyed = true
			r.detonate(blast{source: "barrel:" + hitBarrel.id, owner: s, x: hitBarrel.x, z: hitBarrel.z, radius: barrelRadius, max: barrelMax})
		}
		return hit
	}
	return nil
}

func (r *room) judgeReload(s *seat) (bool, *string, any) {
	switch {
	case s.status != statusUp:
		return reject("not_up")
	case s.reloading:
		return reject("reloading")
	case s.mag == magazineSize || s.reserve == 0:
		return reject("nothing_to_reload")
	}
	s.reloading = true
	s.reloadEnd = ticksFrom(r.tickTime(), reloadTicks)
	return true, nil, map[string]any{"reload_ms": reloadTicks * int(tickDur.Milliseconds())}
}

func (r *room) judgeGrenade(s *seat, x, z float64) (bool, *string, any) {
	switch {
	case !r.inWave():
		return reject("not_in_wave")
	case s.status != statusUp:
		return reject("not_up")
	case s.grenades == 0:
		return reject("no_grenades")
	case math.Hypot(x-s.x, z-s.z) > grenadeRange:
		return reject("out_of_range")
	}
	s.grenades--
	id := "g" + strconv.Itoa(r.nextGrenade())
	r.grenades = append(r.grenades, &grenade{id: id, owner: s.playerID, x: x, z: z, fuseEnd: ticksFrom(r.tickTime(), fuseTicks)})
	return true, nil, map[string]any{"grenade_id": id, "detonates_in_ms": fuseTicks * int(tickDur.Milliseconds())}
}

func (r *room) nextGrenade() int {
	r.grenadeCount++
	return r.grenadeCount
}

func (r *room) judgeRevive(s *seat, targetID string) (bool, *string, any) {
	target := r.seatOf(targetID)
	switch {
	case s.status != statusUp:
		return reject("not_up")
	case target == s:
		return reject("self_revive")
	case target == nil:
		return reject("not_downed")
	case math.Hypot(target.x-s.x, target.z-s.z) > reviveRange:
		return reject("too_far")
	case target.status != statusDowned:
		return reject("not_downed")
	}
	target.status, target.hp = statusUp, revivedHealth
	r.emit("player_revived", map[string]any{"player": target.playerID, "by": s.playerID})
	return true, nil, map[string]any{"revived": target.playerID}
}

// ---- input

type inputBody struct {
	Seq  int `json:"seq"`
	Move *struct {
		X *float64 `json:"x"`
		Z *float64 `json:"z"`
	} `json:"move"`
	Aim *float64 `json:"aim"`
}

func (b inputBody) validate() map[string]string {
	fields := map[string]string{}
	if b.Seq < 1 {
		fields["seq"] = "Use a whole number from 1."
	}
	if b.Move == nil || b.Move.X == nil || b.Move.Z == nil || math.Abs(*b.Move.X) > 1 || math.Abs(*b.Move.Z) > 1 {
		fields["move"] = "Use x and z from -1 to 1."
	}
	if b.Aim == nil || *b.Aim < 0 || *b.Aim > 360 {
		fields["aim"] = "Use an aim from 0 to 360."
	}
	return fields
}

func (r *room) applyInput(s *seat, b inputBody) bool {
	if r.mode != modeSiege || b.Seq <= s.lastInputSeq {
		return false
	}
	s.lastInputSeq = b.Seq
	s.moveX, s.moveZ = *b.Move.X, *b.Move.Z
	s.aim = *b.Aim
	return true
}

// ---- handlers

func (h *hub) postInput(w http.ResponseWriter, r *http.Request) error {
	return h.withSeat(w, r, func(rm *room, s *seat) error {
		var body inputBody
		if err := decodeBody(r, &body); err != nil {
			return err
		}
		if fields := body.validate(); len(fields) > 0 {
			return failFields(fields)
		}
		applied := rm.applyInput(s, body)
		writeJSON(w, http.StatusAccepted, map[string]any{"seq": body.Seq, "applied": applied})
		return nil
	})
}

func (h *hub) postReport(w http.ResponseWriter, r *http.Request) error {
	return h.withSeat(w, r, func(rm *room, s *seat) error {
		var body reportBody
		if err := decodeBody(r, &body); err != nil {
			return err
		}
		if fields := body.validate(); len(fields) > 0 {
			return failFields(fields)
		}
		known, status := rm.lookupReport(body)
		if status == replay {
			writeStatus(w, http.StatusOK, known.resultJSON)
			return nil
		}
		if rm.degraded != "" {
			return fail("room_paused")
		}
		if status == conflict {
			return fail("report_conflict")
		}
		stored, err := rm.judge(s, body)
		if err != nil {
			return err
		}
		writeStatus(w, http.StatusOK, stored.resultJSON)
		return nil
	})
}

func (h *hub) postReportBatch(w http.ResponseWriter, r *http.Request) error {
	return h.withSeat(w, r, func(rm *room, s *seat) error {
		var body struct {
			Reports []reportBody `json:"reports"`
		}
		if err := decodeBody(r, &body); err != nil {
			return err
		}
		if len(body.Reports) < 1 || len(body.Reports) > 64 {
			return failFields(map[string]string{"reports": "Send 1 to 64 reports."})
		}
		for _, rep := range body.Reports {
			if len(rep.validate()) > 0 {
				return failFields(map[string]string{"reports": "Every report needs a valid report_id, type and fields."})
			}
		}
		if rm.degraded != "" {
			for _, rep := range body.Reports {
				if _, status := rm.lookupReport(rep); status != replay {
					return fail("room_paused")
				}
			}
		}
		results := make([]json.RawMessage, 0, len(body.Reports))
		for _, rep := range body.Reports {
			known, status := rm.lookupReport(rep)
			switch status {
			case replay:
				results = append(results, json.RawMessage(known.resultJSON))
			case conflict:
				results = append(results, conflictEntry())
			default:
				stored, err := rm.judge(s, rep)
				if err != nil {
					return err
				}
				results = append(results, json.RawMessage(stored.resultJSON))
			}
		}
		writeJSON(w, http.StatusOK, map[string]any{"results": results})
		return nil
	})
}

// conflictEntry is the batch entry that stands in for a result when a report id was reused.
func conflictEntry() json.RawMessage {
	e := fail("report_conflict")
	return json.RawMessage(fmt.Sprintf(`{"error":{"code":%q,"message":%q}}`, e.code, e.message))
}

func ledgerJob(st *store, matchID string, e ledgerEntry) func(context.Context) error {
	return func(ctx context.Context) error {
		return st.saveLedgerEntry(ctx, ledgerRecord{ID: matchID + ":" + e.id, MatchID: matchID, Account: e.account,
			Amount: e.amount, Kind: e.kind, Ref: e.ref, Item: e.item, UnitPrice: e.unitPrice, At: e.at})
	}
}
