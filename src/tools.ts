/**
 * AI WITH U · 模型工具集
 *
 * 主人的定位是「聊天走正常会话，插件管管理」——所以这些工具刻意保持精简：
 * 只暴露「模型确实需要参与」的动作（记日记、查记忆、忘记/改日记、重置、关系、换开场）。
 * 建卡/删卡/统计这类确定性操作全部留给面板，不占模型工具位。
 *
 * 每条指令能力同时有两个入口：
 *   - 模型工具（本文件，`awu_` 前缀）：聊天里说「忘记…」时由模型调用；
 *   - REST 接口（web.ts）：功能界面点按钮时调用。
 * 两者共用 {@link Store} 上的同一份逻辑，行为一致。
 * @module dsh-ai-with-u/tools
 */
import type { Store } from './store.js'
import { localDiaryDate, RELATION_BANDS } from './store.js'
import type { PromptController } from './prompt.js'

/** 工具需要的最小执行上下文。 */
export interface ToolExec { signal?: AbortSignal }

export interface ToolDef {
  name: string
  description: string
  parameters: Record<string, unknown>
  output: { schema: Record<string, unknown>; render: (args: unknown, value: unknown) => Array<{ type: 'text'; text: string }> }
  execute: (args: Record<string, unknown>, exec: ToolExec) => Promise<unknown>
}

/** 只把执行结果当 JSON 回给模型，不额外解释。 */
const json = {
  schema: { type: 'object' },
  render: (_a: unknown, v: unknown) => [{ type: 'text' as const, text: JSON.stringify(v) }],
}

