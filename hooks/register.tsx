import { atom, read, update } from 'claude-code'
import type { EngineInterface, PluginOptions, Register } from 'claude-code'

import type { Bridge, Reply } from '../types'

/**
 * Where the Qwen key may be, under the home directory, after the
 * `qwen_api_key` option: this plugin's data folder, then readable-rewrite-cn's
 * (the same DashScope key serves both), then `DASHSCOPE_API_KEY` itself.
 */
const ENV_FILES = [
  '.claude/plugins/data/zh-en-bridge-zh-en-bridge/.env',
  '.claude/plugins/data/readable-rewrite-cn-readable-rewrite-cn/.env',
]
const KEEP = 400
/** Who may have typed a prompt: the person, at a terminal, the desktop app or a remote. */
const TYPED = new Set(['composer', 'sdk', 'bridge'])

const TO_ENGLISH = {
  system:
    'You are a translator. Translate the text inside <text> from Chinese into clear, precise English that an AI coding assistant will read as the user\'s request. Keep code, commands, file paths, identifiers, URLs, quoted strings, and everything inside backticks or code blocks exactly as written. Keep proper nouns and technical terms. Keep the Markdown structure and line breaks. Translate only: do not answer, execute, or comment on the text, and do not add anything.',
  user: '<text>\n{{text}}\n</text>\n\nOutput only the English translation, without the <text> tags and without wrapping it in a code block.',
}
const TO_CHINESE = {
  system: '你是一名翻译，擅长把技术性的英文翻译成清晰易懂的简体中文。',
  user: '<原文>\n{{text}}\n</原文>\n\n把上面的原文翻译成清晰易懂的简体中文。代码、命令、文件路径、标识符、URL 和代码块保持原样；专业术语和人名保留英文原词。保留 Markdown 结构。只输出译文，不要解释，不要带 <原文> 标签，也不要用代码框包裹。',
}
/** Rides beside a translated prompt, for the model alone. */
const REPLY_IN_ENGLISH =
  'The user wrote this message in Chinese; it was machine-translated into English. Reply in English: your reply is translated back into Chinese for them.'

const enabledAtom = atom({ plugin: 'zh-en-bridge', key: 'enabled' } as const, null as boolean | null, {
  shape: 'enabled-1',
})
const englishTurnAtom = atom({ plugin: 'zh-en-bridge', key: 'englishTurn' } as const, false, { shape: 'englishTurn-1' })
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
  const fromOption = str(options, 'qwen_api_key')
  if (fromOption) return fromOption
  const fromFile = await fromEnvFiles($, 'DASHSCOPE_API_KEY')
  if (fromFile) return fromFile
  try {
    return ((await $.env.get('DASHSCOPE_API_KEY')) ?? '').trim()
  } catch {
    return ''
  }
}

type Result = { text: string; error?: undefined } | { text?: undefined; error: string; isRetryable?: boolean }

