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

/** Durable settings section schema (defaults: push off, main-turn off, attention kinds on). */
const SettingsSchema = z.object({
  push: z.boolean().default(false),
  token: z.string().default(''),
  enabled: z.boolean().default(true),
  agent: z.boolean().default(false),
  subagent: z.boolean().default(true),
  workflow: z.boolean().default(true),
  approval: z.boolean().default(true),
  question: z.boolean().default(true),
  plan: z.boolean().default(true),
  goal: z.boolean().default(true),
})

const kindLabel = (kind) =>
  kind === 'subagent' ? '子代理任务'
    : kind === 'workflow' ? '工作流'
      : kind === 'agent' ? 'Agent 回合'
        : kind === 'approval' ? '审批请求'
          : kind === 'question' ? '询问'
            : kind === 'plan' ? '计划确认'
              : kind === 'goal' ? '目标受阻' : '提醒'

/** Per-kind toast / push title. */
const kindTitle = (kind) =>
  kind === 'approval' ? '需要你的审批'
    : kind === 'question' ? 'Agent 正在问你'
      : kind === 'plan' ? '计划待你确认'
        : kind === 'goal' ? '目标受阻'
          : 'Agent任务完成'

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
  blocked: '阻塞',
  interrupted: '中断',
  结束: '结束',
  需要审批: '需要审批',
  等待回答: '等待回答',
  等待确认: '等待确认',
  需要处理: '需要处理',
}
const statusLabel = (status) => STATUS_TEXT[status] ?? String(status)

