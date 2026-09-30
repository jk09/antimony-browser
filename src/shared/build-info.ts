// Injected at build time by electron.vite.config.ts.
declare const __BUILD_COMMIT__: string

/** Short git hash of the commit the app was built from, or `unknown` outside a git checkout. */
export const buildCommit = __BUILD_COMMIT__

export const windowTitle = `Antimony - ${buildCommit}`
