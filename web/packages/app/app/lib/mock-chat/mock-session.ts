import type {
  AgentBlockEntry,
  AgentBlockItem,
  AgentStyle,
  CustomEntry,
  HistoryEntry,
  QueuedMessage,
  Session,
  SessionSnapshot,
} from './types.ts'
import {
  randomAssistantFragment,
  randomExplorationToolCalls,
  randomFinalSummary,
  randomReasoningSummary,
} from './fragments.ts'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let nextId = 1
function uid(): string {
  return `mock-${nextId++}`
}

function now(): number {
  return Date.now()
}

// ---------------------------------------------------------------------------
// MockSession
// ---------------------------------------------------------------------------

export class MockSession implements Session {
  private _snapshot: SessionSnapshot
  private _listeners = new Set<() => void>()
  private _style: AgentStyle
  private _streamTimer: ReturnType<typeof setTimeout> | null = null
  private _turnTimer: ReturnType<typeof setTimeout> | null = null
  private _aborted = false

  // Pending work queue for the current generation
  private _pendingWork: (() => Promise<void>)[] = []
  private _working = false

  constructor(style: AgentStyle) {
    this._style = style
    this._snapshot = {
      history: [],
      streamingMessage: null,
      isGenerating: false,
      queueMode: 'followUp',
      steerQueue: [],
      followUpQueue: [],
    }
  }

  // ---- Session interface ----

  subscribe(callback: () => void): () => void {
    this._listeners.add(callback)
    return () => {
      this._listeners.delete(callback)
    }
  }

  getSnapshot(): SessionSnapshot {
    return this._snapshot
  }

  sendMessage(text: string): void {
    const msg: QueuedMessage = { id: uid(), text, timestamp: now() }
    if (this._snapshot.isGenerating) {
      // Queue it
      if (this._snapshot.queueMode === 'steer') {
        this._update({ steerQueue: [...this._snapshot.steerQueue, msg] })
      } else {
        this._update({ followUpQueue: [...this._snapshot.followUpQueue, msg] })
      }
    } else {
      // Start new generation
      this._startGeneration(text)
    }
  }

  interrupt(): void {
    if (!this._snapshot.isGenerating) return
    this._aborted = true
    this._clearTimers()

    // Finalize any streaming message into the current agent block
    this._finalizeStreaming()

    // Close the current agent block
    this._closeCurrentAgentBlock()

    // Add interruption entry
    const entry: CustomEntry = {
      type: 'custom',
      id: uid(),
      customType: 'interruption',
      content: 'Generation interrupted',
      timestamp: now(),
    }
    this._update({
      history: [...this._snapshot.history, entry],
      isGenerating: false,
      streamingMessage: null,
    })

    this._aborted = false
    this._working = false
    this._pendingWork = []
  }

  setQueueMode(mode: 'steer' | 'followUp'): void {
    if (mode !== this._snapshot.queueMode) {
      this._update({ queueMode: mode })
    }
  }

  // ---- Internal ----

  private _notify(): void {
    for (const fn of this._listeners) fn()
  }

  private _update(partial: Partial<SessionSnapshot>): void {
    this._snapshot = { ...this._snapshot, ...partial }
    this._notify()
  }

  private _clearTimers(): void {
    if (this._streamTimer !== null) {
      clearTimeout(this._streamTimer)
      this._streamTimer = null
    }
    if (this._turnTimer !== null) {
      clearTimeout(this._turnTimer)
      this._turnTimer = null
    }
  }

  // ---- Generation pipeline ----

  private _startGeneration(userText: string): void {
    // Add user message + agent-start
    const userEntry: HistoryEntry = {
      type: 'user-message',
      id: uid(),
      text: userText,
      timestamp: now(),
    }
    const agentStart: CustomEntry = {
      type: 'custom',
      id: uid(),
      customType: 'agent-start',
      content: '',
      timestamp: now(),
    }
    const blockId = uid()
    const agentBlock: AgentBlockEntry = {
      type: 'agent-block',
      id: blockId,
      items: [],
      startedAt: now(),
      endedAt: null,
    }

    this._update({
      history: [...this._snapshot.history, userEntry, agentStart, agentBlock],
      isGenerating: true,
    })

    this._aborted = false
    this._runGeneration()
  }

  private async _runGeneration(): Promise<void> {
    if (this._working) return
    this._working = true

    // Decide how many tool-call turns.
    // Bias slightly against 0-turn generations so we usually
    // exercise the tool-call UI, but still allow them sometimes.
    const rand = Math.random()
    const numTurns = rand < 0.15 ? 0 : 1 + Math.floor(Math.random() * 4)

    for (let t = 0; t < numTurns; t++) {
      if (this._aborted) break

      // Check for steer messages after each turn
      if (t > 0 && this._snapshot.steerQueue.length > 0) {
        await this._consumeSteerMessages()
        if (this._aborted) break
      }

      // Emit assistant message (anthropic) or reasoning summary (openai)
      if (this._style === 'anthropic') {
        await this._streamAssistantMessage(randomAssistantFragment())
      } else {
        this._appendToAgentBlock({
          type: 'reasoning-summary',
          id: uid(),
          content: randomReasoningSummary(),
          timestamp: now(),
        })
        await this._delay(200)
      }

      if (this._aborted) break

      // Emit tool calls + results
      const numTools = 1 + Math.floor(Math.random() * 4)
      const toolCalls = randomExplorationToolCalls(numTools)

      for (const tc of toolCalls) {
        if (this._aborted) break
        const callId = uid()
        this._appendToAgentBlock({
          type: 'tool-call',
          id: callId,
          toolName: tc.toolName,
          args: tc.args,
          timestamp: now(),
        })
        // Tool result comes after a small delay
        await this._delay(100 + Math.random() * 200)
        if (this._aborted) break
        this._appendToAgentBlock({
          type: 'tool-result',
          id: uid(),
          toolCallId: callId,
          toolName: tc.toolName,
          isError: Math.random() < 0.05,
          timestamp: now(),
        })
      }
    }

    if (!this._aborted) {
      // Final summary message (always streamed)
      await this._streamAssistantMessage(randomFinalSummary())
    }

    if (!this._aborted) {
      // Close agent block + add agent-end
      this._closeCurrentAgentBlock()
      const agentEnd: CustomEntry = {
        type: 'custom',
        id: uid(),
        customType: 'agent-end',
        content: '',
        timestamp: now(),
      }
      this._update({
        history: [...this._snapshot.history, agentEnd],
      })

      // Check for follow-up messages
      if (this._snapshot.followUpQueue.length > 0) {
        await this._consumeFollowUpMessages()
      } else {
        this._update({ isGenerating: false })
      }
    }

    this._working = false
  }

