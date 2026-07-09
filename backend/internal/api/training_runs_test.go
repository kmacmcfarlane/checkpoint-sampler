package api_test

import (
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
	"github.com/sirupsen/logrus"
	goa "goa.design/goa/v3/pkg"

	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/api"
	gentrainingruns "github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/api/gen/training_runs"
	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/fileformat"
	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/model"
	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/service"
)

// S-155: training-run IDs are stable opaque strings derived from the run's
// relative path, not positional indices. These helpers resolve the stable ID
// of the nth discovered run for a given source by listing first, so tests
// address the same run regardless of discovery order. missingID is a
// syntactically valid but unmatched opaque id used for not-found assertions.
const missingID = "bm9uZXhpc3RlbnQ"

func viewerRunID(svc *api.TrainingRunsService, n int) string {
	runs, err := svc.List(context.Background(), &gentrainingruns.ListPayload{Source: "samples"})
	Expect(err).NotTo(HaveOccurred())
	Expect(len(runs)).To(BeNumerically(">", n))
	return runs[n].ID
}

func checkpointRunID(svc *api.TrainingRunsService, n int) string {
	runs, err := svc.List(context.Background(), &gentrainingruns.ListPayload{Source: "checkpoints"})
	Expect(err).NotTo(HaveOccurred())
	Expect(len(runs)).To(BeNumerically(">", n))
	return runs[n].ID
}

// fakeViewerDiscoveryFS implements service.ViewerFileSystem for testing.
type fakeViewerDiscoveryFS struct {
	subdirs map[string][]string // dir path → list of subdirectory names
	errs    map[string]error    // dir path → error to return
}

func newFakeViewerDiscoveryFS() *fakeViewerDiscoveryFS {
	return &fakeViewerDiscoveryFS{
		subdirs: make(map[string][]string),
		errs:    make(map[string]error),
	}
}

func (f *fakeViewerDiscoveryFS) ListSubdirectories(root string) ([]string, error) {
	if err, ok := f.errs[root]; ok {
		return nil, err
	}
	return f.subdirs[root], nil
}

func (f *fakeViewerDiscoveryFS) DirectoryExists(path string) bool {
	_, ok := f.subdirs[path]
	return ok
}

// fakeScanFS implements service.ScannerFileSystem for testing.
type fakeScanFS struct {
	files      map[string][]string
	errs       map[string]error
	fileData   map[string][]byte   // file path -> content for ReadFile
	existFiles map[string]bool     // explicit file existence for FileExists
}

func newFakeScanFS() *fakeScanFS {
	return &fakeScanFS{
		files:      make(map[string][]string),
		errs:       make(map[string]error),
		fileData:   make(map[string][]byte),
		existFiles: make(map[string]bool),
	}
}

func (f *fakeScanFS) ListPNGFiles(dir string) ([]string, error) {
	if err, ok := f.errs[dir]; ok {
		return nil, err
	}
	return f.files[dir], nil
}

func (f *fakeScanFS) DirectoryExists(path string) bool {
	if _, ok := f.files[path]; ok {
		return true
	}
	// A path registered in errs represents a directory that exists but produces
	// a read error (e.g. disk error). DirectoryExists must return true so the
	// scanner proceeds to ListPNGFiles and surfaces the real error.
	_, ok := f.errs[path]
	return ok
}

func (f *fakeScanFS) FileExists(path string) bool {
	if explicit, ok := f.existFiles[path]; ok {
		return explicit
	}
	// Check if the file's basename is in the directory listing for its parent dir.
	dir := filepath.Dir(path)
	base := filepath.Base(path)
	for _, name := range f.files[dir] {
		if name == base {
			return true
		}
	}
	return false
}

func (f *fakeScanFS) ReadFile(path string) ([]byte, error) {
	data, ok := f.fileData[path]
	if !ok {
		return nil, os.ErrNotExist
	}
	return data, nil
}

// fakeCheckpointDiscoveryFS implements service.CheckpointFileSystem for testing.
type fakeCheckpointDiscoveryFS struct {
	safetensors map[string][]string // root → relative file paths
	dirs        map[string]bool     // path → exists?
	subdirs     map[string][]string // root → immediate subdirectory names
}

func newFakeCheckpointDiscoveryFS() *fakeCheckpointDiscoveryFS {
	return &fakeCheckpointDiscoveryFS{
		safetensors: make(map[string][]string),
		dirs:        make(map[string]bool),
		subdirs:     make(map[string][]string),
	}
}

func (f *fakeCheckpointDiscoveryFS) ListSafetensorsFiles(root string) ([]string, error) {
	return f.safetensors[root], nil
}

func (f *fakeCheckpointDiscoveryFS) DirectoryExists(path string) bool {
	return f.dirs[path]
}

func (f *fakeCheckpointDiscoveryFS) ListSubdirectories(root string) ([]string, error) {
	return f.subdirs[root], nil
}

// fakeStudyGetter implements the api.StudyGetter interface for testing.
type fakeStudyGetter struct {
	studies map[string]model.Study
	err     error
}

func newFakeStudyGetter() *fakeStudyGetter {
	return &fakeStudyGetter{studies: make(map[string]model.Study)}
}

func (f *fakeStudyGetter) GetStudy(id string) (model.Study, error) {
	if f.err != nil {
		return model.Study{}, f.err
	}
	s, ok := f.studies[id]
	if !ok {
		return model.Study{}, fmt.Errorf("study %q not found", id)
	}
	return s, nil
}

