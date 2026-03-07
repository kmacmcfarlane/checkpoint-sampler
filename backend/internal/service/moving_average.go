package service

import "time"

// MovingAverage computes a simple moving average over a fixed-size window
// of time.Duration values. It is used to track per-sample generation times
// and estimate remaining job duration.
type MovingAverage struct {
	window   int
	samples  []time.Duration
	position int
	count    int
}

// NewMovingAverage creates a MovingAverage with the given window size.
// The window size must be at least 1; values less than 1 are clamped to 1.
func NewMovingAverage(window int) *MovingAverage {
	if window < 1 {
		window = 1
	}
	return &MovingAverage{
		window:  window,
		samples: make([]time.Duration, window),
	}
}

// Add records a new sample duration. When the window is full, the oldest
// sample is overwritten (circular buffer).
func (m *MovingAverage) Add(d time.Duration) {
	m.samples[m.position] = d
	m.position = (m.position + 1) % m.window
	if m.count < m.window {
		m.count++
	}
}

// Average returns the current moving average. If no samples have been added,
// it returns 0.
func (m *MovingAverage) Average() time.Duration {
	if m.count == 0 {
		return 0
	}
	var sum time.Duration
	for i := 0; i < m.count; i++ {
		sum += m.samples[i]
	}
	return sum / time.Duration(m.count)
}

// Count returns the number of samples currently in the window (up to the
// window size).
func (m *MovingAverage) Count() int {
	return m.count
}

// Reset clears all samples and resets the moving average to its initial state.
func (m *MovingAverage) Reset() {
	m.position = 0
	m.count = 0
	for i := range m.samples {
		m.samples[i] = 0
	}
}