  private async _consumeSteerMessages(): Promise<void> {
    const steers = this._snapshot.steerQueue
    if (steers.length === 0) return

    // Finish the current agent block so it gets a proper
    // Worked for ... duration label.
    this._finalizeStreaming()
    this._closeCurrentAgentBlock()
    const agentEnd: CustomEntry = {
      type: 'custom',
      id: uid(),
      customType: 'agent-end',
      content: '',
      timestamp: now(),
    }

    const historyWithEnd = [...this._snapshot.history, agentEnd]

    // Flush all queued steers at once into the history as
    // user messages, then start a fresh agent block that
    // continues work under the new guidance.
    const steerEntries: HistoryEntry[] = steers.map((steer) => ({
      type: 'user-message',
      id: uid(),
      text: `[Steer] ${steer.text}`,
      timestamp: now(),
    }))

    const agentStart: CustomEntry = {
      type: 'custom',
      id: uid(),
      customType: 'agent-start',
      content: '',
      timestamp: now(),
    }

    const agentBlock: AgentBlockEntry = {
      type: 'agent-block',
      id: uid(),
      items: [],
      startedAt: now(),
      endedAt: null,
    }

    this._update({
      history: [...historyWithEnd, ...steerEntries, agentStart, agentBlock],
      steerQueue: [],
    })

    // Generate a quick response to the steer batch
    await this._streamAssistantMessage(
      `Understood, adjusting my approach based on your feedback. Let me re-examine the relevant code.`,
    )
  }

  private async _consumeFollowUpMessages(): Promise<void> {
    const followUps = this._snapshot.followUpQueue
    if (followUps.length === 0) return

    const followUp = followUps[0]
    this._update({ followUpQueue: followUps.slice(1) })

    // Start fresh generation for the follow-up. The previous
    // generation already closed its agent block and emitted
    // an agent-end marker, so we don't emit another one here
    // to avoid duplicate "Worked for ..." labels.
    this._working = false
    this._startGeneration(followUp.text)
  }

  // ---- Agent block manipulation ----

  private _getCurrentAgentBlock(): AgentBlockEntry | null {
    const history = this._snapshot.history
    for (let i = history.length - 1; i >= 0; i--) {
      if (history[i].type === 'agent-block') {
        return history[i] as AgentBlockEntry
      }
    }
    return null
  }

  private _appendToAgentBlock(item: AgentBlockItem): void {
    const block = this._getCurrentAgentBlock()
    if (!block) return

    const newBlock: AgentBlockEntry = {
      ...block,
      items: [...block.items, item],
    }
    const history = this._snapshot.history.map((e) =>
      e === block ? newBlock : e
    )
    this._update({ history })
  }

  private _closeCurrentAgentBlock(): void {
    const block = this._getCurrentAgentBlock()
    if (!block || block.endedAt !== null) return

    const closed: AgentBlockEntry = { ...block, endedAt: now() }
    const history = this._snapshot.history.map((e) => e === block ? closed : e)
    this._update({ history })
  }

  // ---- Streaming ----

  private _finalizeStreaming(): void {
    const sm = this._snapshot.streamingMessage
    if (!sm) return

    this._appendToAgentBlock({
      type: 'assistant-message',
      id: sm.id,
      content: sm.content,
      timestamp: now(),
    })
    this._update({ streamingMessage: null })
  }

  private _streamAssistantMessage(fullText: string): Promise<void> {
    return new Promise<void>((resolve) => {
      if (this._aborted) {
        resolve()
        return
      }

      const id = uid()
      let pos = 0
      // Stream in chunks of 2-5 characters
      const chunkSize = () => 2 + Math.floor(Math.random() * 4)

      this._update({
        streamingMessage: { id, content: '' },
      })

      const tick = () => {
        if (this._aborted) {
          resolve()
          return
        }

        const end = Math.min(pos + chunkSize(), fullText.length)
        const content = fullText.slice(0, end)
        pos = end

        this._update({
          streamingMessage: { id, content },
        })

        if (pos >= fullText.length) {
          // Streaming done — fold into agent block
          this._appendToAgentBlock({
            type: 'assistant-message',
            id,
            content: fullText,
            timestamp: now(),
          })
          this._update({ streamingMessage: null })
          resolve()
        } else {
          this._streamTimer = setTimeout(tick, 20 + Math.random() * 20)
        }
      }

      this._streamTimer = setTimeout(tick, 50)
    })
  }

  // ---- Util ----

  private _delay(ms: number): Promise<void> {
    return new Promise((resolve) => {
      this._turnTimer = setTimeout(() => {
        resolve()
      }, ms)
    })
  }
}
