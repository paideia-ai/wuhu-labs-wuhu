export function readEnvTrimmed(name: string): string | undefined {
  const value = Deno.env.get(name)
  if (value === undefined) return undefined
  const trimmed = value.trim()
  return trimmed.length ? trimmed : undefined
}

export function readEnvNumber(
  name: string,
  fallback: number,
): number {
  const raw = readEnvTrimmed(name)
  if (!raw) return fallback
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : fallback
}

export function readEnvString(
  name: string,
  fallback: string,
): string {
  return readEnvTrimmed(name) ?? fallback
}

export function readEnvBool(
  name: string,
  fallback: boolean,
): boolean {
  const raw = readEnvTrimmed(name)
  if (!raw) return fallback
  if (raw === '1' || raw.toLowerCase() === 'true') return true
  if (raw === '0' || raw.toLowerCase() === 'false') return false
  return fallback
}
