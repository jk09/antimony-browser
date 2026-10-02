export const channels = {
  state: 'stacks:state',
  goToNode: 'stacks:go-to-node',
  switch: 'stacks:switch',
  create: 'stacks:create',
  close: 'stacks:close',
  outline: 'stacks:outline',
  closeNode: 'stacks:close-node',
  home: 'stacks:home',
  setHome: 'stacks:set-home',
  stateChanged: 'stacks:state-changed',
  // A shortcut or File menu item (main → UI), not a state change; the UI runs it like its button.
  command: 'stacks:command',
} as const

/**
 * What Ctrl/Cmd+R, +N and +W (and their File menu items) ask the UI to do, and the steps of
 * Ctrl+[Shift+]Tab: start or step a cycle through the stacks, then switch (end) or not (cancel).
 */
export type StackCommand =
  'reload' | 'new' | 'close-page' | 'cycle-next' | 'cycle-previous' | 'cycle-end' | 'cycle-cancel'

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
  /** The root was opened as the home page: the stack is named after the root's first child. */
  startRoot?: boolean
}

/** The home page until `/home` changes or clears it. */
export const DEFAULT_HOME = 'https://www.bing.com/'

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
  /** Starts a stack in a new tab at the home page (empty without one) and makes it current. */
  create(): Promise<void>
  close(stackId: string): Promise<void>
  /** Removes a node of the current stack and its branch; the root closes the whole stack. */
  closeNode(nodeId: number): Promise<void>
  /** The URL new stacks open at, or null for an empty stack. */
  home(): Promise<string | null>
  /** Sets (an http(s) URL) or clears (null) the home page. */
  setHome(url: string | null): Promise<void>
  /** The stack's outline as text for the model, or null if no stack has that name. */
  outline(name: string): Promise<string | null>
  /** Called whenever stacks or the current tree change. Returns an unsubscribe function. */
  onChanged(listener: (state: StacksState) => void): () => void
  /** Called when a stack shortcut is pressed. Returns an unsubscribe function. */
  onCommand(listener: (command: StackCommand) => void): () => void
}
