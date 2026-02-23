package store_test

import (
	"database/sql"
	"io"
	"os"
	"path/filepath"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
	"github.com/sirupsen/logrus"

	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/store"
)

var _ = Describe("OpenDB", func() {
	var tmpDir string

	BeforeEach(func() {
		var err error
		tmpDir, err = os.MkdirTemp("", "store-test-*")
		Expect(err).NotTo(HaveOccurred())
	})

	AfterEach(func() {
		os.RemoveAll(tmpDir)
	})

	It("opens a database and configures pragmas", func() {
		dbPath := filepath.Join(tmpDir, "test.db")
		db, err := store.OpenDB(dbPath)
		Expect(err).NotTo(HaveOccurred())
		defer db.Close()

		// Verify WAL mode
		var journalMode string
		err = db.QueryRow("PRAGMA journal_mode").Scan(&journalMode)
		Expect(err).NotTo(HaveOccurred())
		Expect(journalMode).To(Equal("wal"))

		// Verify busy timeout
		var busyTimeout int
		err = db.QueryRow("PRAGMA busy_timeout").Scan(&busyTimeout)
		Expect(err).NotTo(HaveOccurred())
		Expect(busyTimeout).To(Equal(5000))

		// Verify foreign keys
		var foreignKeys int
		err = db.QueryRow("PRAGMA foreign_keys").Scan(&foreignKeys)
		Expect(err).NotTo(HaveOccurred())
		Expect(foreignKeys).To(Equal(1))
	})

	It("creates the parent directory if it does not exist", func() {
		dbPath := filepath.Join(tmpDir, "subdir", "nested", "test.db")
		db, err := store.OpenDB(dbPath)
		Expect(err).NotTo(HaveOccurred())
		defer db.Close()

		_, err = os.Stat(filepath.Dir(dbPath))
		Expect(err).NotTo(HaveOccurred())
	})
})

