package model

// ImageMetadataValues holds image metadata with fields classified by type.
// String fields contain text values; numeric fields contain quantitative values
// such as seed, steps, and cfg that benefit from numeric representation.
type ImageMetadataValues struct {
	// StringFields holds text-valued metadata entries.
	StringFields map[string]string
	// NumericFields holds quantitative metadata entries (e.g. seed, steps, cfg).
	NumericFields map[string]float64
}
