package store_test

import (
	"os"
	"path/filepath"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
	"github.com/sirupsen/logrus"
	"github.com/sirupsen/logrus/hooks/test"
	"io"

	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/store"
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
	})

	Describe("OpenFile", func() {
		var (
			logger *logrus.Logger
			hook   *test.Hook
			fsHook *store.FileSystem
		)

		BeforeEach(func() {
			logger, hook = test.NewNullLogger()
			logger.SetLevel(logrus.DebugLevel)
			fsHook = store.NewFileSystem(logger)
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
				hook.Reset()
				_, _ = fsHook.OpenFile(filepath.Join(tmpDir, "nonexistent.json"))

				errorEntries := filterByLevel(hook.AllEntries(), logrus.ErrorLevel)
				Expect(errorEntries).To(BeEmpty(), "expected no error-level log entries for a missing file")

				debugEntries := filterByLevel(hook.AllEntries(), logrus.DebugLevel)
				Expect(debugEntries).NotTo(BeEmpty(), "expected at least one debug-level log entry for a missing file")
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

				hook.Reset()
				_, _ = fsHook.OpenFile(filePath)

				errorEntries := filterByLevel(hook.AllEntries(), logrus.ErrorLevel)
				Expect(errorEntries).NotTo(BeEmpty(), "expected an error-level log entry for a permission-denied failure")
			})
		})
	})
})

// filterByLevel returns log entries that match the given level.
func filterByLevel(entries []*logrus.Entry, level logrus.Level) []*logrus.Entry {
	var out []*logrus.Entry
	for _, e := range entries {
		if e.Level == level {
			out = append(out, e)
		}
	}
	return out
}
