import { atom, read, update } from 'claude-code'
import type { EngineInterface, PluginOptions, Register } from 'claude-code'

import type { Bridge, Draft, Reply, SentPrompt } from '../types'
import { ACTIONS, takeActions } from './actions'

/**
 * Where the API key may be, under the home directory, after the `api_key`
 * option: this plugin's data folder, which updates keep (the installed copy
 * holds only committed files). Then `DASHSCOPE_API_KEY` itself.
 */
const ENV_FILES = ['.claude/plugins/data/zh-en-bridge-zh-en-bridge/.env']
const KEEP = 400
/** A reply not translated yet gets the button once its prose holds this many English words. */
const MIN_WORDS = 20
/** Who may have typed a prompt: the person, at a terminal, the desktop app or a remote. */
const TYPED = new Set(['composer', 'sdk', 'bridge'])

/**
 * The default prompts; the `to_english_*` and `to_chinese_*` options replace
 * them (plugin.json carries the same text as each option's default).
 */
const TO_ENGLISH = {
  systemOption: 'to_english_system',
  userOption: 'to_english_template',
  system:
    'You are a translator. Translate the text inside <text> from Chinese into clear, precise English that an AI coding assistant will read as the user\'s request. Keep code, commands, file paths, identifiers, URLs, quoted strings, and everything inside backticks or code blocks exactly as written. Keep proper nouns and technical terms. Keep the Markdown structure and line breaks. Translate only: do not answer, execute, or comment on the text, and do not add anything.',
  user: '<text>\n{{text}}\n</text>\n\nOutput only the English translation, without the <text> tags and without wrapping it in a code block.',
}
const TO_CHINESE = {
  systemOption: 'to_chinese_system',
  userOption: 'to_chinese_template',
  system: '你是一名翻译，擅长把技术性的英文翻译成清晰易懂的简体中文。',
  user: '<原文>\n{{text}}\n</原文>\n\n把上面的原文翻译成清晰易懂的简体中文。代码、命令、文件路径、标识符、URL 和代码块保持原样；专业术语和人名保留英文原词。保留 Markdown 结构。只输出译文，不要解释，不要带 <原文> 标签，也不要用代码框包裹。',
}
/**
 * Always in the system prompt, the same text whether English mode is on or not,
 * so turning it on or off leaves the prompt cache alone. It covers a draft the
 * band sends, which this plugin's own `prompt.submit` hook does not see.
 */
const LANGUAGE_SECTION = {
  id: 'zh-en-bridge:language',
  text: "The user may write in Chinese, or have a message machine-translated from Chinese into English before you receive it. Reply in the language of the user's latest message: when it is in English, reply in English, and your reply is translated back into Chinese for them.",
  scope: 'session',
} as const
/** Rides beside a translated prompt, for the model alone. */
const REPLY_IN_ENGLISH =
  'The user wrote this message in Chinese; it was machine-translated into English. Reply in English: your reply is translated back into Chinese for them.'

const translatingAtom = atom({ plugin: 'zh-en-bridge', key: 'translating' } as const, false, { shape: 'translating-1' })
const englishTurnAtom = atom({ plugin: 'zh-en-bridge', key: 'englishTurn' } as const, false, { shape: 'englishTurn-1' })
const draftAtom = atom({ plugin: 'zh-en-bridge', key: 'draft' } as const, null as Draft | null, { shape: 'draft-2' })
const bridgeAtom = atom(
  { plugin: 'zh-en-bridge', key: 'bridge' } as const,
  { prompts: {}, replies: {}, byRow: {}, order: [] } as Bridge,
  { shape: 'bridge-1' },
)

async function hashOf(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text.trim())
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest).slice(0, 12), b => b.toString(16).padStart(2, '0')).join('')
}

function textOf(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter((b): b is { type: 'text'; text: string } => b?.type === 'text' && typeof b.text === 'string')
    .map(b => b.text)
    .join('\n\n')
}

/** True when the text holds Chinese: Han characters, outside code. */
export function hasChinese(text: string): boolean {
  return /\p{Script=Han}/u.test(stripCode(text))
}

