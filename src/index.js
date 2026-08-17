/**
 * dsh-task-notify host plugin.
 *
 * Listens for Agent/subagent/workflow completion, queues one small owned JSON
 * item per completion, pushes to PushPlus when enabled, and exposes the
 * `taskNotify` Typert Remote (settings read/write, queue poll, push test).
 * Settings live in the durable `task-notify` settings namespace, so the
 * configuration survives process restarts. The client half ships in the same
 * package (`./client`); the web server serves it under
 * /plugins/dsh-task-notify/client.js.
 */
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import z from '@deepseek-ai/schemastery'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { INVOCATIONS, TYPERT_MANIFEST } from './contract.js'

/** Cordis plugin name (the Loader entry and client bundle id). */
export const name = 'dsh-task-notify'

/** Services required before load: the Typert registry and the settings provider. */
export const inject = ['typert', 'settings']

/** The branded settings namespace. */
const NS = settingsNamespace('task-notify')

/**
 * Absolute path of the DeepSeek app logo (deepseek.png at the package root),
 * resolved from this bundled module (…/lib/index.js → package root).
 */
const ICON_PATH = fileURLToPath(new URL('../deepseek.png', import.meta.url))

/** Durable settings section schema (defaults: push off, main-turn off). */
const SettingsSchema = z.object({
  push: z.boolean().default(false),
  token: z.string().default(''),
  enabled: z.boolean().default(true),
  agent: z.boolean().default(false),
  subagent: z.boolean().default(true),
  workflow: z.boolean().default(true),
})

const kindLabel = (kind) =>
  kind === 'subagent' ? '子代理任务' : kind === 'workflow' ? '工作流' : kind === 'agent' ? 'Agent 回合' : '提醒'

/** '2026/8/17 13:37:53' */
const fmtDate = (at) => {
  const d = new Date(at)
  const p = (n) => (n < 10 ? '0' + n : String(n))
  return d.getFullYear() + '/' + (d.getMonth() + 1) + '/' + d.getDate()
    + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds())
}

const STATUS_TEXT = {
  completed: '完成',
  aborted: '中止',
  error: '失败',
  'max-tokens': '超出上限',
  refusal: '拒绝',
  cancelled: '取消',
  结束: '结束',
}
const statusLabel = (status) => STATUS_TEXT[status] ?? String(status)

/** The push content template lines: 会话 / 时间 / 描述. */
const bodyLines = (item) => [
  '会话：' + item.title,
  '时间：' + fmtDate(item.at),
  '描述：' + statusLabel(item.status),
]
const pushBody = (item) => bodyLines(item).join('\n')

/**
 * Show a REAL Windows toast notification through the BurntToast PowerShell
 * module (New-BurntToastNotification), run by pwsh (PowerShell 7 — the
 * BurntToast module lives in the pwsh module path, Windows PowerShell 5.1
 * does not see it). The toast carries the DeepSeek app logo (deepseek.png)
 * and the OS plays its default notification sound. Fails quietly (never
 * throws).
 */
const showWindowsToast = (title, lines) => new Promise((resolve) => {
  // BurntToast's -Text accepts at most 3 entries: bold title + 2 body lines;
  // fold any extra body lines into the last entry, separated by a newline.
  const texts = [title, ...lines]
  while (texts.length > 3) {
    const last = texts.pop()
    texts[texts.length - 1] += '\n' + last
  }
  const payload = Buffer.from(JSON.stringify(texts), 'utf8').toString('base64')
  const script = [
    'Import-Module BurntToast',
    `$t=[System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${payload}')) | ConvertFrom-Json`,
    `New-BurntToastNotification -Text $t -AppLogo '${ICON_PATH}'`,
  ].join(';')
  try {
    const child = spawn('pwsh.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      windowsHide: true,
      stdio: 'ignore',
    })
    child.on('error', (error) => {
      console.error('[dsh-task-notify] toast spawn failed:', error)
      resolve({ ok: false, error: String(error?.message ?? error) })
    })
    child.on('exit', (code) => {
      resolve(code === 0 ? { ok: true } : { ok: false, error: 'powershell 退出码 ' + String(code) })
    })
  } catch (error) {
    resolve({ ok: false, error: String(error?.message ?? error) })
  }
})

/** Fire one PushPlus POST; resolves the API outcome, never throws. */
async function pushToPushPlus(token, title, content) {
  let response
  try {
    response = await fetch('https://www.pushplus.plus/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
      body: new URLSearchParams({ token, title, content, template: 'txt' }).toString(),
      signal: AbortSignal.timeout(15000),
    })
  } catch (error) {
    console.error('[dsh-task-notify] pushplus request failed:', error)
    return { ok: false, error: '网络请求失败' }
  }
  const text = await response.text()
  if (text.includes('code":200') || text.includes('code": 200')) return { ok: true }
  console.error('[dsh-task-notify] pushplus rejected:', text.slice(0, 200))
  return { ok: false, error: '推送被拒绝（检查 Token）' }
}

/**
 * The `taskNotify` Remote service: settings access, the pending queue, and
 * the PushPlus test button. Registered under the `taskNotify` service key.
 */
