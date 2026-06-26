package store_test

import (
	"errors"
	"io"
	"os"
	"path/filepath"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
	"github.com/sirupsen/logrus"

	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/store"
	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/testutil"
)

var _ = Describe("FileSystem", func() {
	var (
		tmpDir string
		fs     *store.FileSystem
	)

	BeforeEach(func() {
		var err error
		tmpDir, err = os.MkdirTemp("", "filesystem-test-*")
		Expect(err).NotTo(HaveOccurred())

		logger := logrus.New()
		logger.SetOutput(io.Discard)
		fs = store.NewFileSystem(logger)
	})

	AfterEach(func() {
		os.RemoveAll(tmpDir)
	})

	Describe("ListPNGFiles", func() {
		It("returns only .png files, ignoring .json sidecar files", func() {
			// Write a mix of PNG and JSON files
			Expect(os.WriteFile(filepath.Join(tmpDir, "image1.png"), []byte("png"), 0644)).To(Succeed())
			Expect(os.WriteFile(filepath.Join(tmpDir, "image1.json"), []byte(`{}`), 0644)).To(Succeed())
			Expect(os.WriteFile(filepath.Join(tmpDir, "image2.png"), []byte("png"), 0644)).To(Succeed())
			Expect(os.WriteFile(filepath.Join(tmpDir, "image2.json"), []byte(`{}`), 0644)).To(Succeed())
			Expect(os.WriteFile(filepath.Join(tmpDir, "notes.txt"), []byte("text"), 0644)).To(Succeed())

			files, err := fs.ListPNGFiles(tmpDir)
			Expect(err).NotTo(HaveOccurred())

			Expect(files).To(HaveLen(2))
			for _, f := range files {
				Expect(f).To(HaveSuffix(".png"))
			}
		})

		It("returns empty list when directory contains only .json files", func() {
			Expect(os.WriteFile(filepath.Join(tmpDir, "image.json"), []byte(`{}`), 0644)).To(Succeed())

			files, err := fs.ListPNGFiles(tmpDir)
			Expect(err).NotTo(HaveOccurred())
			Expect(files).To(BeEmpty())
		})

		It("returns empty list for empty directory", func() {
			files, err := fs.ListPNGFiles(tmpDir)
			Expect(err).NotTo(HaveOccurred())
			Expect(files).To(BeEmpty())
		})

		It("returns error when directory does not exist", func() {
			_, err := fs.ListPNGFiles(filepath.Join(tmpDir, "nonexistent"))
			Expect(err).To(HaveOccurred())
		})

		Context("log level for directory-not-found", func() {
			var (
				lc     *testutil.LogCapture
				fsHook *store.FileSystem
			)

			BeforeEach(func() {
				lc = testutil.NewLogCapture()
				fsHook = store.NewFileSystem(lc.Logger)
			})

			It("logs at debug level (not error) when directory does not exist", func() {
				lc.Reset()
				_, _ = fsHook.ListPNGFiles(filepath.Join(tmpDir, "nonexistent"))

				Expect(lc.EntriesAtLevel(logrus.ErrorLevel)).To(BeEmpty(), "expected no error-level log entries for a missing directory")
				Expect(lc.EntriesAtLevel(logrus.DebugLevel)).NotTo(BeEmpty(), "expected at least one debug-level log entry for a missing directory")
			})
		})
	})

	Describe("ListSafetensorsFiles", func() {
		Context("log level for directory-not-found", func() {
			var (
				lc     *testutil.LogCapture
				fsHook *store.FileSystem
			)

			BeforeEach(func() {
				lc = testutil.NewLogCapture()
				fsHook = store.NewFileSystem(lc.Logger)
			})

			It("returns error when root directory does not exist", func() {
				_, err := fsHook.ListSafetensorsFiles(filepath.Join(tmpDir, "nonexistent"))
				Expect(err).To(HaveOccurred())
			})

			It("logs at debug level (not error) when root directory does not exist", func() {
				lc.Reset()
				_, _ = fsHook.ListSafetensorsFiles(filepath.Join(tmpDir, "nonexistent"))

				Expect(lc.EntriesAtLevel(logrus.ErrorLevel)).To(BeEmpty(), "expected no error-level log entries for a missing directory")
				Expect(lc.EntriesAtLevel(logrus.DebugLevel)).NotTo(BeEmpty(), "expected at least one debug-level log entry for a missing directory")
			})

			It("lists .safetensors files in an existing directory", func() {
				Expect(os.WriteFile(filepath.Join(tmpDir, "model.safetensors"), []byte("data"), 0644)).To(Succeed())
				Expect(os.WriteFile(filepath.Join(tmpDir, "other.txt"), []byte("data"), 0644)).To(Succeed())

				files, err := fsHook.ListSafetensorsFiles(tmpDir)
				Expect(err).NotTo(HaveOccurred())
				Expect(files).To(HaveLen(1))
				Expect(files[0]).To(Equal("model.safetensors"))
			})
		})
	})

	Describe("OpenFile", func() {
		var (
			lc     *testutil.LogCapture
			fsHook *store.FileSystem
		)

		BeforeEach(func() {
			lc = testutil.NewLogCapture()
			fsHook = store.NewFileSystem(lc.Logger)
		})

		It("returns the file reader when the file exists", func() {
			filePath := filepath.Join(tmpDir, "test.txt")
			Expect(os.WriteFile(filePath, []byte("content"), 0644)).To(Succeed())

			rc, err := fsHook.OpenFile(filePath)
			Expect(err).NotTo(HaveOccurred())
			Expect(rc).NotTo(BeNil())
			rc.Close()
		})

		Context("when the file does not exist", func() {
			It("returns an error", func() {
				_, err := fsHook.OpenFile(filepath.Join(tmpDir, "nonexistent.json"))
				Expect(err).To(HaveOccurred())
			})

			It("logs at debug level, not error level", func() {
				lc.Reset()
				_, _ = fsHook.OpenFile(filepath.Join(tmpDir, "nonexistent.json"))

				Expect(lc.EntriesAtLevel(logrus.ErrorLevel)).To(BeEmpty(), "expected no error-level log entries for a missing file")
				Expect(lc.EntriesAtLevel(logrus.DebugLevel)).NotTo(BeEmpty(), "expected at least one debug-level log entry for a missing file")
			})
		})

		Context("when the file cannot be opened due to a permission error", func() {
			It("logs at error level", func() {
				// Create a file and remove read permission
				filePath := filepath.Join(tmpDir, "noperm.txt")
				Expect(os.WriteFile(filePath, []byte("secret"), 0000)).To(Succeed())

				// Skip this test if running as root (root can read any file)
				if os.Getuid() == 0 {
					Skip("running as root; permission denial cannot be tested")
				}

				lc.Reset()
				_, _ = fsHook.OpenFile(filePath)

				Expect(lc.EntriesAtLevel(logrus.ErrorLevel)).NotTo(BeEmpty(), "expected an error-level log entry for a permission-denied failure")
			})
		})
	})

	Describe("OpenImageFile", func() {
		// This is the path-traversal security seam extracted from the API layer
		// (R-017). It rejects unsafe relative paths before touching the
		// filesystem and confirms the resolved path stays within sampleRoot.

		// rejectionCases exercise paths that must be rejected before any file is
		// opened. They must all return store.ErrInvalidImagePath and never a
		// file handle.
		DescribeTable("rejects unsafe relative paths with ErrInvalidImagePath",
			func(relPath string) {
				f, err := fs.OpenImageFile(tmpDir, relPath)
				Expect(f).To(BeNil())
				Expect(err).To(MatchError(store.ErrInvalidImagePath))
			},
			Entry("empty path", ""),
			Entry("parent traversal", "../etc/passwd"),
			Entry("nested parent traversal", "checkpoint.safetensors/../../etc/passwd"),
			Entry("trailing parent traversal", "checkpoint.safetensors/.."),
			Entry("current-dir component prefix", "./image.png"),
			Entry("current-dir component nested", "sub/./image.png"),
			Entry("absolute unix path", "/etc/passwd"),
		)

		It("rejects an absolute path even when it points inside sampleRoot", func() {
			// An absolute path is always rejected regardless of where it points;
			// the API contract requires a relative path.
			abs := filepath.Join(tmpDir, "image.png")
			Expect(os.WriteFile(abs, buildSniffPNG(), 0644)).To(Succeed())

			f, err := fs.OpenImageFile(tmpDir, abs)
			Expect(f).To(BeNil())
			Expect(err).To(MatchError(store.ErrInvalidImagePath))
		})

		It("rejects a sibling directory that shares a name prefix with sampleRoot", func() {
			// S-154 separator-bounded prefix check: a sibling like
			// "<root>-evil" must not be treated as inside "<root>". We build
			// such a sibling, place a file in it, and confirm that no relative
			// path under sampleRoot can reach it. filepath.Join with a relative
			// path cannot escape on its own, so this also guards against a
			// regression that swaps the separator-bounded check for a plain
			// HasPrefix.
			root := filepath.Join(tmpDir, "samples")
			Expect(os.MkdirAll(root, 0755)).To(Succeed())
			sibling := filepath.Join(tmpDir, "samples-evil")
			Expect(os.MkdirAll(sibling, 0755)).To(Succeed())
			Expect(os.WriteFile(filepath.Join(sibling, "secret.png"), buildSniffPNG(), 0644)).To(Succeed())

			// "../samples-evil/secret.png" is rejected at the component check.
			f, err := fs.OpenImageFile(root, "../samples-evil/secret.png")
			Expect(f).To(BeNil())
			Expect(err).To(MatchError(store.ErrInvalidImagePath))
		})

		It("returns ErrImageNotFound for a clean path that does not exist", func() {
			f, err := fs.OpenImageFile(tmpDir, "checkpoint.safetensors/missing.png")
			Expect(f).To(BeNil())
			Expect(err).To(MatchError(store.ErrImageNotFound))
		})

		It("returns ErrImageNotFound when the clean path is a directory", func() {
			Expect(os.MkdirAll(filepath.Join(tmpDir, "some_dir"), 0755)).To(Succeed())

			f, err := fs.OpenImageFile(tmpDir, "some_dir")
			Expect(f).To(BeNil())
			Expect(err).To(MatchError(store.ErrImageNotFound))
		})

		It("opens a valid clean path and reports its size, positioned at the start", func() {
			subDir := filepath.Join(tmpDir, "checkpoint.safetensors")
			Expect(os.MkdirAll(subDir, 0755)).To(Succeed())
			data := buildSniffPNG()
			Expect(os.WriteFile(filepath.Join(subDir, "test.png"), data, 0644)).To(Succeed())

			f, err := fs.OpenImageFile(tmpDir, "checkpoint.safetensors/test.png")
			Expect(err).NotTo(HaveOccurred())
			Expect(f).NotTo(BeNil())
			defer f.Close()

			Expect(f.Size).To(Equal(int64(len(data))))

			// The returned reader is positioned at the start: a full read yields
			// the complete file contents byte-for-byte.
			got, err := io.ReadAll(f)
			Expect(err).NotTo(HaveOccurred())
			Expect(got).To(Equal(data))
		})

		It("supports seeking back to the start after a partial read (content-type sniff path)", func() {
			data := buildSniffPNG()
			Expect(os.WriteFile(filepath.Join(tmpDir, "sniff.png"), data, 0644)).To(Succeed())

			f, err := fs.OpenImageFile(tmpDir, "sniff.png")
			Expect(err).NotTo(HaveOccurred())
			defer f.Close()

			buf := make([]byte, 4)
			_, err = f.Read(buf)
			Expect(err).NotTo(HaveOccurred())

			_, err = f.Seek(0, io.SeekStart)
			Expect(err).NotTo(HaveOccurred())

			got, err := io.ReadAll(f)
			Expect(err).NotTo(HaveOccurred())
			Expect(got).To(Equal(data))
		})

		It("wraps no absolute path into the returned sentinel errors", func() {
			// The sentinel must not leak the server path (R-015).
			_, err := fs.OpenImageFile(tmpDir, "../escape")
			Expect(err).To(HaveOccurred())
			Expect(err.Error()).NotTo(ContainSubstring(tmpDir))
			Expect(errors.Is(err, store.ErrInvalidImagePath)).To(BeTrue())
		})
	})
})

// buildSniffPNG returns the minimal leading bytes of a PNG file, sufficient for
// http.DetectContentType to report "image/png" and for read/seek assertions.
func buildSniffPNG() []byte {
	return []byte{0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D}
}