var _ = Describe("Migrate", func() {
	var (
		db     *sql.DB
		tmpDir string
	)

	BeforeEach(func() {
		var err error
		tmpDir, err = os.MkdirTemp("", "migrate-test-*")
		Expect(err).NotTo(HaveOccurred())

		dbPath := filepath.Join(tmpDir, "test.db")
		db, err = store.OpenDB(dbPath)
		Expect(err).NotTo(HaveOccurred())
	})

	AfterEach(func() {
		if db != nil {
			db.Close()
		}
		os.RemoveAll(tmpDir)
	})

	It("creates the schema_migrations table", func() {
		err := store.Migrate(db, nil)
		Expect(err).NotTo(HaveOccurred())

		// Verify the table exists by querying it
		var count int
		err = db.QueryRow("SELECT COUNT(*) FROM schema_migrations").Scan(&count)
		Expect(err).NotTo(HaveOccurred())
		Expect(count).To(Equal(0))
	})

	It("applies migrations in order", func() {
		migrations := []store.Migration{
			{Version: 1, SQL: "CREATE TABLE t1 (id TEXT PRIMARY KEY)"},
			{Version: 2, SQL: "CREATE TABLE t2 (id TEXT PRIMARY KEY)"},
		}

		err := store.Migrate(db, migrations)
		Expect(err).NotTo(HaveOccurred())

		// Verify both tables exist
		var name string
		err = db.QueryRow("SELECT name FROM sqlite_master WHERE type='table' AND name='t1'").Scan(&name)
		Expect(err).NotTo(HaveOccurred())
		Expect(name).To(Equal("t1"))

		err = db.QueryRow("SELECT name FROM sqlite_master WHERE type='table' AND name='t2'").Scan(&name)
		Expect(err).NotTo(HaveOccurred())
		Expect(name).To(Equal("t2"))

		// Verify migration records
		var count int
		err = db.QueryRow("SELECT COUNT(*) FROM schema_migrations").Scan(&count)
		Expect(err).NotTo(HaveOccurred())
		Expect(count).To(Equal(2))
	})

	It("is idempotent — running migrations twice has no effect", func() {
		migrations := []store.Migration{
			{Version: 1, SQL: "CREATE TABLE t1 (id TEXT PRIMARY KEY)"},
		}

		err := store.Migrate(db, migrations)
		Expect(err).NotTo(HaveOccurred())

		// Run again — should not error
		err = store.Migrate(db, migrations)
		Expect(err).NotTo(HaveOccurred())

		// Still only one migration record
		var count int
		err = db.QueryRow("SELECT COUNT(*) FROM schema_migrations").Scan(&count)
		Expect(err).NotTo(HaveOccurred())
		Expect(count).To(Equal(1))
	})

	It("skips already-applied migrations and applies new ones", func() {
		// Apply first migration
		migrations1 := []store.Migration{
			{Version: 1, SQL: "CREATE TABLE t1 (id TEXT PRIMARY KEY)"},
		}
		err := store.Migrate(db, migrations1)
		Expect(err).NotTo(HaveOccurred())

		// Add a second migration and run
		migrations2 := []store.Migration{
			{Version: 1, SQL: "CREATE TABLE t1 (id TEXT PRIMARY KEY)"},
			{Version: 2, SQL: "CREATE TABLE t2 (id TEXT PRIMARY KEY)"},
		}
		err = store.Migrate(db, migrations2)
		Expect(err).NotTo(HaveOccurred())

		// Both tables exist
		var count int
		err = db.QueryRow("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name IN ('t1','t2')").Scan(&count)
		Expect(err).NotTo(HaveOccurred())
		Expect(count).To(Equal(2))

		// Two migration records
		err = db.QueryRow("SELECT COUNT(*) FROM schema_migrations").Scan(&count)
		Expect(err).NotTo(HaveOccurred())
		Expect(count).To(Equal(2))
	})

	It("records the applied timestamp in RFC 3339 format", func() {
		migrations := []store.Migration{
			{Version: 1, SQL: "CREATE TABLE t1 (id TEXT PRIMARY KEY)"},
		}

		err := store.Migrate(db, migrations)
		Expect(err).NotTo(HaveOccurred())

		var applied string
		err = db.QueryRow("SELECT applied FROM schema_migrations WHERE version = 1").Scan(&applied)
		Expect(err).NotTo(HaveOccurred())
		Expect(applied).To(MatchRegexp(`^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$`))
	})

	It("returns an error for invalid SQL in a migration", func() {
		migrations := []store.Migration{
			{Version: 1, SQL: "INVALID SQL STATEMENT"},
		}

		err := store.Migrate(db, migrations)
		Expect(err).To(HaveOccurred())
		Expect(err.Error()).To(ContainSubstring("executing migration 1"))
	})

	It("does not apply subsequent migrations if one fails", func() {
		migrations := []store.Migration{
			{Version: 1, SQL: "INVALID SQL"},
			{Version: 2, SQL: "CREATE TABLE t2 (id TEXT PRIMARY KEY)"},
		}

		err := store.Migrate(db, migrations)
		Expect(err).To(HaveOccurred())

		// No migrations should be recorded
		var count int
		err = db.QueryRow("SELECT COUNT(*) FROM schema_migrations").Scan(&count)
		Expect(err).NotTo(HaveOccurred())
		Expect(count).To(Equal(0))

		// t2 should not exist
		err = db.QueryRow("SELECT name FROM sqlite_master WHERE type='table' AND name='t2'").Scan(new(string))
		Expect(err).To(Equal(sql.ErrNoRows))
	})
})

var _ = Describe("AllMigrations", func() {
	It("returns the presets table as migration 1", func() {
		migrations := store.AllMigrations()
		Expect(migrations).To(HaveLen(2))
		Expect(migrations[0].Version).To(Equal(1))
		Expect(migrations[0].SQL).To(ContainSubstring("CREATE TABLE"))
		Expect(migrations[0].SQL).To(ContainSubstring("presets"))
	})

	It("returns the sample_presets table as migration 2", func() {
		migrations := store.AllMigrations()
		Expect(migrations[1].Version).To(Equal(2))
		Expect(migrations[1].SQL).To(ContainSubstring("CREATE TABLE"))
		Expect(migrations[1].SQL).To(ContainSubstring("sample_presets"))
	})
})

