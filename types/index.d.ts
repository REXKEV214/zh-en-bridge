/** A prompt sent in English: keyed by a hash of the English text that was stored. */
export type SentPrompt = {
  /** What the person typed. */
  zh: string
  /** True while the row shows the English that was sent. */
  showEnglish?: boolean
  /** True when the person changed the English draft before sending it. */
  isEdited?: boolean
}

/**
 * A prompt held back for the person to confirm: its English translation, or,
 * when the translation failed, the Chinese to retry or send as typed.
 */
export type Draft = {
  /** What the person typed. */
  zh: string
  /** The translation, once done. */
  en?: string
  /** Why the translation failed. */
  error?: string
  /** The field's text as the person edited it in the band. */
  edited?: string
  /** True when the band shows the draft: a failure, or a surface whose prompt box a plugin cannot write. */
  isInBand?: boolean
  /** True while the band's retry is under way. */
  isTranslating?: boolean
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
      /** The English draft in the prompt box, until it is sent or English mode is turned off. */
      draft: Shaped<Draft | null>
      bridge: Shaped<Bridge>
    }
  }
}
