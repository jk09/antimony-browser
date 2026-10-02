export const channels = {
  state: 'stacks:state',
  goToNode: 'stacks:go-to-node',
  switch: 'stacks:switch',
  create: 'stacks:create',
  close: 'stacks:close',
  outline: 'stacks:outline',
  settings: 'stacks:settings',
  updateSettings: 'stacks:update-settings',
  stateChanged: 'stacks:state-changed',
} as const

/** One page in a stack's tree. */
export interface StackNode {
  id: number
  url: string
  title: string
  parentId: number | null
  /** In creation order. */
  children: number[]
  /** Epoch milliseconds the node was last the active one. */
  lastVisitedAt: number
}

/** A tab's navigation as a tree; stored in `stacks.json`. */
export interface Stack {
  id: string
  /** Derived once from the root page; null until then ("New tab"). */
  name: string | null
  nodes: Record<number, StackNode>
  rootId: number | null
  activeId: number | null
  nextNodeId: number
  lastUsedAt: number
  /** The root was opened as the new-stack page: the stack is named after the root's first child. */
  startRoot?: boolean
}

/** `userData/stacks-settings.json`. */
export interface StacksSettings {
  /** The http(s) page an empty new stack opens as its root; null: new stacks stay empty. */
  newStackPage: string | null
}

export const DEFAULT_NEW_STACK_PAGE = 'https://www.bing.com/'

/** A row of the tree as the header shows it, in depth-first order. */
export interface StackRow {
  id: number
  url: string
  title: string
  depth: number
  /** The last child of its parent (└ instead of ├). */
  last: boolean
}

export interface StackSummary {
  id: string
  /** '' for a stack without a name yet. */
  name: string
  rootTitle: string
  pages: number
}

export interface StacksState {
  /** The current stack; null with no stack at all ("New tab"). */
  current: { id: string; name: string; rows: StackRow[]; activeId: number | null } | null
  /** All stacks, most recently used first. */
  stacks: StackSummary[]
}

export interface StacksApi {
  state(): Promise<StacksState>
  /** Loads a node of the current stack; the tree doesn't change. */
  goToNode(nodeId: number): Promise<void>
  /** Makes a stack current (its tab is created if it isn't live). */
  switch(stackId: string): Promise<void>
  /** Starts an empty stack in a new tab and makes it current. */
  create(): Promise<void>
  close(stackId: string): Promise<void>
  /** The stack's outline as text for the model, or null if no stack has that name. */
  outline(name: string): Promise<string | null>
  settings(): Promise<StacksSettings>
  /** Main rejects a page that isn't an http(s) URL. Returns the saved settings. */
  updateSettings(settings: StacksSettings): Promise<StacksSettings>
  /** Called whenever stacks or the current tree change. Returns an unsubscribe function. */
  onChanged(listener: (state: StacksState) => void): () => void
}
