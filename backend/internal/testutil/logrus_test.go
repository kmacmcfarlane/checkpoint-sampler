package testutil_test

import (
	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
	"github.com/sirupsen/logrus"

	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/testutil"
)

var _ = Describe("LogCapture", func() {
	Describe("NewLogCapture", func() {
		It("returns a non-nil LogCapture with a logger and hook", func() {
			lc := testutil.NewLogCapture()
			Expect(lc).NotTo(BeNil())
			Expect(lc.Logger).NotTo(BeNil())
			Expect(lc.Hook).NotTo(BeNil())
		})

		It("sets the logger level to TraceLevel so all entries are captured", func() {
			lc := testutil.NewLogCapture()
			Expect(lc.Logger.Level).To(Equal(logrus.TraceLevel))
		})

		It("starts with no captured entries", func() {
			lc := testutil.NewLogCapture()
			Expect(lc.Hook.AllEntries()).To(BeEmpty())
		})
	})

	Describe("EntriesAtLevel", func() {
		It("returns only entries that match the requested level", func() {
			lc := testutil.NewLogCapture()
			lc.Logger.Info("info message")
			lc.Logger.Warn("warn message")
			lc.Logger.Error("error message")

			Expect(lc.EntriesAtLevel(logrus.InfoLevel)).To(HaveLen(1))
			Expect(lc.EntriesAtLevel(logrus.WarnLevel)).To(HaveLen(1))
			Expect(lc.EntriesAtLevel(logrus.ErrorLevel)).To(HaveLen(1))
		})

		It("returns empty when no entries match the level", func() {
			lc := testutil.NewLogCapture()
			lc.Logger.Info("info only")

			Expect(lc.EntriesAtLevel(logrus.ErrorLevel)).To(BeEmpty())
		})

		It("returns all matching entries when multiple entries share the same level", func() {
			lc := testutil.NewLogCapture()
			lc.Logger.Debug("debug one")
			lc.Logger.Debug("debug two")

			Expect(lc.EntriesAtLevel(logrus.DebugLevel)).To(HaveLen(2))
		})
	})

	Describe("MessagesAtLevel", func() {
		It("returns the message strings of matching entries", func() {
			lc := testutil.NewLogCapture()
			lc.Logger.Warn("validation failed")
			lc.Logger.Info("some info")

			msgs := lc.MessagesAtLevel(logrus.WarnLevel)
			Expect(msgs).To(ConsistOf("validation failed"))
		})

		It("returns empty slice when no entries match", func() {
			lc := testutil.NewLogCapture()
			lc.Logger.Info("info only")

			msgs := lc.MessagesAtLevel(logrus.ErrorLevel)
			Expect(msgs).To(BeEmpty())
		})
	})

	Describe("Reset", func() {
		It("clears previously captured entries", func() {
			lc := testutil.NewLogCapture()
			lc.Logger.Error("before reset")
			Expect(lc.Hook.AllEntries()).NotTo(BeEmpty())

			lc.Reset()
			Expect(lc.Hook.AllEntries()).To(BeEmpty())
		})

		It("allows re-capture after reset", func() {
			lc := testutil.NewLogCapture()
			lc.Logger.Error("first")
			lc.Reset()
			lc.Logger.Info("second")

			Expect(lc.EntriesAtLevel(logrus.ErrorLevel)).To(BeEmpty())
			Expect(lc.EntriesAtLevel(logrus.InfoLevel)).To(HaveLen(1))
		})
	})

	DescribeTable("captures entries at every severity level",
		func(logFn func(*testutil.LogCapture), expectedLevel logrus.Level) {
			lc := testutil.NewLogCapture()
			logFn(lc)
			Expect(lc.EntriesAtLevel(expectedLevel)).To(HaveLen(1))
		},
		Entry("trace", func(lc *testutil.LogCapture) { lc.Logger.Trace("t") }, logrus.TraceLevel),
		Entry("debug", func(lc *testutil.LogCapture) { lc.Logger.Debug("d") }, logrus.DebugLevel),
		Entry("info", func(lc *testutil.LogCapture) { lc.Logger.Info("i") }, logrus.InfoLevel),
		Entry("warn", func(lc *testutil.LogCapture) { lc.Logger.Warn("w") }, logrus.WarnLevel),
		Entry("error", func(lc *testutil.LogCapture) { lc.Logger.Error("e") }, logrus.ErrorLevel),
	)
})
