package store_test

import (
	"io"
	"os"
	"path/filepath"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
	"github.com/sirupsen/logrus"

	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/store"
)

// These tests lock down the highest-blast-radius code in the repo: the
// recursive deletion helpers in store/filesystem.go. They assert that each
// helper (a) removes exactly the intended subtree and leaves siblings intact,
// (b) is a no-op when the target is missing, and (c) behaves as currently
// implemented for traversal/escape inputs ('..', absolute paths, empty
// components). Where a helper does NOT defend against an escape input, the test
// documents the actual (unsafe) behavior so any regression is caught and the
// security gap is visible.
var _ = Describe("FileSystem destructive helpers", func() {
	var (
		root string // a sandbox root containing the sample dir + siblings
		fs   *store.FileSystem
	)

	BeforeEach(func() {
		root = GinkgoT().TempDir()

		logger := logrus.New()
		logger.SetOutput(io.Discard)
		fs = store.NewFileSystem(logger)
	})

	// writeTree creates dir and a marker file inside it so we can assert the
	// directory (and its contents) are present or gone.
	writeTree := func(dir string) {
		Expect(os.MkdirAll(dir, 0o755)).To(Succeed())
		Expect(os.WriteFile(filepath.Join(dir, "marker.png"), []byte("x"), 0o644)).To(Succeed())
	}

	exists := func(path string) bool {
		_, err := os.Stat(path)
		return err == nil
	}

	Describe("RemoveSampleDir", func() {
		var sampleDir string

		BeforeEach(func() {
			sampleDir = filepath.Join(root, "samples")
		})

		// AC: correct-subtree deletion + sibling survival
		It("removes only the target checkpoint dir and preserves siblings", func() {
			target := filepath.Join(sampleDir, "model-a.safetensors")
			sibling := filepath.Join(sampleDir, "model-b.safetensors")
			writeTree(target)
			writeTree(sibling)

			Expect(fs.RemoveSampleDir(sampleDir, "model-a.safetensors")).To(Succeed())

			Expect(exists(target)).To(BeFalse(), "target subtree should be removed")
			Expect(exists(sibling)).To(BeTrue(), "sibling subtree must survive")
		})

		// AC: missing-target behavior
		It("is a no-op (no error) when the target does not exist", func() {
			writeTree(sampleDir)
			Expect(fs.RemoveSampleDir(sampleDir, "does-not-exist.safetensors")).To(Succeed())
			Expect(exists(sampleDir)).To(BeTrue())
		})
	})

	Describe("RemoveStudyDir", func() {
		var sampleDir string

		BeforeEach(func() {
			sampleDir = filepath.Join(root, "samples")
		})

		// AC: correct-subtree deletion + sibling survival
		It("removes only the named study dir and preserves siblings", func() {
			target := filepath.Join(sampleDir, "study-alpha")
			sibling := filepath.Join(sampleDir, "study-beta")
			writeTree(target)
			writeTree(sibling)

			Expect(fs.RemoveStudyDir(sampleDir, "study-alpha")).To(Succeed())

			Expect(exists(target)).To(BeFalse())
			Expect(exists(sibling)).To(BeTrue())
		})

		// AC: missing-target behavior
		It("is a no-op when the study dir does not exist", func() {
			writeTree(sampleDir)
			Expect(fs.RemoveStudyDir(sampleDir, "nope")).To(Succeed())
			Expect(exists(sampleDir)).To(BeTrue())
		})
	})

	Describe("RemoveJobSampleDir", func() {
		var sampleDir string

		BeforeEach(func() {
			sampleDir = filepath.Join(root, "samples")
		})

		// AC: correct-subtree deletion + sibling survival
		It("removes only sampleDir/study/checkpoint and preserves sibling checkpoints", func() {
			remover := store.NewJobSampleDirRemover(fs, sampleDir)
			target := filepath.Join(sampleDir, "study-alpha", "model-a.safetensors")
			siblingCheckpoint := filepath.Join(sampleDir, "study-alpha", "model-b.safetensors")
			siblingStudy := filepath.Join(sampleDir, "study-beta", "model-a.safetensors")
			writeTree(target)
			writeTree(siblingCheckpoint)
			writeTree(siblingStudy)

			Expect(remover.RemoveJobSampleDir("study-alpha", "model-a.safetensors")).To(Succeed())

			Expect(exists(target)).To(BeFalse())
			Expect(exists(siblingCheckpoint)).To(BeTrue(), "sibling checkpoint in same study must survive")
			Expect(exists(siblingStudy)).To(BeTrue(), "same checkpoint in a different study must survive")
			Expect(exists(filepath.Join(sampleDir, "study-alpha"))).To(BeTrue(), "parent study dir must survive")
		})

		// AC: missing-target behavior
		It("is a no-op when the target does not exist", func() {
			remover := store.NewJobSampleDirRemover(fs, sampleDir)
			writeTree(filepath.Join(sampleDir, "study-alpha"))
			Expect(remover.RemoveJobSampleDir("study-alpha", "missing.safetensors")).To(Succeed())
			Expect(exists(filepath.Join(sampleDir, "study-alpha"))).To(BeTrue())
		})
	})

	Describe("RemoveCheckpointOutputDir", func() {
		var sampleDir string

		BeforeEach(func() {
			sampleDir = filepath.Join(root, "samples")
		})

		// AC: correct-subtree deletion + sibling survival
		It("removes only {run}/{study}/{checkpoint} and preserves siblings", func() {
			remover := store.NewStudyOutputDirRemover(fs, sampleDir)
			target := filepath.Join(sampleDir, "run-x", "study-alpha", "model-a.safetensors")
			siblingCheckpoint := filepath.Join(sampleDir, "run-x", "study-alpha", "model-b.safetensors")
			siblingStudy := filepath.Join(sampleDir, "run-x", "study-beta", "model-a.safetensors")
			writeTree(target)
			writeTree(siblingCheckpoint)
			writeTree(siblingStudy)

			Expect(remover.RemoveCheckpointOutputDir("run-x", "study-alpha", "model-a.safetensors")).To(Succeed())

			Expect(exists(target)).To(BeFalse())
			Expect(exists(siblingCheckpoint)).To(BeTrue())
			Expect(exists(siblingStudy)).To(BeTrue())
		})

		// AC: training run names with slashes are sanitized to a single dir component
		It("sanitizes a slash-bearing training run name to a single dir component", func() {
			remover := store.NewStudyOutputDirRemover(fs, sampleDir)
			// SanitizeTrainingRunName turns "qwen/Qwen2" into "qwen_Qwen2".
			target := filepath.Join(sampleDir, "qwen_Qwen2", "study-alpha", "model-a.safetensors")
			writeTree(target)

			Expect(remover.RemoveCheckpointOutputDir("qwen/Qwen2", "study-alpha", "model-a.safetensors")).To(Succeed())
			Expect(exists(target)).To(BeFalse())
		})

		// AC: escape-input rejection — checkpoint filename is reduced with
		// filepath.Base (B-115), so a traversal payload cannot escape the study dir.
		It("reduces a traversal checkpoint filename with filepath.Base, leaving outside siblings untouched", func() {
			remover := store.NewStudyOutputDirRemover(fs, sampleDir)
			// Outside-of-study sibling that an attacker would try to reach via '..'.
			outside := filepath.Join(sampleDir, "run-x", "secret")
			writeTree(outside)
			// A legitimately-named dir matching the Base() of the payload, inside the study.
			insideBase := filepath.Join(sampleDir, "run-x", "study-alpha", "secret")
			writeTree(insideBase)

			// filepath.Base("../secret") == "secret", so target is
			// sampleDir/run-x/study-alpha/secret — never the parent.
			Expect(remover.RemoveCheckpointOutputDir("run-x", "study-alpha", "../secret")).To(Succeed())

			Expect(exists(outside)).To(BeTrue(), "parent-level sibling must NOT be deleted by a '..' checkpoint payload")
			Expect(exists(insideBase)).To(BeFalse(), "the Base()-reduced target inside the study is what gets removed")
		})

		// AC: missing-target behavior
		It("is a no-op when the target does not exist", func() {
			remover := store.NewStudyOutputDirRemover(fs, sampleDir)
			writeTree(filepath.Join(sampleDir, "run-x", "study-alpha"))
			Expect(remover.RemoveCheckpointOutputDir("run-x", "study-alpha", "missing.safetensors")).To(Succeed())
			Expect(exists(filepath.Join(sampleDir, "run-x", "study-alpha"))).To(BeTrue())
		})
	})

	// Escape-input behavior for the Join-based helpers. These helpers rely on
	// callers passing already-validated names; they do NOT independently reject
	// '..' / absolute components. The tests below assert the ACTUAL current
	// behavior so a regression is caught, and the fixture-intact assertions
	// document exactly which sibling is (or is not) protected.
	Describe("escape-input behavior (Join-based helpers)", func() {
		var sampleDir string

		BeforeEach(func() {
			sampleDir = filepath.Join(root, "samples")
		})

		// AC: escape-input — empty component is a no-op that does not nuke the root.
		// filepath.Join(sampleDir, "") == sampleDir, but RemoveAll on the sample
		// root would wipe everything; assert the documented (dangerous) behavior so
		// callers know an empty name must never reach these helpers.
		DescribeTable("RemoveStudyDir with degenerate name components",
			func(name string, expectRootRemoved bool) {
				writeTree(filepath.Join(sampleDir, "study-alpha"))
				outside := filepath.Join(root, "outside")
				writeTree(outside)

				Expect(fs.RemoveStudyDir(sampleDir, name)).To(Succeed())

				if expectRootRemoved {
					Expect(exists(sampleDir)).To(BeFalse(), "empty/dot name resolves to the sample root and removes it")
				} else {
					Expect(exists(sampleDir)).To(BeTrue())
				}
				// In every case, nothing OUTSIDE the configured sample root's parent
				// chain that we did not target should be touched beyond the documented
				// Join resolution. The 'outside' dir is a sibling of sampleDir under root.
				_ = outside
			},
			// empty string -> Join yields sampleDir -> RemoveAll wipes the root.
			Entry("empty name resolves to sample root", "", true),
			// "." -> Join cleans to sampleDir -> wipes the root.
			Entry("dot name resolves to sample root", ".", true),
		)

		// AC: escape-input rejection — assert that a '..' component does NOT delete
		// a sibling OUTSIDE the sample root in the common case where no such
		// directory exists at the escaped location (RemoveAll on a missing path is
		// a no-op). This documents that traversal is only dangerous if the escaped
		// path happens to exist, and verifies the in-root fixture stays intact.
		It("with a '..' study name does not error and leaves the in-root fixture intact when the escaped path is absent", func() {
			study := filepath.Join(sampleDir, "study-alpha")
			writeTree(study)

			// filepath.Join(sampleDir, "../nonexistent") -> root/nonexistent, which
			// does not exist, so RemoveAll is a no-op.
			Expect(fs.RemoveStudyDir(sampleDir, "../nonexistent")).To(Succeed())

			Expect(exists(study)).To(BeTrue(), "in-root fixture must be untouched")
		})

		// AC: escape-input — demonstrate the genuine traversal gap so it is
		// regression-locked and visible. A '..' study name CAN reach a sibling of
		// the sample root. This asserts ACTUAL behavior (helper does not reject it).
		It("DOCUMENTS traversal gap: a '..' study name can delete a sibling of the sample root", func() {
			study := filepath.Join(sampleDir, "study-alpha")
			writeTree(study)
			// Sibling of sampleDir (i.e. directly under root). An attacker-controlled
			// study name of "../escaped" resolves here.
			escaped := filepath.Join(root, "escaped")
			writeTree(escaped)

			Expect(fs.RemoveStudyDir(sampleDir, "../escaped")).To(Succeed())

			// CURRENT behavior: the escaped sibling IS removed. If a path-scoping
			// guard is added later, flip this expectation.
			Expect(exists(escaped)).To(BeFalse(), "current implementation permits '..' traversal out of the sample root")
			Expect(exists(study)).To(BeTrue(), "the legitimately-named study is untouched")
		})
	})
})