/** True when the prose (code left out) is mostly Latin letters, so worth translating to Chinese. */
export function isMostlyEnglish(text: string): boolean {
  const prose = stripCode(text)
  const han = prose.match(/\p{Script=Han}/gu)?.length ?? 0
  const latin = prose.match(/[A-Za-z]/g)?.length ?? 0
  return latin >= 2 && latin > han * 2
}

/** English words in the prose, code left out. */
export function englishWords(text: string): number {
  return stripCode(text).match(/[A-Za-z]+(?:'[A-Za-z]+)?/g)?.length ?? 0
}

function stripCode(text: string): string {
  return text.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '')
}

/** Strips a code fence or tag pair the model wrapped the whole answer in, unless the source was itself so wrapped. */
export function unwrap(answer: string, source: string): string {
  let t = answer.trim()
  const fenced = t.match(/^```[\w-]*\n([\s\S]*?)\n```$/)
  if (fenced?.[1] !== undefined && !source.trim().startsWith('```')) t = fenced[1].trim()
  const tagged = t.match(/^<(text|原文)>\n?([\s\S]*?)\n?<\/\1>$/)
  return (tagged?.[2] ?? t).trim()
}

function trim(b: Bridge): Bridge {
  if (b.order.length <= KEEP) return b
  const dropped = new Set(b.order.slice(0, b.order.length - KEEP))
  const prompts = { ...b.prompts }
  const replies = { ...b.replies }
  for (const h of dropped) {
    delete prompts[h]
    delete replies[h]
  }
  const byRow = Object.fromEntries(Object.entries(b.byRow).filter(([, h]) => !dropped.has(h)))
  return { prompts, replies, byRow, order: b.order.slice(-KEEP) }
}

function withOrder(b: Bridge, hash: string): string[] {
  return b.order.includes(hash) ? b.order : [...b.order, hash]
}

function setReply(b: Bridge, hash: string, reply: Reply): Bridge {
  return trim({ ...b, replies: { ...b.replies, [hash]: reply }, order: withOrder(b, hash) })
}

function str(options: PluginOptions, key: string): string {
  const v = options[key]
  return typeof v === 'string' ? v.trim() : ''
}

/** The `NAME` line of the first `ENV_FILES` file that sets it. */
async function fromEnvFiles($: EngineInterface, name: string): Promise<string> {
  let home: string | undefined
  try {
    home = await $.env.get('HOME')
  } catch {
    return ''
  }
  if (!home) return ''
  for (const file of ENV_FILES) {
    let text: string
    try {
      text = await $.fs.read(`${home}/${file}`)
    } catch {
      continue
    }
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\s*(?:export\s+)?([A-Za-z_]\w*)\s*=\s*(.*?)\s*$/)
      if (m?.[1] !== name) continue
      const value = m[2] ?? ''
      const bare = /^(["']).*\1$/.test(value) ? value.slice(1, -1) : value
      if (bare.trim()) return bare.trim()
    }
  }
  return ''
}

async function apiKey($: EngineInterface, options: PluginOptions): Promise<string> {
  const fromOption = str(options, 'api_key')
  if (fromOption) return fromOption
  const fromFile = await fromEnvFiles($, 'DASHSCOPE_API_KEY')
  if (fromFile) return fromFile
  try {
    return ((await $.env.get('DASHSCOPE_API_KEY')) ?? '').trim()
  } catch {
    return ''
  }
}

/** A direction's default prompts and the options that replace them. */
type Prompts = { system: string; user: string; systemOption: string; userOption: string }

type Result = { text: string; error?: undefined } | { text?: undefined; error: string; isRetryable?: boolean }

async function callModel(
  $: EngineInterface,
  options: PluginOptions,
  prompts: Prompts,
  source: string,
): Promise<Result> {
  const system = str(options, prompts.systemOption) || prompts.system
  const template = str(options, prompts.userOption) || prompts.user
  const key = await apiKey($, options)
  const model = str(options, 'model')
  const baseUrl = str(options, 'base_url').replace(/\/+$/, '')
  if (!key || !model || !baseUrl)
    return {
      error: `翻译模型未配置 ${!key ? 'API Key（api_key、.env 或环境变量 DASHSCOPE_API_KEY）' : !model ? '模型 ID（model）' : 'Base URL（base_url）'}`,
    }

  let extra: Record<string, unknown> = {}
  const extraRaw = str(options, 'extra_body')
  if (extraRaw) {
    try {
      extra = JSON.parse(extraRaw)
    } catch {
      return { error: 'extra_body 不是合法 JSON' }
    }
  }
  const body = {
    ...extra,
    model,
    stream: false,
    messages: [
      ...(system ? [{ role: 'system', content: system }] : []),
      { role: 'user', content: template.includes('{{text}}') ? template.split('{{text}}').join(source) : `${template}\n\n${source}` },
    ],
  }

  const seconds = typeof options.timeout_seconds === 'number' && options.timeout_seconds > 0 ? options.timeout_seconds : 30
  let timer: { cancel: () => void } | undefined
  const timeout = new Promise<'timeout'>(resolve => {
    timer = $.clock.after(seconds * 1000, () => resolve('timeout'))
  })
  try {
    const r = await Promise.race([
      $.http.fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify(body),
      }),
      timeout,
    ])
    if (r === 'timeout') return { error: `请求超时（${seconds} 秒）`, isRetryable: true }
    let json: { choices?: { message?: { content?: unknown } }[]; error?: { message?: string } } = {}
    try {
      json = JSON.parse(r.text)
    } catch {}
    if (!r.ok) {
      const why = json.error?.message ?? r.text.slice(0, 200)
      return { error: `API 错误 ${r.status} ${why}`, isRetryable: r.status === 429 || r.status >= 500 }
    }
    const content = json.choices?.[0]?.message?.content
    const text = typeof content === 'string' ? unwrap(content, source) : ''
    return text ? { text } : { error: '模型返回空文本' }
  } catch (err) {
    return { error: `请求失败：${err instanceof Error ? err.message : String(err)}`, isRetryable: true }
  } finally {
    timer?.cancel()
  }
}

