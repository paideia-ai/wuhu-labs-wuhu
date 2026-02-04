// Simple CUID-like ID generator (Deno-native)
export function createId(): string {
  const timestamp = Date.now().toString(36)
  const randomPart = crypto.randomUUID().replace(/-/g, '').slice(0, 12)
  return `c${timestamp}${randomPart}`
}
