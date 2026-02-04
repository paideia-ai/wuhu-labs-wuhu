import { Octokit } from '@octokit/rest'
import { createClient } from 'redis'

export interface RepoSummary {
  id: number
  name: string
  fullName: string
  url: string
  defaultBranch: string
  private: boolean
  org: string
}

export interface RepoServiceConfig {
  token?: string
  allowedOrgs: string[]
  redisUrl: string
  cacheTtlSeconds?: number
}

const DEFAULT_CACHE_TTL_SECONDS = 300
const CACHE_KEY = 'wuhu:repos:v1'
type RedisClient = ReturnType<typeof createClient>

export class RepoService {
  #octokit: Octokit
  #token?: string
  #allowedOrgs: string[]
  #redisUrl: string
  #cacheTtlSeconds: number
  #redisClient: RedisClient | null = null
  #redisConnectPromise?: Promise<RedisClient>
  #redisDisabled = false

  constructor(config: RepoServiceConfig) {
    this.#token = config.token
    this.#allowedOrgs = config.allowedOrgs
    this.#redisUrl = config.redisUrl
    this.#cacheTtlSeconds = config.cacheTtlSeconds ?? DEFAULT_CACHE_TTL_SECONDS
    this.#octokit = new Octokit(
      this.#token ? { auth: this.#token } : undefined,
    )
  }

  async listRepos(): Promise<RepoSummary[]> {
    if (!this.#token) {
      throw new Error('missing_github_token')
    }
    if (this.#allowedOrgs.length === 0) {
      throw new Error('missing_github_allowed_orgs')
    }

    const cached = await this.#getCachedRepos()
    if (cached) return cached

    const repos = await this.#fetchRepos()
    await this.#setCachedRepos(repos)
    return repos
  }

  async #fetchRepos(): Promise<RepoSummary[]> {
    const repos: RepoSummary[] = []
    for (const org of this.#allowedOrgs) {
      const orgRepos = await this.#octokit.paginate(
        this.#octokit.rest.repos.listForOrg,
        {
          org,
          type: 'all',
          per_page: 100,
        },
      )
      for (const repo of orgRepos) {
        if (!repo.full_name) continue
        repos.push({
          id: repo.id,
          name: repo.name,
          fullName: repo.full_name,
          url: repo.html_url,
          defaultBranch: repo.default_branch ?? '',
          private: repo.private,
          org,
        })
      }
    }
    repos.sort((a, b) => a.fullName.localeCompare(b.fullName))
    return repos
  }

  async #getCachedRepos(): Promise<RepoSummary[] | null> {
    const client = await this.#getRedisClient()
    if (!client) return null
    try {
      const cached = await client.get(CACHE_KEY)
      if (!cached) return null
      const parsed = JSON.parse(cached)
      return Array.isArray(parsed) ? (parsed as RepoSummary[]) : null
    } catch (error) {
      console.warn('repo cache read failed', error)
      return null
    }
  }

  async #setCachedRepos(repos: RepoSummary[]): Promise<void> {
    const client = await this.#getRedisClient()
    if (!client) return
    try {
      await client.set(CACHE_KEY, JSON.stringify(repos), {
        EX: this.#cacheTtlSeconds,
      })
    } catch (error) {
      console.warn('repo cache write failed', error)
    }
  }

  async #getRedisClient(): Promise<RedisClient | null> {
    if (this.#redisDisabled) return null
    if (this.#redisClient) return this.#redisClient
    if (!this.#redisConnectPromise) {
      const client = createClient({ url: this.#redisUrl })
      client.on('error', (error) => {
        console.warn('redis client error', error)
      })
      this.#redisConnectPromise = client.connect().then(() => client)
    }
    try {
      this.#redisClient = await this.#redisConnectPromise
      return this.#redisClient
    } catch (error) {
      console.warn('redis connect failed', error)
      this.#redisDisabled = true
      return null
    }
  }
}
