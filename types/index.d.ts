/** A prompt sent in English: keyed by a hash of the English text that was stored. */
export type SentPrompt = {
  /** What the person typed. */
  zh: string
  /** True while the row shows the Chinese the person typed instead of the English that was sent. */
  showChinese?: boolean
  /** True when the person changed the English draft before sending it. */
  isEdited?: boolean
}

/** An English translation the button wrote into the prompt box, until it is sent or replaced. */
export type Draft = {
  /** What the person typed. */
  zh: string
  /** The translation. */
  en: string
  /** The band field's text as the person edited it. */
  edited?: string
  /** True when the band holds the draft: a surface whose prompt box a plugin cannot write. */
  isInBand?: boolean
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
      /** True while the button's translation is under way. */
      translating: Shaped<boolean>
      /** Whether the last prompt the person sent was a translation from the button. */
      englishTurn: Shaped<boolean>
      /** The button's last translation, until a prompt is sent. */
      draft: Shaped<Draft | null>
      bridge: Shaped<Bridge>
    }
  }
}
