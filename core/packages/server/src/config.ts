export interface SandboxConfig {
  namespace: string
  image: string
  daemonPort: number
  previewPort: number
  previewDomain: string
}

export interface KubeConfigOptions {
  kubeconfigPath?: string
  context?: string
}

export interface AppConfig {
  port: number
  sandbox: SandboxConfig
  kube: KubeConfigOptions
}

export function loadConfig(): AppConfig {
  const port = parseInt(Deno.env.get('PORT') ?? '3000')
  const namespace = Deno.env.get('SANDBOX_NAMESPACE') ??
    Deno.env.get('KUBE_NAMESPACE') ?? 'default'
  const image = Deno.env.get('SANDBOX_IMAGE') ?? 'wuhu-core:latest'
  const previewDomain = Deno.env.get('SANDBOX_PREVIEW_DOMAIN') ??
    'wuhu.liu.ms'

  return {
    port,
    sandbox: {
      namespace,
      image,
      daemonPort: 8787,
      previewPort: 8066,
      previewDomain,
    },
    kube: {
      kubeconfigPath: Deno.env.get('KUBECONFIG') ?? undefined,
      context: Deno.env.get('KUBECONFIG_CONTEXT') ?? undefined,
    },
  }
}
