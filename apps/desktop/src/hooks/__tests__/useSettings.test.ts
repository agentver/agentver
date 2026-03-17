import { act, renderHook, waitFor } from '@testing-library/react'
import {
  mockStoreGet,
  mockStoreSave,
  mockStoreSet,
  resetAllTauriMocks,
} from '../../__mocks__/tauri'
import { useSettings } from '../useSettings'

beforeEach(() => {
  resetAllTauriMocks()
})

describe('useSettings', () => {
  it('returns default settings on first load', async () => {
    mockStoreGet.mockResolvedValue(null)

    const { result } = renderHook(() => useSettings())

    // Initially loading
    expect(result.current.loading).toBe(true)
    expect(result.current.settings).toEqual({
      theme: 'system',
      defaultScope: 'project',
      auditEnabled: true,
      blockSeverity: 'high',
    })

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    // Still defaults after loading completes (no stored data)
    expect(result.current.settings).toEqual({
      theme: 'system',
      defaultScope: 'project',
      auditEnabled: true,
      blockSeverity: 'high',
    })
  })

  it('loads persisted settings from store', async () => {
    mockStoreGet.mockResolvedValue({
      theme: 'dark',
      defaultScope: 'global',
      auditEnabled: false,
      blockSeverity: 'critical',
    })

    const { result } = renderHook(() => useSettings())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.settings).toEqual({
      theme: 'dark',
      defaultScope: 'global',
      auditEnabled: false,
      blockSeverity: 'critical',
    })
  })

  it('merges partial stored settings with defaults', async () => {
    mockStoreGet.mockResolvedValue({
      theme: 'light',
    })

    const { result } = renderHook(() => useSettings())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.settings).toEqual({
      theme: 'light',
      defaultScope: 'project',
      auditEnabled: true,
      blockSeverity: 'high',
    })
  })

  it('updateTheme persists to store', async () => {
    mockStoreGet.mockResolvedValue(null)

    const { result } = renderHook(() => useSettings())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    act(() => {
      result.current.updateTheme('dark')
    })

    expect(result.current.settings.theme).toBe('dark')
    await waitFor(() => {
      expect(mockStoreSet).toHaveBeenCalledWith(
        'settings',
        expect.objectContaining({ theme: 'dark' })
      )
    })
    expect(mockStoreSave).toHaveBeenCalled()
  })

  it('updateDefaultScope persists to store', async () => {
    mockStoreGet.mockResolvedValue(null)

    const { result } = renderHook(() => useSettings())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    act(() => {
      result.current.updateDefaultScope('global')
    })

    expect(result.current.settings.defaultScope).toBe('global')
    await waitFor(() => {
      expect(mockStoreSet).toHaveBeenCalledWith(
        'settings',
        expect.objectContaining({ defaultScope: 'global' })
      )
    })
    expect(mockStoreSave).toHaveBeenCalled()
  })

  it('updateAuditEnabled persists to store', async () => {
    mockStoreGet.mockResolvedValue(null)

    const { result } = renderHook(() => useSettings())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    act(() => {
      result.current.updateAuditEnabled(false)
    })

    expect(result.current.settings.auditEnabled).toBe(false)
    await waitFor(() => {
      expect(mockStoreSet).toHaveBeenCalledWith(
        'settings',
        expect.objectContaining({ auditEnabled: false })
      )
    })
    expect(mockStoreSave).toHaveBeenCalled()
  })

  it('updateBlockSeverity persists to store', async () => {
    mockStoreGet.mockResolvedValue(null)

    const { result } = renderHook(() => useSettings())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    act(() => {
      result.current.updateBlockSeverity('critical')
    })

    expect(result.current.settings.blockSeverity).toBe('critical')
    await waitFor(() => {
      expect(mockStoreSet).toHaveBeenCalledWith(
        'settings',
        expect.objectContaining({ blockSeverity: 'critical' })
      )
    })
    expect(mockStoreSave).toHaveBeenCalled()
  })
})
