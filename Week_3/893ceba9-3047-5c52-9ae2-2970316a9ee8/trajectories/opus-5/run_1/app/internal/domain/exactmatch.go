// Package domain decides every rule of the desk exactly once: the exact-match
// normalisation, the MQM score, the segment and branch state machines, the
// merge classification and the published bundle format.
package domain

import (
	"regexp"
	"strings"

	"golang.org/x/text/unicode/norm"
)

// placeholderPattern matches every placeholder style the brief lists. The
// longer forms come first so `{{name}}` and `%1$s` win over `{name}` and `%s`.
var placeholderPattern = regexp.MustCompile(`\{\{[A-Za-z0-9_]+\}\}|\{[A-Za-z0-9_]+\}|%[0-9]+\$[sd]|%[sd@]`)

var whitespaceRun = regexp.MustCompile(`[\s\p{Zs}\x{00a0}]+`)

// Normalise is the one normalisation behind every exact 100% match.
func Normalise(s string) string {
	s = norm.NFC.String(s)
	s = placeholderPattern.ReplaceAllString(s, "{}")
	s = strings.ToLower(s)
	s = whitespaceRun.ReplaceAllString(s, " ")
	return strings.TrimSpace(s)
}

// Placeholders lists the placeholder tokens of a string in order of appearance.
func Placeholders(s string) []string {
	return placeholderPattern.FindAllString(norm.NFC.String(s), -1)
}

// ReuseValue maps a translation-memory target onto a key source by replacing
// every occurrence of the memory source's i-th placeholder with the key
// source's i-th placeholder. Tokens the memory source lacks stay as they are.
func ReuseValue(tmSource, tmTarget, keySource string) string {
	from := Placeholders(tmSource)
	to := Placeholders(keySource)
	if len(from) == 0 {
		return tmTarget
	}
	mapping := make(map[string]string, len(from))
	for i, token := range from {
		if i < len(to) {
			mapping[token] = to[i]
		}
	}
	return placeholderPattern.ReplaceAllStringFunc(tmTarget, func(token string) string {
		if replacement, ok := mapping[token]; ok {
			return replacement
		}
		return token
	})
}
