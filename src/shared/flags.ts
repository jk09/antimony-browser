/**
 * Feature flags. Every flag has an owner and a removal date in its feature README's
 * "Feature flags" table; the audit-features skill lists overdue ones.
 */
export const flags = {} as const satisfies Record<string, boolean>

export type Flag = keyof typeof flags
