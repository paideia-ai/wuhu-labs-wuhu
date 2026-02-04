import { assert, assertEquals } from '@std/assert'

import type { S3RawLogsConfig } from './config.ts'
import { RawLogsS3Store } from './raw-logs-s3.ts'

function loadS3TestConfig(): S3RawLogsConfig | null {
  const endpoint = (Deno.env.get('S3_ENDPOINT') ?? '').trim()
  const bucket = (Deno.env.get('S3_BUCKET') ?? '').trim()
  const accessKeyId = (Deno.env.get('S3_ACCESS_KEY_ID') ?? '').trim()
  const secretAccessKey = (Deno.env.get('S3_SECRET_ACCESS_KEY') ?? '').trim()
  const region = (Deno.env.get('S3_REGION') ?? 'us-east-1').trim() ||
    'us-east-1'
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) return null
  return {
    endpoint,
    bucket,
    accessKeyId,
    secretAccessKey,
    region,
    forcePathStyle: true,
    presignExpiresInSeconds: 60,
  }
}

Deno.test('RawLogsS3Store keyForTurn matches spec', () => {
  const store = new RawLogsS3Store({
    endpoint: 'http://localhost:9000',
    region: 'us-east-1',
    bucket: 'wuhu-raw-logs',
    accessKeyId: 'minio',
    secretAccessKey: 'miniosecret',
    forcePathStyle: true,
    presignExpiresInSeconds: 60,
  })
  assertEquals(store.keyForTurn('sb_123', 0), 'sessions/sb_123/turn-0.jsonl')
  assertEquals(store.keyForTurn('sb_123', 2), 'sessions/sb_123/turn-2.jsonl')
})

Deno.test({
  name: 'RawLogsS3Store uploads + presigns + downloads',
  ignore: !loadS3TestConfig(),
  fn: async () => {
    const cfg = loadS3TestConfig()
    if (!cfg) return
    const store = new RawLogsS3Store(cfg)

    const sessionId = `sb_s3_${crypto.randomUUID().slice(0, 8)}`
    const turnIndex = 1
    const ndjson =
      '{"type":"turn_start","timestamp":1}\n{"type":"turn_end","timestamp":2}\n'
    const encoder = new TextEncoder()
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(ndjson))
        controller.close()
      },
    })

    await store.uploadTurn(sessionId, turnIndex, body)
    assert(await store.existsTurn(sessionId, turnIndex))

    const { url } = await store.presignGetTurn(sessionId, turnIndex, 60)
    const res = await fetch(url)
    assertEquals(res.status, 200)
    const text = await res.text()
    assertEquals(text, ndjson)
  },
})
