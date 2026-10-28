/** Shared React contexts of the terminal app (kept apart to avoid import cycles). */

import { createContext, useContext } from 'react'

/** Engine calls, what is set up, navigation (see app.mjs). */
export const AppContext = createContext(null)
export const useAppCtx = () => useContext(AppContext)

/** Count of active text fields: single keys like "?" are then typed, not taken as shortcuts. */
export const TypingContext = createContext({ current: 0 })
