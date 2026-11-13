package main

import (
	"io"
	"net/http"
)

func readAllBytes(res *http.Response) ([]byte, error) {
	return io.ReadAll(res.Body)
}
