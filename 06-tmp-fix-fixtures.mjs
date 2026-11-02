// 一次性：把 fixtures.json 的 /overview /character /preview 对齐到 src/web.ts 的真实响应，
// 并新增「会话已绑定」场景（boundOverview / boundDetail）。仅开发用，放 06-tmp 外。
import { readFile, writeFile } from 'node:fs/promises'

const path = 'tools/preview/fixtures.json'
const data = JSON.parse(await readFile(path, 'utf8'))
const SID = 'sandbox-session-1'

const binding = { sessionId: SID, character: '虞照', boundAt: '2026-11-02T10:00:00+08:00' }
const presetA = { id: 'test-a', name: '测试预设A · 克制文风', chars: 1240 }
const presetB = { id: 'test-b', name: '测试预设B · 重体积', chars: 24856 }

/** overview 的契约字段（web.ts:244-293） */
function withOverviewContract(ov, { sessionId, active, boundChar, presetSource, presetCurrent }) {
  return {
    ...ov,
    active: { ...(ov.active ?? {}), mode: 'text+action' },
    mode: 'text+action',
    discipline: 'lite',
    sessionId,
    bindings: {
      count: boundChar === '' ? 0 : 1,
      current: boundChar === '' ? null : { ...binding, character: boundChar },
      effective: { character: active, source: boundChar === '' ? (active === '' ? 'none' : 'global') : 'session' },
      items: boundChar === '' ? [] : [{ ...binding, character: boundChar }],
    },
    preset: {
      active: { global: presetA.id, sessions: presetSource === 'session' ? { [SID]: presetB.id } : {} },
      current: presetCurrent,
      source: presetSource,
    },
  }
}

data.overview = withOverviewContract(data.overview, {
  sessionId: '', active: '', boundChar: '', presetSource: 'none', presetCurrent: null,
})
data.liveOverview = withOverviewContract(data.liveOverview, {
  sessionId: '', active: '虞照', boundChar: '', presetSource: 'global', presetCurrent: presetA,
})

/** detail 的契约字段（web.ts:507-535） */
function withDetailContract(detail, { sessionId, boundHere, isGlobal }) {
  return {
    ...detail,
    relation: {
      ...(detail.relation ?? {}),
      current: (detail.relation && detail.relation.current) || '亲近',
      log: [
        { at: '2026-10-29T21:10:00+08:00', from: '熟悉', to: '亲近', note: '（沙盒合成）他留下伞那次' },
        { at: '2026-10-30T01:00:00+08:00', from: '亲近', to: '亲近', note: '（沙盒合成）夜里聊旧书' },
      ],
    },
    binding: {
      boundHere,
      sessions: boundHere ? [sessionId] : [],
      global: isGlobal,
      effective: { character: '虞照', source: boundHere ? 'session' : (isGlobal ? 'global' : 'none') },
    },
  }
}

data.character = withDetailContract(data.character, { sessionId: '', boundHere: false, isGlobal: false })
data.liveDetail = withDetailContract(data.liveDetail, { sessionId: '', boundHere: false, isGlobal: true })

// 新增：「会话已绑定」场景（P1.7）。所有旧图都停在「当前会话不可识别」的降级分支，
// 会话绑定 / 预设摘要 / 纪律档位这三块零覆盖。
data.boundOverview = withOverviewContract(
  { ...data.liveOverview, active: { enabled: true, character: '虞照', mode: 'text+action' }, discipline: 'full' },
  { sessionId: SID, active: '虞照', boundChar: '虞照', presetSource: 'session', presetCurrent: presetB },
)
data.boundOverview.discipline = 'full'
data.boundDetail = withDetailContract(data.liveDetail, { sessionId: SID, boundHere: true, isGlobal: true })

// /preview 的契约字段（prompt.ts:1184-1260）
data.preview = {
  ...data.preview,
  sessionId: SID,
  source: 'session',
  preset: {
    id: presetA.id, name: presetA.name, source: 'custom',
    moduleCount: 4, enabledCount: 3, chars: presetA.chars,
  },
}

await writeFile(path, JSON.stringify(data, null, 2) + '\n', 'utf8')
console.log('top keys:', Object.keys(data).join(', '))
console.log('overview keys:', Object.keys(data.overview).join(', '))
console.log('liveDetail keys:', Object.keys(data.liveDetail).join(', '))
console.log('boundOverview.sessionId:', data.boundOverview.sessionId, '| bindings.count:', data.boundOverview.bindings.count, '| preset.source:', data.boundOverview.preset.source)
console.log('boundDetail.binding:', JSON.stringify(data.boundDetail.binding))
console.log('preview.preset:', JSON.stringify(data.preview.preset))