class TaskNotifyRuntime extends TypertRemoteService {
  constructor(ctx, settings) {
    super(ctx, 'taskNotify')
    this.settings = settings
    this.queue = []
  }

  getSettings() {
    return this.settings.get()
  }

  async updateSettings(update) {
    await this.settings.update(update ?? {})
    return this.settings.get()
  }

  next() {
    if (this.queue.length === 0) return []
    const items = this.queue.slice(0, 10)
    this.queue = []
    return items
  }

  async testPush() {
    const s = this.settings.get()
    if (!s.push || s.token === '') return { ok: false, error: '请先开启推送并填写 Token' }
    return await pushToPushPlus(s.token, 'Agent任务完成', pushBody({ title: '测试会话', status: '测试消息', at: Date.now() }))
  }

  async testNotify() {
    return await showWindowsToast('Agent任务完成', bodyLines({ title: '测试会话', status: 'Windows 通知正常', at: Date.now() }))
  }
}

/**
 * Mount the completion listeners and the Remote service.
 * @param ctx - host cordis context.
 */
export function apply(ctx) {
  const settings = ctx.settings.register(NS, SettingsSchema, { applies: 'live' })
  const runtime = new TaskNotifyRuntime(ctx, settings)

  const sessions = ctx.get('sessions')
  const titleOf = (session) => {
    if (session === undefined || session === null) return undefined
    try {
      const snap = ctx.get('sessionTitle')?.get(session)
      return typeof snap?.title === 'string' && snap.title !== '' ? snap.title : undefined
    } catch {
      return undefined
    }
  }

  // Walk a session lineage up to the root conversation (parentSession chain),
  // so 会话 always names the CURRENT conversation, not the child task's own.
  const rootOf = (session) => {
    if (session === undefined || session === null) return undefined
    let current = session
    const seenIds = new Set()
    while (current !== undefined && current !== null) {
      const id = String(current.id)
      if (seenIds.has(id)) break
      seenIds.add(id)
      const parentId = current.header === null || current.header === undefined
        ? undefined
        : current.header.parentSession
      if (parentId === undefined || parentId === null || parentId === '') break
      const parent = sessions === undefined ? undefined : sessions.get(parentId)
      if (parent === undefined || parent === null) break
      current = parent
    }
    return current
  }
  // The most recently observed root session — the workflow fallback when the
  // event carries no session lineage (workflow/end has none).
  let currentRoot = undefined

  // 3-second dedup window: a subagent's own `agent/status` idle lands right
  // after its `subagent/end`; only the first of the pair becomes a toast.
  const seen = new Map()
  const notify = (key, msg) => {
    const s = settings.get()
    if (s.enabled !== true) return
    const now = Date.now()
    const last = seen.get(key)
    if (last !== undefined && now - last < 3000) return
    seen.set(key, now)
    if (seen.size > 200) {
      for (const [k, t] of seen) if (now - t >= 3000) seen.delete(k)
    }
    const item = Object.assign({ at: now }, msg)
    runtime.queue.push(item)
    if (runtime.queue.length > 20) runtime.queue.shift()
    // Desktop channel: a real Windows toast with the system notification sound.
    showWindowsToast('Agent任务完成', bodyLines(item)).then((outcome) => {
      if (outcome.ok !== true) console.error('[dsh-task-notify] windows toast failed:', outcome.error)
    }, () => {})
    if (s.push && s.token !== '') {
      pushToPushPlus(s.token, 'Agent任务完成', pushBody(item)).catch((error) => {
        console.error('[dsh-task-notify] push failed:', error)
      })
    }
  }

  ctx.on('subagent/end', (info) => {
    if (!settings.get().subagent) return
    const id = info === null || info === undefined ? undefined : info.id
    const child = sessions?.get(id)
    const root = rootOf(child) ?? currentRoot
    if (root !== undefined) currentRoot = root
    notify(String(id ?? info?.runId ?? 'subagent'), {
      kind: 'subagent',
      title: titleOf(root) ?? titleOf(child) ?? String(info?.provider ?? '子代理'),
      status: String(info?.stopReason ?? '结束'),
    })
  })

  ctx.on('workflow/end', (info, result) => {
    if (!settings.get().workflow) return
    notify('wf:' + String(info?.id ?? ''), {
      kind: 'workflow',
      title: titleOf(currentRoot) ?? (typeof info?.meta?.name === 'string' ? info.meta.name : '工作流'),
      status: String(result?.stopReason ?? '结束'),
    })
  })

  ctx.on('agent/status', (payload) => {
    if (!settings.get().agent) return
    if (payload?.status !== 'idle') return
    const agent = payload === null || payload === undefined ? undefined : payload.agent
    if (agent === undefined || agent === null) return
    const root = rootOf(agent.session)
    if (root !== undefined) currentRoot = root
    notify(String(agent.id), {
      kind: 'agent',
      title: titleOf(root) ?? titleOf(agent.session) ?? 'Agent 回合',
      status: '结束',
    })
  })

  // Strict endpoint registration: the gateway resolves taskNotify/* from
  // this manifest, independent of decorator marker state.
  ctx.effect(() => {
    const dispose = ctx.typert.register(TYPERT_MANIFEST)
    return () => { void dispose() }
  }, 'dsh-task-notify: typert manifest')
}