async function translate(
  $: EngineInterface,
  options: PluginOptions,
  prompts: Prompts,
  source: string,
): Promise<Result> {
  const first = await callModel($, options, prompts, source)
  return first.error !== undefined && first.isRetryable ? callModel($, options, prompts, source) : first
}

async function translateReply($: EngineInterface, options: PluginOptions, hash: string, source: string) {
  const r = await translate($, options, TO_CHINESE, source)
  await update($, bridgeAtom, cur => {
    const one = cur.replies[hash]
    if (!one) return cur
    const next: Reply =
      r.error === undefined ? { ...one, status: 'done', text: r.text, error: undefined } : { ...one, status: 'failed', error: r.error }
    return setReply(cur, hash, next)
  })
}

/** Starts a reply's translation unless it is done or under way. */
async function ensureReply($: EngineInterface, options: PluginOptions, hash: string, source: string) {
  let start = false
  await update($, bridgeAtom, cur => {
    const one = cur.replies[hash]
    if (one?.status === 'pending' || one?.status === 'done') return cur
    start = true
    return setReply(cur, hash, { source, status: 'pending', showOriginal: false })
  })
  if (start) await translateReply($, options, hash, source)
}

/** Records that `sent` went out for what the person typed, so its row shows the Chinese. */
async function remember($: EngineInterface, zh: string, sent: string, isEdited: boolean) {
  const hash = await hashOf(sent)
  const one: SentPrompt = { zh, ...(isEdited ? { isEdited: true } : {}) }
  await update($, bridgeAtom, cur => trim({ ...cur, prompts: { ...cur.prompts, [hash]: one }, order: withOrder(cur, hash) }))
}

/** Puts the English in the prompt box; where the surface has no box a plugin can write, the band holds it. */
async function putInBox($: EngineInterface, text: string) {
  const r = await $.prompt.fill({ text, mode: 'replace' })
  if (!r.isFilled) await update($, draftAtom, cur => (cur ? { ...cur, isInBand: true } : cur))
}

/**
 * Translates the Chinese in the prompt box and writes the English in its
 * place. Nothing is submitted: the person reads it, edits it and presses Enter.
 * On a failure the box keeps the Chinese untouched.
 */
