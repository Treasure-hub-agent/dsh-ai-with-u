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
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { localDiaryDate, RELATION_BANDS, resolveInteractionMode } from './store.js'
import type { PromptController } from './prompt.js'
import { readSessionId } from './prompt.js'
import type { DistillArm } from './distill.js'
import { saveCardFromModel } from './distill.js'

/**
 * 工具需要的最小执行上下文。
 *
 * `agent` 由宿主 agent 循环注入（`ToolExecutionInput.agent`）——**这是会话决议的入口**：
 * 同一次工具调用属于哪个会话，就按哪个会话的绑定走（会话绑定 > 全局启用 > 未启用）。
 * 手写自检可以只传 `sessionId`。
 */
export interface ToolExec {
  signal?: AbortSignal
  agent?: unknown
  sessionId?: string
}

export interface ToolDef {
  name: string
  description: string
  parameters: Record<string, unknown>
  output: { schema: Record<string, unknown>; render: (args: unknown, value: unknown) => Array<{ type: 'text'; text: string }> }
  execute: (args: Record<string, unknown>, exec: ToolExec) => Promise<unknown>
}

/**
 * 编译期契约校验：我们的工具形状必须能被宿主 `tools.register` 接受。
 * 宿主改了 ToolDefinition（例如 output.render 签名、execute 参数）时，
 * 这里会在 tsc 阶段直接报错，而不是等到运行时工具悄悄失效。
 */
type ToolShapeConforms = ToolDef extends ToolDefinition ? true : false
const toolShapeConforms: ToolShapeConforms = true
void toolShapeConforms

/** 只把执行结果当 JSON 回给模型，不额外解释。 */
const json = {
  schema: { type: 'object' },
  render: (_a: unknown, v: unknown) => [{ type: 'text' as const, text: JSON.stringify(v) }],
}