var _ = Describe("Presets table migration", func() {
	var (
		db     *sql.DB
		tmpDir string
	)

	BeforeEach(func() {
		var err error
		tmpDir, err = os.MkdirTemp("", "presets-test-*")
		Expect(err).NotTo(HaveOccurred())

		dbPath := filepath.Join(tmpDir, "test.db")
		db, err = store.OpenDB(dbPath)
		Expect(err).NotTo(HaveOccurred())

		err = store.Migrate(db, store.AllMigrations())
		Expect(err).NotTo(HaveOccurred())
	})

	AfterEach(func() {
		if db != nil {
			db.Close()
		}
		os.RemoveAll(tmpDir)
	})

	It("creates the presets table with the expected columns", func() {
		// Insert a row to verify the schema
		_, err := db.Exec(
			"INSERT INTO presets (id, name, mapping, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
			"test-id", "test-preset", `{"x":"cfg"}`, "2025-01-01T00:00:00Z", "2025-01-01T00:00:00Z",
		)
		Expect(err).NotTo(HaveOccurred())

		// Read it back
		var id, name, mapping, createdAt, updatedAt string
		err = db.QueryRow("SELECT id, name, mapping, created_at, updated_at FROM presets WHERE id = ?", "test-id").
			Scan(&id, &name, &mapping, &createdAt, &updatedAt)
		Expect(err).NotTo(HaveOccurred())
		Expect(id).To(Equal("test-id"))
		Expect(name).To(Equal("test-preset"))
		Expect(mapping).To(Equal(`{"x":"cfg"}`))
		Expect(createdAt).To(Equal("2025-01-01T00:00:00Z"))
		Expect(updatedAt).To(Equal("2025-01-01T00:00:00Z"))
	})

	It("enforces the primary key constraint on id", func() {
		_, err := db.Exec(
			"INSERT INTO presets (id, name, mapping, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
			"dup-id", "first", "{}", "2025-01-01T00:00:00Z", "2025-01-01T00:00:00Z",
		)
		Expect(err).NotTo(HaveOccurred())

		_, err = db.Exec(
			"INSERT INTO presets (id, name, mapping, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
			"dup-id", "second", "{}", "2025-01-01T00:00:00Z", "2025-01-01T00:00:00Z",
		)
		Expect(err).To(HaveOccurred())
	})

	It("rejects null name", func() {
		_, err := db.Exec(
			"INSERT INTO presets (id, name, mapping, created_at, updated_at) VALUES (?, NULL, ?, ?, ?)",
			"null-name", "{}", "2025-01-01T00:00:00Z", "2025-01-01T00:00:00Z",
		)
		Expect(err).To(HaveOccurred())
	})

	It("rejects null mapping", func() {
		_, err := db.Exec(
			"INSERT INTO presets (id, name, mapping, created_at, updated_at) VALUES (?, ?, NULL, ?, ?)",
			"null-map", "test", "2025-01-01T00:00:00Z", "2025-01-01T00:00:00Z",
		)
		Expect(err).To(HaveOccurred())
	})
})

var _ = Describe("New", func() {
	var tmpDir string

	BeforeEach(func() {
		var err error
		tmpDir, err = os.MkdirTemp("", "store-new-test-*")
		Expect(err).NotTo(HaveOccurred())
	})

	AfterEach(func() {
		os.RemoveAll(tmpDir)
	})

	It("creates a store and runs migrations", func() {
		dbPath := filepath.Join(tmpDir, "test.db")
		db, err := store.OpenDB(dbPath)
		Expect(err).NotTo(HaveOccurred())

		logger := logrus.New()
		logger.SetOutput(io.Discard) // Silence logs in tests
		s, err := store.New(db, logger)
		Expect(err).NotTo(HaveOccurred())
		defer s.Close()

		// Verify presets table exists
		var name string
		err = s.DB().QueryRow("SELECT name FROM sqlite_master WHERE type='table' AND name='presets'").Scan(&name)
		Expect(err).NotTo(HaveOccurred())
		Expect(name).To(Equal("presets"))
	})

	It("is idempotent — can be called multiple times on the same database", func() {
		dbPath := filepath.Join(tmpDir, "test.db")

		logger := logrus.New()
		logger.SetOutput(io.Discard) // Silence logs in tests

		// First store creation
		db1, err := store.OpenDB(dbPath)
		Expect(err).NotTo(HaveOccurred())
		s1, err := store.New(db1, logger)
		Expect(err).NotTo(HaveOccurred())
		s1.Close()

		// Second store creation on same DB
		db2, err := store.OpenDB(dbPath)
		Expect(err).NotTo(HaveOccurred())
		s2, err := store.New(db2, logger)
		Expect(err).NotTo(HaveOccurred())
		defer s2.Close()

		// Verify presets table still works
		_, err = s2.DB().Exec(
			"INSERT INTO presets (id, name, mapping, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
			"test-id", "test", "{}", "2025-01-01T00:00:00Z", "2025-01-01T00:00:00Z",
		)
		Expect(err).NotTo(HaveOccurred())
	})
})