/** 组装 awu_* 工具集。仅在启用状态下才会被注册（拔出即全部消失）。 */
export function createTools(store: Store, prompt: PromptController): ToolDef[] {
  const requireActive = (): string => {
    const name = prompt.characterName
    if (name === undefined) throw new Error('当前没有启用任何角色')
    return name
  }

  /** 写完后刷新提示词缓存，下一轮组装立刻用新内容。 */
  const afterWrite = async (): Promise<void> => {
    prompt.invalidate()
    await prompt.refresh()
  }

  return [
    {
      name: 'awu_diary_write',
      description: '把本次对话中值得记住的事写进当前角色的日记（追加式）。只记关键人生信息、重大情绪、共同经历、约定与承诺、关系里程碑；闲聊琐事不记。写完不要向用户报告「已记录」。',
      parameters: {
        timeline: {
          type: 'array',
          item: { type: 'string' },
          description: '客观事实条目，如「下午 · [在推进] TA 说下周三要考试」。行首可带 [事实] / [在推进] / [完结] 标注。',
        },
        notes: {
          type: 'array',
          item: { type: 'string' },
          description: '角色口吻的心情札记，每条 1-3 句，如「她今天看起来好累，想让她早点休息」。',
        },
        date: {
          type: 'string',
          description: '可选的日期，格式 YYYY MM DD。省略则用今天。',
        },
      },
      output: json,
      async execute(args) {
        const name = requireActive()
        const timeline = Array.isArray(args['timeline']) ? args['timeline'].map(String) : []
        const notes = Array.isArray(args['notes']) ? args['notes'].map(String) : []
        if (timeline.length === 0 && notes.length === 0) throw new Error('timeline 与 notes 至少填一项')
        const date = typeof args['date'] === 'string' && args['date'].trim() !== '' ? args['date'].trim() : localDiaryDate()
        await store.appendDiary(name, date, timeline, notes)
        await afterWrite()
        return { ok: true, date, written: timeline.length + notes.length }
      },
    },
    {
      name: 'awu_diary_read',
      description: '读取当前角色与用户相关的日记内容（用于回忆旧事、判断未竟话题、到期提起约定与生日）。默认只返回最近几天的条目。',
      parameters: {
        days: { type: 'number', description: '返回最近多少天的条目，默认 7。' },
        keyword: { type: 'string', description: '可选关键词，只返回包含它的条目。' },
      },
      output: json,
      async execute(args) {
        const name = requireActive()
        const days = typeof args['days'] === 'number' && args['days'] > 0 ? Math.floor(args['days']) : 7
        let entries = await store.readDiary(name)
        const keyword = typeof args['keyword'] === 'string' ? args['keyword'].trim() : ''
        if (keyword !== '') {
          entries = entries.filter(e =>
            e.timeline.some(t => t.includes(keyword)) || e.notes.some(n => n.includes(keyword)))
        }
        return { character: name, entries: entries.slice(-days) }
      },
    },
    {
      name: 'awu_whoami',
      description: '查询当前启用了哪位角色及其关系设定。仅在不确定「我现在是谁」时调用。',
      parameters: {},
      output: json,
      async execute() {
        const name = prompt.characterName
        if (name === undefined) return { active: false }
        const card = await store.readCard(name)
        const session = await store.readSession(name)
        return {
          active: true,
          character: name,
          relationship: card?.['relationship'] ?? {},
          mode: prompt.snapshot().mode,
          turnCount: Number(session?.turn_count ?? 0) || 0,
        }
      },
    },
    // ------------------------------------------------------------ 忘记
    {
      name: 'awu_forget',
      description: '用户说「忘记{事情}」「忘了…」时调用：三处同步定点清理——日记里命中的条目（时间线整条删、心情按条删）、会话摘要里的相关条目、角色卡 memory_anchor / dynamic_state 里相关的句子。这条路是用户主动要求的定点删除例外，平时日志的追加式纪律不变。',
      parameters: {
        keyword: {
          type: 'string',
          required: true,
          description: '要忘记的事的关键词；多件事用 | 分隔（如「考试|补课」）。',
        },
      },
      output: json,
      async execute(args) {
        const name = requireActive()
        const keyword = typeof args['keyword'] === 'string' ? args['keyword'].trim() : ''
        if (keyword === '') throw new Error('把要忘记的事说清楚一点（keyword）')
        const result = await store.forget(name, keyword)
        await afterWrite()
        return result
      },
    },
    // ------------------------------------------------------------ 改日记
    {
      name: 'awu_diary_edit',
      description: '用户说「改日记{内容}」时调用：就地改写日记中对应的一条（不动同段其他条目）。定位：先给 match 关键词或 date；多条命中默认改最新一条，要改别的就把候选逐条告诉用户再指定 index。',
      parameters: {
        text: { type: 'string', required: true, description: '改写后的完整条目文字。' },
        match: { type: 'string', description: '关键词，定位要改的那条；多个用 | 分隔。' },
        date: { type: 'string', description: '可选：限定日期分组，格式 YYYY MM DD。' },
        section: { type: 'string', enum: ['timeline', 'notes'], description: '可选：只在这一段里找。' },
        index: { type: 'number', description: '可选：命中多条时的第几条（从 0 起）。' },
      },
      output: json,
      async execute(args) {
        const name = requireActive()
        const text = typeof args['text'] === 'string' ? args['text'] : ''
        const result = await store.editDiary(name, {
          text,
          match: typeof args['match'] === 'string' ? args['match'] : undefined,
          date: typeof args['date'] === 'string' ? args['date'] : undefined,
          section: args['section'] === 'notes' ? 'notes' : args['section'] === 'timeline' ? 'timeline' : undefined,
          index: typeof args['index'] === 'number' ? args['index'] : undefined,
        })
        await afterWrite()
        return result
      },
    },
    // ------------------------------------------------------------ 全新开始 / 彻底重置
    {
      name: 'awu_session_reset',
      description: '重置会话。scope=session（「全新开始」）清空会话状态但保留日记——角色还记得用户这个人，只是不记得最近聊了什么；scope=all（「彻底重置」）连日记一起清空，一切归零。彻底重置必须先征得用户明确同意才可调用。',
      parameters: {
        scope: {
          type: 'string',
          required: true,
          enum: ['session', 'all'],
          description: 'session = 全新开始（保留日记）；all = 彻底重置（连日记清空）。',
        },
        confirmAll: {
          type: 'boolean',
          description: 'scope=all 时必填 true，表示用户已明确确认。',
        },
      },
      output: json,
      async execute(args) {
        const name = requireActive()
        const scope = args['scope'] === 'all' ? 'all' : 'session'
        if (scope === 'all' && args['confirmAll'] !== true) {
          throw new Error('彻底重置要用户明确确认（confirmAll=true）后才能执行')
        }
        const result = scope === 'all'
          ? await store.resetStory(name)
          : await store.resetSession(name)
        await afterWrite()
        return { ok: true, ...result }
      },
    },
    // ------------------------------------------------------------ 关系
    {
      name: 'awu_relation',
      description: '用户说「关系」时调用：返回关系档位的客观依据（累计轮次、最近互动、日记条目数、起点锚定）。档位本身由你现算（五档：陌生/认识/熟悉/亲近/亲密），不落盘、不在对话里提数值。',
      parameters: {},
      output: json,
      async execute() {
        const name = requireActive()
        const state = await store.relationState(name)
        return {
          ...state,
          tag: `${state.character}（${state.baseline}）`,
          bands: [...RELATION_BANDS],
        }
      },
    },
    // ------------------------------------------------------------ 换一句开场
    {
      name: 'awu_opening_next',
      description: '用户说「换一句开场」时调用：从角色卡的 openings 里轮换下一句。无历史档案时取下一句并把它移到数组末尾（游标靠顺序持久化）；有历史档案时不重发开场，改由你按同一句意换声线切面顺口说一句。openings 缺失时返回 needGenerate=true，你按声线生成 2-3 句后用 candidates 参数再调用一次写入。',
      parameters: {
        candidates: {
          type: 'array',
          item: { type: 'string' },
          description: '可选：openings 缺失时你现生成的候选开场（2-3 句，风格锚点互不相同）。给了就追加写入 openings 并采用第一句。',
        },
      },
      output: json,
      async execute(args) {
        const name = requireActive()
        const raw = args['candidates']
        const candidates = Array.isArray(raw) ? raw.map(String) : []
        const result = await store.rotateOpening(name, { candidates })
        await afterWrite()
        return result
      },
    },
  ]
}