/** The push content template lines: 会话 / 时间 / 描述 (+ optional detail). */
const bodyLines = (item) => {
  const lines = [
    '会话：' + item.title,
    '时间：' + fmtDate(item.at),
    '描述：' + statusLabel(item.status),
  ]
  if (typeof item.detail === 'string' && item.detail !== '') lines.push(item.detail)
  return lines
}
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

  /**
   * The session's effective approval policy: its own `approval/policy` fold
   * (per-session override, e.g. a permission-preset switch), else the
   * deployment default from the ApprovalService config. The seam is optional
   * (`ctx.get('approval')`); without it no ask can ever be raised, so the
   * fallback value only decides whether a hypothetical ask would notify.
   */
  const effectiveApprovalPolicy = (session) => {
    try {
      const approval = ctx.get('approval')
      if (approval === undefined) return 'ask'
      const override = approval.overrideOf(session)
      if (override !== undefined) return override
      const policy = approval.config?.policy
      if (policy !== undefined) return policy
      return 'ask'
    } catch {
      return 'ask'
    }
  }

  /**
   * Whether plan mode is in force for a session: the last logged `plan/mode`
   * wins, a log with none folds to inactive. Same fold as the harness's
   * `foldPlanMode`, re-implemented here to avoid a new peer dependency.
   */
  const planModeActive = (session) => {
    if (session === undefined || session === null) return false
    let active = false
    try {
      for (const event of session.events) {
        if (event.type === 'plan/mode') active = event.data.active === true
      }
    } catch { /* 忽略 */ }
    return active
  }

  /** The plan's first markdown heading (any level), or undefined when it has none. */
  const planHeading = (plan) => {
    for (const line of String(plan).split('\n')) {
      const match = /^#{1,6}\s+(.+?)\s*$/.exec(line)
      if (match !== null) return match[1]
    }
    return undefined
  }

  /**
   * Whether the event's session is a LIVE ROOT agent. Interactive asks
   * (`ask_user_question`, `exit_plan_mode`) throw DELEGATED_CALLER for
   * agents owned by another live agent — the question never reaches the
   * user, so a `tool/call` there must not notify. Without the agents
   * registry (headless compositions) nothing is suppressed.
   */
  const isLiveRootSession = (session) => {
    if (session === undefined || session === null) return true
    const agents = ctx.get('agents')
    if (agents === undefined) return true
    try {
      const agent = agents.get(session.id)
      if (agent === undefined || agent.session !== session) return true
      return agents.roots().includes(agent)
    } catch {
      return true
    }
  }

  /** Label of the last `turn/end` reason for the session (fallback 结束). */
  const turnEndLabel = (session) => {
    if (session === undefined || session === null) return '结束'
    try {
      for (let index = session.events.length - 1; index >= 0; index -= 1) {
        const event = session.events[index]
        if (event.type !== 'turn/end') continue
        const label = STATUS_TEXT[event.data?.reason?.kind]
        return label ?? '结束'
      }
    } catch { /* 忽略 */ }
    return '结束'
  }

  /**
   * Attention notifications: the agent stopped and the USER must act.
   *  - approval/asked: an approval question reached the answerer chain
   *    (escalation / privileged execution). Notify only under policy `ask`
   *    — under `never` the ask is auto-rejected and no manual elevation is
   *    possible.
   *  - tool/call ask_user_question: the agent actively paused to consult the
   *    user (plain questions and plan-review intents alike).
   * session/event is a live, post-commit append feed (no startup replay), so
   * every event here is a fresh ask; dedup keys are the durable ids.
   */
  ctx.on('session/event', (session, event) => {
    if (event.type === 'approval/asked') {
      if (!settings.get().approval) return
      if (effectiveApprovalPolicy(session) !== 'ask') return
      const root = rootOf(session) ?? currentRoot
      if (root !== undefined) currentRoot = root
      const toolName = String(event.data.toolName ?? '')
      const reason = event.data.reason
      notify('ap:' + String(event.data.id), {
        kind: 'approval',
        title: titleOf(root) ?? titleOf(session) ?? 'Agent 回合',
        status: '需要审批',
        detail: '工具：' + toolName + (typeof reason === 'string' && reason !== '' ? '，原因：' + reason : ''),
      })
      return
    }
    if (event.type === 'tool/call' && event.data.name === 'ask_user_question') {
      if (!settings.get().question) return
      // A delegated child's ask fails with DELEGATED_CALLER before any UI
      // shows it — only live root agents can pause for a human answer.
      if (!isLiveRootSession(session)) return
      const root = rootOf(session) ?? currentRoot
      if (root !== undefined) currentRoot = root
      // arguments is a JSON string; the first question text becomes the
      // notification's detail line. Fail soft on any malformed payload.
      let text = ''
      try {
        const args = JSON.parse(String(event.data.arguments ?? '{}'))
        const first = Array.isArray(args?.questions) ? args.questions[0] : undefined
        if (first !== null && first !== undefined && typeof first.question === 'string') {
          text = first.question
        }
      } catch { /* 忽略格式问题 */ }
      if (text.length > 100) text = text.slice(0, 100) + '…'
      notify('qu:' + String(event.data.callId), {
        kind: 'question',
        title: titleOf(root) ?? titleOf(session) ?? 'Agent 回合',
        status: '等待回答',
        detail: text === '' ? '（请查看界面）' : text,
      })
      return
    }
    // Plan review: the agent called exit_plan_mode and is blocked on the
    // user's approve / keep-planning decision (the plan-review intent of the
    // user-questions channel). tool/call fires at dispatch, exactly when the
    // plan is presented. Every guard mirrors a path where the tool fails
    // BEFORE the review can appear — no guard, no toast.
    if (event.type === 'tool/call' && event.data.name === 'exit_plan_mode') {
      if (!settings.get().plan) return
      if (!isLiveRootSession(session)) return
      if (ctx.get('userQuestions') === undefined) return
      if (!planModeActive(session)) return
      let plan = ''
      try {
        const args = JSON.parse(String(event.data.arguments ?? '{}'))
        if (typeof args?.plan === 'string') plan = args.plan
      } catch { /* 忽略格式问题 */ }
      if (!/^#\s+\S/.test(plan.trim())) return
      const heading = planHeading(plan)
      const excerpt = plan
        .replace(/^#{1,6}\s+.*$/m, '') // 去掉标题行
        .trim().replace(/\s+/g, ' ') // 压平换行
      const excerptText = excerpt.length > 60 ? excerpt.slice(0, 60) + '…' : excerpt
      const root = rootOf(session) ?? currentRoot
      if (root !== undefined) currentRoot = root
      notify('pr:' + String(event.data.callId), {
        kind: 'plan',
        title: titleOf(root) ?? titleOf(session) ?? 'Agent 回合',
        status: '等待确认',
        detail: '标题：' + (heading ?? '（无标题）')
          + (excerptText === '' ? '' : '\n摘要：' + excerptText),
      })
      return
    }
    // Goal blocked: the autonomous goal run ended on a persistent blocker
    // (model-reported or round-limit) — the user must resolve it or clear
    // the goal. Durable `goal/change` operation 'block' carries the full
    // snapshot; the fold invariant guarantees phase 'blocked' with a reason.
    if (event.type === 'goal/change' && event.data?.operation === 'block') {
      if (!settings.get().goal) return
      const goal = event.data.goal
      const message = goal?.blockedReason?.message
      const reason = typeof message === 'string' && message !== ''
        ? (message.length > 120 ? message.slice(0, 120) + '…' : message)
        : '（未提供原因）'
      const root = rootOf(session) ?? currentRoot
      if (root !== undefined) currentRoot = root
      notify('goal:' + String(goal?.id ?? '') + ':' + String(goal?.revision ?? ''), {
        kind: 'goal',
        title: titleOf(root) ?? titleOf(session) ?? 'Agent 回合',
        status: '需要处理',
        detail: '原因：' + reason,
      })
    }
  })

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
    const title = kindTitle(item.kind)
    // Desktop channel: a real Windows toast with the system notification sound.
    showWindowsToast(title, bodyLines(item)).then((outcome) => {
      if (outcome.ok !== true) console.error('[dsh-task-notify] windows toast failed:', outcome.error)
    }, () => {})
    if (s.push && s.token !== '') {
      pushToPushPlus(s.token, title, pushBody(item)).catch((error) => {
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
      // Enrich the generic 结束 with the last turn/end reason (完成/中止/
      // 失败/超出上限/中断/阻塞), so abnormal stops stand out.
      status: turnEndLabel(agent.session),
    })
  })

  // Strict endpoint registration: the gateway resolves taskNotify/* from
  // this manifest, independent of decorator marker state.
  ctx.effect(() => {
    const dispose = ctx.typert.register(TYPERT_MANIFEST)
    return () => { void dispose() }
  }, 'dsh-task-notify: typert manifest')
}
