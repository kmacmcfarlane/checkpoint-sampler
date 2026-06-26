package model

import "fmt"

// TooManyItemsCode is the stable error code used when a study or job would
// produce more total work items than the configured maximum. The frontend and
// API transport layers map this code to a user-facing message.
const TooManyItemsCode = "too_many_items"

// TooManyItemsError is a typed error returned when the computed total number of
// work items for a study or sample job exceeds the configured limit. It carries
// the computed total and the configured limit so callers (API/transport) can
// surface a precise, stable message without string-parsing.
type TooManyItemsError struct {
	// Total is the computed number of work items that triggered the rejection.
	Total int
	// Limit is the configured maximum number of work items allowed.
	Limit int
}

// Error implements the error interface with a stable, parseable message that
// includes both the computed total and the configured limit.
func (e *TooManyItemsError) Error() string {
	return fmt.Sprintf("total work items %d exceeds the configured maximum of %d", e.Total, e.Limit)
}

// Code returns the stable error code for this error type.
func (e *TooManyItemsError) Code() string {
	return TooManyItemsCode
}
