/**
 * The taskNotify wire contract, shared verbatim by the host manifest
 * (`ctx.typert.register` in src/index.js) and the client contribution
 * (`ctx.remote.$mount` in src/client/index.js). Every boundary carries a
 * STRICT codec: the client-side gateway refuses src-json descriptors
 * (`requireStrictDescriptor`), so loose codecs break the client mount.
 *
 * Codec schemas are hand-rolled `TypertSchema` objects (a `parse` method is
 * the whole runtime contract) — no zod dependency, so both bundles stay tiny.
 */

const fail = (path, expected) => {
  throw new Error(`dsh-task-notify: invalid ${path} (expected ${expected})`)
}
const isBool = (value) => typeof value === 'boolean'
const isStr = (value) => typeof value === 'string'
const isNum = (value) => typeof value === 'number' && Number.isFinite(value)
const isObj = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

/** Durable settings section shape (host and client share it). */
const settingsSchema = {
  parse(value) {
    if (!isObj(value)) fail('settings', 'object')
    for (const key of ['push', 'agent', 'subagent', 'workflow']) {
      if (!isBool(value[key])) fail('settings.' + key, 'boolean')
    }
    if (value.enabled !== undefined && !isBool(value.enabled)) fail('settings.enabled', 'boolean')
    if (!isStr(value.token)) fail('settings.token', 'string')
    return {
      push: value.push,
      token: value.token,
      // Absent `enabled` (pre-restart host, which lacks the field) means on.
      enabled: value.enabled === undefined ? true : value.enabled,
      agent: value.agent,
      subagent: value.subagent,
      workflow: value.workflow,
    }
  },
}

const ITEM_KINDS = ['subagent', 'workflow', 'agent', 'test']

/** One completion notification, owned JSON produced by the Host. */
const itemSchema = {
  parse(value) {
    if (!isObj(value)) fail('item', 'object')
    if (!ITEM_KINDS.includes(value.kind)) fail('item.kind', 'subagent|workflow|agent|test')
    if (!isStr(value.title)) fail('item.title', 'string')
    if (!isStr(value.status)) fail('item.status', 'string')
    if (!isNum(value.at)) fail('item.at', 'number')
    return { kind: value.kind, title: value.title, status: value.status, at: value.at }
  },
}

/** The pending-queue result of `next()`. */
const itemListSchema = {
  parse(value) {
    if (!Array.isArray(value)) fail('items', 'array')
    return value.map((item) => itemSchema.parse(item))
  },
}

/** testPush outcome. */
const testResultSchema = {
  parse(value) {
    if (!isObj(value)) fail('testResult', 'object')
    if (!isBool(value.ok)) fail('testResult.ok', 'boolean')
    const result = { ok: value.ok }
    if (value.error !== undefined) {
      if (!isStr(value.error)) fail('testResult.error', 'string')
      result.error = value.error
    }
    return result
  },
}

/** The taskNotify Remote namespace's strict invocation descriptors. */
export const INVOCATIONS = [
  {
    id: 'dsh-task-notify#taskNotify/getSettings',
    service: 'taskNotify',
    namespace: 'taskNotify',
    method: 'getSettings',
    invocation: { kind: 'direct' },
    parameters: [],
    result: {
      mode: 'strict',
      typeSymbol: 'dsh-task-notify#TaskNotifySettings',
      schema: settingsSchema,
    },
  },
  {
    id: 'dsh-task-notify#taskNotify/updateSettings',
    service: 'taskNotify',
    namespace: 'taskNotify',
    method: 'updateSettings',
    invocation: { kind: 'direct' },
    parameters: [
      {
        name: 'update',
        wire: 'update',
        source: 'json',
        codec: {
          mode: 'strict',
          typeSymbol: 'dsh-task-notify#TaskNotifySettings',
          schema: settingsSchema,
        },
      },
    ],
    result: {
      mode: 'strict',
      typeSymbol: 'dsh-task-notify#TaskNotifySettings',
      schema: settingsSchema,
    },
  },
  {
    id: 'dsh-task-notify#taskNotify/next',
    service: 'taskNotify',
    namespace: 'taskNotify',
    method: 'next',
    invocation: { kind: 'direct' },
    parameters: [],
    result: {
      mode: 'strict',
      typeSymbol: 'dsh-task-notify#TaskNotifyItem[]',
      schema: itemListSchema,
    },
  },
  {
    id: 'dsh-task-notify#taskNotify/testPush',
    service: 'taskNotify',
    namespace: 'taskNotify',
    method: 'testPush',
    invocation: { kind: 'direct' },
    parameters: [],
    result: {
      mode: 'strict',
      typeSymbol: 'dsh-task-notify#TaskNotifyTestResult',
      schema: testResultSchema,
    },
  },
  {
    id: 'dsh-task-notify#taskNotify/testNotify',
    service: 'taskNotify',
    namespace: 'taskNotify',
    method: 'testNotify',
    invocation: { kind: 'direct' },
    parameters: [],
    result: {
      mode: 'strict',
      typeSymbol: 'dsh-task-notify#TaskNotifyTestResult',
      schema: testResultSchema,
    },
  },
]

/** The taskNotify namespace's strict host manifest (shared with the client). */
export const TYPERT_MANIFEST = {
  package: 'dsh-task-notify',
  face: 'host',
  schemas: [],
  model: {
    services: [
      {
        key: 'taskNotify',
        exportName: 'TaskNotifyRuntime',
        description: 'Agent/subagent/workflow completion queue, PushPlus push, and durable settings.',
        tags: [],
        members: [
          { kind: 'method', name: 'getSettings', signature: 'getSettings(): TaskNotifySettings' },
          { kind: 'method', name: 'updateSettings', signature: 'updateSettings(update: object): Promise<TaskNotifySettings>' },
          { kind: 'method', name: 'next', signature: 'next(): TaskNotifyItem[]' },
          { kind: 'method', name: 'testPush', signature: 'testPush(): Promise<{ ok: boolean; error?: string }>' },
          { kind: 'method', name: 'testNotify', signature: 'testNotify(): Promise<{ ok: boolean; error?: string }>' },
        ],
        types: [],
      },
    ],
    events: [],
    objects: [],
  },
  invocations: INVOCATIONS,
}