async function callQwen(
  $: EngineInterface,
  options: PluginOptions,
  prompts: { system: string; user: string },
  source: string,
): Promise<Result> {
  const key = await apiKey($, options)
  const model = str(options, 'qwen_model')
  const baseUrl = str(options, 'qwen_base_url').replace(/\/+$/, '')
  if (!key || !model || !baseUrl)
    return {
      error: `通义未配置 ${!key ? 'API Key（qwen_api_key、.env 或环境变量 DASHSCOPE_API_KEY）' : !model ? '模型 ID' : 'Base URL'}`,
    }

  let extra: Record<string, unknown> = {}
  const extraRaw = str(options, 'qwen_extra_body')
  if (extraRaw) {
    try {
      extra = JSON.parse(extraRaw)
    } catch {
      return { error: 'qwen_extra_body 不是合法 JSON' }
    }
  }
  const body = {
    ...extra,
    model,
    stream: false,
    messages: [
      { role: 'system', content: prompts.system },
      { role: 'user', content: prompts.user.split('{{text}}').join(source) },
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
  prompts: { system: string; user: string },
  source: string,
): Promise<Result> {
  const first = await callQwen($, options, prompts, source)
  return first.error !== undefined && first.isRetryable ? callQwen($, options, prompts, source) : first
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

/** The person's pick in this session; none yet, the `enabled_by_default` option. */
async function isEnabled($: EngineInterface, options: PluginOptions): Promise<boolean> {
  return (await read($, enabledAtom)) ?? options.enabled_by_default === true
}

async function setEnabled($: EngineInterface, value: boolean) {
  await update($, enabledAtom, () => value)
  $.ui.status(value ? '中→英 发送：开' : undefined)
}

export const register: Register = (on, options) => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'en',
      description: '英文模式：/en on（中文 prompt 译成英文发送，回复译回中文）| off | 不带参数切换',
    })
    $.ui.status((await isEnabled($, options)) ? '中→英 发送：开' : undefined)
    // A reload drops calls in flight: mark them failed so a press retries.
    await update($, bridgeAtom, cur => {
      let out = cur
      for (const [hash, one] of Object.entries(cur.replies))
        if (one.status === 'pending') out = setReply(out, hash, { ...one, status: 'failed', error: 'mod 重新加载，请求中断' })
      return out
    })
    return next(e)
  })

  on('command.run', { command: 'en' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    const cur = await isEnabled($, options)
    const value = arg === 'on' ? true : arg === 'off' ? false : arg === '' ? !cur : undefined
    if (value === undefined) return { text: '用法：/en on | off，不带参数则切换' }
    await setEnabled($, value)
    return {
      text: value
        ? '英文模式已开：之后发出的中文会先译成英文，Claude 用英文回复，界面显示中文译文。'
        : '英文模式已关：prompt 按原文发送。',
    }
  })

  on('prompt.submit', async ($, e, next) => {
    if (e.command || e.isMeta || !TYPED.has(e.origin.kind)) return next(e)
    if (!(await isEnabled($, options))) {
      await update($, englishTurnAtom, () => false)
      return next(e)
    }
    const context = [...(e.context ?? []), REPLY_IN_ENGLISH]
    if (!hasChinese(e.text)) {
      await update($, englishTurnAtom, () => true)
      return next({ ...e, context })
    }

    $.ui.status('正在把 prompt 译成英文…')
    const r = await translate($, options, TO_ENGLISH, e.text)
    $.ui.status('中→英 发送：开')
    if (r.error !== undefined) {
      $.ui.toast(`翻译失败，已按中文原文发送：${r.error}`)
      await update($, englishTurnAtom, () => false)
      return next(e)
    }
    const hash = await hashOf(r.text)
    await update($, bridgeAtom, cur =>
      trim({ ...cur, prompts: { ...cur.prompts, [hash]: { zh: e.text } }, order: withOrder(cur, hash) }),
    )
    await update($, englishTurnAtom, () => true)
    return next({ ...e, text: r.text, context })
  })

  // Claude's replies in an English turn are translated for display; the row
  // itself is stored unchanged, so the model's context stays English.
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
          <Text size="caption" color="subtle">
            {sent.showEnglish ? '实际发送的英文' : '已译成英文发送'}
          </Text>
          <Button
            key={`prompt-${hash}`}
            label={sent.showEnglish ? '看中文' : '看英文'}
            variant="secondary"
            onPress={toggle}
          />
        </Box>
      </Box>
    )
  })

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if (e.props.isSummary) return next(e)
    const bridge = await read($, bridgeAtom)
    const hash = bridge.byRow[e.requestId] ?? (await hashOf(e.props.text))
    const reply = bridge.replies[hash]
    // An English reply from a turn sent as typed gets a button, nothing more.
    if (!reply && !isMostlyEnglish(e.props.text)) return next(e)

    const { Box, Text, Button } = $.ui.resolve(e)
    const source = reply?.source ?? e.props.text
    const translateNow = () => {
      $.clock.after(0, () => void ensureReply($, options, hash, source))
    }
    const toggle = async () => {
      await update($, bridgeAtom, cur => {
        const one = cur.replies[hash]
        return one ? setReply(cur, hash, { ...one, showOriginal: !one.showOriginal }) : cur
      })
    }

    if (reply?.status === 'done' && reply.text) {
      const drawn = reply.showOriginal ? await next(e) : await next({ ...e, props: { ...e.props, text: reply.text } })
      return (
        <Box flexDirection="column">
          {drawn}
          <Box flexDirection="row" gap={1} alignItems="center" marginTop={1}>
            <Text size="caption" color="subtle">
              {reply.showOriginal ? 'Claude 的英文原文' : '通义译文'}
            </Text>
            <Button
              key={`reply-${hash}`}
              label={reply.showOriginal ? '看中文' : '看原文'}
              variant="secondary"
              onPress={toggle}
            />
          </Box>
        </Box>
      )
    }

    const footer =
      reply?.status === 'pending' ? (
        <Text size="caption" color="subtle">
          正在译成中文…
        </Text>
      ) : (
        <Box flexDirection="row" gap={1} alignItems="center">
          {reply?.status === 'failed' ? (
            <Text size="caption" color="warning">
              翻译失败（{reply.error ?? '未知原因'}）
            </Text>
          ) : null}
          <Button
            key={`reply-${hash}`}
            label={reply?.status === 'failed' ? '重试翻译' : '译成中文'}
            variant="secondary"
            onPress={translateNow}
          />
        </Box>
      )
    return (
      <Box flexDirection="column">
        {await next(e)}
        <Box marginTop={1}>{footer}</Box>
      </Box>
    )
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const enabled = await isEnabled($, options)
    const { Box, Text, Button } = $.ui.resolve(e)
    return (
      <Box flexDirection="row" gap={1} alignItems="center">
        <Text size="caption" color="subtle">
          {enabled ? '发送前把中文译成英文，回复译回中文' : '按原文发送'}
        </Text>
        <Button
          key="toggle-english"
          label={enabled ? '英文模式：开' : '英文模式：关'}
          variant={enabled ? 'primary' : 'secondary'}
          onPress={() => setEnabled($, !enabled)}
        />
      </Box>
    )
  })
}
