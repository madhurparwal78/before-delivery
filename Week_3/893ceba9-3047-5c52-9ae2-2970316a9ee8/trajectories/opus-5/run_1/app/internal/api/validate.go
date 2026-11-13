package api

import (
	"regexp"
	"strings"
	"unicode/utf8"
)

var (
	slugPattern       = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{1,39}$`)
	languagePattern   = regexp.MustCompile(`^[a-z]{2,3}(-[A-Z]{2})?$`)
	repositoryPattern = regexp.MustCompile(`^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$`)
	enginePattern     = regexp.MustCompile(`^[a-z0-9-]{1,40}$`)
	keyNamePattern    = regexp.MustCompile(`^[A-Za-z0-9_.-]{1,120}$`)
	branchNamePattern = regexp.MustCompile(`^[a-z0-9][a-z0-9/_-]{0,62}$`)
	idempotencyKey    = regexp.MustCompile(`^[\x21-\x7e]{1,64}$`)
	absoluteURL       = regexp.MustCompile(`^https?://[^\s]+$`)
)

func validSlug(s string) bool       { return slugPattern.MatchString(s) }
func validLanguage(s string) bool   { return languagePattern.MatchString(s) }
func validRepository(s string) bool { return repositoryPattern.MatchString(s) }
func validEngine(s string) bool     { return enginePattern.MatchString(s) }
func validKeyName(s string) bool    { return keyNamePattern.MatchString(s) }
func validBranchName(s string) bool {
	return branchNamePattern.MatchString(s) && s != "main"
}

func lengthBetween(s string, low, high int) bool {
	n := utf8.RuneCountInString(s)
	return n >= low && n <= high
}

func validSource(s string) bool {
	return lengthBetween(s, 1, 2000) && strings.TrimSpace(s) != ""
}
