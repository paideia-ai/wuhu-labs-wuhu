export function coreFunction(): string {
  return "from core"
}

export function heavyComputation(): number {
  // Simulate something that takes time to type check
  const arr: Array<{ nested: { value: number } }> = []
  for (let i = 0; i < 100; i++) {
    arr.push({ nested: { value: i } })
  }
  return arr.reduce((sum, item) => sum + item.nested.value, 0)
}
