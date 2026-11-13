package domain

import (
	"math"
	"strings"
)

// Issue is one recorded MQM issue on a segment.
type Issue struct {
	Category string `json:"category"`
	Severity string `json:"severity"`
	Note     string `json:"note"`
}

var issueCategories = map[string]bool{
	"accuracy": true, "fluency": true, "terminology": true, "style": true, "locale-convention": true,
}

var issueSeverities = map[string]bool{"minor": true, "major": true, "critical": true}

func ValidIssueCategory(c string) bool { return issueCategories[c] }
func ValidIssueSeverity(s string) bool { return issueSeverities[s] }

func penaltyPoints(severity string) int {
	switch severity {
	case "minor":
		return 1
	case "major":
		return 5
	case "critical":
		return 25
	}
	return 0
}

// WordCount counts the whitespace-separated tokens of a key source.
func WordCount(source string) int { return len(strings.Fields(source)) }

// MQMScore is the one MQM formula: 100 minus 100 times the penalty total over
// the larger of the word count and 10, rounded half up with a floor of 0.
func MQMScore(source string, issues []Issue) int {
	penalty := 0
	for _, issue := range issues {
		penalty += penaltyPoints(issue.Severity)
	}
	words := WordCount(source)
	if words < 10 {
		words = 10
	}
	score := int(math.Floor(100 - 100*float64(penalty)/float64(words) + 0.5))
	if score < 0 {
		return 0
	}
	return score
}

// ScoredStatus is the status a scored segment takes for a project threshold.
func ScoredStatus(score, threshold int) string {
	if score < threshold {
		return StatusNeedsReview
	}
	return StatusScored
}
