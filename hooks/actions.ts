/**
 * The key of the Box that holds a plugin's buttons under a reply. A plugin
 * drawing above another one's takes that Box out of `next(e)`'s tree and draws
 * it first in its own row, so the buttons of both stand side by side. The same
 * convention, and this file, are shared with readable-rewrite-cn.
 */
export const ACTIONS = 'reply-actions'

type Plain = { type: string; props?: Record<string, unknown>; children?: unknown[]; part?: unknown }

function isElement(node: unknown): node is Plain {
  return typeof node === 'object' && node !== null && typeof (node as Plain).type === 'string'
}

/**
 * Splits `tree` into the drawing without its first `ACTIONS` Box, and that Box.
 * The Box takes the plugin mark of the tree's root when it has none of its own,
 * so its buttons stay its plugin's wherever it is drawn.
 */
export function takeActions<T>(tree: T): { rest: T; actions?: T } {
  let found: Plain | undefined
  const walk = (node: unknown): unknown => {
    if (found || !isElement(node)) return node
    if (node.type === 'Box' && node.props?.key === ACTIONS) {
      found = node
      return undefined
    }
    if (!Array.isArray(node.children)) return node
    const children = node.children.map(walk).filter(c => c !== undefined)
    return found ? { ...node, children } : node
  }
  const walked = walk(tree)
  if (!found || !isElement(walked)) return { rest: tree }

  let rest: Plain = walked
  const { marginTop: _, ...props } = found.props ?? {}
  let actions: Plain = { ...found, props }
  if (actions.part === undefined && rest.part !== undefined) {
    const { part, ...withoutPart } = rest
    actions = { ...actions, part }
    rest = withoutPart
  }
  return { rest: rest as T, actions: actions as T }
}
