package service

import (
	"fmt"
	"net/url"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"

	"github.com/kmacmcfarlane/checkpoint-sampler/local-web-app/backend/internal/model"
)

// batchPattern matches the _NNNNN_ suffix in ComfyUI filenames.
var batchPattern = regexp.MustCompile(`_(\d+)_$`)

// ScannerFileSystem defines the operations the scanner needs from the filesystem.
type ScannerFileSystem interface {
	ListPNGFiles(dir string) ([]string, error)
}

// Scanner scans sample directories for a training run's checkpoints and discovers
// images with dimensions.
type Scanner struct {
	fs        ScannerFileSystem
	sampleDir string
}

// NewScanner creates a Scanner backed by the given filesystem and sample directory.
func NewScanner(fs ScannerFileSystem, sampleDir string) *Scanner {
	return &Scanner{fs: fs, sampleDir: sampleDir}
}

// ScanTrainingRun discovers images and dimensions for a training run by scanning
// the sample directories for each checkpoint that has samples.
func (s *Scanner) ScanTrainingRun(tr model.TrainingRun) (*model.ScanResult, error) {
	// Track unique dimension values: dimName → set of values
	dimValues := make(map[string]map[string]struct{})
	dimTypes := make(map[string]model.DimensionType)

	// The checkpoint dimension is always int type
	dimTypes["checkpoint"] = model.DimensionTypeInt

	// key → image for deduplication (highest batch number wins)
	type imageEntry struct {
		image    model.Image
		batchNum int
	}
	imageMap := make(map[string]imageEntry)

	for _, cp := range tr.Checkpoints {
		if !cp.HasSamples {
			continue
		}

		// Checkpoint dimension value
		checkpointValue := strconv.Itoa(cp.StepNumber)

		// Track checkpoint dimension value
		if dimValues["checkpoint"] == nil {
			dimValues["checkpoint"] = make(map[string]struct{})
		}
		dimValues["checkpoint"][checkpointValue] = struct{}{}

		// Scan the sample directory for this checkpoint
		sampleDirPath := filepath.Join(s.sampleDir, cp.Filename)
		files, err := s.fs.ListPNGFiles(sampleDirPath)
		if err != nil {
			return nil, fmt.Errorf("listing PNG files for checkpoint %q: %w", cp.Filename, err)
		}

		for _, filename := range files {
			fileDims, batchNum := parseFilename(filename)
			if fileDims == nil {
				continue
			}

			// Merge checkpoint dimension + file dimensions
			allDims := make(map[string]string)
			allDims["checkpoint"] = checkpointValue
			for k, v := range fileDims {
				allDims[k] = v
			}

			// Track file dimension values and types
			for name, val := range fileDims {
				if dimValues[name] == nil {
					dimValues[name] = make(map[string]struct{})
				}
				dimValues[name][val] = struct{}{}
				if _, exists := dimTypes[name]; !exists {
					if _, err := strconv.Atoi(val); err == nil {
						dimTypes[name] = model.DimensionTypeInt
					} else {
						dimTypes[name] = model.DimensionTypeString
					}
				}
			}

			// Build dedup key from all dimensions except batch
			dedupKey := buildDedupKey(allDims)

			// Relative path: checkpoint_filename/image_filename
			relPath := filepath.Join(cp.Filename, filename)

			existing, found := imageMap[dedupKey]
			if !found || batchNum > existing.batchNum {
				imageMap[dedupKey] = imageEntry{
					image: model.Image{
						RelativePath: relPath,
						Dimensions:   allDims,
					},
					batchNum: batchNum,
				}
			}
		}
	}

	// Collect images
	images := make([]model.Image, 0, len(imageMap))
	for _, entry := range imageMap {
		images = append(images, entry.image)
	}
	sort.Slice(images, func(i, j int) bool {
		return images[i].RelativePath < images[j].RelativePath
	})

	// Build dimension list
	dimensions := buildDimensions(dimValues, dimTypes)

	return &model.ScanResult{
		Images:     images,
		Dimensions: dimensions,
	}, nil
}

// parseFilename parses a query-encoded filename like
// "index=5&prompt_name=portal_hub&seed=422&cfg=3&_00001_.png"
// Returns the dimension key-value pairs and the batch number.
// The _NNNNN_ batch suffix is not treated as a dimension.
func parseFilename(filename string) (dims map[string]string, batchNum int) {
	ext := filepath.Ext(filename)
	if !strings.EqualFold(ext, ".png") {
		return nil, 0
	}

	name := strings.TrimSuffix(filename, ext)

	// Extract batch number from _NNNNN_ suffix
	batchNum = 0
	if m := batchPattern.FindStringSubmatch(name); m != nil {
		batchNum, _ = strconv.Atoi(m[1])
		name = name[:len(name)-len(m[0])]
	}

	// Remove trailing & if present after batch removal
	name = strings.TrimRight(name, "&")

	if name == "" {
		return nil, batchNum
	}

	// Parse query-encoded key=value pairs
	values, err := url.ParseQuery(name)
	if err != nil {
		return nil, batchNum
	}

	dims = make(map[string]string)
	for key, vals := range values {
		if len(vals) > 0 && key != "" {
			dims[key] = vals[0]
		}
	}

	if len(dims) == 0 {
		return nil, batchNum
	}

	return dims, batchNum
}

// buildDedupKey creates a stable deduplication key from dimension values.
func buildDedupKey(dims map[string]string) string {
	keys := make([]string, 0, len(dims))
	for k := range dims {
		keys = append(keys, k)
	}
	sort.Strings(keys)

	parts := make([]string, len(keys))
	for i, k := range keys {
		parts[i] = k + "=" + dims[k]
	}
	return strings.Join(parts, "&")
}

// buildDimensions creates sorted Dimension objects from collected dimension values.
func buildDimensions(dimValues map[string]map[string]struct{}, dimTypes map[string]model.DimensionType) []model.Dimension {
	dimensions := make([]model.Dimension, 0, len(dimValues))
	for name, valSet := range dimValues {
		vals := make([]string, 0, len(valSet))
		for v := range valSet {
			vals = append(vals, v)
		}

		dimType := dimTypes[name]
		sortValues(vals, dimType)

		dimensions = append(dimensions, model.Dimension{
			Name:   name,
			Type:   dimType,
			Values: vals,
		})
	}
	sort.Slice(dimensions, func(i, j int) bool {
		return dimensions[i].Name < dimensions[j].Name
	})
	return dimensions
}

// sortValues sorts dimension values according to their type.
func sortValues(vals []string, dimType model.DimensionType) {
	if dimType == model.DimensionTypeInt {
		sort.Slice(vals, func(i, j int) bool {
			vi, ei := strconv.Atoi(vals[i])
			vj, ej := strconv.Atoi(vals[j])
			if ei != nil || ej != nil {
				return vals[i] < vals[j]
			}
			return vi < vj
		})
	} else {
		sort.Strings(vals)
	}
}
