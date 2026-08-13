import { createContext, type ReactNode, use, useEffect, useState } from 'react'

export type ThemePreference = 'light' | 'dark' | 'system'

const STORAGE_KEY = 'catatmd.theme'

interface ThemeContextValue {
  preference: ThemePreference
  resolved: 'light' | 'dark'
  setPreference: (next: ThemePreference) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

const systemPrefersDark = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches

/**
 * Light is the default, not the operating system's preference.
 *
 * A clinical tool that flips to dark because a doctor's laptop is in night mode
 * is making a legibility decision on their behalf, and every severity contrast
 * ratio in docs/DESIGN.md was derived against the light ground first. Dark is
 * offered, never assumed. `system` remains selectable, just not the default.
 */
const readStored = (): ThemePreference => {
  if (typeof window === 'undefined') return 'light'
  const stored = window.localStorage.getItem(STORAGE_KEY)
  return stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'light'
}

/**
 * Only ever stores the preference, never anything about the consultation being
 * viewed. `localStorage` is banned for clinical content
 * (`.claude/skills/healthcare-phi-compliance`) and a theme key is the one thing
 * that legitimately belongs there.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>(readStored)
  const [systemDark, setSystemDark] = useState(systemPrefersDark)

  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (event: MediaQueryListEvent) => setSystemDark(event.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])

  const resolved: 'light' | 'dark' =
    preference === 'system' ? (systemDark ? 'dark' : 'light') : preference

  useEffect(() => {
    document.documentElement.dataset.theme = resolved
  }, [resolved])

  const setPreference = (next: ThemePreference) => {
    setPreferenceState(next)
    // Stored even when it is `system`: absence now means "never chose", which
    // resolves to light, so removing the key would silently reset the choice.
    window.localStorage.setItem(STORAGE_KEY, next)
  }

  return <ThemeContext value={{ preference, resolved, setPreference }}>{children}</ThemeContext>
}

export function useTheme() {
  const context = use(ThemeContext)
  if (!context) throw new Error('useTheme must be used inside ThemeProvider')
  return context
}
