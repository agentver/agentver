import { vi } from 'vitest'

// --- @tauri-apps/api/core ---

export const mockInvoke = vi.fn()

vi.mock('@tauri-apps/api/core', () => ({
  invoke: mockInvoke,
}))

// --- @tauri-apps/api/app ---

export const mockGetVersion = vi.fn().mockResolvedValue('0.1.0')

vi.mock('@tauri-apps/api/app', () => ({
  getVersion: mockGetVersion,
}))

// --- @tauri-apps/plugin-store ---

export const mockStoreGet = vi.fn()
export const mockStoreSet = vi.fn().mockResolvedValue(undefined)
export const mockStoreSave = vi.fn().mockResolvedValue(undefined)
export const mockStoreDelete = vi.fn().mockResolvedValue(undefined)

export const mockStoreInstance = {
  get: mockStoreGet,
  set: mockStoreSet,
  save: mockStoreSave,
  delete: mockStoreDelete,
}

export const mockStoreLoad = vi.fn().mockResolvedValue(mockStoreInstance)

vi.mock('@tauri-apps/plugin-store', () => ({
  Store: {
    load: mockStoreLoad,
  },
}))

// --- @tauri-apps/plugin-http ---

export const mockFetch = vi.fn()

vi.mock('@tauri-apps/plugin-http', () => ({
  fetch: mockFetch,
}))

// --- Helper to reset all mocks ---

export function resetAllTauriMocks() {
  mockInvoke.mockReset()
  mockGetVersion.mockReset().mockResolvedValue('0.1.0')
  mockStoreGet.mockReset()
  mockStoreSet.mockReset().mockResolvedValue(undefined)
  mockStoreSave.mockReset().mockResolvedValue(undefined)
  mockStoreDelete.mockReset().mockResolvedValue(undefined)
  mockStoreLoad.mockReset().mockResolvedValue(mockStoreInstance)
  mockFetch.mockReset()
}
