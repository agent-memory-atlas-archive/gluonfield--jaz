import { createContext } from 'react'

// A page that brings its own chrome, like a canvas thread, hides the app's
// titlebar, rail and thread list while it is mounted.
export const AppChrome = createContext<((hidden: boolean) => void) | null>(null)
