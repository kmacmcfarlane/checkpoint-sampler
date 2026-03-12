import { ref, watch, onUnmounted, type Ref } from 'vue'

/**
 * Composable that interpolates a countdown between server-pushed ETA updates.
 *
 * The server pushes ETA values (in seconds) periodically via WebSocket. This
 * composable creates a local setInterval that decrements the displayed value
 * every second, giving a smooth "counting down" UX between events. When a new
 * ETA value arrives from the server, the interval resets to the new value.
 *
 * @param serverEtaSeconds - Reactive source for the server-provided ETA (in seconds).
 *   May be undefined when no ETA is available.
 * @returns displayEtaSeconds - Reactive value that counts down from the latest server ETA.
 */
export function useCountdown(serverEtaSeconds: Ref<number | undefined>) {
  const displayEtaSeconds = ref<number | undefined>(undefined)

  let intervalId: ReturnType<typeof setInterval> | null = null

  function clearTimer() {
    if (intervalId !== null) {
      clearInterval(intervalId)
      intervalId = null
    }
  }

  function startTimer(initialSeconds: number) {
    clearTimer()
    displayEtaSeconds.value = initialSeconds
    intervalId = setInterval(() => {
      if (displayEtaSeconds.value !== undefined && displayEtaSeconds.value > 0) {
        displayEtaSeconds.value = displayEtaSeconds.value - 1
      } else {
        clearTimer()
        displayEtaSeconds.value = undefined
      }
    }, 1000)
  }

  // AC1 + AC2: When a new ETA value arrives from the server, reset the countdown.
  watch(
    serverEtaSeconds,
    (newEta) => {
      if (newEta === undefined || newEta <= 0) {
        clearTimer()
        displayEtaSeconds.value = undefined
      } else {
        startTimer(newEta)
      }
    },
    { immediate: true },
  )

  // AC3: Clean up the timer on component unmount.
  onUnmounted(() => {
    clearTimer()
  })

  return { displayEtaSeconds }
}

/**
 * An ETA entry with sample and job countdown values.
 */
interface EtaEntry {
  sampleSeconds: number | undefined
  jobSeconds: number | undefined
}

/**
 * Composable that manages countdown interpolation for a map of job ETAs.
 *
 * Designed for components that display multiple job progress entries, each
 * with sample and job ETAs. Watches the given jobProgress record and maintains
 * separate per-job countdown timers for both sample and job ETAs. All timers
 * are cleaned up on component unmount.
 *
 * @param jobProgressRef - Reactive reference to the job progress map.
 *   The map is keyed by job ID and each entry may have sample_eta_seconds and
 *   job_eta_seconds fields.
 * @returns
 *   - getDisplaySampleEta(jobId) - Returns the locally-interpolated sample ETA
 *     in seconds for the given job, or undefined if not available.
 *   - getDisplayJobEta(jobId) - Returns the locally-interpolated job ETA in
 *     seconds for the given job, or undefined if not available.
 */
