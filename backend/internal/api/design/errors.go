package design

// Canonical Goa error vocabulary (R-016).
//
// Every design method that can fail declares its error set drawn from the
// shared vocabulary below. One canonical code is used per failure class across
// all services so the frontend can rely on stable codes without per-service
// special-casing (architecture.md §2.7). The same list is mirrored in
// docs/api.md §5.3.
//
//	Code                  HTTP status                  Meaning
//	------------------    --------------------------   ------------------------------------------------
//	internal_error        500 InternalServerError      Unexpected server-side failure: DB error,
//	                                                    filesystem error, or a scan/discovery/validation
//	                                                    operation that failed unexpectedly.
//	not_found             404 NotFound                 The requested entity does not exist.
//	invalid_payload       400 BadRequest               Malformed or invalid request data, including a
//	                                                    rejected filename or file path (traversal).
//	invalid_state         400 BadRequest               The operation is not valid for the entity's
//	                                                    current state (e.g. starting a running job).
//	too_many_items        422 UnprocessableEntity      Computed total work items exceeds the configured
//	                                                    maximum.
//	service_unavailable   503 ServiceUnavailable       A required dependency (the ComfyUI connection)
//	                                                    is unavailable.
//
// Domain-specific codes (invalid_state, too_many_items, service_unavailable) are
// retained only where the frontend genuinely needs to distinguish them from a
// generic failure. All other 500-class failures collapse to internal_error,
// all 404s to not_found, and all malformed-input 400s to invalid_payload.
//
// When adding a new failing method, reuse a code from this list. Introduce a new
// code only for a genuinely new failure class the frontend must distinguish, and
// document it here and in docs/api.md.
