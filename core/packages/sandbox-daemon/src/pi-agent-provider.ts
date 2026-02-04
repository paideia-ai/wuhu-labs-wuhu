import type {
  SandboxDaemonAbortRequest,
  SandboxDaemonAgentEvent,
  SandboxDaemonPromptRequest,
} from './types.ts'
import type { AgentProvider } from './agent-provider.ts'

export interface PiTransport {
  start(): Promise<void>
  stop(): Promise<void>
  send(line: string): Promise<void>
  onLine(handler: (line: string) => void): () => void
}

export interface ProcessPiTransportOptions {
  command?: string
  args?: string[]
  cwd?: string
  /**
   * Environment overrides passed to the Pi process.
   * Only the provided keys are set/overridden; other env vars are inherited.
   */
  env?: Record<string, string>
}

export class ProcessPiTransport implements PiTransport {
  #command: string
  #args: string[]
  #cwd?: string
  #env?: Record<string, string>
  #child?: Deno.ChildProcess
  #writer?: WritableStreamDefaultWriter<Uint8Array>
  #handlers = new Set<(line: string) => void>()
  #encoder = new TextEncoder()
  #decoder = new TextDecoder()

  constructor(
    command = 'pi',
    args: string[] = ['--mode', 'rpc'],
    options: Omit<ProcessPiTransportOptions, 'command' | 'args'> = {},
  ) {
    this.#command = command
    this.#args = args
    this.#cwd = options.cwd
    this.#env = options.env
  }

  start(): Promise<void> {
    if (this.#child) {
      return Promise.resolve()
    }
    const cmd = new Deno.Command(this.#command, {
      args: this.#args,
      cwd: this.#cwd,
      env: this.#env,
      stdin: 'piped',
      stdout: 'piped',
      stderr: 'inherit',
    })
    const child = cmd.spawn()
    this.#child = child
    const writer = child.stdin.getWriter()
    this.#writer = writer
    const reader = child.stdout.getReader()

    let buffer = ''
    ;(async () => {
      try {
        while (true) {
          const { value, done } = await reader.read()
          if (done) break
          buffer += this.#decoder.decode(value, { stream: true })
          while (true) {
            const idx = buffer.indexOf('\n')
            if (idx === -1) break
            const line = buffer.slice(0, idx)
            buffer = buffer.slice(idx + 1)
            for (const handler of this.#handlers) {
              handler(line)
            }
          }
        }
      } catch {
        // Ignore read errors; process exit will be handled separately.
      } finally {
        reader.releaseLock()
      }
    })()
    return Promise.resolve()
  }

  async send(line: string): Promise<void> {
    if (!this.#writer) {
      throw new Error('Pi transport not started')
    }
    const data = this.#encoder.encode(line + '\n')
    await this.#writer.write(data)
  }

  onLine(handler: (line: string) => void): () => void {
    this.#handlers.add(handler)
    return () => {
      this.#handlers.delete(handler)
    }
  }

  async stop(): Promise<void> {
    if (this.#writer) {
      await this.#writer.close()
      this.#writer = undefined
    }
    if (this.#child) {
      try {
        this.#child.kill('SIGTERM')
      } catch {
        // Ignore kill errors (e.g., already exited).
      }
      this.#child = undefined
    }
    this.#handlers.clear()
  }
}

export interface PiAgentProviderOptions {
  transport?: PiTransport
  command?: string
  args?: string[]
  cwd?: string
  env?: Record<string, string>
}

export class PiAgentProvider implements AgentProvider {
  #transport: PiTransport
  #handlers = new Set<(event: SandboxDaemonAgentEvent) => void>()
  #pending = new Map<
    string,
    {
      resolve: (value: unknown) => void
      reject: (reason?: unknown) => void
      timeoutId: number
    }
  >()
  #requestCounter = 0
  #responseTimeoutMs = 5000

  constructor(options: PiAgentProviderOptions = {}) {
    const transport = options.transport ??
      new ProcessPiTransport(
        options.command,
        options.args,
        { cwd: options.cwd, env: options.env },
      )
    this.#transport = transport
  }

  async start(): Promise<void> {
    await this.#transport.start()
    this.#transport.onLine((line) => {
      this.#handleLine(line)
    })
  }

  async stop(): Promise<void> {
    await this.#transport.stop()
    this.#handlers.clear()
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timeoutId)
      pending.reject(new Error('Pi transport stopped'))
    }
    this.#pending.clear()
  }

  async sendPrompt(request: SandboxDaemonPromptRequest): Promise<void> {
    const cmd: Record<string, unknown> = {
      type: 'prompt',
      message: request.message,
    }
    if (request.images) {
      cmd.images = request.images
    }
    if (request.streamingBehavior) {
      cmd.streamingBehavior = request.streamingBehavior
    }
    await this.#transport.send(JSON.stringify(cmd))
  }

  async abort(_request?: SandboxDaemonAbortRequest): Promise<void> {
    const cmd = { type: 'abort' as const }
    await this.#transport.send(JSON.stringify(cmd))
  }

  async getState(): Promise<{ sessionFile?: string | null } | null> {
    const response = await this.#sendCommand({ type: 'get_state' })
    if (!response || typeof response !== 'object') return null
    const responseObj = response as {
      type?: string
      success?: boolean
      data?: unknown
    }
    if (responseObj.type !== 'response' || responseObj.success !== true) {
      return null
    }
    const data = responseObj.data as { sessionFile?: unknown } | undefined
    const sessionFile = data && typeof data.sessionFile === 'string'
      ? data.sessionFile
      : null
    return { sessionFile }
  }

  onEvent(handler: (event: SandboxDaemonAgentEvent) => void): () => void {
    this.#handlers.add(handler)
    return () => {
      this.#handlers.delete(handler)
    }
  }

  #handleLine(line: string): void {
    const trimmed = line.trim()
    if (!trimmed) return
    let parsed: { type?: string; [key: string]: unknown }
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      return
    }
    if (parsed.type === 'response') {
      const id = typeof parsed.id === 'string' ? parsed.id : undefined
      if (id && this.#pending.has(id)) {
        const pending = this.#pending.get(id)!
        clearTimeout(pending.timeoutId)
        this.#pending.delete(id)
        pending.resolve(parsed)
      }
      // Ignore command responses for Protocol 0.
      return
    }
    const type = typeof parsed.type === 'string' ? parsed.type : 'unknown'
    const event: SandboxDaemonAgentEvent = {
      source: 'agent',
      type,
      payload: {
        ...parsed,
        type,
      },
    }
    for (const handler of this.#handlers) {
      handler(event)
    }
  }

  async #sendCommand(command: Record<string, unknown>): Promise<unknown> {
    const id = `req-${Date.now()}-${this.#requestCounter++}`
    const payload = { id, ...command }
    const response = new Promise<unknown>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.#pending.delete(id)
        reject(new Error('Pi command timed out'))
      }, this.#responseTimeoutMs)
      this.#pending.set(id, { resolve, reject, timeoutId })
    })
    await this.#transport.send(JSON.stringify(payload))
    return await response
  }
}
