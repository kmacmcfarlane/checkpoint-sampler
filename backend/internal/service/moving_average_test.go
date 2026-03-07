package service_test

import (
	"time"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"

	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/service"
)

// AC: BE: Unit tests for moving average calculation
var _ = Describe("MovingAverage", func() {
	Describe("NewMovingAverage", func() {
		It("creates a moving average with the given window size", func() {
			ma := service.NewMovingAverage(10)
			Expect(ma.Count()).To(Equal(0))
			Expect(ma.Average()).To(Equal(time.Duration(0)))
		})

		It("clamps window size to 1 when given 0", func() {
			ma := service.NewMovingAverage(0)
			ma.Add(5 * time.Second)
			Expect(ma.Count()).To(Equal(1))
			Expect(ma.Average()).To(Equal(5 * time.Second))
		})

		It("clamps window size to 1 when given negative value", func() {
			ma := service.NewMovingAverage(-3)
			ma.Add(7 * time.Second)
			Expect(ma.Count()).To(Equal(1))
			Expect(ma.Average()).To(Equal(7 * time.Second))
		})
	})

	Describe("Add and Average", func() {
		// AC: Test edge case: first sample has no prior average to work with
		It("returns the single sample when only one has been added", func() {
			ma := service.NewMovingAverage(5)
			ma.Add(10 * time.Second)
			Expect(ma.Count()).To(Equal(1))
			Expect(ma.Average()).To(Equal(10 * time.Second))
		})

		It("computes the average of multiple samples within the window", func() {
			ma := service.NewMovingAverage(5)
			ma.Add(10 * time.Second)
			ma.Add(20 * time.Second)
			ma.Add(30 * time.Second)
			Expect(ma.Count()).To(Equal(3))
			Expect(ma.Average()).To(Equal(20 * time.Second))
		})

		It("computes the average when the window is exactly full", func() {
			ma := service.NewMovingAverage(3)
			ma.Add(10 * time.Second)
			ma.Add(20 * time.Second)
			ma.Add(30 * time.Second)
			Expect(ma.Count()).To(Equal(3))
			Expect(ma.Average()).To(Equal(20 * time.Second))
		})

		// AC: Test ETA accuracy improves after several samples (moving average stabilizes)
		It("drops the oldest sample when the window overflows", func() {
			ma := service.NewMovingAverage(3)
			ma.Add(10 * time.Second) // [10, _, _]
			ma.Add(20 * time.Second) // [10, 20, _]
			ma.Add(30 * time.Second) // [10, 20, 30] avg=20
			ma.Add(40 * time.Second) // [40, 20, 30] oldest (10) replaced by 40, avg=30

			Expect(ma.Count()).To(Equal(3))
			Expect(ma.Average()).To(Equal(30 * time.Second))
		})

		// AC: Test ETA display with varying sample generation times
		It("handles varying sample generation times correctly", func() {
			ma := service.NewMovingAverage(5)
			// Simulate varying generation times
			ma.Add(5 * time.Second)
			ma.Add(15 * time.Second)
			ma.Add(8 * time.Second)
			ma.Add(12 * time.Second)
			ma.Add(10 * time.Second)
			// avg = (5+15+8+12+10)/5 = 50/5 = 10
			Expect(ma.Average()).To(Equal(10 * time.Second))
		})

		It("stabilizes after the window is full despite initial outlier", func() {
			ma := service.NewMovingAverage(3)
			// First sample is an outlier (very slow)
			ma.Add(60 * time.Second)
			// After outlier, average is the outlier itself
			Expect(ma.Average()).To(Equal(60 * time.Second))

			// Add normal samples
			ma.Add(10 * time.Second)
			ma.Add(10 * time.Second)
			// avg = (60+10+10)/3 = 26.6s (still affected)
			Expect(ma.Average()).To(BeNumerically("~", 26666*time.Millisecond, 700*time.Millisecond))

			// Overflow: outlier is dropped
			ma.Add(10 * time.Second)
			// avg = (10+10+10)/3 = 10s (stabilized)
			Expect(ma.Average()).To(Equal(10 * time.Second))
		})
	})

	Describe("Count", func() {
		It("returns 0 when no samples have been added", func() {
			ma := service.NewMovingAverage(10)
			Expect(ma.Count()).To(Equal(0))
		})

		It("does not exceed the window size", func() {
			ma := service.NewMovingAverage(3)
			ma.Add(1 * time.Second)
			ma.Add(2 * time.Second)
			ma.Add(3 * time.Second)
			ma.Add(4 * time.Second)
			ma.Add(5 * time.Second)
			Expect(ma.Count()).To(Equal(3))
		})
	})

	Describe("Reset", func() {
		It("clears all samples and resets count", func() {
			ma := service.NewMovingAverage(5)
			ma.Add(10 * time.Second)
			ma.Add(20 * time.Second)
			ma.Add(30 * time.Second)

			ma.Reset()
			Expect(ma.Count()).To(Equal(0))
			Expect(ma.Average()).To(Equal(time.Duration(0)))
		})

		It("allows adding new samples after reset", func() {
			ma := service.NewMovingAverage(3)
			ma.Add(100 * time.Second)
			ma.Add(200 * time.Second)

			ma.Reset()
			ma.Add(5 * time.Second)
			Expect(ma.Count()).To(Equal(1))
			Expect(ma.Average()).To(Equal(5 * time.Second))
		})
	})

	Describe("Average with zero count", func() {
		It("returns zero duration when no samples exist", func() {
			ma := service.NewMovingAverage(5)
			Expect(ma.Average()).To(Equal(time.Duration(0)))
		})
	})

	// AC: Test ETA accuracy improves after several samples
	Describe("ETA calculation integration", func() {
		It("computes decreasing ETA as samples complete", func() {
			ma := service.NewMovingAverage(10)
			// Simulate 5 samples each taking 10 seconds
			for i := 0; i < 5; i++ {
				ma.Add(10 * time.Second)
			}

			remaining := 20
			etaAfter5 := ma.Average() * time.Duration(remaining)
			// 10s * 20 = 200s
			Expect(etaAfter5).To(Equal(200 * time.Second))

			// Complete 5 more
			for i := 0; i < 5; i++ {
				ma.Add(10 * time.Second)
			}

			remaining = 15
			etaAfter10 := ma.Average() * time.Duration(remaining)
			// 10s * 15 = 150s
			Expect(etaAfter10).To(Equal(150 * time.Second))

			// ETA decreased
			Expect(etaAfter10).To(BeNumerically("<", etaAfter5))
		})
	})
})
