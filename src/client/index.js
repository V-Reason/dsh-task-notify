/**
 * dsh-task-notify client plugin: the browser half.
 *
 * - a ghost bell button in the session header action row (hollow when push is
 *   off, solid with a small smartphone silhouette when push is on) opening a
 *   minimal glass configuration panel,
 * - the panel lives in `shell.overlay`,
 * - the HOST fires every Windows toast / PushPlus push itself (the client
 *   only polls settings every 10s to keep the bell and panel in sync),
 * - the panel keeps clear of the dsh-better-sidebar right/bottom panels by
 *   measuring their live DOM every animation frame (60fps drag following).
 *
 * The Host owns every durable fact; this half only renders what the Remote
 * returns and forwards user edits back through it.
 */
import React from 'react'
import { INVOCATIONS } from '../contract.js'

export const name = 'dsh-task-notify'
export const inject = ['remote', 'slots']

const STYLE_ID = 'dsh-task-notify-style'

const cssText = `
.dtn_bell {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: 0;
  border-radius: 8px;
  background: none;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}
.dtn_bell:hover {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
}
.dtn_bell[data-on='true'] { color: var(--dsw-alias-brand-primary); }
.dtn_bell[data-open='true'] { background: var(--dsw-alias-interactive-bg-hover); }
.dtn_badge {
  position: absolute;
  top: -3px;
  right: -3px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #ffffff;
  filter: drop-shadow(0 0 1px rgba(0, 0, 0, 0.5));
  pointer-events: none;
}

.dtn_panel {
  position: fixed;
  top: 58px;
  width: 296px;
  padding: 6px 0;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 14px;
  background: var(--dsw-alias-bg-layer-2);
  backdrop-filter: blur(16px);
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.35);
  pointer-events: auto;
  overflow: hidden;
}
.dtn_panelHead {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 14px;
}
.dtn_panelTitle {
  margin: 0;
  color: var(--dsw-alias-label-primary);
  font-size: 13px;
  font-weight: 600;
}
.dtn_close {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border: 0;
  border-radius: 10px;
  background: none;
  color: var(--dsw-alias-label-tertiary);
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
}
.dtn_close:hover {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
}
.dtn_section { padding: 8px 14px; }
.dtn_section + .dtn_section { border-top: 1px solid var(--dsw-alias-border-l1); }
.dtn_section[data-disabled='true'] {
  opacity: 0.45;
  pointer-events: none;
}
.dtn_sectionLabel {
  display: block;
  margin: 0 0 2px;
  color: var(--dsw-alias-label-tertiary);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.dtn_row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-height: 30px;
}
.dtn_rowLabel { color: var(--dsw-alias-label-primary); font-size: 13px; }

.dtn_switch {
  position: relative;
  display: inline-block;
  flex: none;
  width: 32px;
  height: 18px;
}
.dtn_switch input {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  margin: 0;
  opacity: 0;
  cursor: pointer;
}
.dtn_track {
  position: absolute;
  inset: 0;
  border-radius: 9px;
  background: var(--dsw-alias-interactive-bg-hover);
  transition: background 0.15s ease;
  pointer-events: none;
}
.dtn_switch input:checked + .dtn_track { background: var(--dsw-alias-brand-primary); }
.dtn_thumb {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--dsw-alias-label-primary-inverted);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
  transition: transform 0.15s ease;
  pointer-events: none;
}
.dtn_switch input:checked + .dtn_track .dtn_thumb { transform: translateX(14px); }

.dtn_input {
  box-sizing: border-box;
  width: 100%;
  height: 32px;
  margin-top: 8px;
  padding: 0 10px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 8px;
  outline: none;
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
  font-size: 12.5px;
  line-height: 30px;
}
.dtn_input:focus { border-color: var(--dsw-alias-brand-primary); }
.dtn_input::placeholder { color: var(--dsw-alias-label-tertiary); }

.dtn_actions { display: flex; gap: 8px; margin-top: 10px; }
.dtn_primary {
  flex: 1;
  height: 30px;
  border: 0;
  border-radius: 8px;
  background: var(--dsw-alias-button-primary-fill);
  color: var(--dsw-alias-label-primary-inverted);
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
}
.dtn_primary:hover { filter: brightness(1.08); }
.dtn_ghost {
  flex: 1;
  height: 30px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 8px;
  background: none;
  color: var(--dsw-alias-label-secondary);
  font-size: 12.5px;
  cursor: pointer;
}
.dtn_ghost:hover {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
}
.dtn_note {
  margin: 8px 0 0;
  color: var(--dsw-alias-label-tertiary);
  font-size: 12px;
  line-height: 18px;
}
.dtn_note[data-ok='true'] { color: var(--dsw-alias-state-success-primary, #4caf7d); }
.dtn_note[data-ok='false'] { color: var(--dsw-alias-state-error-primary); }
`