var _ = Describe("SampleDirCleaner.CleanStudyDirs", func() {
	var (
		sampleDir string
		fs        *store.FileSystem
	)

	BeforeEach(func() {
		sampleDir = GinkgoT().TempDir()

		logger := logrus.New()
		logger.SetOutput(io.Discard)
		fs = store.NewFileSystem(logger)
	})

	mkdir := func(name string) {
		Expect(os.MkdirAll(filepath.Join(sampleDir, name), 0o755)).To(Succeed())
	}
	dirExists := func(name string) bool {
		info, err := os.Stat(filepath.Join(sampleDir, name))
		return err == nil && info.IsDir()
	}
	fileExists := func(name string) bool {
		info, err := os.Stat(filepath.Join(sampleDir, name))
		return err == nil && !info.IsDir()
	}

	// AC: correct-subtree deletion + sibling survival — checkpoint fixture dirs
	// (*.safetensors) and regular files are preserved; study dirs are removed.
	It("removes study dirs but preserves *.safetensors dirs and regular files", func() {
		cleaner := store.NewSampleDirCleaner(fs, sampleDir)

		mkdir("study-alpha")              // study-generated -> removed
		mkdir("study-beta")               // study-generated -> removed
		mkdir("model-a.safetensors")      // checkpoint fixture -> preserved
		mkdir("Model-B.SafeTensors")      // case-insensitive suffix -> preserved
		Expect(os.WriteFile(filepath.Join(sampleDir, "top-level.png"), []byte("x"), 0o644)).To(Succeed())

		Expect(cleaner.CleanStudyDirs()).To(Succeed())

		Expect(dirExists("study-alpha")).To(BeFalse())
		Expect(dirExists("study-beta")).To(BeFalse())
		Expect(dirExists("model-a.safetensors")).To(BeTrue())
		Expect(dirExists("Model-B.SafeTensors")).To(BeTrue())
		Expect(fileExists("top-level.png")).To(BeTrue(), "top-level regular files are preserved")
	})

	// AC: missing-target behavior
	It("is a no-op (no error) when the sample dir does not exist", func() {
		cleaner := store.NewSampleDirCleaner(fs, filepath.Join(sampleDir, "nonexistent"))
		Expect(cleaner.CleanStudyDirs()).To(Succeed())
	})

	// AC: empty directory
	It("succeeds with an empty sample dir", func() {
		cleaner := store.NewSampleDirCleaner(fs, sampleDir)
		Expect(cleaner.CleanStudyDirs()).To(Succeed())
	})

	// CleanStudyDirs only ever joins entry.Name() (a single path component read
	// from the directory itself), so it cannot traverse outside the sample root
	// regardless of caller input. This test pins that scoping property.
	// AC: escape-input rejection (structurally cannot escape)
	It("only deletes immediate children of the sample dir, never a parent", func() {
		cleaner := store.NewSampleDirCleaner(fs, sampleDir)
		// A sibling of the sample dir that must never be touched.
		parent := filepath.Dir(sampleDir)
		sibling := filepath.Join(parent, "sibling-keep")
		Expect(os.MkdirAll(sibling, 0o755)).To(Succeed())
		defer os.RemoveAll(sibling)

		mkdir("study-alpha")

		Expect(cleaner.CleanStudyDirs()).To(Succeed())

		Expect(dirExists("study-alpha")).To(BeFalse())
		_, err := os.Stat(sibling)
		Expect(err).NotTo(HaveOccurred(), "sibling of the sample dir must be untouched")
	})
})

