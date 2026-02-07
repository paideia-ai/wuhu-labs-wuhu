import { useCallback, useMemo, useSyncExternalStore } from 'react'
import { MockSession } from './mock-session.ts'
import type { AgentStyle, SessionSnapshot } from './types.ts'

export function useMockSession(style: AgentStyle): {
  snapshot: SessionSnapshot
  sendMessage: (text: string) => void
  interrupt: () => void
  setQueueMode: (mode: 'steer' | 'followUp') => void
} {
  // Stable session instance per style — recreated when style changes
  const session = useMemo(() => new MockSession(style), [style])

  const snapshot = useSyncExternalStore(
    useCallback((cb: () => void) => session.subscribe(cb), [session]),
    useCallback(() => session.getSnapshot(), [session]),
  )

  const sendMessage = useCallback(
    (text: string) => session.sendMessage(text),
    [session],
  )

  const interrupt = useCallback(() => session.interrupt(), [session])

  const setQueueMode = useCallback(
    (mode: 'steer' | 'followUp') => session.setQueueMode(mode),
    [session],
  )

  return { snapshot, sendMessage, interrupt, setQueueMode }
}
