/** What is known about a link target: its summary, or null when it has none (fetch failed, no content). */
export type CachedSummary = { title: string; summary: string } | null

/** Summaries per target URL, in memory only; the least recently used are dropped beyond `max`. */
export class SummaryCache {
  private readonly entries = new Map<string, CachedSummary>()

  constructor(private readonly max = 500) {}

  has(url: string): boolean {
    return this.entries.has(url)
  }

  get(url: string): CachedSummary | undefined {
    if (!this.entries.has(url)) return undefined
    const value = this.entries.get(url)!
    this.entries.delete(url)
    this.entries.set(url, value)
    return value
  }

  set(url: string, value: CachedSummary): void {
    this.entries.delete(url)
    this.entries.set(url, value)
    while (this.entries.size > this.max) {
      this.entries.delete(this.entries.keys().next().value!)
    }
  }

  clear(): void {
    this.entries.clear()
  }

  get size(): number {
    return this.entries.size
  }
}
