/**
 * Default platform URL for the desktop app.
 *
 * Override at build time via the VITE_PLATFORM_URL environment variable,
 * or at runtime via the "Advanced" section on the login screen
 * (persisted to the Tauri auth store).
 */
export const DEFAULT_PLATFORM_URL = import.meta.env.VITE_PLATFORM_URL ?? 'https://app.agentver.com'