async function translateBox($: EngineInterface, options: PluginOptions) {
  if (await read($, translatingAtom)) return
  const box = await $.prompt.read()
  const zh = box.text.trim()
  if (!zh) {
    $.ui.toast('输入框是空的，或者当前界面读不到输入框')
    return
  }
  if (!hasChinese(zh)) {
    $.ui.toast('输入框里没有中文，直接发送就行')
    return
  }
  await update($, translatingAtom, () => true)
  const r = await translate($, options, TO_ENGLISH, zh)
  await update($, translatingAtom, () => false)
  if (r.error !== undefined) {
    $.ui.toast(`翻译失败（${r.error}），输入框里的中文没有改动`)
    return
  }
  await update($, draftAtom, () => ({ zh, en: r.text }))
  await putInBox($, r.text)
}

/** Sends the English draft the band holds, as the person may have edited it. */
async function sendDraft($: EngineInterface) {
  const draft = await read($, draftAtom)
  if (!draft) return
  const text = (draft.edited ?? draft.en).trim()
  if (!text) return
  await remember($, draft.zh, text, text !== draft.en.trim())
  await update($, englishTurnAtom, () => true)
  await update($, draftAtom, () => null)
  await $.prompt.submit({ text, asUser: true })
}

export const register: Register = (on, options) => {
  on('session.start', async ($, e, next) => {
    // A reload drops calls in flight: mark them failed so a press retries.
    await update($, bridgeAtom, cur => {
      let out = cur
      for (const [hash, one] of Object.entries(cur.replies))
        if (one.status === 'pending') out = setReply(out, hash, { ...one, status: 'failed', error: 'mod 重新加载，请求中断' })
      return out
    })
    await update($, translatingAtom, () => false)
    return next(e)
  })

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    return { sections: [...composed.sections.filter(s => s.id !== LANGUAGE_SECTION.id), LANGUAGE_SECTION] }
  })

  on('prompt.submit', async ($, e, next) => {
    if (e.command) return next(e)
    // The band's own send: `sendDraft` has already recorded it.
    if (e.origin.kind === 'plugin') {
      if (e.origin.name !== 'zh-en-bridge') return next(e)
      return next({ ...e, context: [...(e.context ?? []), REPLY_IN_ENGLISH] })
    }
    if (e.isMeta || !TYPED.has(e.origin.kind)) return next(e)

    // A translation from the button, sent as it stands or as the person edited it.
    const draft = await read($, draftAtom)
    if (draft && !hasChinese(e.text)) {
      await remember($, draft.zh, e.text, e.text.trim() !== draft.en.trim())
      await update($, draftAtom, () => null)
      await update($, englishTurnAtom, () => true)
      return next({ ...e, context: [...(e.context ?? []), REPLY_IN_ENGLISH] })
    }
    // Anything else goes out as typed.
    if (draft) await update($, draftAtom, () => null)
    await update($, englishTurnAtom, () => false)
    return next(e)
  })

  // Claude's replies to a translated prompt are translated for display; the
  // row itself is stored unchanged, so the model's context stays English.
  on('session.append', { door: 'response' }, async ($, e, next) => {
    const stored = await next(e)
    if (e.agentId || e.message.type !== 'assistant') return stored
    if (!(await read($, englishTurnAtom))) return stored
    const source = textOf(e.message.content)
    if (!source.trim() || !isMostlyEnglish(source)) return stored
    const hash = await hashOf(source)
    await update($, bridgeAtom, cur => ({ ...cur, byRow: { ...cur.byRow, [e.uuid]: hash } }))
    void ensureReply($, options, hash, source)
    return stored
  })

  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    const bridge = await read($, bridgeAtom)
    const hash = await hashOf(e.props.text)
    const sent = bridge.prompts[hash]
    if (!sent) return next(e)

    const { Box, Text, Button } = $.ui.resolve(e)
    const toggle = async () => {
      await update($, bridgeAtom, cur => {
        const one = cur.prompts[hash]
        return one ? { ...cur, prompts: { ...cur.prompts, [hash]: { ...one, showEnglish: !one.showEnglish } } } : cur
      })
    }
    const drawn = sent.showEnglish ? await next(e) : await next({ ...e, props: { ...e.props, text: sent.zh } })
    return (
      <Box flexDirection="column">
        {drawn}
        <Box flexDirection="row" gap={1} alignItems="center">
          <Button
            key={`prompt-${hash}`}
            label="发送的英文"
            variant={sent.showEnglish ? 'primary' : 'secondary'}
            onPress={toggle}
          />
          <Text size="caption" color="subtle">
            {sent.isEdited ? '已译成英文，经你修改后发送' : '已译成英文发送'}
          </Text>
        </Box>
      </Box>
    )
  })

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if (e.props.isSummary) return next(e)
    const bridge = await read($, bridgeAtom)
    const hash = bridge.byRow[e.requestId] ?? (await hashOf(e.props.text))
    const reply = bridge.replies[hash]
    // A reply not yet translated gets the button once it holds enough English.
    if (!reply && englishWords(e.props.text) < MIN_WORDS) return next(e)

    const { Text, Button, Box } = $.ui.resolve(e)
    const source = reply?.source ?? e.props.text
    // One button: lit while the translation is chosen; pressing it again goes back to the original.
    const isOn = !!reply && reply.status !== 'failed' && !reply.showOriginal
    const press = async () => {
      if (reply && reply.status !== 'failed') {
        await update($, bridgeAtom, cur => {
          const one = cur.replies[hash]
          return one ? setReply(cur, hash, { ...one, showOriginal: !one.showOriginal }) : cur
        })
        return
      }
      $.clock.after(0, () => void ensureReply($, options, hash, source))
    }
    const status =
      isOn && reply?.status === 'pending' ? (
        <Text size="caption" color="subtle">
          正在译成中文…
        </Text>
      ) : reply?.status === 'failed' ? (
        <Text size="caption" color="warning">
          翻译失败（{reply.error ?? '未知原因'}），再点一次重试
        </Text>
      ) : null
    const drawn =
      isOn && reply?.status === 'done' && reply.text ? await next({ ...e, props: { ...e.props, text: reply.text } }) : await next(e)
    // Another plugin's buttons under this reply join this one's on a single row.
    const { rest, actions } = takeActions(drawn)
    return (
      <Box flexDirection="column">
        {rest}
        <Box key={ACTIONS} flexDirection="row" gap={1} alignItems="center" marginTop={1}>
          {actions}
          <Button key={`reply-${hash}`} label="中文译文" variant={isOn ? 'primary' : 'secondary'} onPress={press} />
          {status}
        </Box>
      </Box>
    )
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const draft = await read($, draftAtom)
    const isBusy = await read($, translatingAtom)
    const { Box, Text, Button, Input } = $.ui.resolve(e)
    const bar = (
      <Box flexDirection="row" gap={1} alignItems="center">
        <Button
          key="translate-box"
          label={isBusy ? '翻译中…' : '译成英文'}
          variant="secondary"
          onPress={() => translateBox($, options)}
        />
        <Text size="caption" color="subtle">
          把输入框里的中文译成英文，确认后再按 Enter 发送
        </Text>
      </Box>
    )
    if (!draft?.isInBand) return bar

    // A surface whose prompt box a plugin cannot write: the draft waits here.
    const value = draft.edited ?? draft.en
    const setEdited = (v: string) => void update($, draftAtom, cur => (cur ? { ...cur, edited: v } : cur))
    return (
      <Box flexDirection="column" gap={1}>
        {bar}
        <Text size="caption" color="subtle">
          英文草稿：检查或修改后发送
        </Text>
        <Input
          key="draft"
          value={value}
          rows={Math.min(8, Math.max(3, value.split('\n').length + 1))}
          submitLabel="发送"
          onInput={setEdited}
          onSubmit={v => void update($, draftAtom, cur => (cur ? { ...cur, edited: v } : cur)).then(() => sendDraft($))}
        />
        <Box flexDirection="row" gap={1}>
          <Button key="draft-send" label="发送英文" variant="primary" onPress={() => sendDraft($)} />
          <Button key="draft-discard" label="放弃" variant="secondary" onPress={() => update($, draftAtom, () => null)} />
        </Box>
      </Box>
    )
  })
}
