export type DashboardSettings = {
  relayUrl: string    // e.g. http://localhost:8080
  appId: string
  token: string
}

export const DEFAULT_SETTINGS: DashboardSettings = {
  relayUrl: 'http://localhost:8080',
  appId: 'default',
  token: '',
}

const KEY = 'nexsync:dashboard:settings'

export function loadSettings(): DashboardSettings {
  if (typeof window === 'undefined') return DEFAULT_SETTINGS
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return DEFAULT_SETTINGS
    return JSON.parse(raw) as DashboardSettings
  } catch {
    return DEFAULT_SETTINGS
  }
}

export function saveSettings(s: DashboardSettings): void {
  if (typeof window !== 'undefined') {
    localStorage.setItem(KEY, JSON.stringify(s))
  }
}
