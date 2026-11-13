package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"
)

const maxAdvanceSeconds = 31536000

// clockMove is what an operator asked of the clock: a move forward by seconds or to an instant, and/or a hold or release.
type clockMove struct {
	advance int64
	setTo   *time.Time
	hold    *bool
}

// wholeNumber reads a JSON integer; anything else, null, a fraction or a string included, reports false.
func wholeNumber(raw json.RawMessage) (int, bool) {
	var value *int
	if json.Unmarshal(raw, &value) != nil || value == nil {
		return 0, false
	}
	return *value, true
}

func readInstant(raw json.RawMessage) (time.Time, error) {
	var text string
	if err := json.Unmarshal(raw, &text); err != nil {
		return time.Time{}, fmt.Errorf("read instant: %w", err)
	}
	instant, err := parseInstant(text)
	if err != nil {
		return time.Time{}, fmt.Errorf("parse instant: %w", err)
	}
	return instant, nil
}

func readClockMove(change map[string]json.RawMessage) (clockMove, error) {
	var move clockMove
	advance, hasAdvance := change["advance_seconds"]
	setTo, hasSetTo := change["set_to"]
	hold, hasHold := change["frozen"]
	switch {
	case !hasAdvance && !hasSetTo && !hasHold:
		return move, errField("advance_seconds", "Give advance_seconds, set_to or frozen.")
	case hasAdvance && hasSetTo:
		return move, errField("set_to", "Give either advance_seconds or set_to, not both.")
	}
	if hasAdvance {
		seconds, whole := wholeNumber(advance)
		if !whole || seconds < 1 || seconds > maxAdvanceSeconds {
			return move, errField("advance_seconds", "Use a whole number of seconds from 1 to 31536000.")
		}
		move.advance = int64(seconds)
	}
	if hasSetTo {
		instant, err := readInstant(setTo)
		if err != nil {
			return move, errField("set_to", "Use an instant such as 2027-03-14T14:00:00Z.")
		}
		move.setTo = &instant
	}
	if hasHold {
		if json.Unmarshal(hold, &move.hold) != nil || move.hold == nil {
			return move, errField("frozen", "Use true or false.")
		}
	}
	return move, nil
}

// applyClockMove changes the clock under the domain lock, so no action is stamped on the wrong side of the move. A move
// that cannot be made changes nothing, a hold included.
func (a *App) applyClockMove(ctx context.Context, move clockMove) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	switch {
	case move.setTo != nil:
		moved, err := a.clock.SetTo(ctx, *move.setTo)
		if err != nil {
			return fmt.Errorf("set the clock: %w", err)
		}
		if !moved {
			return errField("set_to", "The clock only moves forward.")
		}
	case move.advance > 0:
		if err := a.clock.Advance(ctx, move.advance); err != nil {
			return fmt.Errorf("advance the clock: %w", err)
		}
	}
	if move.hold != nil {
		if err := a.clock.Hold(ctx, *move.hold); err != nil {
			return fmt.Errorf("hold the clock: %w", err)
		}
	}
	return nil
}

// hMoveClock moves or holds the one server clock. The answer is the clock after every timer the move made due has been
// applied, and open screens hear the new time at once.
func (a *App) hMoveClock(rq *Req) error {
	var change map[string]json.RawMessage
	if err := rq.Decode(&change); err != nil {
		return fmt.Errorf("read clock move: %w", err)
	}
	move, err := readClockMove(change)
	if err != nil {
		return fmt.Errorf("check clock move: %w", err)
	}
	if err := a.applyClockMove(rq.Ctx(), move); err != nil {
		return fmt.Errorf("move clock: %w", err)
	}
	if err := a.settle(rq.Ctx()); err != nil {
		return fmt.Errorf("apply due timers: %w", err)
	}
	a.clearOncallCache(rq.Ctx(), "")
	a.clearStatusCache(rq.Ctx())
	a.hub.Pulse(rq.Ctx())
	wakeWebhooks()
	return rq.JSON(http.StatusOK, a.clock.State())
}

func init() {
	routeSetups = append(routeSetups, func(a *App) {
		a.route(route{Pattern: "POST /api/operator/clock", Access: accAdmin, Handler: a.hMoveClock})
	})
}
