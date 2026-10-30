/**
 * AI WITH U · 从作品蒸馏角色卡（v2：消息通道）
 *
 * 职责边界（2026-10-30 22:00 调整）：
 *   - 本文件**只负责**：定位并读取 `distill/flow.md`、生成要发进当前会话的指令文本。
 *   - **卡片格式与校验已挂起**：主人拍板改成酒馆卡 CCv3（`spec: chara_card_v3`，含 `character_book`），
 *     原来的「10 组 34 字段 + V1–V13 校验」随格式一起重做。那部分设计存档在
 *     `docs/design/2026-10-30-distill-entry.md` §5.6 / §5.7 / 附录 B，等 tavern 格式定稿再回来。
 *
 * 所以这里除「读一个 markdown 文件」之外**零 IO、零依赖**，也不会随格式变化而改。
 * @module dsh-ai-with-u/distill
 */
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** 流程文件名（放在包根的 `distill/` 下，随 `package.json` 的 files 发布）。 */
export const DISTILL_FLOW_FILE = 'flow.md'

/**
 * `distill/flow.md` 的绝对路径。
 *
 * 与 `src/index.ts:152` 定位 `presets/` 的写法一致：本文件编译到 `lib/distill.js`，
 * 所以 `dirname(import.meta.url)/..` 就是包根。
 */
export function distillFlowPath(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '..', 'distill', DISTILL_FLOW_FILE)
}

export interface DistillFlowFile {
  path: string
  text: string
  chars: number
}

/** 读流程文件全文。缺失或空白都用「可操作」的中文报错，不吞异常。 */
export async function readDistillFlow(): Promise<DistillFlowFile> {
  const path = distillFlowPath()
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code
    const reason = error instanceof Error ? error.message : String(error)
    if (code === 'ENOENT') {
      throw new Error(`找不到蒸馏流程文件：${path}（插件安装不完整：distill/flow.md 应随包发布）`)
    }
    throw new Error(`读取蒸馏流程文件失败：${path}（${reason}）`)
  }
  if (text.trim() === '') throw new Error(`蒸馏流程文件是空的：${path}`)
  return { path, text, chars: text.length }
}

/**
 * 生成要发进当前会话的那段指令。
 *
 * 设计约束（L2 铁律）：指令里**只有**绝对路径 + 行为要求，**不放**任何字段契约正文。
 * 契约正文由模型自己去读 md —— 这样这段指令即使被贴进会话，也只是一句「去读这个文件」。
 * 卡片格式（CCv3）最终也写在 md 里，这段指令**不需要跟着改**。
 */
export function buildDistillInstruction(flowPath: string): string {
  return [
    '请帮我从作品里蒸馏一张角色卡。',
    '',
    '第一步：完整读取这份流程文件，按它执行：',
    flowPath,
    '',
    '要求：',
    '1. 读完先只回一句「流程已读，请给我作品名或正文」，不要提前开讲。',
    '2. 按文件里的阶段推进，一次只问一个问题。',
    '3. 最终只输出一个 json 代码块，键名与结构逐字照文件里的输出格式，不要自己发明字段。',
    '4. 不要调用任何 awu_* 工具；蒸馏不依赖它们，最后也不要替我保存卡片。',
    '',
    '作品：（在这里贴正文；只给作品名也可以，但请先提醒我可能有记忆偏差）',
  ].join('\n')
}

export interface DistillFlowInfo {
  path: string
  instruction: string
  chars: number
  flowChars: number
}

/** `GET /distill/flow` 的返回体（不含信封里的 ok）。 */
export async function distillFlowInfo(): Promise<DistillFlowInfo> {
  const flow = await readDistillFlow()
  const instruction = buildDistillInstruction(flow.path)
  return { path: flow.path, instruction, chars: instruction.length, flowChars: flow.chars }
}
