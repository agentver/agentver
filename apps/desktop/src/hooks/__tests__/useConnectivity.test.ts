import { act, renderHook, waitFor } from '@testing-library/react'
import { mockFetch, resetAllTauriMocks } from '../../__mocks__/tauri'
import { DEFAULT_PLATFORM_URL } from '../../lib/config'
import { useConnectivity } from '../useConnectivity'

// Mock the auth module
const mockGetAuthData = vi.fn()
vi.mock('../../lib/auth', () => ({
  getAuthData: () => mockGetAuthData(),
}))

beforeEach(() => {
  resetAllTauriMocks()
  mockGetAuthData.mockReset()
  mockGetAuthData.mockResolvedValue({
    platformUrl: DEFAULT_PLATFORM_URL,
  })
  vi.useFakeTimers({ shouldAdvanceTime: true })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useConnectivity', () => {
  it('starts with offline status', () => {
    // Prevent the initial health check from resolving
    mockFetch.mockReturnValue(new Promise(() => {}))

    const { result } = renderHook(() => useConnectivity())

    expect(result.current.status).toBe('offline')
  })

  it('transitions to connected on successful health check', async () => {
    mockFetch.mockResolvedValue({ ok: true })

    const { result } = renderHook(() => useConnectivity())

    await waitFor(() => {
      expect(result.current.status).toBe('reconnecting')
    })

    // Advance past the reconnecting timeout
    act(() => {
      vi.advanceTimersByTime(3000)
    })

    expect(result.current.status).toBe('connected')
  })

  it('transitions to offline on failed health check', async () => {
    mockFetch.mockRejectedValue(new Error('Network error'))

    const { result } = renderHook(() => useConnectivity())

    await waitFor(() => {
      expect(result.current.status).toBe('offline')
    })
  })

  it('shows reconnecting briefly when recovering from offline', async () => {
    // First check fails (offline)
    mockFetch.mockRejectedValueOnce(new Error('Network error'))

    const { result } = renderHook(() => useConnectivity())

    await waitFor(() => {
      expect(result.current.status).toBe('offline')
    })

    // Next check succeeds — should show reconnecting first
    mockFetch.mockResolvedValue({ ok: true })

    // Trigger the interval check
    await act(async () => {
      vi.advanceTimersByTime(30_000)
    })

    await waitFor(() => {
      expect(result.current.status).toBe('reconnecting')
    })

    // After 3 seconds, settles to connected
    act(() => {
      vi.advanceTimersByTime(3000)
    })

    expect(result.current.status).toBe('connected')
  })

  it('stays offline on non-ok response', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 503 })

    const { result } = renderHook(() => useConnectivity())

    await waitFor(() => {
      expect(result.current.status).toBe('offline')
    })
  })

  it('uses default platform URL when auth data has none', async () => {
    mockGetAuthData.mockResolvedValue(null)
    mockFetch.mockResolvedValue({ ok: true })

    renderHook(() => useConnectivity())

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        `${DEFAULT_PLATFORM_URL}/api/v1/health`,
        expect.objectContaining({ method: 'HEAD' })
      )
    })
  })

  it('exposes checkConnectivity for manual re-checks', async () => {
    mockFetch.mockRejectedValue(new Error('Offline'))

    const { result } = renderHook(() => useConnectivity())

    await waitFor(() => {
      expect(result.current.status).toBe('offline')
    })

    // Now network is back
    mockFetch.mockResolvedValue({ ok: true })

    await act(async () => {
      await result.current.checkConnectivity()
    })

    await waitFor(() => {
      expect(
        result.current.status === 'reconnecting' || result.current.status === 'connected'
      ).toBe(true)
    })
  })
})