/** 组装 awu_* 工具集。仅在启用状态下才会被注册（拔出即全部消失）。 */
export function createTools(store: Store, prompt: PromptController): ToolDef[] {
  /** 这次工具调用属于哪个会话（宿主注入的 agent；自检可直接给 sessionId）。 */
  const sessionIdOf = (exec: ToolExec): string | undefined =>
    exec.sessionId !== undefined && exec.sessionId.trim() !== ''
      ? exec.sessionId.trim()
      : readSessionId(exec.agent)

  /**
   * 取**本次调用所在会话**的决议角色（会话绑定 > 全局启用 > 未启用）。
   *
   * 绝不能再用 `prompt.characterName`（那是全局值）：会话绑定了 A、全局启用 B 时，
   * 那个会话的日记/关系/重置都必须落在 A 身上，否则就是串台。
   */
  const requireActive = (exec: ToolExec): string => {
    const name = prompt.characterForSession(sessionIdOf(exec))
    if (name === undefined) throw new Error('当前会话没有启用任何角色')
    return name
  }

  /** 写完后刷新提示词缓存，下一轮组装立刻用新内容（按会话刷，不污染别人的槽位）。 */
  const afterWrite = async (exec: ToolExec): Promise<void> => {
    prompt.invalidate()
    const sessionId = sessionIdOf(exec)
    await prompt.refresh(undefined, sessionId === undefined ? undefined : { sessionId })
  }

  return [
    {
      name: 'awu_diary_write',
      description: '把本次对话中值得记住的事写进当前角色的日记（追加式）。只记关键人生信息、重大情绪、共同经历、约定与承诺、关系里程碑；闲聊琐事不记。写完不要向用户报告「已记录」。',
      parameters: {
        timeline: {
          type: 'array',
          items: { type: 'string' },
          description: '客观事实条目，如「下午 · [在推进] TA 说下周三要考试」。行首可带 [事实] / [在推进] / [完结] 标注。',
        },
        notes: {
          type: 'array',
          items: { type: 'string' },
          description: '角色口吻的心情札记，每条 1-3 句，如「她今天看起来好累，想让她早点休息」。',
        },
        date: {
          type: 'string',
          description: '可选的日期，格式 YYYY MM DD。省略则用今天。',
        },
        topic: {
          type: 'string',
          description: '可选：此刻还没聊完的话题（一句话，如「下周三的考试」）。会写进会话状态，让你下一轮自然接上；没有未竟话题就省略。',
        },
        mood: {
          type: 'string',
          description: '可选：你此刻的情绪（一句话，如「有点担心又不想显得啰嗦」）。写进会话状态，供下一轮延续；不要写用户看不到的元信息。',
        },
      },
      output: json,
      async execute(args, exec) {
        const name = requireActive(exec)
        const timeline = Array.isArray(args['timeline']) ? args['timeline'].map(String) : []
        const notes = Array.isArray(args['notes']) ? args['notes'].map(String) : []
        if (timeline.length === 0 && notes.length === 0) throw new Error('timeline 与 notes 至少填一项')
        const date = typeof args['date'] === 'string' && args['date'].trim() !== '' ? args['date'].trim() : localDiaryDate()
        const topic = typeof args['topic'] === 'string' ? args['topic'].trim() : ''
        const mood = typeof args['mood'] === 'string' ? args['mood'].trim() : ''
        // 日记与会话在同一次写盘事务里完成（见 Store.appendDiaryWithNote：避免两次加锁被 commitTurn 插队）
        const session = await store.appendDiaryWithNote(name, date, timeline, notes, { topic, mood })
        await afterWrite(exec)
        return {
          ok: true,
          date,
          written: timeline.length + notes.length,
          ...(topic === '' ? {} : { topic }),
          ...(mood === '' ? {} : { mood }),
          ...(session === undefined ? {} : { turnCount: Number(session.turn_count ?? 0) || 0 }),
        }
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
      async execute(args, exec) {
        const name = requireActive(exec)
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
      description: '查询这个会话里启用了哪位角色及其关系设定。仅在不确定「我现在是谁」时调用。',
      parameters: {},
      output: json,
      async execute(_args, exec) {
        const sessionId = sessionIdOf(exec)
        const target = prompt.resolveTarget(sessionId)
        const name = target.character
        if (name === undefined) {
          return { active: false, sessionId: sessionId ?? '', source: target.source, dead: target.dead === true }
        }
        const card = await store.readCard(name)
        const session = await store.readSession(name)
        return {
          active: true,
          character: name,
          // 会话绑定（本会话启用）还是全局启用：模型偶尔需要知道自己在哪个会话里
          source: target.source,
          sessionId: sessionId ?? '',
          relationship: card?.['relationship'] ?? {},
          // 与 L1 / overview 同一口径：session 里的模式优先
          mode: resolveInteractionMode(session, prompt.snapshot()),
          turnCount: Number(session?.turn_count ?? 0) || 0,
          discipline: prompt.disciplineLevel,
        }
      },
    },
    // ------------------------------------------------------------ 切换交互模式
    {
      name: 'awu_mode',
      description: [
        '用户说「切换纯文本 / 只发文字 / 别写动作」或「切换动作 / 把动作写回来」时调用：',
        '把当前角色的交互模式切成 text（纯文本，不输出动作符号）或 text+action（文本+动作，动作用（动作）包裹）。',
        '执行后用**角色口吻**顺口确认一句（如「好，不写动作了」「行，那我连动作一起说」），',
        '不要系统式确认——禁止「已切换 / 已更新设置」这类话。',
      ].join(''),
      parameters: {
        mode: {
          type: 'string',
          required: true,
          enum: ['text', 'text+action'],
          description: 'text = 纯文本（不输出动作符号）；text+action = 文本+动作（动作神态用（动作）包裹）。',
        },
      },
      output: json,
      async execute(args, exec) {
        const character = requireActive(exec)
        const mode = args['mode']
        if (mode !== 'text' && mode !== 'text+action') {
          throw new Error('mode 只能是 text 或 text+action')
        }
        // session.json 是权威、_active.json 是兜底：统一入口写两处并刷新 L1（见 PromptController.applyInteractionMode）。
        // 这里不再调 afterWrite()：上面那次刷新已经重读过卡与日记，再刷一次是白读一遍盘。
        const result = await prompt.applyInteractionMode(mode, character)
        return { ok: true, mode, character, turnCount: Number(result.session?.turn_count ?? 0) || 0 }
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
      async execute(args, exec) {
        const name = requireActive(exec)
        const keyword = typeof args['keyword'] === 'string' ? args['keyword'].trim() : ''
        if (keyword === '') throw new Error('把要忘记的事说清楚一点（keyword）')
        const result = await store.forget(name, keyword)
        await afterWrite(exec)
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
      async execute(args, exec) {
        const name = requireActive(exec)
        const text = typeof args['text'] === 'string' ? args['text'] : ''
        const result = await store.editDiary(name, {
          text,
          match: typeof args['match'] === 'string' ? args['match'] : undefined,
          date: typeof args['date'] === 'string' ? args['date'] : undefined,
          section: args['section'] === 'notes' ? 'notes' : args['section'] === 'timeline' ? 'timeline' : undefined,
          index: typeof args['index'] === 'number' ? args['index'] : undefined,
        })
        await afterWrite(exec)
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
      async execute(args, exec) {
        const name = requireActive(exec)
        const scope = args['scope'] === 'all' ? 'all' : 'session'
        if (scope === 'all' && args['confirmAll'] !== true) {
          throw new Error('彻底重置要用户明确确认（confirmAll=true）后才能执行')
        }
        const result = scope === 'all'
          ? await store.resetStory(name)
          : await store.resetSession(name)
        await afterWrite(exec)
        return { ok: true, ...result }
      },
    },
    // ------------------------------------------------------------ 关系
    {
      name: 'awu_relation',
      description: [
        '关系档位工具。参数都不填 = 只查询（用户问「我们是什么关系」时用，**只读不回写**）；',
        '带 set = 把档位写回会话（**只在里程碑事件**：第一次约定、第一次争吵、称呼改变、表白或明确转折）。',
        '档位由你判定（五档：陌生/认识/熟悉/亲近/亲密），日常闲聊不推档；',
        '填了 set 就同时追加一条变更日志（why 写这次改变的原因，一句话）。',
        '不要在对话里提「好感度 / 亲密度 +1 / 几级」这类数值；用户问起时只给状态条 + 一句角色口吻的话。',
      ].join(''),
      parameters: {
        set: {
          type: 'string',
          enum: [...RELATION_BANDS],
          description: '可选：要写回的档位（五档之一）。只在关系里程碑事件才传，其余情况省略。',
        },
        why: {
          type: 'string',
          description: '可选：这次档位变化的原因（一句话，如「第一次说好下次一起去」）。只在带 set 时有意义。',
        },
      },
      output: json,
      async execute(args, exec) {
        const name = requireActive(exec)
        const raw = args['set']
        const value = typeof raw === 'string' ? raw.trim() : ''
        const state = value === ''
          ? await store.relationState(name)
          : await store.setIntimacy(name, value as (typeof RELATION_BANDS)[number], typeof args['why'] === 'string' ? args['why'] : undefined)
        if (value !== '') await afterWrite(exec)
        return {
          ...state,
          tag: `${state.character}（${state.current}）`,
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
          items: { type: 'string' },
          description: '可选：openings 缺失时你现生成的候选开场（2-3 句，风格锚点互不相同）。给了就追加写入 openings 并采用第一句。',
        },
      },
      output: json,
      async execute(args, exec) {
        const name = requireActive(exec)
        const raw = args['candidates']
        const candidates = Array.isArray(raw) ? raw.map(String) : []
        const result = await store.rotateOpening(name, { candidates })
        await afterWrite(exec)
        return result
      },
    },
  ]
}

// ---------------------------------------------------------------- 蒸馏：落卡工具（临时武装）

/**
 * `awu_card_save` —— **模型唯一能落卡的通道**，只在「蒸馏武装」期间挂载。
 *
 * 为什么单独一个工厂而不是塞进 {@link createTools}：
 *   1. 常驻工具只在启用角色时挂（`createTools` 的前提），而蒸馏**不需要启用任何角色**；
 *   2. 这份"能写卡的权力"必须是**临时**的：`POST /distill/arm` 挂上，成功保存一次后自动卸下，
 *      TTL（2 小时）到期也自动卸下。常驻 = 模型在任何会话里都能写卡，那是事故面。
 *
 * 参数 schema 里数组元素一律用 `items`（JSON Schema 的正确写法）。
 * 历史错法 `item` 已在 2026-10-31 的 P2 批次统一改正。
 */
export function createCardSaveTool(store: Store, arm: DistillArm): ToolDef {
  return {
    name: 'awu_card_save',
    description: [
      '把蒸馏出来的角色卡直接保存到插件里（落盘 CCv3 + 更新索引），保存后角色簿立刻能看到这张卡。',
      '**只在蒸馏武装期间可用**：用户点了「蒸馏角色卡」后这个工具才会出现，保存成功一次就自动失效；',
      '平时（非蒸馏）不要去找它，也不要试图用它改已有角色——只有在蒸馏流程的最后一阶段调用它。',
      '`data` 是 CCv3 的 data 部分；拿不到证据的字段留空，绝不编造。',
      '若返回 code=name-conflict：已有同名卡，先问用户「改名还是覆盖」，只有用户明确要覆盖时才带 overwrite: true 重试。',
    ].join(''),
    parameters: {
      name: {
        type: 'string',
        required: true,
        description: '角色名（同时是目录名与索引键）。不能含路径分隔符或 Windows 非法字符（: * ? " < > |），不能是 CON/NUL 这类保留名。',
      },
      data: {
        type: 'object',
        additionalProperties: true,
        required: true,
        description: 'CCv3 的 data 部分：description / personality / scenario / first_mes / alternate_greetings / mes_example / system_prompt / post_history_instructions / character_book / extensions / tags 等。至少要有 description、personality、scenario、first_mes、mes_example 之一。',
      },
      overwrite: {
        type: 'boolean',
        description: '同名卡已存在时是否覆盖。默认 false（此时返回 name-conflict 与已有卡摘要，不写盘）。',
      },
    },
    output: json,
    async execute(args) {
      if (!arm.armed) {
        return {
          ok: false,
          code: 'not-armed',
          error: 'awu_card_save 只在蒸馏武装期间可用（当前不在武装期，或已保存过一次）。请让用户重新点「蒸馏角色卡」。',
        }
      }
      try {
        const outcome = await saveCardFromModel(store, {
          name: args['name'],
          data: args['data'],
          overwrite: args['overwrite'] === true,
        })
        if (outcome.ok) {
          // 保存成功 = 这份写卡权力用完即焚（主人要求：不常驻）
          arm.markSaved(outcome.name)
          return {
            ...outcome,
            hint: '卡已保存，面板角色簿里已经能看到。这份保存能力已自动失效；要再建一张，请让用户重新点「蒸馏角色卡」。',
          }
        }
        return outcome
      } catch (error) {
        // 意外异常也结构化返回，避免模型只看到一条笼统的工具失败
        return {
          ok: false,
          code: 'internal',
          error: `保存失败：${error instanceof Error ? error.message : String(error)}`,
        }
      }
    },
  }
}