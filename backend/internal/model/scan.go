package model

// Image represents a discovered image with its parsed dimension values.
type Image struct {
	// RelativePath is the path relative to the dataset root.
	RelativePath string
	// Dimensions maps dimension names to their string values for this image.
	Dimensions map[string]string
}

// Dimension represents a discovered dimension with its unique values.
type Dimension struct {
	Name   string
	Type   DimensionType
	Values []string
}

// ScanResult contains the results of scanning a training run's directories.
type ScanResult struct {
	Images     []Image
	Dimensions []Dimension
}
