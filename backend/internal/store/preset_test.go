package store_test

import (
	"database/sql"
	"io"
	"os"
	"path/filepath"
	"time"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
	"github.com/sirupsen/logrus"

	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/model"
	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/store"
)

var _ = Describe("PresetStore", func() {
	var (
		st     *store.Store
		tmpDir string
		logger *logrus.Logger
	)

	BeforeEach(func() {
		var err error
		tmpDir, err = os.MkdirTemp("", "preset-store-test-*")
		Expect(err).NotTo(HaveOccurred())

		dbPath := filepath.Join(tmpDir, "test.db")
		db, err := store.OpenDB(dbPath)
		Expect(err).NotTo(HaveOccurred())

		logger = logrus.New()
		logger.SetOutput(io.Discard) // Silence logs in tests
		st, err = store.New(db, logger)
		Expect(err).NotTo(HaveOccurred())
	})

	AfterEach(func() {
		if st != nil {
			st.Close()
		}
		os.RemoveAll(tmpDir)
	})

	now := time.Date(2025, 1, 1, 0, 0, 0, 0, time.UTC)

	makePreset := func(id, name string) model.Preset {
		return model.Preset{
			ID:   id,
			Name: name,
			Mapping: model.PresetMapping{
				X:      "cfg",
				Y:      "prompt_name",
				Slider: "checkpoint",
				Combos: []string{"seed", "index"},
			},
			CreatedAt: now,
			UpdatedAt: now,
		}
	}

	Describe("CreatePreset", func() {
		It("creates a preset and reads it back", func() {
			p := makePreset("p1", "Test Preset")
			err := st.CreatePreset(p)
			Expect(err).NotTo(HaveOccurred())

			got, err := st.GetPreset("p1")
			Expect(err).NotTo(HaveOccurred())
			Expect(got.ID).To(Equal("p1"))
			Expect(got.Name).To(Equal("Test Preset"))
			Expect(got.Mapping.X).To(Equal("cfg"))
			Expect(got.Mapping.Y).To(Equal("prompt_name"))
			Expect(got.Mapping.Slider).To(Equal("checkpoint"))
			Expect(got.Mapping.Combos).To(Equal([]string{"seed", "index"}))
			Expect(got.CreatedAt).To(BeTemporally("~", now, time.Second))
			Expect(got.UpdatedAt).To(BeTemporally("~", now, time.Second))
		})

		It("creates a preset with empty optional mapping fields", func() {
			p := model.Preset{
				ID:   "p2",
				Name: "Minimal",
				Mapping: model.PresetMapping{
					Combos: []string{"seed"},
				},
				CreatedAt: now,
				UpdatedAt: now,
			}
			err := st.CreatePreset(p)
			Expect(err).NotTo(HaveOccurred())

			got, err := st.GetPreset("p2")
			Expect(err).NotTo(HaveOccurred())
			Expect(got.Mapping.X).To(Equal(""))
			Expect(got.Mapping.Y).To(Equal(""))
			Expect(got.Mapping.Slider).To(Equal(""))
			Expect(got.Mapping.Combos).To(Equal([]string{"seed"}))
		})

		It("returns error for duplicate ID", func() {
			p := makePreset("dup", "First")
			Expect(st.CreatePreset(p)).To(Succeed())

			p2 := makePreset("dup", "Second")
			err := st.CreatePreset(p2)
			Expect(err).To(HaveOccurred())
		})
	})

	Describe("ListPresets", func() {
		It("returns empty slice when no presets exist", func() {
			presets, err := st.ListPresets()
			Expect(err).NotTo(HaveOccurred())
			Expect(presets).To(BeEmpty())
		})

		It("returns presets ordered by name", func() {
			Expect(st.CreatePreset(makePreset("p1", "Zebra"))).To(Succeed())
			Expect(st.CreatePreset(makePreset("p2", "Alpha"))).To(Succeed())
			Expect(st.CreatePreset(makePreset("p3", "Middle"))).To(Succeed())

			presets, err := st.ListPresets()
			Expect(err).NotTo(HaveOccurred())
			Expect(presets).To(HaveLen(3))
			Expect(presets[0].Name).To(Equal("Alpha"))
			Expect(presets[1].Name).To(Equal("Middle"))
			Expect(presets[2].Name).To(Equal("Zebra"))
		})
	})

	Describe("GetPreset", func() {
		It("returns sql.ErrNoRows for non-existent preset", func() {
			_, err := st.GetPreset("nonexistent")
			Expect(err).To(Equal(sql.ErrNoRows))
		})
	})

	Describe("UpdatePreset", func() {
		It("updates name and mapping", func() {
			p := makePreset("u1", "Original")
			Expect(st.CreatePreset(p)).To(Succeed())

			p.Name = "Updated"
			p.Mapping.X = "seed"
			p.Mapping.Combos = []string{"cfg"}
			p.UpdatedAt = now.Add(time.Hour)
			Expect(st.UpdatePreset(p)).To(Succeed())

			got, err := st.GetPreset("u1")
			Expect(err).NotTo(HaveOccurred())
			Expect(got.Name).To(Equal("Updated"))
			Expect(got.Mapping.X).To(Equal("seed"))
			Expect(got.Mapping.Combos).To(Equal([]string{"cfg"}))
			Expect(got.UpdatedAt).To(BeTemporally("~", now.Add(time.Hour), time.Second))
		})

		It("returns sql.ErrNoRows for non-existent preset", func() {
			p := makePreset("missing", "Ghost")
			err := st.UpdatePreset(p)
			Expect(err).To(Equal(sql.ErrNoRows))
		})
	})

	Describe("DeletePreset", func() {
		It("deletes an existing preset", func() {
			Expect(st.CreatePreset(makePreset("d1", "ToDelete"))).To(Succeed())

			Expect(st.DeletePreset("d1")).To(Succeed())

			_, err := st.GetPreset("d1")
			Expect(err).To(Equal(sql.ErrNoRows))
		})

		It("returns sql.ErrNoRows for non-existent preset", func() {
			err := st.DeletePreset("nonexistent")
			Expect(err).To(Equal(sql.ErrNoRows))
		})
	})
})
