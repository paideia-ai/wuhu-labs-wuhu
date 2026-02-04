import { Client as MinioClient } from 'minio'
import { Readable } from 'node:stream'
import type { ReadableStream as NodeReadableStream } from 'node:stream/web'

import type { S3RawLogsConfig } from './config.ts'

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isNotFoundError(error: unknown): boolean {
  if (!isRecord(error)) return false
  const code = typeof error.code === 'string' ? error.code : ''
  const name = typeof error.name === 'string' ? error.name : ''
  return code === 'NoSuchKey' || code === 'NotFound' || name === 'NotFound'
}

export interface PresignedRawLogUrl {
  url: string
  expiresIn: number
}

export class RawLogsS3Store {
  #client: MinioClient
  #bucket: string
  #region: string
  #presignDefaultExpiresInSeconds: number
  #bucketReady: Promise<void> | null = null

  constructor(config: S3RawLogsConfig) {
    const endpoint = new URL(config.endpoint)
    const useSSL = endpoint.protocol === 'https:'
    const port = endpoint.port ? Number(endpoint.port) : (useSSL ? 443 : 80)

    this.#bucket = config.bucket
    this.#region = config.region
    this.#presignDefaultExpiresInSeconds = config.presignExpiresInSeconds
    this.#client = new MinioClient({
      endPoint: endpoint.hostname,
      port,
      useSSL,
      accessKey: config.accessKeyId,
      secretKey: config.secretAccessKey,
      region: config.region,
    })
  }

  keyForTurn(sessionId: string, turnIndex: number): string {
    const turn = Math.max(0, Math.floor(turnIndex))
    return `sessions/${sessionId}/turn-${turn}.jsonl`
  }

  async ensureBucket(): Promise<void> {
    if (this.#bucketReady) return await this.#bucketReady
    this.#bucketReady = (async () => {
      const exists = await this.#client.bucketExists(this.#bucket)
      if (exists) return
      await this.#client.makeBucket(this.#bucket, this.#region).catch((err) => {
        // Best-effort: if another replica races us, ignore bucket-exists errors.
        if (isRecord(err) && typeof err.code === 'string') {
          if (err.code === 'BucketAlreadyOwnedByYou') return
          if (err.code === 'BucketAlreadyExists') return
        }
        throw err
      })
    })()
    return await this.#bucketReady
  }

  async uploadTurn(
    sessionId: string,
    turnIndex: number,
    body: ReadableStream<Uint8Array>,
    contentType = 'application/x-ndjson',
  ): Promise<{ bucket: string; key: string }> {
    await this.ensureBucket()
    const key = this.keyForTurn(sessionId, turnIndex)
    const stream = Readable.fromWeb(body as unknown as NodeReadableStream)
    await this.#client.putObject(this.#bucket, key, stream, undefined, {
      'Content-Type': contentType,
    })
    return { bucket: this.#bucket, key }
  }

  async existsTurn(sessionId: string, turnIndex: number): Promise<boolean> {
    await this.ensureBucket()
    const key = this.keyForTurn(sessionId, turnIndex)
    try {
      await this.#client.statObject(this.#bucket, key)
      return true
    } catch (err) {
      if (isNotFoundError(err)) return false
      throw err
    }
  }

  async presignGetTurn(
    sessionId: string,
    turnIndex: number,
    expiresInSeconds?: number,
  ): Promise<PresignedRawLogUrl> {
    await this.ensureBucket()
    const key = this.keyForTurn(sessionId, turnIndex)
    const expiresIn = Number.isFinite(expiresInSeconds)
      ? Math.max(1, Math.min(86_400, Math.floor(expiresInSeconds!)))
      : this.#presignDefaultExpiresInSeconds
    const url = await this.#client.presignedGetObject(
      this.#bucket,
      key,
      expiresIn,
    )
    return { url, expiresIn }
  }
}
