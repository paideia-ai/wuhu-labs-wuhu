export interface SandboxConfig {
  namespace: string
  image: string
  daemonPort: number
  previewPort: number
  previewDomain: string
}

export interface GithubConfig {
  token?: string
  allowedOrgs: string[]
}

export interface RedisConfig {
  url: string
}

export interface KubeConfigOptions {
  kubeconfigPath?: string
  context?: string
}

export interface S3RawLogsConfig {
  endpoint: string
  region: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
  forcePathStyle: boolean
  presignExpiresInSeconds: number
}

export interface AppConfig {
  port: number
  /**
   * Base URL that a sandbox daemon should use to call back into Core.
   * In-cluster default is `http://core:${PORT}`.
   */
  coreApiUrl: string
  sandbox: SandboxConfig
  github: GithubConfig
  redis: RedisConfig
  kube: KubeConfigOptions
  rawLogsS3: S3RawLogsConfig | null
}

export function loadConfig(): AppConfig {
  const port = parseInt(Deno.env.get('PORT') ?? '3000')
  const namespace = Deno.env.get('SANDBOX_NAMESPACE') ??
    Deno.env.get('KUBE_NAMESPACE') ?? 'default'
  const image = Deno.env.get('SANDBOX_IMAGE') ?? 'wuhu-core:latest'
  const previewDomain = Deno.env.get('SANDBOX_PREVIEW_DOMAIN') ??
    'wuhu.liu.ms'
  const githubToken = Deno.env.get('GITHUB_TOKEN') ?? undefined
  const allowedOrgs = (Deno.env.get('GITHUB_ALLOWED_ORGS') ?? '')
    .split(',')
    .map((org) => org.trim())
    .filter(Boolean)
  const redisUrl = Deno.env.get('REDIS_URL') ?? 'redis://localhost:6379'
  const coreApiUrl = (Deno.env.get('CORE_API_URL') ?? '').trim() ||
    `http://core:${port}`

  const s3Endpoint = (Deno.env.get('S3_ENDPOINT') ?? '').trim()
  const s3Region = (Deno.env.get('S3_REGION') ?? 'us-east-1').trim() ||
    'us-east-1'
  const s3Bucket = (Deno.env.get('S3_BUCKET') ?? '').trim()
  const s3AccessKeyId = (Deno.env.get('S3_ACCESS_KEY_ID') ?? '').trim()
  const s3SecretAccessKey = (Deno.env.get('S3_SECRET_ACCESS_KEY') ?? '').trim()
  const s3ForcePathStyleRaw = (Deno.env.get('S3_FORCE_PATH_STYLE') ?? 'true')
    .trim()
    .toLowerCase()
  const s3ForcePathStyle = s3ForcePathStyleRaw === '1' ||
    s3ForcePathStyleRaw === 'true' || s3ForcePathStyleRaw === 'yes'
  const presignExpiresInRaw = Number(
    (Deno.env.get('S3_PRESIGN_EXPIRES_IN_SECONDS') ?? '3600').trim(),
  )
  const presignExpiresInSeconds = Number.isFinite(presignExpiresInRaw)
    ? Math.max(1, Math.min(86_400, Math.floor(presignExpiresInRaw)))
    : 3600

  const rawLogsS3 = s3Endpoint && s3Bucket && s3AccessKeyId && s3SecretAccessKey
    ? {
      endpoint: s3Endpoint,
      region: s3Region,
      bucket: s3Bucket,
      accessKeyId: s3AccessKeyId,
      secretAccessKey: s3SecretAccessKey,
      forcePathStyle: s3ForcePathStyle,
      presignExpiresInSeconds,
    }
    : null

  return {
    port,
    coreApiUrl,
    sandbox: {
      namespace,
      image,
      daemonPort: 8787,
      previewPort: 8066,
      previewDomain,
    },
    github: {
      token: githubToken,
      allowedOrgs,
    },
    redis: {
      url: redisUrl,
    },
    kube: {
      kubeconfigPath: Deno.env.get('KUBECONFIG') ?? undefined,
      context: Deno.env.get('KUBECONFIG_CONTEXT') ?? undefined,
    },
    rawLogsS3,
  }
}
