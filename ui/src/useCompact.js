// One signal, two consumers: CSS gets it as a data attribute on .app, and the
// few things CSS cannot do (which view opens by default, whether the sheet
// exists at all) read the boolean. Keeping both on one matchMedia means they
// can never disagree about what "compact" is.

import { useEffect, useState } from 'react'

export const COMPACT_QUERY = '(max-width: 860px)'

export function useCompact() {
  const [compact, setCompact] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(COMPACT_QUERY).matches
      : false)

  useEffect(() => {
    // Guard the absence of matchMedia, not its presence: with `===` here the
    // subscription never runs and the value is frozen at first render, so a
    // rotate or a resize is never noticed.
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const mq = window.matchMedia(COMPACT_QUERY)
    const onChange = (e) => setCompact(e.matches)
    setCompact(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  return compact
}
