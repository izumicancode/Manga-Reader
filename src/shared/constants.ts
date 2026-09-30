import type { Prefs } from './types'

export const DEFAULT_PREFS: Prefs = {
  theme: 'dark',
  accentColor: '#e0555a',
  cardSize: 'medium',
  readingDirection: 'ltr',
  defaultFit: 'contain',
  toolbarAutoHide: true,
  toolbarHideDelay: 2500,
  animationsEnabled: true
}
export const PREF_KEYS = Object.keys(DEFAULT_PREFS) as (keyof Prefs)[]
