export const channels = {
  send: 'feedback:send',
} as const

/** The repository feedback and crash reports go to, as GitHub issues. */
export const FEEDBACK_REPO = 'jk09/antimony-browser'

export const MAX_FEEDBACK = 5000

/**
 * Where an issue went: created with the user's `gh` CLI (`url` is the issue), or GitHub's
 * prefilled new-issue form opened in the default browser for the user to submit (`url` is the form).
 */
export interface SendResult {
  via: 'gh' | 'form'
  url: string
}

export interface FeedbackApi {
  /** Sends feedback text (1–5000 characters) as an issue. */
  send(text: string): Promise<SendResult>
}
