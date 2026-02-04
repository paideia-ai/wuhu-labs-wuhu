import type { AgentProvider } from './agent-provider.ts'
import type {
  SandboxDaemonAbortRequest,
  SandboxDaemonAgentEvent,
  SandboxDaemonPromptRequest,
} from './types.ts'

export interface LazyAgentProviderFactory<TProvider extends AgentProvider> {
  create(revision: number): TProvider
  getRevision(): number
}

/**
 * A small wrapper that instantiates the underlying provider lazily and can
 * restart it when the factory revision changes (e.g., credentials updated).
 */
export class LazyAgentProvider implements AgentProvider {
  #factory: LazyAgentProviderFactory<AgentProvider>
  #provider?: AgentProvider
  #providerRevision = -1
  #eventHandlers = new Set<(event: SandboxDaemonAgentEvent) => void>()
  #unsubscribeFromProvider?: () => void
  #started = false

  constructor(factory: LazyAgentProviderFactory<AgentProvider>) {
    this.#factory = factory
  }

  async start(): Promise<void> {
    this.#started = true
    await this.#ensureProvider()
  }

  async stop(): Promise<void> {
    this.#started = false
    this.#unsubscribeFromProvider?.()
    this.#unsubscribeFromProvider = undefined
    if (this.#provider) {
      await this.#provider.stop()
      this.#provider = undefined
    }
  }

  async sendPrompt(request: SandboxDaemonPromptRequest): Promise<void> {
    if (!this.#started) {
      await this.start()
    } else {
      await this.#ensureProvider()
    }
    await this.#provider!.sendPrompt(request)
  }

  async abort(request?: SandboxDaemonAbortRequest): Promise<void> {
    if (!this.#provider) return
    await this.#provider.abort(request)
  }

  async getState() {
    if (!this.#provider || !this.#provider.getState) return null
    return await this.#provider.getState()
  }

  onEvent(handler: (event: SandboxDaemonAgentEvent) => void): () => void {
    this.#eventHandlers.add(handler)
    return () => {
      this.#eventHandlers.delete(handler)
    }
  }

  async #ensureProvider(): Promise<void> {
    const revision = this.#factory.getRevision()
    const needsCreate = !this.#provider
    const needsRestart = this.#provider && this.#providerRevision !== revision

    if (!needsCreate && !needsRestart) return

    if (this.#provider) {
      this.#unsubscribeFromProvider?.()
      this.#unsubscribeFromProvider = undefined
      await this.#provider.stop()
      this.#provider = undefined
    }

    const provider = this.#factory.create(revision)
    this.#provider = provider
    this.#providerRevision = revision
    this.#unsubscribeFromProvider = provider.onEvent((event) => {
      for (const handler of this.#eventHandlers) {
        handler(event)
      }
    })
    if (this.#started) {
      await provider.start()
    }
  }
}