function adoptStyles() {
  if (document.getElementById(STYLE_ID) !== null) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = cssText
  document.head.appendChild(style)
}

/** Hollow line bell (Feather-style) for push-off, solid bell for push-on. */
function BellIcon(props) {
  const { solid, ...rest } = props
  if (solid === true) {
    return React.createElement('svg', Object.assign({
      width: 15, height: 15, viewBox: '0 0 24 24', fill: 'currentColor',
    }, rest),
    React.createElement('path', {
      d: 'M12 22c1.1 0 2-.9 2-2h-4c0 1.1.89 2 2 2zm6-6v-5c0-3.07-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z',
    }))
  }
  return React.createElement('svg', Object.assign({
    width: 15, height: 15, viewBox: '0 0 24 24', fill: 'none',
    stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round',
  }, rest),
  React.createElement('path', { d: 'M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9' }),
  React.createElement('path', { d: 'M13.73 21a2 2 0 0 1-3.46 0' }))
}

/** 11px smartphone silhouette for the push-enabled corner badge (no circle). */
function PhoneBadge() {
  return React.createElement('svg', { width: 11, height: 11, viewBox: '0 0 24 24', fill: 'currentColor' },
    React.createElement('path', {
      d: 'M17 1.01 7 1c-1.1 0-2 .9-2 2v18c0 1.1.9 2 2 2h10c1.1 0 2-.9 2-2V3c0-1.1-.9-1.99-2-1.99zM17 19H7V5h10v14z',
    }))
}

