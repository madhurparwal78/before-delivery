package main

import (
	"math"
	"strings"
)

// Penalty points per MQM severity.
var severityPenalty = map[string]float64{"minor": 1, "major": 5, "critical": 25}

// MqmScore computes the one MQM score: 100 minus 100 times the penalty total
// divided by the larger of the word count and 10, rounded half up, floored at 0.
// Word count counts whitespace-separated tokens in the source, placeholders included.
func MqmScore(source string, issues []IssueIn) int {
	total := 0.0
	for _, i := range issues {
		if p, ok := severityPenalty[i.Severity]; ok {
			total += p
		}
	}
	words := 0
	for _, tok := range strings.Fields(source) {
		_ = tok
		words++
	}
	if words < 10 {
		words = 10
	}
	raw := 100 - 100*total/float64(words)
	if raw < 0 {
		return 0
	}
	return int(math.Floor(raw + 0.5))
}

// IssueIn is an incoming MQM issue.
type IssueIn struct {
	Category string `json:"category"`
	Severity string `json:"severity"`
	Note     string `json:"note"`
}

var issueCategories = map[string]bool{"accuracy": true, "fluency": true, "terminology": true, "style": true, "locale-convention": true}
var issueSeverities = map[string]bool{"minor": true, "major": true, "critical": true}

func validIssue(i IssueIn) bool {
	return issueCategories[i.Category] && issueSeverities[i.Severity]
}
