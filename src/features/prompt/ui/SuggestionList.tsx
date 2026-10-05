import { useEffect } from 'react'
import type { Suggestion } from '../shared/suggest'

const icons: Record<Suggestion['kind'], string> = {
  url: '🌐',
  query: '💬',
  command: '',
  value: '↳',
  stack: '🗂',
  page: '',
}

/** Deeper pages stop indenting, so titles keep room. */
const MAX_INDENT_DEPTH = 6

export const suggestionId = (index: number) => `prompt-suggestion-${index}`

/** What a screen reader says for an option: whether it's a stack or a page, and where it leads. */
function accessibleName(suggestion: Suggestion): string | undefined {
  const detail = suggestion.detail ? `, ${suggestion.detail}` : ''
  if (suggestion.kind === 'stack') return `Stack ${suggestion.label}${detail}`
  if (suggestion.kind === 'page') {
    return `Page ${suggestion.label}${detail}${suggestion.current ? ', current page' : ''}`
  }
  return undefined
}

export function SuggestionList({
  suggestions,
  more = 0,
  selected,
  onPick,
}: {
  suggestions: Suggestion[]
  /** Matches left out over the limit. */
  more?: number
  selected: number
  onPick: (suggestion: Suggestion) => void
}) {
  // ↑ ↓ keep the selected row visible in a scrolled list.
  useEffect(() => {
    if (selected < 0) return
    document.getElementById(suggestionId(selected))?.scrollIntoView?.({ block: 'nearest' })
  }, [selected])

  return (
    <ul
      className="prompt-suggestions"
      id="prompt-suggestions"
      role="listbox"
      aria-label="Suggestions"
    >
      {suggestions.map((suggestion, index) => {
        const classes = [
          suggestion.kind === 'stack' || suggestion.kind === 'page'
            ? `prompt-suggestion-${suggestion.kind}`
            : '',
          suggestion.current ? 'current' : '',
          index === selected ? 'selected' : '',
        ].filter(Boolean)
        return (
          <li
            key={`${suggestion.kind}:${suggestion.text}:${suggestion.target?.nodeId ?? ''}`}
            id={suggestionId(index)}
            role="option"
            aria-selected={index === selected}
            aria-label={accessibleName(suggestion)}
            className={classes.length > 0 ? classes.join(' ') : undefined}
            title={suggestion.kind === 'page' ? suggestion.target?.reference : undefined}
            style={
              suggestion.kind === 'page'
                ? {
                    paddingLeft: `${8 + 14 * Math.min(suggestion.depth ?? 0, MAX_INDENT_DEPTH)}px`,
                  }
                : undefined
            }
            // Keep focus in the text area.
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onPick(suggestion)}
          >
            {suggestion.kind === 'page' ? (
              <span className="prompt-suggestion-icon prompt-suggestion-branch" aria-hidden="true">
                {suggestion.last ? '└' : '├'}
              </span>
            ) : (
              icons[suggestion.kind] && (
                <span className="prompt-suggestion-icon" aria-hidden="true">
                  {icons[suggestion.kind]}
                </span>
              )
            )}
            <span className="prompt-suggestion-label">{suggestion.label}</span>
            {suggestion.detail && (
              <span className="prompt-suggestion-detail">{suggestion.detail}</span>
            )}
          </li>
        )
      })}
      {more > 0 && (
        <li
          className="prompt-suggestion-more"
          role="option"
          aria-disabled="true"
          aria-selected={false}
        >
          ⋯ {more} more – type to narrow
        </li>
      )}
    </ul>
  )
}
