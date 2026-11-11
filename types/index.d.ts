/** A prompt sent in English: keyed by a hash of the English text that was stored. */
export type SentPrompt = {
  /** What the person typed. */
  zh: string
  /** True while the row shows the English that was sent. */
  showEnglish?: boolean
}

/** One reply's Chinese translation, keyed by a hash of the reply's text. */
export type Reply = {
  /** The reply as Claude wrote it. */
  source: string
  status: 'pending' | 'done' | 'failed'
  /** The translation, once done. */
  text?: string
  /** Why it failed, once failed. */
  error?: string
  /** True while the row shows the original. */
  showOriginal?: boolean
}

export type Bridge = {
  prompts: Record<string, SentPrompt>
  replies: Record<string, Reply>
  /** Transcript row uuid → reply hash. */
  byRow: Record<string, string>
  /** Hashes of prompts and replies, oldest first, for trimming. */
  order: string[]
}

declare module 'claude-code' {
  interface PluginState {
    'zh-en-bridge': {
      /** Whether prompts are translated to English before they are sent; null until the person picks, then `enabled_by_default` decides. */
      enabled: Shaped<boolean | null>
      /** Whether the last prompt the person sent went out in English. */
      englishTurn: Shaped<boolean>
      bridge: Shaped<Bridge>
    }
  }
}
