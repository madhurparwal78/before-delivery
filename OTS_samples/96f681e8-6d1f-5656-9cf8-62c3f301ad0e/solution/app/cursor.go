package main

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/url"
	"strconv"
)

const (
	defaultPageSize = 20
	maxPageSize     = 50
)

// pageQuery is a paged list's limit and opaque cursor.
type pageQuery struct {
	limit  int
	cursor string
}

// parsePage reads limit (1 to 50, default 20) and cursor from a query string.
func parsePage(query url.Values) (pageQuery, error) {
	page := pageQuery{limit: defaultPageSize, cursor: query.Get("cursor")}
	problems := fieldErrors{}
	if query.Has("limit") {
		limit, err := strconv.Atoi(query.Get("limit"))
		if err != nil || limit < 1 || limit > maxPageSize {
			problems["limit"] = msgLimit
		} else {
			page.limit = limit
		}
	}
	return page, problems.err()
}

// encodeCursor writes a position in a list's sort order as an opaque token.
func encodeCursor(position any) (string, error) {
	payload, err := json.Marshal(position)
	if err != nil {
		return "", fmt.Errorf("encode cursor: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(payload), nil
}

// decodeCursor reads a position back; an unreadable cursor is a 422.
func decodeCursor(cursor string, into any) error {
	payload, err := base64.RawURLEncoding.DecodeString(cursor)
	if err != nil || json.Unmarshal(payload, into) != nil {
		return failValidation(map[string]string{"cursor": msgCursor})
	}
	return nil
}
