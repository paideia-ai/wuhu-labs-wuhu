import type {
  SandboxDaemonAbortRequest,
  SandboxDaemonAgentEvent,
  SandboxDaemonPromptRequest,
} from './types.ts'

export interface AgentProvider {
  start(): Promise<void>
  stop(): Promise<void>
  sendPrompt(request: SandboxDaemonPromptRequest): Promise<void>
  abort(request?: SandboxDaemonAbortRequest): Promise<void>
  onEvent(handler: (event: SandboxDaemonAgentEvent) => void): () => void
  getState?(): Promise<AgentProviderState | null>
}

export interface AgentProviderState {
  sessionFile?: string | null
  sessionId?: string | null
}

export class FakeAgentProvider implements AgentProvider {
  private handlers = new Set<(event: SandboxDaemonAgentEvent) => void>()

  readonly prompts: SandboxDaemonPromptRequest[] = []
  abortCalls = 0

  start(): Promise<void> {
    // No-op for fake implementation
    return Promise.resolve()
  }

  stop(): Promise<void> {
    this.handlers.clear()
    return Promise.resolve()
  }

  sendPrompt(request: SandboxDaemonPromptRequest): Promise<void> {
    this.prompts.push(request)
    return Promise.resolve()
  }

  abort(_request?: SandboxDaemonAbortRequest): Promise<void> {
    this.abortCalls++
    return Promise.resolve()
  }

  onEvent(handler: (event: SandboxDaemonAgentEvent) => void): () => void {
    this.handlers.add(handler)
    return () => {
      this.handlers.delete(handler)
    }
  }

  emit(event: SandboxDaemonAgentEvent): void {
    for (const handler of this.handlers) {
      handler(event)
    }
  }
}