var _ = Describe("TrainingRunsService", func() {
	var (
		viewerFS        *fakeViewerDiscoveryFS
		scanFS          *fakeScanFS
		cpFS            *fakeCheckpointDiscoveryFS
		viewerDiscovery *service.ViewerDiscoveryService
		cpDiscovery     *service.DiscoveryService
		scanner         *service.Scanner
		sampleDir       string
		logger          *logrus.Logger
	)

	BeforeEach(func() {
		sampleDir = "/samples"
		viewerFS = newFakeViewerDiscoveryFS()
		scanFS = newFakeScanFS()
		cpFS = newFakeCheckpointDiscoveryFS()
		logger = logrus.New()
		logger.SetOutput(io.Discard)
	})

	// Helper to create a TrainingRunsService with all dependencies
	makeSvc := func(validator *service.ValidationService, watcher *service.Watcher) *api.TrainingRunsService {
		return api.NewTrainingRunsService(viewerDiscovery, cpDiscovery, scanner, validator, watcher, nil)
	}


	Describe("List", func() {
		// AC1: Scanner discovers viewable content from sample output directories
		It("returns empty slice when no sample directories found", func() {
			viewerFS.subdirs[sampleDir] = []string{}
			viewerDiscovery = service.NewViewerDiscoveryService(viewerFS, sampleDir, logger)
			cpDiscovery = service.NewDiscoveryService(cpFS, []string{}, nil, sampleDir, logger)
			scanner = service.NewScanner(scanFS, sampleDir, logger)
			svc := makeSvc(nil, nil)

			result, err := svc.List(context.Background(), &gentrainingruns.ListPayload{Source: "samples"})

			Expect(err).NotTo(HaveOccurred())
			Expect(result).To(HaveLen(0))
		})

		It("returns training runs discovered from sample output directories", func() {
			viewerFS.subdirs[sampleDir] = []string{
				"model-a.safetensors",
				"model-a-step00001000.safetensors",
				"model-b.safetensors",
			}
			viewerDiscovery = service.NewViewerDiscoveryService(viewerFS, sampleDir, logger)
			cpDiscovery = service.NewDiscoveryService(cpFS, []string{}, nil, sampleDir, logger)
			scanner = service.NewScanner(scanFS, sampleDir, logger)
			svc := makeSvc(nil, nil)

			result, err := svc.List(context.Background(), &gentrainingruns.ListPayload{Source: "samples"})

			Expect(err).NotTo(HaveOccurred())
			Expect(result).To(HaveLen(2))
			// Sorted by name
			Expect(result[0].Name).To(Equal("model-a"))
			Expect(result[0].CheckpointCount).To(Equal(2))
			Expect(result[1].Name).To(Equal("model-b"))
			Expect(result[1].CheckpointCount).To(Equal(1))
		})

		It("includes checkpoint details in response", func() {
			viewerFS.subdirs[sampleDir] = []string{
				"model-step00001000.safetensors",
				"model-step00002000.safetensors",
			}
			viewerDiscovery = service.NewViewerDiscoveryService(viewerFS, sampleDir, logger)
			cpDiscovery = service.NewDiscoveryService(cpFS, []string{}, nil, sampleDir, logger)
			scanner = service.NewScanner(scanFS, sampleDir, logger)
			svc := makeSvc(nil, nil)

			result, err := svc.List(context.Background(), &gentrainingruns.ListPayload{Source: "samples"})

			Expect(err).NotTo(HaveOccurred())
			Expect(result).To(HaveLen(1))
			Expect(result[0].Checkpoints).To(HaveLen(2))
			Expect(result[0].Checkpoints[0].Filename).To(Equal("model-step00001000.safetensors"))
			Expect(result[0].Checkpoints[0].StepNumber).To(Equal(1000))
			// All viewer-discovered checkpoints have samples
			Expect(result[0].Checkpoints[0].HasSamples).To(BeTrue())
			Expect(result[0].Checkpoints[1].Filename).To(Equal("model-step00002000.safetensors"))
			Expect(result[0].Checkpoints[1].HasSamples).To(BeTrue())
		})

		// AC1: All listed runs have samples by definition
		It("returns all runs via samples source", func() {
			viewerFS.subdirs[sampleDir] = []string{
				"model-a.safetensors",
				"model-b.safetensors",
			}
			viewerDiscovery = service.NewViewerDiscoveryService(viewerFS, sampleDir, logger)
			cpDiscovery = service.NewDiscoveryService(cpFS, []string{}, nil, sampleDir, logger)
			scanner = service.NewScanner(scanFS, sampleDir, logger)
			svc := makeSvc(nil, nil)

			result, err := svc.List(context.Background(), &gentrainingruns.ListPayload{Source: "samples"})

			Expect(err).NotTo(HaveOccurred())
			Expect(result).To(HaveLen(2))
			Expect(result[0].HasSamples).To(BeTrue())
			Expect(result[1].HasSamples).To(BeTrue())
		})

		// AC2: Training runs derived from study directory structure
		It("discovers study-scoped training runs", func() {
			viewerFS.subdirs[sampleDir] = []string{"my-study"}
			viewerFS.subdirs[sampleDir+"/my-study"] = []string{
				"model-step00001000.safetensors",
				"model-step00002000.safetensors",
			}
			viewerDiscovery = service.NewViewerDiscoveryService(viewerFS, sampleDir, logger)
			cpDiscovery = service.NewDiscoveryService(cpFS, []string{}, nil, sampleDir, logger)
			scanner = service.NewScanner(scanFS, sampleDir, logger)
			svc := makeSvc(nil, nil)

			result, err := svc.List(context.Background(), &gentrainingruns.ListPayload{Source: "samples"})

			Expect(err).NotTo(HaveOccurred())
			Expect(result).To(HaveLen(1))
			Expect(result[0].Name).To(Equal("my-study/model"))
			Expect(result[0].CheckpointCount).To(Equal(2))
		})

		// source=checkpoints returns checkpoint-based training runs
		It("returns checkpoint-based training runs when source=checkpoints", func() {
			cpFS.safetensors["/checkpoints"] = []string{
				"qwen/psai4rt-v0.3.0-step00001000.safetensors",
				"qwen/psai4rt-v0.3.0-step00002000.safetensors",
				"qwen/psai4rt-v0.3.0.safetensors",
			}
			viewerDiscovery = service.NewViewerDiscoveryService(viewerFS, sampleDir, logger)
			cpDiscovery = service.NewDiscoveryService(cpFS, []string{"/checkpoints"}, nil, sampleDir, logger)
			scanner = service.NewScanner(scanFS, sampleDir, logger)
			svc := makeSvc(nil, nil)

			result, err := svc.List(context.Background(), &gentrainingruns.ListPayload{Source: "checkpoints"})

			Expect(err).NotTo(HaveOccurred())
			Expect(result).To(HaveLen(1))
			Expect(result[0].Name).To(Equal("qwen/psai4rt-v0.3.0"))
			Expect(result[0].CheckpointCount).To(Equal(3))
		})

		It("returns checkpoint-based runs with correct has_samples flag", func() {
			cpFS.safetensors["/checkpoints"] = []string{
				"model-a.safetensors",
				"model-b.safetensors",
			}
			// model-a has a sample directory, model-b does not
			cpFS.dirs[sampleDir+"/model-a.safetensors"] = true
			viewerDiscovery = service.NewViewerDiscoveryService(viewerFS, sampleDir, logger)
			cpDiscovery = service.NewDiscoveryService(cpFS, []string{"/checkpoints"}, nil, sampleDir, logger)
			scanner = service.NewScanner(scanFS, sampleDir, logger)
			svc := makeSvc(nil, nil)

			result, err := svc.List(context.Background(), &gentrainingruns.ListPayload{Source: "checkpoints"})

			Expect(err).NotTo(HaveOccurred())
			Expect(result).To(HaveLen(2))
			// Sorted by name: model-a, model-b
			Expect(result[0].Name).To(Equal("model-a"))
			Expect(result[0].HasSamples).To(BeTrue())
			Expect(result[1].Name).To(Equal("model-b"))
			Expect(result[1].HasSamples).To(BeFalse())
		})

		// B-142: When the FSState cache is configured, List serves from the cache.
		// Without refresh, files added to disk after Populate() are NOT visible
		// (this models the stale NFS cache). With refresh=true, List forces a
		// fresh Populate() so the newly added file appears.
		It("serves stale cache without refresh and rescans with refresh=true (B-142)", func() {
			cpFS.safetensors["/checkpoints"] = []string{
				"model-step00001000.safetensors",
			}
			viewerDiscovery = service.NewViewerDiscoveryService(viewerFS, sampleDir, logger)
			cpDiscovery = service.NewDiscoveryService(cpFS, []string{"/checkpoints"}, nil, sampleDir, logger)
			scanner = service.NewScanner(scanFS, sampleDir, logger)
			svc := makeSvc(nil, nil)

			// Wire an FSState cache backed by the same discovery services and populate it.
			fsState := service.NewFSState(cpDiscovery, viewerDiscovery, logger)
			Expect(fsState.Populate()).To(Succeed())
			svc.SetFSState(fsState)

			// A new checkpoint file appears on disk (e.g. added on an NFS mount by
			// another host) after the snapshot was taken. fsnotify did not fire.
			cpFS.safetensors["/checkpoints"] = []string{
				"model-step00001000.safetensors",
				"model-step00002000.safetensors",
			}

			// Without refresh: served from stale cache → only the original run is seen.
			stale, err := svc.List(context.Background(), &gentrainingruns.ListPayload{Source: "checkpoints"})
			Expect(err).NotTo(HaveOccurred())
			Expect(stale).To(HaveLen(1))
			Expect(stale[0].CheckpointCount).To(Equal(1))

			// With refresh=true: forces a fresh rescan → the new checkpoint appears.
			fresh, err := svc.List(context.Background(), &gentrainingruns.ListPayload{Source: "checkpoints", Refresh: true})
			Expect(err).NotTo(HaveOccurred())
			Expect(fresh).To(HaveLen(1))
			Expect(fresh[0].CheckpointCount).To(Equal(2))
		})

		// AC: refresh=true must surface discovery failures as an internal_error.
		// B-142: When refresh is requested and Populate() fails (e.g. an NFS stale read
		// during the forced rescan), List must return the error mapped to the canonical
		// internal_error Goa error code (R-016) rather than serving stale data or panicking.
		It("returns internal_error when refresh rescan fails (B-142)", func() {
			cpFS.safetensors["/checkpoints"] = []string{
				"model-step00001000.safetensors",
			}
			viewerDiscovery = service.NewViewerDiscoveryService(viewerFS, sampleDir, logger)
			cpDiscovery = service.NewDiscoveryService(cpFS, []string{"/checkpoints"}, nil, sampleDir, logger)
			scanner = service.NewScanner(scanFS, sampleDir, logger)
			svc := makeSvc(nil, nil)

			// Wire and populate the FSState cache successfully first.
			fsState := service.NewFSState(cpDiscovery, viewerDiscovery, logger)
			Expect(fsState.Populate()).To(Succeed())
			svc.SetFSState(fsState)

			// Inject a viewer-discovery error so the forced refresh Populate() fails.
			// Populate() calls DiscoverViewable(), which lists sampleDir first.
			// (fakeCheckpointDiscoveryFS.ListSafetensorsFiles never errors, so the
			// error must be injected on the viewer FS path.)
			viewerFS.errs[sampleDir] = fmt.Errorf("nfs stale")

			_, err := svc.List(context.Background(), &gentrainingruns.ListPayload{Source: "checkpoints", Refresh: true})

			Expect(err).To(HaveOccurred())
			serr, ok := err.(*goa.ServiceError)
			Expect(ok).To(BeTrue(), "expected a goa.ServiceError")
			Expect(serr.Name).To(Equal("internal_error"))
		})

		It("defaults to samples source when source parameter is empty", func() {
			viewerFS.subdirs[sampleDir] = []string{
				"viewer-model.safetensors",
			}
			viewerDiscovery = service.NewViewerDiscoveryService(viewerFS, sampleDir, logger)
			cpDiscovery = service.NewDiscoveryService(cpFS, []string{}, nil, sampleDir, logger)
			scanner = service.NewScanner(scanFS, sampleDir, logger)
			svc := makeSvc(nil, nil)

			// Source defaults to "samples" via Goa Default() — pass it explicitly
			result, err := svc.List(context.Background(), &gentrainingruns.ListPayload{Source: "samples"})

			Expect(err).NotTo(HaveOccurred())
			Expect(result).To(HaveLen(1))
			Expect(result[0].Name).To(Equal("viewer-model"))
		})
	})

	Describe("Scan", func() {
		It("returns not_found for invalid training run ID", func() {
			viewerFS.subdirs[sampleDir] = []string{
				"model.safetensors",
			}
			viewerDiscovery = service.NewViewerDiscoveryService(viewerFS, sampleDir, logger)
			cpDiscovery = service.NewDiscoveryService(cpFS, []string{}, nil, sampleDir, logger)
			scanner = service.NewScanner(scanFS, sampleDir, logger)
			svc := makeSvc(nil, nil)

			_, err := svc.Scan(context.Background(), &gentrainingruns.ScanPayload{ID: missingID})

			Expect(err).To(HaveOccurred())
			Expect(err.Error()).To(ContainSubstring("not found"))
		})

		It("returns not_found for unknown ID", func() {
			viewerFS.subdirs[sampleDir] = []string{
				"model.safetensors",
			}
			viewerDiscovery = service.NewViewerDiscoveryService(viewerFS, sampleDir, logger)
			cpDiscovery = service.NewDiscoveryService(cpFS, []string{}, nil, sampleDir, logger)
			scanner = service.NewScanner(scanFS, sampleDir, logger)
			svc := makeSvc(nil, nil)

			_, err := svc.Scan(context.Background(), &gentrainingruns.ScanPayload{ID: missingID + "x"})

			Expect(err).To(HaveOccurred())
		})

		It("returns scan results with images and dimensions (legacy)", func() {
			viewerFS.subdirs[sampleDir] = []string{
				"model-step00001000.safetensors",
			}
			viewerDiscovery = service.NewViewerDiscoveryService(viewerFS, sampleDir, logger)
			cpDiscovery = service.NewDiscoveryService(cpFS, []string{}, nil, sampleDir, logger)
			scanner = service.NewScanner(scanFS, sampleDir, logger)
			svc := makeSvc(nil, nil)

			scanFS.files[sampleDir+"/model-step00001000.safetensors"] = []string{
				"seed=1&cfg=3&_00001_.png",
				"seed=2&cfg=7&_00001_.png",
			}

			result, err := svc.Scan(context.Background(), &gentrainingruns.ScanPayload{ID: viewerRunID(svc, 0)})

			Expect(err).NotTo(HaveOccurred())
			Expect(result.Images).To(HaveLen(2))
			Expect(result.Dimensions).NotTo(BeEmpty())
		})

		It("auto-derives study name for study-scoped runs", func() {
			viewerFS.subdirs[sampleDir] = []string{"my-study"}
			viewerFS.subdirs[sampleDir+"/my-study"] = []string{
				"model-step00001000.safetensors",
			}
			viewerDiscovery = service.NewViewerDiscoveryService(viewerFS, sampleDir, logger)
			cpDiscovery = service.NewDiscoveryService(cpFS, []string{}, nil, sampleDir, logger)
			scanner = service.NewScanner(scanFS, sampleDir, logger)
			svc := makeSvc(nil, nil)

			// The scanner should look at /samples/my-study/model-step00001000.safetensors/
			scanFS.files[sampleDir+"/my-study/model-step00001000.safetensors"] = []string{
				"seed=42&_00001_.png",
			}

			result, err := svc.Scan(context.Background(), &gentrainingruns.ScanPayload{ID: viewerRunID(svc, 0)})

			Expect(err).NotTo(HaveOccurred())
			Expect(result.Images).To(HaveLen(1))
		})

		It("returns internal_error when scanner encounters an error", func() {
			viewerFS.subdirs[sampleDir] = []string{
				"model-step00001000.safetensors",
			}
			viewerDiscovery = service.NewViewerDiscoveryService(viewerFS, sampleDir, logger)
			cpDiscovery = service.NewDiscoveryService(cpFS, []string{}, nil, sampleDir, logger)
			scanner = service.NewScanner(scanFS, sampleDir, logger)
			svc := makeSvc(nil, nil)

			scanFS.errs[sampleDir+"/model-step00001000.safetensors"] = fmt.Errorf("disk error")

			_, err := svc.Scan(context.Background(), &gentrainingruns.ScanPayload{ID: viewerRunID(svc, 0)})

			Expect(err).To(HaveOccurred())
			Expect(err.Error()).To(ContainSubstring("disk error"))
			// R-016: scan failures map to the canonical internal_error (500) code.
			serr, ok := err.(*goa.ServiceError)
			Expect(ok).To(BeTrue(), "expected a goa.ServiceError")
			Expect(serr.Name).To(Equal("internal_error"))
		})

		It("maps model types to API response types correctly", func() {
			viewerFS.subdirs[sampleDir] = []string{
				"model-step00001000.safetensors",
				"model-step00002000.safetensors",
			}
			viewerDiscovery = service.NewViewerDiscoveryService(viewerFS, sampleDir, logger)
			cpDiscovery = service.NewDiscoveryService(cpFS, []string{}, nil, sampleDir, logger)
			scanner = service.NewScanner(scanFS, sampleDir, logger)
			svc := makeSvc(nil, nil)

			scanFS.files[sampleDir+"/model-step00001000.safetensors"] = []string{
				"seed=42&_00001_.png",
			}
			scanFS.files[sampleDir+"/model-step00002000.safetensors"] = []string{
				"seed=42&_00001_.png",
			}

			result, err := svc.Scan(context.Background(), &gentrainingruns.ScanPayload{ID: viewerRunID(svc, 0)})

			Expect(err).NotTo(HaveOccurred())
			Expect(result.Images).To(HaveLen(2))

			dimMap := make(map[string]*gentrainingruns.DimensionResponse)
			for _, d := range result.Dimensions {
				dimMap[d.Name] = d
			}
			Expect(dimMap["checkpoint"].Type).To(Equal("int"))
			Expect(dimMap["checkpoint"].Values).To(Equal([]string{"1000", "2000"}))
			Expect(dimMap["seed"].Type).To(Equal("int"))
		})

		// AC1 (S-155): A held training-run id must address the SAME run after a
		// rescan that changes discovery order. Previously ids were positional
		// indices, so inserting a new run shifted the index and a held id pointed
		// at a different run. With stable opaque ids, the held id still resolves
		// to the originally selected run.
		It("scans the same run by held id after a rescan reorders discovery", func() {
			// Initial discovery: two runs. "mid-model" sorts to index 0.
			viewerFS.subdirs[sampleDir] = []string{
				"mid-model-step00001000.safetensors",
				"omega-model-step00001000.safetensors",
			}
			viewerDiscovery = service.NewViewerDiscoveryService(viewerFS, sampleDir, logger)
			cpDiscovery = service.NewDiscoveryService(cpFS, []string{}, nil, sampleDir, logger)
			scanner = service.NewScanner(scanFS, sampleDir, logger)
			svc := makeSvc(nil, nil)

			runsBefore, err := svc.List(context.Background(), &gentrainingruns.ListPayload{Source: "samples"})
			Expect(err).NotTo(HaveOccurred())
			Expect(runsBefore).To(HaveLen(2))
			// Select "mid-model" and hold its id and original index.
			var heldID, heldName string
			oldIndex := -1
			for i, r := range runsBefore {
				if r.Name == "mid-model" {
					heldID = r.ID
					heldName = r.Name
					oldIndex = i
				}
			}
			Expect(heldID).NotTo(BeEmpty())
			Expect(oldIndex).To(Equal(0))

			// Sample files for the selected run, used to verify the scan targets it.
			scanFS.files[sampleDir+"/mid-model-step00001000.safetensors"] = []string{
				"seed=1&_00001_.png",
				"seed=2&_00001_.png",
			}

			// Rescan: a new run is added that sorts BEFORE "mid-model", shifting
			// the original run's positional index. The held id must still resolve
			// to "mid-model".
			viewerFS.subdirs[sampleDir] = []string{
				"aaa-new-model-step00001000.safetensors",
				"mid-model-step00001000.safetensors",
				"omega-model-step00001000.safetensors",
			}

			runsAfter, err := svc.List(context.Background(), &gentrainingruns.ListPayload{Source: "samples"})
			Expect(err).NotTo(HaveOccurred())
			Expect(runsAfter).To(HaveLen(3))
			// Confirm the positional index of the held run actually changed.
			var newIndex int
			for i, r := range runsAfter {
				if r.ID == heldID {
					newIndex = i
				}
			}
			Expect(newIndex).NotTo(Equal(oldIndex), "the held run's position should have shifted after rescan")

			// Scan by the held id and assert it addressed the originally selected run.
			result, err := svc.Scan(context.Background(), &gentrainingruns.ScanPayload{ID: heldID})
			Expect(err).NotTo(HaveOccurred())
			Expect(result.Images).To(HaveLen(2))
			Expect(heldName).To(Equal("mid-model"))
		})
	})

	Describe("Validate", func() {
		// AC3: API endpoint to trigger validation of a selected sample set on demand
		It("returns not_found for invalid training run ID", func() {
			viewerFS.subdirs[sampleDir] = []string{
				"model.safetensors",
			}
			viewerDiscovery = service.NewViewerDiscoveryService(viewerFS, sampleDir, logger)
			cpDiscovery = service.NewDiscoveryService(cpFS, []string{}, nil, sampleDir, logger)
			scanner = service.NewScanner(scanFS, sampleDir, logger)
			validator := service.NewValidationService(scanFS, sampleDir, logger)
			svc := api.NewTrainingRunsService(viewerDiscovery, cpDiscovery, scanner, validator, nil, nil)

			_, err := svc.Validate(context.Background(), &gentrainingruns.ValidatePayload{ID: missingID})

			Expect(err).To(HaveOccurred())
			Expect(err.Error()).To(ContainSubstring("not found"))
		})

		// AC4: Validation reuses completeness-check logic against the selected sample set directory
		// AC5: Validation results returned to the frontend (per-checkpoint completeness counts)
		It("returns per-checkpoint completeness when all are complete", func() {
			viewerFS.subdirs[sampleDir] = []string{
				"model-step00001000.safetensors",
				"model-step00002000.safetensors",
			}
			viewerDiscovery = service.NewViewerDiscoveryService(viewerFS, sampleDir, logger)
			cpDiscovery = service.NewDiscoveryService(cpFS, []string{}, nil, sampleDir, logger)
			scanner = service.NewScanner(scanFS, sampleDir, logger)
			validator := service.NewValidationService(scanFS, sampleDir, logger)
			svc := api.NewTrainingRunsService(viewerDiscovery, cpDiscovery, scanner, validator, nil, nil)

			scanFS.files[sampleDir+"/model-step00001000.safetensors"] = []string{
				"seed=42&_00001_.png",
				"seed=43&_00001_.png",
			}
			scanFS.files[sampleDir+"/model-step00002000.safetensors"] = []string{
				"seed=42&_00001_.png",
				"seed=43&_00001_.png",
			}

			result, err := svc.Validate(context.Background(), &gentrainingruns.ValidatePayload{ID: viewerRunID(svc, 0)})

			Expect(err).NotTo(HaveOccurred())
			Expect(result.Checkpoints).To(HaveLen(2))
			Expect(result.Checkpoints[0].Expected).To(Equal(2))
			Expect(result.Checkpoints[0].Verified).To(Equal(2))
			Expect(result.Checkpoints[0].Missing).To(Equal(0))
			Expect(result.Checkpoints[1].Missing).To(Equal(0))
		})

		It("returns per-checkpoint completeness with missing files", func() {
			viewerFS.subdirs[sampleDir] = []string{
				"model-step00001000.safetensors",
				"model-step00002000.safetensors",
			}
			viewerDiscovery = service.NewViewerDiscoveryService(viewerFS, sampleDir, logger)
			cpDiscovery = service.NewDiscoveryService(cpFS, []string{}, nil, sampleDir, logger)
			scanner = service.NewScanner(scanFS, sampleDir, logger)
			validator := service.NewValidationService(scanFS, sampleDir, logger)
			svc := api.NewTrainingRunsService(viewerDiscovery, cpDiscovery, scanner, validator, nil, nil)

			scanFS.files[sampleDir+"/model-step00001000.safetensors"] = []string{
				"seed=42&_00001_.png",
				"seed=43&_00001_.png",
			}
			// Second checkpoint has fewer files
			scanFS.files[sampleDir+"/model-step00002000.safetensors"] = []string{
				"seed=42&_00001_.png",
			}

			result, err := svc.Validate(context.Background(), &gentrainingruns.ValidatePayload{ID: viewerRunID(svc, 0)})

			Expect(err).NotTo(HaveOccurred())
			Expect(result.Checkpoints).To(HaveLen(2))
			Expect(result.Checkpoints[0].Missing).To(Equal(0))
			Expect(result.Checkpoints[1].Missing).To(Equal(1))
		})

		It("auto-derives study name for study-scoped runs", func() {
			viewerFS.subdirs[sampleDir] = []string{"my-study"}
			viewerFS.subdirs[sampleDir+"/my-study"] = []string{
				"model-step00001000.safetensors",
			}
			viewerDiscovery = service.NewViewerDiscoveryService(viewerFS, sampleDir, logger)
			cpDiscovery = service.NewDiscoveryService(cpFS, []string{}, nil, sampleDir, logger)
			scanner = service.NewScanner(scanFS, sampleDir, logger)
			validator := service.NewValidationService(scanFS, sampleDir, logger)
			svc := api.NewTrainingRunsService(viewerDiscovery, cpDiscovery, scanner, validator, nil, nil)

			scanFS.files[sampleDir+"/my-study/model-step00001000.safetensors"] = []string{
				"seed=42&_00001_.png",
			}

			result, err := svc.Validate(context.Background(), &gentrainingruns.ValidatePayload{ID: viewerRunID(svc, 0)})

			Expect(err).NotTo(HaveOccurred())
			Expect(result.Checkpoints).To(HaveLen(1))
			Expect(result.Checkpoints[0].Expected).To(Equal(1))
			Expect(result.Checkpoints[0].Verified).To(Equal(1))
			Expect(result.Checkpoints[0].Missing).To(Equal(0))
		})

		// B-079: Study-aware validation uses checkpoint discovery (same source as the frontend).
		// Before fix, the Validate endpoint used viewer discovery, which returns no runs before
		// generation (causing not_found) and returns runs with embedded study dirs after
		// generation (causing double-nested paths and wrong validation results).
		Describe("study-aware validation (study_id provided)", func() {
			studyID := "study-abc"

			It("returns per-checkpoint completeness using checkpoint discovery before samples exist", func() {
				// Viewer discovery returns nothing (no samples yet)
				viewerFS.subdirs[sampleDir] = []string{}
				// Checkpoint discovery returns the training run
				cpFS.safetensors["/checkpoints"] = []string{
					"model-step00001000.safetensors",
					"model-step00002000.safetensors",
				}
				viewerDiscovery = service.NewViewerDiscoveryService(viewerFS, sampleDir, logger)
				cpDiscovery = service.NewDiscoveryService(cpFS, []string{"/checkpoints"}, nil, sampleDir, logger)
				scanner = service.NewScanner(scanFS, sampleDir, logger)
				validator := service.NewValidationService(scanFS, sampleDir, logger)
				studyGetter := newFakeStudyGetter()
				studyGetter.studies[studyID] = model.Study{
					ID:      studyID,
					Name:    "Test Study",
					Prompts: []model.NamedPrompt{{Name: "p1", Text: "prompt"}},
					Steps:   []int{20},
					CFGs:    []float64{7},
					SamplerSchedulerPairs: []model.SamplerSchedulerPair{
						{Sampler: "euler", Scheduler: "normal"},
					},
					Seeds: []int64{42},
				}
				svc := api.NewTrainingRunsService(viewerDiscovery, cpDiscovery, scanner, validator, nil, studyGetter)

				// No sample files yet — all checkpoints should show 0 verified
				sid := studyID
				result, err := svc.Validate(context.Background(), &gentrainingruns.ValidatePayload{ID: checkpointRunID(svc, 0), StudyID: &sid})

				Expect(err).NotTo(HaveOccurred())
				Expect(result.Checkpoints).To(HaveLen(2))
				Expect(result.Checkpoints[0].Verified).To(Equal(0))
				Expect(result.Checkpoints[1].Verified).To(Equal(0))
				Expect(result.ExpectedPerCheckpoint).To(Equal(1))
			})

			It("returns per-checkpoint completeness using correct scoped dir after generation", func() {
				// After generation: samples exist at {sampleDir}/{trainingRunName}/{studyName}/{checkpoint}/
				// Viewer discovery finds new-layout run (name embeds study output dir).
				studyName := "Test Study"
				viewerFS.subdirs[sampleDir] = []string{"model"}
				viewerFS.subdirs[sampleDir+"/model"] = []string{studyName}
				viewerFS.subdirs[sampleDir+"/model/"+studyName] = []string{
					"model-step00001000.safetensors",
					"model-step00002000.safetensors",
				}
				// Checkpoint discovery returns the training run using its canonical name.
				cpFS.safetensors["/checkpoints"] = []string{
					"model-step00001000.safetensors",
					"model-step00002000.safetensors",
				}
				viewerDiscovery = service.NewViewerDiscoveryService(viewerFS, sampleDir, logger)
				cpDiscovery = service.NewDiscoveryService(cpFS, []string{"/checkpoints"}, nil, sampleDir, logger)
				scanner = service.NewScanner(scanFS, sampleDir, logger)
				validator := service.NewValidationService(scanFS, sampleDir, logger)
				studyGetter := newFakeStudyGetter()
				studyGetter.studies[studyID] = model.Study{
					ID:      studyID,
					Name:    "Test Study",
					Prompts: []model.NamedPrompt{{Name: "p1", Text: "prompt"}},
					Steps:   []int{20},
					CFGs:    []float64{7},
					SamplerSchedulerPairs: []model.SamplerSchedulerPair{
						{Sampler: "euler", Scheduler: "normal"},
					},
					Seeds: []int64{42},
				}
				svc := api.NewTrainingRunsService(viewerDiscovery, cpDiscovery, scanner, validator, nil, studyGetter)

				// Sample files in the scoped directory: {sampleDir}/model/{studyName}/{checkpoint}/
				scanFS.files[sampleDir+"/model/"+studyName+"/model-step00001000.safetensors"] = []string{
					"seed=42&_00001_.png",
				}
				scanFS.files[sampleDir+"/model/"+studyName+"/model-step00002000.safetensors"] = []string{
					"seed=42&_00001_.png",
				}

				sid := studyID
				result, err := svc.Validate(context.Background(), &gentrainingruns.ValidatePayload{ID: checkpointRunID(svc, 0), StudyID: &sid})

				Expect(err).NotTo(HaveOccurred())
				Expect(result.Checkpoints).To(HaveLen(2))
				Expect(result.Checkpoints[0].Verified).To(Equal(1))
				Expect(result.Checkpoints[0].Missing).To(Equal(0))
				Expect(result.Checkpoints[1].Verified).To(Equal(1))
				Expect(result.Checkpoints[1].Missing).To(Equal(0))
				Expect(result.TotalActual).To(Equal(2))
			})

			It("correctly validates when only some checkpoints have been generated", func() {
				// Only model-step00001000 has samples; model-step00002000 does not.
				// Samples are placed at {sampleDir}/model/{studyName}/{checkpoint}/
				cpFS.safetensors["/checkpoints"] = []string{
					"model-step00001000.safetensors",
					"model-step00002000.safetensors",
				}
				viewerDiscovery = service.NewViewerDiscoveryService(viewerFS, sampleDir, logger)
				cpDiscovery = service.NewDiscoveryService(cpFS, []string{"/checkpoints"}, nil, sampleDir, logger)
				scanner = service.NewScanner(scanFS, sampleDir, logger)
				validator := service.NewValidationService(scanFS, sampleDir, logger)
				studyGetter := newFakeStudyGetter()
				studyGetter.studies[studyID] = model.Study{
					ID:      studyID,
					Name:    "Test Study",
					Prompts: []model.NamedPrompt{{Name: "p1", Text: "prompt"}},
					Steps:   []int{20},
					CFGs:    []float64{7},
					SamplerSchedulerPairs: []model.SamplerSchedulerPair{
						{Sampler: "euler", Scheduler: "normal"},
					},
					Seeds: []int64{42},
				}
				svc := api.NewTrainingRunsService(viewerDiscovery, cpDiscovery, scanner, validator, nil, studyGetter)

				// Only the first checkpoint's scoped directory exists with samples.
				// scopedStudyDir = "model/" + studyName → {sampleDir}/model/{studyName}/{checkpoint}/
				scanFS.files[sampleDir+"/model/Test Study/model-step00001000.safetensors"] = []string{
					"seed=42&_00001_.png",
				}
				// model-step00002000 has no directory entry → verified=0

				sid := studyID
				result, err := svc.Validate(context.Background(), &gentrainingruns.ValidatePayload{ID: checkpointRunID(svc, 0), StudyID: &sid})

				Expect(err).NotTo(HaveOccurred())
				Expect(result.Checkpoints).To(HaveLen(2))
				// Sorted by step: step1000 first, step2000 second
				Expect(result.Checkpoints[0].Verified).To(Equal(1)) // model-step00001000 has 1 file
				Expect(result.Checkpoints[0].Missing).To(Equal(0))
				Expect(result.Checkpoints[1].Verified).To(Equal(0)) // model-step00002000 has no files
				Expect(result.Checkpoints[1].Missing).To(Equal(1))
			})

			It("returns not_found when study_id does not match any study", func() {
				cpFS.safetensors["/checkpoints"] = []string{"model.safetensors"}
				viewerDiscovery = service.NewViewerDiscoveryService(viewerFS, sampleDir, logger)
				cpDiscovery = service.NewDiscoveryService(cpFS, []string{"/checkpoints"}, nil, sampleDir, logger)
				scanner = service.NewScanner(scanFS, sampleDir, logger)
				validator := service.NewValidationService(scanFS, sampleDir, logger)
				studyGetter := newFakeStudyGetter()
				// studyGetter has no studies
				svc := api.NewTrainingRunsService(viewerDiscovery, cpDiscovery, scanner, validator, nil, studyGetter)

				sid := "nonexistent-study"
				_, err := svc.Validate(context.Background(), &gentrainingruns.ValidatePayload{ID: checkpointRunID(svc, 0), StudyID: &sid})

				Expect(err).To(HaveOccurred())
			})

			It("returns not_found for out-of-range ID with checkpoint discovery", func() {
				cpFS.safetensors["/checkpoints"] = []string{"model.safetensors"}
				viewerDiscovery = service.NewViewerDiscoveryService(viewerFS, sampleDir, logger)
				cpDiscovery = service.NewDiscoveryService(cpFS, []string{"/checkpoints"}, nil, sampleDir, logger)
				scanner = service.NewScanner(scanFS, sampleDir, logger)
				validator := service.NewValidationService(scanFS, sampleDir, logger)
				studyGetter := newFakeStudyGetter()
				studyGetter.studies[studyID] = model.Study{ID: studyID, Name: "Test Study"}
				svc := api.NewTrainingRunsService(viewerDiscovery, cpDiscovery, scanner, validator, nil, studyGetter)

				sid := studyID
				_, err := svc.Validate(context.Background(), &gentrainingruns.ValidatePayload{ID: missingID, StudyID: &sid})

				Expect(err).To(HaveOccurred())
				Expect(err.Error()).To(ContainSubstring("not found"))
			})

			// B-078 UAT rework: training run names with slashes (e.g. "qwen/Qwen2-VL") must be
			// sanitized before being used as a filesystem path component. The validation endpoint
			// must look in "qwen_Qwen2-VL/{studyID}/" not "qwen/Qwen2-VL/{studyID}/".
			It("sanitizes forward slashes in training run name when constructing scoped study dir", func() {
				// Training run discovered via checkpoint source. Checkpoint files are at
				// qwen/Qwen2-VL-step*.safetensors so the run name is "qwen/Qwen2-VL".
				// Checkpoint filenames (basename only) are "Qwen2-VL-step*.safetensors".
				cpFS.safetensors["/checkpoints"] = []string{
					"qwen/Qwen2-VL-step00001000.safetensors",
					"qwen/Qwen2-VL-step00002000.safetensors",
				}
				viewerDiscovery = service.NewViewerDiscoveryService(viewerFS, sampleDir, logger)
				cpDiscovery = service.NewDiscoveryService(cpFS, []string{"/checkpoints"}, nil, sampleDir, logger)
				scanner = service.NewScanner(scanFS, sampleDir, logger)
				validator := service.NewValidationService(scanFS, sampleDir, logger)
				studyGetter := newFakeStudyGetter()
				studyGetter.studies[studyID] = model.Study{
					ID:      studyID,
					Name:    "Test Study",
					Prompts: []model.NamedPrompt{{Name: "p1", Text: "prompt"}},
					Steps:   []int{20},
					CFGs:    []float64{7},
					SamplerSchedulerPairs: []model.SamplerSchedulerPair{
						{Sampler: "euler", Scheduler: "normal"},
					},
					Seeds: []int64{42},
				}
				svc := api.NewTrainingRunsService(viewerDiscovery, cpDiscovery, scanner, validator, nil, studyGetter)

				// The job executor writes samples to the sanitized path:
				// {sampleDir}/qwen_Qwen2-VL/{studyName}/{checkpoint_basename}/
				// Checkpoint basenames: "Qwen2-VL-step00001000.safetensors" etc.
				// Validation must look in the same sanitized path.
				sanitizedStudyDir := sampleDir + "/qwen_Qwen2-VL/Test Study"
				scanFS.files[sanitizedStudyDir+"/Qwen2-VL-step00001000.safetensors"] = []string{
					"seed=42&_00001_.png",
				}
				scanFS.files[sanitizedStudyDir+"/Qwen2-VL-step00002000.safetensors"] = []string{
					"seed=42&_00001_.png",
				}

				sid := studyID
				result, err := svc.Validate(context.Background(), &gentrainingruns.ValidatePayload{ID: checkpointRunID(svc, 0), StudyID: &sid})

				Expect(err).NotTo(HaveOccurred())
				// Training run name is "qwen/Qwen2-VL" (slash kept in DB/API; sanitized only for FS)
				Expect(result.Checkpoints).To(HaveLen(2))
				// Both checkpoints should find their samples via the sanitized path
				Expect(result.Checkpoints[0].Verified).To(Equal(1))
				Expect(result.Checkpoints[0].Missing).To(Equal(0))
				Expect(result.Checkpoints[1].Verified).To(Equal(1))
				Expect(result.Checkpoints[1].Missing).To(Equal(0))
				Expect(result.TotalActual).To(Equal(2))
			})
		})
	})
})

