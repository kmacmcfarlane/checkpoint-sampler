import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock naive-ui's useMessage so registerMessageApi can run outside a real
// <n-message-provider> and we can assert delegation. The ToastRegistrar
// integration test (ToastRegistrar.test.ts) exercises the real provider.
const messageApiMock = {
  error: vi.fn(),
  success: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
}

vi.mock('naive-ui', () => ({
  useMessage: () => messageApiMock,
}))

import { useToast, registerMessageApi, resetMessageApi } from '../useToast'

describe('useToast', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetMessageApi()
  })

  it('is a no-op before the message API is registered (does not throw)', () => {
    const toast = useToast()
    expect(() => toast.error('x')).not.toThrow()
    expect(messageApiMock.error).not.toHaveBeenCalled()
  })

  it.each([
    ['error', 'Failed to stop sample job. Please try again.'],
    ['success', 'Saved'],
    ['warning', 'Careful'],
    ['info', 'Heads up'],
  ] as const)('delegates %s() to the registered message API', (level, content) => {
    registerMessageApi()
    const toast = useToast()
    toast[level](content)
    expect(messageApiMock[level]).toHaveBeenCalledWith(content)
  })

  it('surfaces the job-control failure message that App.vue fires on error', () => {
    // AC: stopJob/resumeJob/retryFailedJob/deleteJob failures show a toast.
    registerMessageApi()
    const toast = useToast()
    toast.error('Failed to delete sample job. Please try again.')
    expect(messageApiMock.error).toHaveBeenCalledWith(
      'Failed to delete sample job. Please try again.',
    )
  })
})