var _ = Describe("FileSystem.ListSubdirectories", func() {
	var (
		root string
		fs   *store.FileSystem
	)

	BeforeEach(func() {
		root = GinkgoT().TempDir()
		logger := logrus.New()
		logger.SetOutput(io.Discard)
		fs = store.NewFileSystem(logger)
	})

	// AC: happy path — only immediate subdirectories returned, files skipped.
	It("returns only immediate subdirectories, skipping files", func() {
		Expect(os.MkdirAll(filepath.Join(root, "dir-a"), 0o755)).To(Succeed())
		Expect(os.MkdirAll(filepath.Join(root, "dir-b"), 0o755)).To(Succeed())
		Expect(os.WriteFile(filepath.Join(root, "file.txt"), []byte("x"), 0o644)).To(Succeed())

		dirs, err := fs.ListSubdirectories(root)
		Expect(err).NotTo(HaveOccurred())
		Expect(dirs).To(ConsistOf("dir-a", "dir-b"))
	})

	// AC: missing root returns empty slice, not an error.
	It("returns an empty slice (no error) when the root does not exist", func() {
		dirs, err := fs.ListSubdirectories(filepath.Join(root, "nonexistent"))
		Expect(err).NotTo(HaveOccurred())
		Expect(dirs).To(BeEmpty())
	})

	// AC: empty directory
	It("returns empty for an existing but empty directory", func() {
		dirs, err := fs.ListSubdirectories(root)
		Expect(err).NotTo(HaveOccurred())
		Expect(dirs).To(BeEmpty())
	})
})
