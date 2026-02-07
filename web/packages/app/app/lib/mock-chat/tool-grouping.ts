import type { AgentBlockItem, ToolCallItem } from './types.ts'

// ---------------------------------------------------------------------------
// Tool categories
// ---------------------------------------------------------------------------

type ToolCategory = 'exploration' | 'mutation' | 'execution'

const TOOL_CATEGORIES: Record<string, ToolCategory> = {
  read: 'exploration',
  grep: 'exploration',
  find: 'exploration',
  ls: 'exploration',
  write: 'mutation',
  edit: 'mutation',
  bash: 'execution',
}

function categoryOf(toolName: string): ToolCategory | null {
  return TOOL_CATEGORIES[toolName] ?? null
}

// ---------------------------------------------------------------------------
// Grouped tool calls for display
// ---------------------------------------------------------------------------

export interface ToolLineSummary {
  toolName: string
  /** Display label, e.g. "Read AGENTS.md, README.md" or "Read 4 files" */
  label: string
}

export interface ToolGroup {
  category: ToolCategory
  lines: ToolLineSummary[]
}

/** A renderable block — either a group of tool calls or a pass-through item. */
export type RenderBlock =
  | { kind: 'tool-group'; group: ToolGroup }
  | { kind: 'item'; item: AgentBlockItem }

// ---------------------------------------------------------------------------
// Grouping logic
// ---------------------------------------------------------------------------

/**
 * Transform agent block items into renderable blocks with tool calls grouped
 * by category. Adjacent tool calls of the same category are merged. Tool
 * results are dropped (not rendered). Non-tool items pass through as-is.
 */
export function groupAgentBlockItems(items: AgentBlockItem[]): RenderBlock[] {
  const blocks: RenderBlock[] = []
  let pendingToolCalls: ToolCallItem[] = []
  let pendingCategory: ToolCategory | null = null

  function flushPending() {
    if (pendingToolCalls.length === 0 || pendingCategory === null) return
    blocks.push({
      kind: 'tool-group',
      group: buildGroup(pendingCategory, pendingToolCalls),
    })
    pendingToolCalls = []
    pendingCategory = null
  }

  for (const item of items) {
    // Skip tool results — we don't render them
    if (item.type === 'tool-result') continue

    if (item.type === 'tool-call') {
      const cat = categoryOf(item.toolName)
      if (cat === null) {
        // Unknown tool — flush pending, emit as standalone item
        flushPending()
        blocks.push({ kind: 'item', item })
        continue
      }

      if (cat === pendingCategory) {
        // Same category — accumulate
        pendingToolCalls.push(item)
      } else {
        // Different category — flush old, start new
        flushPending()
        pendingCategory = cat
        pendingToolCalls = [item]
      }
    } else {
      // assistant-message or reasoning-summary — flush and pass through
      flushPending()
      blocks.push({ kind: 'item', item })
    }
  }

  flushPending()
  return blocks
}

// ---------------------------------------------------------------------------
// Build a ToolGroup from a list of tool calls in the same category
// ---------------------------------------------------------------------------

function buildGroup(category: ToolCategory, calls: ToolCallItem[]): ToolGroup {
  if (category === 'execution') {
    return {
      category,
      lines: calls.map((c) => ({
        toolName: c.toolName,
        label: formatBashLine(c),
      })),
    }
  }

  // For exploration and mutation, group by tool kind
  const byKind = new Map<string, ToolCallItem[]>()
  for (const c of calls) {
    const existing = byKind.get(c.toolName)
    if (existing) {
      existing.push(c)
    } else {
      byKind.set(c.toolName, [c])
    }
  }

  const lines: ToolLineSummary[] = []
  for (const [toolName, kindCalls] of byKind) {
    lines.push({ toolName, label: formatKindLine(toolName, kindCalls) })
  }

  return { category, lines }
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function formatBashLine(call: ToolCallItem): string {
  const cmd = String(call.args.command ?? '')
  return `\`${cmd}\``
}

function formatKindLine(toolName: string, calls: ToolCallItem[]): string {
  const verb = toolVerb(toolName)

  switch (toolName) {
    case 'read':
    case 'write':
    case 'edit': {
      const files = calls.map((c) => fileName(String(c.args.path ?? '')))
      return formatFileList(verb, files)
    }
    case 'ls': {
      const dirs = calls.map((c) => dirName(String(c.args.path ?? '')))
      return formatFileList(verb, dirs)
    }
    case 'grep': {
      if (calls.length === 1) {
        return `${verb} \`${calls[0].args.pattern ?? ''}\``
      }
      return `${verb} ${calls.length} patterns`
    }
    case 'find': {
      if (calls.length === 1) {
        return `${verb} \`${calls[0].args.pattern ?? ''}\``
      }
      return `${verb} ${calls.length} patterns`
    }
    default:
      return `${verb} ${calls.length} call${calls.length === 1 ? '' : 's'}`
  }
}

function formatFileList(verb: string, names: string[]): string {
  if (names.length <= 3) {
    return `${verb} ${names.join(', ')}`
  }
  return `${verb} ${names.length} files`
}

function toolVerb(toolName: string): string {
  switch (toolName) {
    case 'read':
      return 'Read'
    case 'write':
      return 'Write'
    case 'edit':
      return 'Edit'
    case 'ls':
      return 'List'
    case 'grep':
      return 'Grep'
    case 'find':
      return 'Find'
    case 'bash':
      return 'Bash'
    default:
      return toolName
  }
}

function fileName(path: string): string {
  const parts = path.split('/')
  return parts[parts.length - 1] || path
}

function dirName(path: string): string {
  if (path === '.') return '.'
  const parts = path.split('/').filter(Boolean)
  return parts[parts.length - 1] || path
}