export function useJobEtaCountdowns(
  jobProgressRef: Ref<Record<string, {
    sample_eta_seconds?: number
    job_eta_seconds?: number
  }> | undefined>,
) {
  /** Per-job countdown display values. */
  const displayEtas = ref<Record<string, EtaEntry>>({})

  /** Per-job interval IDs for sample ETAs. */
  const sampleIntervals: Record<string, ReturnType<typeof setInterval>> = {}
  /** Per-job interval IDs for job ETAs. */
  const jobIntervals: Record<string, ReturnType<typeof setInterval>> = {}

  function clearSampleTimer(jobId: string) {
    if (sampleIntervals[jobId] !== undefined) {
      clearInterval(sampleIntervals[jobId])
      delete sampleIntervals[jobId]
    }
  }

  function clearJobTimer(jobId: string) {
    if (jobIntervals[jobId] !== undefined) {
      clearInterval(jobIntervals[jobId])
      delete jobIntervals[jobId]
    }
  }

  function clearAllTimers() {
    for (const key of Object.keys(sampleIntervals)) {
      clearSampleTimer(key)
    }
    for (const key of Object.keys(jobIntervals)) {
      clearJobTimer(key)
    }
  }

  function getEntry(jobId: string): EtaEntry {
    return displayEtas.value[jobId] ?? { sampleSeconds: undefined, jobSeconds: undefined }
  }

  function setEntry(jobId: string, entry: EtaEntry) {
    displayEtas.value = { ...displayEtas.value, [jobId]: entry }
  }

  function startSampleTimer(jobId: string, initialSeconds: number) {
    clearSampleTimer(jobId)
    setEntry(jobId, { ...getEntry(jobId), sampleSeconds: initialSeconds })
    sampleIntervals[jobId] = setInterval(() => {
      const current = displayEtas.value[jobId]?.sampleSeconds
      if (current !== undefined && current > 0) {
        setEntry(jobId, { ...getEntry(jobId), sampleSeconds: current - 1 })
      } else {
        clearSampleTimer(jobId)
        setEntry(jobId, { ...getEntry(jobId), sampleSeconds: undefined })
      }
    }, 1000)
  }

  function startJobTimer(jobId: string, initialSeconds: number) {
    clearJobTimer(jobId)
    setEntry(jobId, { ...getEntry(jobId), jobSeconds: initialSeconds })
    jobIntervals[jobId] = setInterval(() => {
      const current = displayEtas.value[jobId]?.jobSeconds
      if (current !== undefined && current > 0) {
        setEntry(jobId, { ...getEntry(jobId), jobSeconds: current - 1 })
      } else {
        clearJobTimer(jobId)
        setEntry(jobId, { ...getEntry(jobId), jobSeconds: undefined })
      }
    }, 1000)
  }

  // AC1 + AC2: Watch the jobProgress map for ETA changes and reset countdowns.
  watch(
    jobProgressRef,
    (progress) => {
      if (!progress) return

      const incomingKeys = new Set(Object.keys(progress))

      // Handle keys present in the incoming progress
      for (const jobId of incomingKeys) {
        const entry = progress[jobId]

        // Sample ETA
        const serverSampleEta = entry?.sample_eta_seconds
        if (serverSampleEta !== undefined && serverSampleEta > 0) {
          const currentDisplay = displayEtas.value[jobId]?.sampleSeconds
          // Reset the timer when the server value changes significantly (new push arrived)
          if (currentDisplay === undefined || Math.abs(serverSampleEta - currentDisplay) > 1) {
            startSampleTimer(jobId, serverSampleEta)
          }
        } else {
          clearSampleTimer(jobId)
          if (displayEtas.value[jobId]?.sampleSeconds !== undefined) {
            setEntry(jobId, { ...getEntry(jobId), sampleSeconds: undefined })
          }
        }

        // Job ETA
        const serverJobEta = entry?.job_eta_seconds
        if (serverJobEta !== undefined && serverJobEta > 0) {
          const currentDisplay = displayEtas.value[jobId]?.jobSeconds
          if (currentDisplay === undefined || Math.abs(serverJobEta - currentDisplay) > 1) {
            startJobTimer(jobId, serverJobEta)
          }
        } else {
          clearJobTimer(jobId)
          if (displayEtas.value[jobId]?.jobSeconds !== undefined) {
            setEntry(jobId, { ...getEntry(jobId), jobSeconds: undefined })
          }
        }
      }

      // Clean up timers for jobs no longer in progress
      for (const jobId of Object.keys(displayEtas.value)) {
        if (!incomingKeys.has(jobId)) {
          clearSampleTimer(jobId)
          clearJobTimer(jobId)
          const updated = { ...displayEtas.value }
          delete updated[jobId]
          displayEtas.value = updated
        }
      }
    },
    { immediate: true, deep: true },
  )

  // AC3: Clean up all timers on component unmount.
  onUnmounted(() => {
    clearAllTimers()
  })

  /** Get the locally-interpolated sample ETA in seconds for the given job. */
  function getDisplaySampleEta(jobId: string): number | undefined {
    return displayEtas.value[jobId]?.sampleSeconds
  }

  /** Get the locally-interpolated job ETA in seconds for the given job. */
  function getDisplayJobEta(jobId: string): number | undefined {
    return displayEtas.value[jobId]?.jobSeconds
  }

  return { getDisplaySampleEta, getDisplayJobEta }
}