// B-132: API-level tests for manifest-first validation routing.
// These tests verify the Validate endpoint prefers manifest-based validation
// (per-sample filename + param verification) over count-based validation.
var _ = Describe("TrainingRunsService manifest validation routing (B-132)", func() {
	var (
		viewerFS        *fakeViewerDiscoveryFS
		scanFS          *fakeScanFS
		cpFS            *fakeCheckpointDiscoveryFS
		viewerDiscovery *service.ViewerDiscoveryService
		cpDiscovery     *service.DiscoveryService
		scanner         *service.Scanner
		logger          *logrus.Logger
		sampleDir       string
	)

	BeforeEach(func() {
		sampleDir = "/samples"
		viewerFS = newFakeViewerDiscoveryFS()
		scanFS = newFakeScanFS()
		cpFS = newFakeCheckpointDiscoveryFS()
		logger = logrus.New()
		logger.SetOutput(io.Discard)
	})

	// B-132: When a manifest exists, the study-aware path uses manifest validation
	// which checks filenames and sidecar params instead of just counting PNG files.
	It("uses manifest validation when manifest exists (study_id path)", func() {
		studyID := "study-abc"
		studyName := "Test Study"

		// Checkpoint discovery
		cpFS.safetensors["/checkpoints"] = []string{
			"model-step00001000.safetensors",
		}
		viewerDiscovery = service.NewViewerDiscoveryService(viewerFS, sampleDir, logger)
		cpDiscovery = service.NewDiscoveryService(cpFS, []string{"/checkpoints"}, nil, sampleDir, logger)
		scanner = service.NewScanner(scanFS, sampleDir, logger)
		validator := service.NewValidationService(scanFS, sampleDir, logger)
		studyGetter := newFakeStudyGetter()
		studyGetter.studies[studyID] = model.Study{
			ID:      studyID,
			Name:    studyName,
			Prompts: []model.NamedPrompt{{Name: "p1", Text: "prompt"}},
			Steps:   []int{20},
			CFGs:    []float64{7},
			SamplerSchedulerPairs: []model.SamplerSchedulerPair{
				{Sampler: "euler", Scheduler: "normal"},
			},
			Seeds: []int64{42},
		}
		svc := api.NewTrainingRunsService(viewerDiscovery, cpDiscovery, scanner, validator, nil, studyGetter)

		// Build the manifest with the same params as the study
		manifest := fileformat.JobManifest{
			JobID:           "job-1",
			TrainingRunName: "model",
			StudyName:       studyName,
			Prompts:         []fileformat.ManifestNamedPrompt{{Name: "p1", Text: "prompt"}},
			Steps:           []int{20},
			CFGs:            []float64{7},
			SamplerSchedulerPairs: []fileformat.ManifestSamplerSchedulerPair{
				{Sampler: "euler", Scheduler: "normal"},
			},
			Seeds:               []int64{42},
			ImagesPerCheckpoint: 1,
			Checkpoints:         []string{"model-step00001000.safetensors"},
		}
		manifestData, err := fileformat.MarshalManifest(manifest)
		Expect(err).NotTo(HaveOccurred())

		// scopedStudyDir = "model/" + studyName
		scopedStudyDir := sampleDir + "/model/" + studyName
		scanFS.fileData[scopedStudyDir+"/manifest.json"] = manifestData

		// The expected filename from the manifest's param combination
		expectedFile := service.GenerateOutputFilename(model.SampleJobItem{
			PromptName: "p1", Steps: 20, CFG: 7,
			SamplerName: "euler", Scheduler: "normal", Seed: 42,
		})

		// Place the expected file plus a foreign file in the checkpoint dir
		cpDir := scopedStudyDir + "/model-step00001000.safetensors"
		scanFS.files[cpDir] = []string{expectedFile, "foreign.png"}

		sid := studyID
		result, err := svc.Validate(context.Background(), &gentrainingruns.ValidatePayload{ID: checkpointRunID(svc, 0), StudyID: &sid})

		Expect(err).NotTo(HaveOccurred())
		Expect(result.Checkpoints).To(HaveLen(1))
		// B-132: Manifest validation checks filenames — only expectedFile counts as verified.
		// The foreign file is flagged as extra, not counted as verified.
		Expect(result.Checkpoints[0].Verified).To(Equal(1))
		Expect(result.Checkpoints[0].Extra).To(Equal(1))
		Expect(result.Checkpoints[0].Missing).To(Equal(0))
	})

	// B-132: When a manifest exists, foreign (unexpected) samples cause validation to
	// report them as extra — this is the fix for the original bug where extra samples
	// were invisible to validation.
	It("detects extra samples that would be invisible with count-only validation", func() {
		studyID := "study-abc"
		studyName := "Test Study"

		cpFS.safetensors["/checkpoints"] = []string{
			"model-step00001000.safetensors",
		}
		viewerDiscovery = service.NewViewerDiscoveryService(viewerFS, sampleDir, logger)
		cpDiscovery = service.NewDiscoveryService(cpFS, []string{"/checkpoints"}, nil, sampleDir, logger)
		scanner = service.NewScanner(scanFS, sampleDir, logger)
		validator := service.NewValidationService(scanFS, sampleDir, logger)
		studyGetter := newFakeStudyGetter()
		studyGetter.studies[studyID] = model.Study{
			ID:      studyID,
			Name:    studyName,
			Prompts: []model.NamedPrompt{{Name: "p1", Text: "prompt"}},
			Steps:   []int{20},
			CFGs:    []float64{7},
			SamplerSchedulerPairs: []model.SamplerSchedulerPair{
				{Sampler: "euler", Scheduler: "normal"},
			},
			Seeds: []int64{42},
		}
		svc := api.NewTrainingRunsService(viewerDiscovery, cpDiscovery, scanner, validator, nil, studyGetter)

		manifest := fileformat.JobManifest{
			JobID:           "job-1",
			TrainingRunName: "model",
			StudyName:       studyName,
			Prompts:         []fileformat.ManifestNamedPrompt{{Name: "p1", Text: "prompt"}},
			Steps:           []int{20},
			CFGs:            []float64{7},
			SamplerSchedulerPairs: []fileformat.ManifestSamplerSchedulerPair{
				{Sampler: "euler", Scheduler: "normal"},
			},
			Seeds:               []int64{42},
			ImagesPerCheckpoint: 1,
			Checkpoints:         []string{"model-step00001000.safetensors"},
		}
		manifestData, err := fileformat.MarshalManifest(manifest)
		Expect(err).NotTo(HaveOccurred())

		scopedStudyDir := sampleDir + "/model/" + studyName
		scanFS.fileData[scopedStudyDir+"/manifest.json"] = manifestData

		// The expected file is MISSING. Only foreign files exist.
		cpDir := scopedStudyDir + "/model-step00001000.safetensors"
		scanFS.files[cpDir] = []string{"foreign1.png", "foreign2.png", "foreign3.png"}

		sid := studyID
		result, err := svc.Validate(context.Background(), &gentrainingruns.ValidatePayload{ID: checkpointRunID(svc, 0), StudyID: &sid})

		Expect(err).NotTo(HaveOccurred())
		Expect(result.Checkpoints).To(HaveLen(1))
		// B-132: The expected sample is missing, and foreign files are tracked as extra.
		// Count-only validation would have shown 3/1 (over-verified).
		// Manifest validation correctly shows 0/1 verified + 3 extra.
		Expect(result.Checkpoints[0].Verified).To(Equal(0))
		Expect(result.Checkpoints[0].Missing).To(Equal(1))
		Expect(result.Checkpoints[0].Extra).To(Equal(3))
	})

	// B-132: Viewer path also prefers manifest validation when study output dir exists.
	It("uses manifest validation for viewer path with study-scoped run", func() {
		// Viewer discovers a study-scoped run
		viewerFS.subdirs[sampleDir] = []string{"my-model"}
		viewerFS.subdirs[sampleDir+"/my-model"] = []string{"Test Study"}
		viewerFS.subdirs[sampleDir+"/my-model/Test Study"] = []string{
			"model-step00001000.safetensors",
		}
		viewerDiscovery = service.NewViewerDiscoveryService(viewerFS, sampleDir, logger)
		cpDiscovery = service.NewDiscoveryService(cpFS, []string{}, nil, sampleDir, logger)
		scanner = service.NewScanner(scanFS, sampleDir, logger)
		validator := service.NewValidationService(scanFS, sampleDir, logger)
		svc := api.NewTrainingRunsService(viewerDiscovery, cpDiscovery, scanner, validator, nil, nil)

		// Build manifest
		manifest := fileformat.JobManifest{
			JobID:           "job-1",
			TrainingRunName: "model",
			StudyName:       "Test Study",
			Prompts:         []fileformat.ManifestNamedPrompt{{Name: "p1", Text: "prompt"}},
			Steps:           []int{20},
			CFGs:            []float64{7},
			SamplerSchedulerPairs: []fileformat.ManifestSamplerSchedulerPair{
				{Sampler: "euler", Scheduler: "normal"},
			},
			Seeds:               []int64{42},
			ImagesPerCheckpoint: 1,
			Checkpoints:         []string{"model-step00001000.safetensors"},
		}
		manifestData, err := fileformat.MarshalManifest(manifest)
		Expect(err).NotTo(HaveOccurred())

		// The viewer-discovered run name is "my-model/Test Study/model"
		// StudyNameForRun returns "my-model/Test Study"
		studyOutputDir := sampleDir + "/my-model/Test Study"
		scanFS.fileData[studyOutputDir+"/manifest.json"] = manifestData

		expectedFile := service.GenerateOutputFilename(model.SampleJobItem{
			PromptName: "p1", Steps: 20, CFG: 7,
			SamplerName: "euler", Scheduler: "normal", Seed: 42,
		})

		cpDir := studyOutputDir + "/model-step00001000.safetensors"
		scanFS.files[cpDir] = []string{expectedFile, "extra.png"}

		result, err := svc.Validate(context.Background(), &gentrainingruns.ValidatePayload{ID: viewerRunID(svc, 0)})

		Expect(err).NotTo(HaveOccurred())
		Expect(result.Checkpoints).To(HaveLen(1))
		// Manifest validation detects the foreign file as extra
		Expect(result.Checkpoints[0].Verified).To(Equal(1))
		Expect(result.Checkpoints[0].Extra).To(Equal(1))
	})

	// B-132: Manifest validation detects param mismatches through the API layer.
	It("reports invalid params when sidecar does not match manifest (study_id path)", func() {
		studyID := "study-abc"
		studyName := "Test Study"

		cpFS.safetensors["/checkpoints"] = []string{
			"model-step00001000.safetensors",
		}
		viewerDiscovery = service.NewViewerDiscoveryService(viewerFS, sampleDir, logger)
		cpDiscovery = service.NewDiscoveryService(cpFS, []string{"/checkpoints"}, nil, sampleDir, logger)
		scanner = service.NewScanner(scanFS, sampleDir, logger)
		validator := service.NewValidationService(scanFS, sampleDir, logger)
		studyGetter := newFakeStudyGetter()
		studyGetter.studies[studyID] = model.Study{
			ID:      studyID,
			Name:    studyName,
			Prompts: []model.NamedPrompt{{Name: "p1", Text: "prompt"}},
			Steps:   []int{20},
			CFGs:    []float64{7},
			SamplerSchedulerPairs: []model.SamplerSchedulerPair{
				{Sampler: "euler", Scheduler: "normal"},
			},
			Seeds: []int64{42},
		}
		svc := api.NewTrainingRunsService(viewerDiscovery, cpDiscovery, scanner, validator, nil, studyGetter)

		manifest := fileformat.JobManifest{
			JobID:           "job-1",
			TrainingRunName: "model",
			StudyName:       studyName,
			Prompts:         []fileformat.ManifestNamedPrompt{{Name: "p1", Text: "prompt"}},
			Steps:           []int{20},
			CFGs:            []float64{7},
			SamplerSchedulerPairs: []fileformat.ManifestSamplerSchedulerPair{
				{Sampler: "euler", Scheduler: "normal"},
			},
			Seeds:               []int64{42},
			ImagesPerCheckpoint: 1,
			Checkpoints:         []string{"model-step00001000.safetensors"},
		}
		manifestData, err := fileformat.MarshalManifest(manifest)
		Expect(err).NotTo(HaveOccurred())

		scopedStudyDir := sampleDir + "/model/" + studyName
		scanFS.fileData[scopedStudyDir+"/manifest.json"] = manifestData

		expectedFile := service.GenerateOutputFilename(model.SampleJobItem{
			PromptName: "p1", Steps: 20, CFG: 7,
			SamplerName: "euler", Scheduler: "normal", Seed: 42,
		})

		cpDir := scopedStudyDir + "/model-step00001000.safetensors"
		scanFS.files[cpDir] = []string{expectedFile}

		// B-132: Sidecar has wrong seed (999 vs manifest's 42) — param mismatch
		import_json_pkg := `{"checkpoint":"model-step00001000.safetensors","prompt_name":"p1","seed":999,"cfg":7,"steps":20,"sampler_name":"euler","scheduler":"normal","width":1024,"height":768}`
		sidecarBase := expectedFile[:len(expectedFile)-4] // strip .png
		scanFS.fileData[cpDir+"/"+sidecarBase+".json"] = []byte(import_json_pkg)

		sid := studyID
		result, err := svc.Validate(context.Background(), &gentrainingruns.ValidatePayload{ID: checkpointRunID(svc, 0), StudyID: &sid})

		Expect(err).NotTo(HaveOccurred())
		Expect(result.Checkpoints).To(HaveLen(1))
		// B-132: Param mismatch — not verified, counted as invalid.
		Expect(result.Checkpoints[0].Verified).To(Equal(0))
		Expect(result.Checkpoints[0].InvalidParams).To(Equal(1))
		Expect(result.TotalInvalidParams).To(Equal(1))
	})

	// B-132: Falls back to study-based validation when no manifest exists.
	It("falls back to study count validation when manifest is absent (study_id path)", func() {
		studyID := "study-abc"
		studyName := "Test Study"

		cpFS.safetensors["/checkpoints"] = []string{
			"model-step00001000.safetensors",
		}
		viewerDiscovery = service.NewViewerDiscoveryService(viewerFS, sampleDir, logger)
		cpDiscovery = service.NewDiscoveryService(cpFS, []string{"/checkpoints"}, nil, sampleDir, logger)
		scanner = service.NewScanner(scanFS, sampleDir, logger)
		validator := service.NewValidationService(scanFS, sampleDir, logger)
		studyGetter := newFakeStudyGetter()
		studyGetter.studies[studyID] = model.Study{
			ID:      studyID,
			Name:    studyName,
			Prompts: []model.NamedPrompt{{Name: "p1", Text: "prompt"}},
			Steps:   []int{20},
			CFGs:    []float64{7},
			SamplerSchedulerPairs: []model.SamplerSchedulerPair{
				{Sampler: "euler", Scheduler: "normal"},
			},
			Seeds: []int64{42},
		}
		svc := api.NewTrainingRunsService(viewerDiscovery, cpDiscovery, scanner, validator, nil, studyGetter)

		// No manifest.json in scanFS.fileData — will trigger manifest-not-found fallback

		// Study expects 1 image per checkpoint. Place 1 file.
		scopedStudyDir := sampleDir + "/model/" + studyName
		scanFS.files[scopedStudyDir+"/model-step00001000.safetensors"] = []string{"any-file.png"}

		sid := studyID
		result, err := svc.Validate(context.Background(), &gentrainingruns.ValidatePayload{ID: checkpointRunID(svc, 0), StudyID: &sid})

		Expect(err).NotTo(HaveOccurred())
		Expect(result.Checkpoints).To(HaveLen(1))
		// Falls back to study-based count validation: expected=1, verified=1
		Expect(result.ExpectedPerCheckpoint).To(Equal(1))
		Expect(result.Checkpoints[0].Verified).To(Equal(1))
		Expect(result.Checkpoints[0].Missing).To(Equal(0))
	})
})