export function apply(ctx) {
  adoptStyles()

  let taskNotify
  ctx.effect(async () => {
    const dispose = await ctx.remote.$mount({ package: 'dsh-task-notify', descriptors: INVOCATIONS })
    const reflect = ctx.reflect
    taskNotify = reflect === undefined ? undefined : reflect.get('remote.taskNotify')
    if (taskNotify === undefined) throw new Error('dsh-task-notify: the taskNotify Remote namespace did not mount')
    return () => {
      taskNotify = undefined
      void dispose()
    }
  }, 'dsh-task-notify: remote')

  // Shared stores: panel open state, last settings, and the layout insets
  // needed to keep clear of dsh-better-sidebar's panels.
  let panelOpen = false
  let lastSettings = null
  let sidebarRight = 0
  let sidebarBottom = 0
  const listeners = new Set()
  const emit = () => { for (const l of listeners) l() }
  const setPanelOpen = (next) => { panelOpen = next; emit() }
  const setSettings = (next) => { lastSettings = next; emit() }
  const useSnapshot = () => {
    const [v, setV] = React.useState(0)
    React.useEffect(() => {
      const l = () => setV((n) => n + 1)
      listeners.add(l)
      return () => { listeners.delete(l) }
    }, [])
    return v
  }

  // Best-effort layout adaptation: measure the better-sidebar panels' live
  // DOM every animation frame, so the config panel follows even mid-drag
  // (the store only commits on pointer-up). Only vertically on-screen,
  // right-aligned elements count as the right panel; only horizontally
  // on-screen, bottom-aligned ones as the bottom panel — translated-away
  // hidden panels never contribute an inset.
  let sidebarHost = null
  let hostCheckAt = 0
  const getSidebarHost = () => {
    if (sidebarHost !== null && sidebarHost.isConnected) return sidebarHost
    const now = performance.now()
    if (sidebarHost === null && now - hostCheckAt < 1000) return null
    hostCheckAt = now
    sidebarHost = document.querySelector('[data-dsh-better-sidebar]')
    return sidebarHost
  }
  const refreshInsets = () => {
    let right = 0
    let bottom = 0
    const host = getSidebarHost()
    if (host !== null && host !== undefined) {
      const width = window.innerWidth
      const height = window.innerHeight
      for (const child of host.children) {
        try {
          const rect = child.getBoundingClientRect()
          if (rect.width > 0 && rect.height > 80
            && rect.top >= -8 && rect.top < height
            && rect.left >= 0 && rect.left < width
            && rect.right >= width - 2) {
            right = Math.max(right, Math.min(Math.round(width - rect.left), width - 200))
          }
          if (rect.width > 160 && rect.height > 0
            && rect.left >= -8 && rect.left < width
            && rect.top >= 0 && rect.top < height
            && rect.bottom >= height - 2) {
            bottom = Math.max(bottom, Math.min(Math.round(height - rect.top), height - 160))
          }
        } catch { /* 忽略 */ }
      }
    }
    const better = ctx.get('betterSidebar')
    if (better !== null && better !== undefined) {
      try {
        const snap = better.getSnapshot()
        const state = snap === null || snap === undefined ? undefined : snap.state
        if (state !== null && state !== undefined) {
          if (state.panelOpen === true) right = Math.max(right, Math.min(Number(state.width) || 0, window.innerWidth))
          if (state.bottomOpen === true) bottom = Math.max(bottom, Math.min(Number(state.bottomHeight) || 0, window.innerHeight))
        }
      } catch { /* 忽略 */ }
    }
    if (sidebarRight !== right || sidebarBottom !== bottom) {
      sidebarRight = right
      sidebarBottom = bottom
      emit()
    }
  }
  // 60fps requestAnimationFrame loop; cheap when nothing changes.
  let insetSubscribed = false
  ctx.effect(() => {
    let rafId = 0
    const loop = () => {
      const better = ctx.get('betterSidebar')
      if (!insetSubscribed && better !== null && better !== undefined && typeof better.subscribeState === 'function') {
        insetSubscribed = true
        try {
          better.subscribeState(refreshInsets)
        } catch {
          insetSubscribed = false
        }
      }
      refreshInsets()
      rafId = requestAnimationFrame(loop)
    }
    rafId = requestAnimationFrame(loop)
    refreshInsets()
    const onResize = () => refreshInsets()
    window.addEventListener('resize', onResize)
    return () => {
      cancelAnimationFrame(rafId)
      window.removeEventListener('resize', onResize)
    }
  }, 'dsh-task-notify: layout insets')

  const unwrap = (result) => (result !== null && result !== undefined && result.ok === true) ? result.value : undefined

  const loadSettings = async () => {
    if (taskNotify === undefined) return
    try {
      const value = unwrap(await taskNotify.getSettings())
      if (value !== undefined) setSettings(value)
    } catch (error) {
      console.error('[dsh-task-notify] settings read failed:', error)
    }
  }

  const saveSettings = async (update) => {
    if (taskNotify === undefined) return { ok: false, error: '服务未就绪' }
    try {
      const result = await taskNotify.updateSettings(update)
      if (result !== null && result !== undefined && result.ok === true) {
        setSettings(result.value)
        return { ok: true, value: result.value }
      }
      const err = result === null || result === undefined ? undefined : result.error
      const message = typeof err?.message === 'string' ? err.message : typeof err?.code === 'string' ? err.code : '未知错误'
      console.error('[dsh-task-notify] settings update failed:', err)
      return { ok: false, error: String(message) }
    } catch (error) {
      console.error('[dsh-task-notify] settings update failed:', error)
      return { ok: false, error: String(error?.message ?? error ?? '') }
    }
  }

  const testPush = async () => {
    if (taskNotify === undefined) return { ok: false, error: '服务未就绪' }
    try {
      const value = unwrap(await taskNotify.testPush())
      return value ?? { ok: false, error: '服务未就绪' }
    } catch (error) {
      console.error('[dsh-task-notify] test push failed:', error)
      return { ok: false, error: String(error ?? '') }
    }
  }

  // Poll the host queue every 2.5s and raise one Windows notification per item.
  // Periodic settings refresh: the Host owns all state (Windows toast and
  // PushPlus fire there), so this only keeps the bell and panel in sync
  // across tabs and after host restarts.
  ctx.effect(() => {
    const timer = setInterval(() => { void loadSettings() }, 10000)
    void loadSettings()
    return () => clearInterval(timer)
  }, 'dsh-task-notify: settings refresh')

  function HeaderButton() {
    useSnapshot()
    const settings = lastSettings
    const enabled = settings?.enabled !== false
    const pushOn = enabled && settings?.push === true
    return React.createElement('button', {
      className: 'dtn_bell',
      title: '任务完成提醒',
      'data-on': enabled ? 'true' : 'false',
      'data-open': panelOpen ? 'true' : 'false',
      onClick: () => setPanelOpen(!panelOpen),
    },
    React.createElement(BellIcon, { solid: enabled }),
    pushOn
      ? React.createElement('span', { className: 'dtn_badge' }, React.createElement(PhoneBadge))
      : null)
  }

  function Switch({ checked, onChange }) {
    return React.createElement('label', { className: 'dtn_switch' },
      React.createElement('input', { type: 'checkbox', checked: checked === true, onChange }),
      React.createElement('span', { className: 'dtn_track' },
        React.createElement('span', { className: 'dtn_thumb' })))
  }

  function Panel() {
    useSnapshot()
    const [draft, setDraft] = React.useState(null)
    const [note, setNote] = React.useState(null)
    React.useEffect(() => {
      if (panelOpen) {
        setDraft(null)
        setNote(null)
        void loadSettings()
      }
    }, [panelOpen])
    if (!panelOpen) return null
    const settings = draft ?? lastSettings ?? {
      push: false, token: '', enabled: true, agent: false, subagent: true, workflow: true,
      approval: true, question: true, plan: true, goal: true,
    }
    const masterOn = settings.enabled !== false
    const toggle = (key) => (event) => setDraft(Object.assign({}, settings, { [key]: event.target.checked }))
    const setToken = (event) => setDraft(Object.assign({}, settings, { token: event.target.value }))
    const row = (key, labelText) => React.createElement('div', { className: 'dtn_row', key },
      React.createElement('span', { className: 'dtn_rowLabel' }, labelText),
      React.createElement(Switch, { checked: settings[key] === true, onChange: toggle(key) }))
    const section = (key, dim, children) => React.createElement('div', {
      className: 'dtn_section',
      key,
      'data-disabled': dim && !masterOn ? 'true' : 'false',
    }, ...children)
    const save = async () => {
      const outcome = await saveSettings(draft ?? settings)
      setNote({
        ok: outcome.ok === true,
        text: outcome.ok === true ? '已保存' : '保存失败：' + String(outcome.error ?? ''),
      })
      if (outcome.ok === true) setDraft(null)
    }
    const test = async () => {
      await saveSettings(draft ?? settings)
      const result = await testPush()
      setNote({ ok: result.ok === true, text: result.ok === true ? '测试消息已发送，请查收' : '失败：' + String(result.error ?? '') })
    }
    const testNotify = async () => {
      if (taskNotify === undefined) {
        setNote({ ok: false, text: '服务未就绪' })
        return
      }
      try {
        const value = unwrap(await taskNotify.testNotify())
        const result = value ?? { ok: false, error: '服务未就绪' }
        setNote({
          ok: result.ok === true,
          text: result.ok === true ? '已弹出 Windows 系统通知（含提示音）' : '失败：' + String(result.error ?? ''),
        })
      } catch (error) {
        console.error('[dsh-task-notify] test notify failed:', error)
        setNote({ ok: false, text: '失败：' + String(error?.message ?? error ?? '') })
      }
    }
    return React.createElement('div', {
      className: 'dtn_panel',
      style: { right: 16 + sidebarRight },
    },
    React.createElement('div', { className: 'dtn_panelHead' },
      React.createElement('h4', { className: 'dtn_panelTitle' }, '任务完成提醒'),
      React.createElement('button', { className: 'dtn_close', title: '关闭', onClick: () => setPanelOpen(false) }, '×')),
    section('master', false, [
      React.createElement('div', { className: 'dtn_row' },
        React.createElement('span', { className: 'dtn_rowLabel' }, '总开关'),
        React.createElement(Switch, { checked: masterOn, onChange: toggle('enabled') })),
    ]),
    section('kinds', true, [
      React.createElement('span', { className: 'dtn_sectionLabel' }, '提醒对象'),
      row('agent', '主回合'),
      row('subagent', '子代理'),
      row('workflow', '工作流'),
      row('approval', '需要审批'),
      row('question', '询问用户'),
      row('plan', '计划确认'),
      row('goal', '目标受阻'),
    ]),
    section('push', true, [
      React.createElement('div', { className: 'dtn_row' },
        React.createElement('span', { className: 'dtn_rowLabel' }, '手机推送（PushPlus）'),
        React.createElement(Switch, { checked: settings.push === true, onChange: toggle('push') })),
      React.createElement('input', {
        className: 'dtn_input', type: 'password', placeholder: 'PushPlus Token',
        value: settings.token ?? '', onChange: setToken,
      }),
    ]),
    // Actions live in their own never-dimmed section, so saving the master
    // switch off remains possible.
    React.createElement('div', { className: 'dtn_section' },
      React.createElement('div', { className: 'dtn_actions' },
        React.createElement('button', { className: 'dtn_primary', onClick: save }, '保存'),
        React.createElement('button', { className: 'dtn_ghost', onClick: test }, '测试推送'),
        React.createElement('button', { className: 'dtn_ghost', onClick: testNotify }, '测试通知')),
      note === null ? null : React.createElement('p', { className: 'dtn_note', 'data-ok': note.ok ? 'true' : 'false' }, note.text)))
  }

  ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
    name: 'conversation.session.header.actions',
    id: 'task-notify',
    order: 30,
    label: '任务提醒',
  }, HeaderButton))

  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'task-notify-panel',
    order: 20,
  }, Panel))
}
