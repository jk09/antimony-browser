import type { Suggestion } from '../shared/suggest'

const icons: Record<Suggestion['kind'], string> = {
  url: '🌐',
  query: '💬',
  command: '',
  value: '↳',
}

export const suggestionId = (index: number) => `prompt-suggestion-${index}`

export function SuggestionList({
  suggestions,
  selected,
  onPick,
}: {
  suggestions: Suggestion[]
  selected: number
  onPick: (suggestion: Suggestion) => void
}) {
  return (
    <ul
      className="prompt-suggestions"
      id="prompt-suggestions"
      role="listbox"
      aria-label="Suggestions"
    >
      {suggestions.map((suggestion, index) => (
        <li
          key={`${suggestion.kind}:${suggestion.text}`}
          id={suggestionId(index)}
          role="option"
          aria-selected={index === selected}
          className={index === selected ? 'selected' : undefined}
          // Keep focus in the text area.
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onPick(suggestion)}
        >
          {icons[suggestion.kind] && (
            <span className="prompt-suggestion-icon" aria-hidden="true">
              {icons[suggestion.kind]}
            </span>
          )}
          <span className="prompt-suggestion-label">{suggestion.label}</span>
          {suggestion.detail && (
            <span className="prompt-suggestion-detail">{suggestion.detail}</span>
          )}
        </li>
      ))}
    </ul>
  )
}
