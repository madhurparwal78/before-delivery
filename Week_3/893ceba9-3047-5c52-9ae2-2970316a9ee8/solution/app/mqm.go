package main

import "strings"

// Segment statuses.
const (
	statusUntranslated = "untranslated"
	statusDrafted      = "drafted"
	statusScored       = "scored"
	statusNeedsReview  = "needs_review"
	statusApproved     = "approved"
)

var severityPenalty = map[string]int{"minor": 1, "major": 5, "critical": 25}

var issueCategories = map[string]bool{"accuracy": true, "fluency": true, "terminology": true, "style": true, "locale-convention": true}

// mqmScore is the one score formula: 100 minus 100 times the penalty over max(words, 10),
// rounded half up, floored at 0.
func mqmScore(source string, issues []Issue) int {
	penalty := 0
	for _, issue := range issues {
		penalty += severityPenalty[issue.Severity]
	}
	words := max(len(strings.Fields(source)), 10)
	// score = 100 - 100*penalty/words, half up, computed in integers.
	return max(0, (2*(100*words-100*penalty)+words)/(2*words))
}

func statusForScore(score, threshold int) string {
	if score >= threshold {
		return statusScored
	}
	return statusNeedsReview
}

// segmentMoves lists, per action, the statuses it may start from: the one state machine for segments.
var segmentMoves = map[string][]string{
	"score":         {statusDrafted, statusScored, statusNeedsReview},
	"approve":       {statusScored, statusNeedsReview},
	"correct":       {statusNeedsReview},
	"source_change": {statusDrafted, statusScored, statusNeedsReview, statusApproved},
}

var segmentMoveTarget = map[string]string{
	"score": statusScored, "approve": statusApproved,
	"correct": statusApproved, "source_change": statusNeedsReview,
}

func allowMove(action, from string) error {
	for _, ok := range segmentMoves[action] {
		if ok == from {
			return nil
		}
	}
	return errIllegalTransition(from, segmentMoveTarget[action])
}
