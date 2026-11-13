package main

import (
	"sort"
	"strconv"
	"strings"
)

// buildBundle is the one bundle format: flat dotted keys sorted by code point, two-space indent,
// non-ASCII kept as itself, a trailing newline, and `{}` plus a newline when empty.
func buildBundle(values map[string]string) []byte {
	if len(values) == 0 {
		return []byte("{}\n")
	}
	names := make([]string, 0, len(values))
	for name := range values {
		names = append(names, name)
	}
	sort.Strings(names)
	var sb strings.Builder
	sb.WriteString("{\n")
	for i, name := range names {
		sb.WriteString("  ")
		sb.WriteString(jsonString(name))
		sb.WriteString(": ")
		sb.WriteString(jsonString(values[name]))
		if i < len(names)-1 {
			sb.WriteByte(',')
		}
		sb.WriteByte('\n')
	}
	sb.WriteString("}\n")
	return []byte(sb.String())
}

func jsonString(s string) string {
	var sb strings.Builder
	sb.WriteByte('"')
	for _, r := range s {
		switch {
		case r == '"':
			sb.WriteString(`\"`)
		case r == '\\':
			sb.WriteString(`\\`)
		case r == '\n':
			sb.WriteString(`\n`)
		case r == '\r':
			sb.WriteString(`\r`)
		case r == '\t':
			sb.WriteString(`\t`)
		case r == '\b':
			sb.WriteString(`\b`)
		case r == '\f':
			sb.WriteString(`\f`)
		case r < 0x20:
			sb.WriteString(`\u00`)
			sb.WriteString(strings.ToLower(strconv.FormatInt(int64(0x100|r), 16))[1:])
		default:
			sb.WriteRune(r)
		}
	}
	sb.WriteByte('"')
	return sb.String()
}
