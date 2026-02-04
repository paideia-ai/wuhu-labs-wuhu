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

export interface AppConfig {
  port: number
  sandbox: SandboxConfig
  github: GithubConfig
  redis: RedisConfig
  kube: KubeConfigOptions
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

  return {
    port,
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
  }
}