// B-160: The Generate Samples dialog (study_id path) previously reconstructed the
// sample output dir as {sanitize(run)}/{study}, which omits the {base_model} level
// that LoRA runs write into ({sanitize(run)}/{study}/{base_model}). The manifest
// therefore was not found at the guessed path, validation fell back to study-config
// counting against a non-existent directory, and the dialog reported 0/N while the
// slideout (which uses the run's real StudyOutputDir) reported N/N.
//
// These tests set up fixtures where the canonical output dir DIFFERS from the naive
// reconstruction (LoRA) and assert the study_id path now resolves the real dir and
// reports the identical totals as the study_output_dir (slideout) path.
var _ = Describe("TrainingRunsService study-scoped output-dir resolution (B-160)", func() {
	var (
		viewerFS        *fakeViewerDiscoveryFS
		scanFS          *fakeScanFS
		cpFS            *fakeCheckpointDiscoveryFS
		viewerDiscovery *service.ViewerDiscoveryService
		cpDiscovery     *service.DiscoveryService
		scanner         *service.Scanner
		logger          *logrus.Logger
		sampleDir       string
	)

	BeforeEach(func() {
		sampleDir = "/samples"
		viewerFS = newFakeViewerDiscoveryFS()
		scanFS = newFakeScanFS()
		cpFS = newFakeCheckpointDiscoveryFS()
		logger = logrus.New()
		logger.SetOutput(io.Discard)
	})

	// expectedFileFor returns the single expected sample filename for the shared
	// one-combination study/manifest used by these tests.
	expectedFileFor := func() string {
		return service.GenerateOutputFilename(model.SampleJobItem{
			PromptName: "p1", Steps: 20, CFG: 7,
			SamplerName: "euler", Scheduler: "normal", Seed: 42,
		})
	}

	oneComboStudy := func(id, name string) model.Study {
		return model.Study{
			ID:      id,
			Name:    name,
			Prompts: []model.NamedPrompt{{Name: "p1", Text: "prompt"}},
			Steps:   []int{20},
			CFGs:    []float64{7},
			SamplerSchedulerPairs: []model.SamplerSchedulerPair{
				{Sampler: "euler", Scheduler: "normal"},
			},
			Seeds: []int64{42},
		}
	}

	oneComboManifest := func(runName, studyName, checkpoint string) []byte {
		manifest := fileformat.JobManifest{
			JobID:           "job-1",
			TrainingRunName: runName,
			StudyName:       studyName,
			Prompts:         []fileformat.ManifestNamedPrompt{{Name: "p1", Text: "prompt"}},
			Steps:           []int{20},
			CFGs:            []float64{7},
			SamplerSchedulerPairs: []fileformat.ManifestSamplerSchedulerPair{
				{Sampler: "euler", Scheduler: "normal"},
			},
			Seeds:               []int64{42},
			ImagesPerCheckpoint: 1,
			Checkpoints:         []string{checkpoint},
		}
		data, err := fileformat.MarshalManifest(manifest)
		Expect(err).NotTo(HaveOccurred())
		return data
	}

	// LoRA run: canonical dir = {run}/{study}/{base_model}; naive = {run}/{study}.
	// This is the primary reproduction of the 0/N bug.
	It("resolves the LoRA base-model output dir for the study_id path and matches the slideout", func() {
		studyID := "study-lora"
		studyName := "Test Study"
		runName := "mylora"
		baseModel := "sdxl-base"
		checkpoint := "mylora-step00001000.safetensors"

		// Checkpoint discovery (dialog source): the LoRA run.
		cpFS.safetensors["/loras"] = []string{checkpoint}

		// Viewer discovery (slideout source): the LoRA sample layout on disk.
		// {run}/{study}/{base_model}/{checkpoint}/ → StudyOutputDir = "mylora/Test Study/sdxl-base"
		viewerFS.subdirs[sampleDir] = []string{runName}
		viewerFS.subdirs[sampleDir+"/"+runName] = []string{studyName}
		viewerFS.subdirs[sampleDir+"/"+runName+"/"+studyName] = []string{baseModel}
		viewerFS.subdirs[sampleDir+"/"+runName+"/"+studyName+"/"+baseModel] = []string{checkpoint}

		viewerDiscovery = service.NewViewerDiscoveryService(viewerFS, sampleDir, logger)
		cpDiscovery = service.NewDiscoveryService(cpFS, nil, []string{"/loras"}, sampleDir, logger)
		scanner = service.NewScanner(scanFS, sampleDir, logger)
		validator := service.NewValidationService(scanFS, sampleDir, logger)
		studyGetter := newFakeStudyGetter()
		studyGetter.studies[studyID] = oneComboStudy(studyID, studyName)
		svc := api.NewTrainingRunsService(viewerDiscovery, cpDiscovery, scanner, validator, nil, studyGetter)

		// Manifest + sample live ONLY at the canonical LoRA path (with base model).
		// The naive path {sampleDir}/mylora/Test Study has no manifest and no files,
		// which is what the old code guessed → 0/N.
		canonicalDir := sampleDir + "/" + runName + "/" + studyName + "/" + baseModel
		scanFS.fileData[canonicalDir+"/manifest.json"] = oneComboManifest(runName, studyName, checkpoint)
		scanFS.files[canonicalDir+"/"+checkpoint] = []string{expectedFileFor()}

		// Dialog path: study_id only.
		sid := studyID
		dialogResult, err := svc.Validate(context.Background(), &gentrainingruns.ValidatePayload{
			ID: checkpointRunID(svc, 0), StudyID: &sid,
		})
		Expect(err).NotTo(HaveOccurred())
		Expect(dialogResult.Checkpoints).To(HaveLen(1))
		// Pre-fix this was 0 (manifest not found at guessed dir). Now all present.
		Expect(dialogResult.TotalActual).To(Equal(dialogResult.TotalExpected))
		Expect(dialogResult.TotalExpected).To(Equal(1))
		Expect(dialogResult.Checkpoints[0].Verified).To(Equal(1))
		Expect(dialogResult.Checkpoints[0].Missing).To(Equal(0))

		// Slideout path: study_output_dir (the run's real StudyOutputDir).
		viewerRuns, err := svc.List(context.Background(), &gentrainingruns.ListPayload{Source: "samples"})
		Expect(err).NotTo(HaveOccurred())
		Expect(viewerRuns).To(HaveLen(1))
		Expect(viewerRuns[0].StudyOutputDir).NotTo(BeNil())
		Expect(*viewerRuns[0].StudyOutputDir).To(Equal(runName + "/" + studyName + "/" + baseModel))
		sod := *viewerRuns[0].StudyOutputDir
		slideoutResult, err := svc.Validate(context.Background(), &gentrainingruns.ValidatePayload{
			ID: viewerRuns[0].ID, StudyOutputDir: &sod,
		})
		Expect(err).NotTo(HaveOccurred())

		// The dialog and slideout must report identical totals for the same run+study.
		Expect(dialogResult.TotalActual).To(Equal(slideoutResult.TotalActual))
		Expect(dialogResult.TotalExpected).To(Equal(slideoutResult.TotalExpected))
		Expect(dialogResult.TotalVerified).To(Equal(slideoutResult.TotalVerified))
	})

	// Checkpoint run: canonical dir = {run}/{study} (== naive). This asserts the
	// shared resolver + core keep working for the checkpoint kind and that the
	// study_id and study_output_dir paths agree.
	It("resolves the checkpoint output dir for the study_id path and matches the slideout", func() {
		studyID := "study-cp"
		studyName := "Test Study"
		runName := "model"
		checkpoint := "model-step00001000.safetensors"

		cpFS.safetensors["/checkpoints"] = []string{checkpoint}

		// Viewer discovery: {run}/{study}/{checkpoint}/ → StudyOutputDir = "model/Test Study"
		viewerFS.subdirs[sampleDir] = []string{runName}
		viewerFS.subdirs[sampleDir+"/"+runName] = []string{studyName}
		viewerFS.subdirs[sampleDir+"/"+runName+"/"+studyName] = []string{checkpoint}

		viewerDiscovery = service.NewViewerDiscoveryService(viewerFS, sampleDir, logger)
		cpDiscovery = service.NewDiscoveryService(cpFS, []string{"/checkpoints"}, nil, sampleDir, logger)
		scanner = service.NewScanner(scanFS, sampleDir, logger)
		validator := service.NewValidationService(scanFS, sampleDir, logger)
		studyGetter := newFakeStudyGetter()
		studyGetter.studies[studyID] = oneComboStudy(studyID, studyName)
		svc := api.NewTrainingRunsService(viewerDiscovery, cpDiscovery, scanner, validator, nil, studyGetter)

		canonicalDir := sampleDir + "/" + runName + "/" + studyName
		scanFS.fileData[canonicalDir+"/manifest.json"] = oneComboManifest(runName, studyName, checkpoint)
		scanFS.files[canonicalDir+"/"+checkpoint] = []string{expectedFileFor()}

		sid := studyID
		dialogResult, err := svc.Validate(context.Background(), &gentrainingruns.ValidatePayload{
			ID: checkpointRunID(svc, 0), StudyID: &sid,
		})
		Expect(err).NotTo(HaveOccurred())
		Expect(dialogResult.TotalActual).To(Equal(dialogResult.TotalExpected))
		Expect(dialogResult.TotalExpected).To(Equal(1))
		Expect(dialogResult.Checkpoints[0].Verified).To(Equal(1))

		viewerRuns, err := svc.List(context.Background(), &gentrainingruns.ListPayload{Source: "samples"})
		Expect(err).NotTo(HaveOccurred())
		Expect(viewerRuns).To(HaveLen(1))
		Expect(*viewerRuns[0].StudyOutputDir).To(Equal(runName + "/" + studyName))
		sod := *viewerRuns[0].StudyOutputDir
		slideoutResult, err := svc.Validate(context.Background(), &gentrainingruns.ValidatePayload{
			ID: viewerRuns[0].ID, StudyOutputDir: &sod,
		})
		Expect(err).NotTo(HaveOccurred())

		Expect(dialogResult.TotalActual).To(Equal(slideoutResult.TotalActual))
		Expect(dialogResult.TotalExpected).To(Equal(slideoutResult.TotalExpected))
		Expect(dialogResult.TotalVerified).To(Equal(slideoutResult.TotalVerified))
	})
})
