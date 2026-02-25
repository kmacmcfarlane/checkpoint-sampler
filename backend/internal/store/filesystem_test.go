package store_test

import (
	"os"
	"path/filepath"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
	"github.com/sirupsen/logrus"
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
})
