/**
 * AI WITH U · 文案与角色卡解析
 *
 * 文案走宿主 locale 服务（`ctx.locale.register` + 槽位注入的 `t`），所以这里
 * 只提供两种语言的字典和一份「找不到就用中文」的兜底翻译器。
 * 角色卡解析单独放一处：卡是七字段的自由 JSON，UI 需要的只是几种稳定读法。
 */
import type { Card, CharacterSummary, DiaryEntry } from './api'

// ---------------------------------------------------------------- 语言字典

/** 字典键集合（中文是 source of truth；英文漏项在开发期一眼可见）。 */
const zh = {
  'badge.label': '角色管理',
  'badge.none': '未启用角色',
  'badge.busy': '切换中…',
  'badge.title': '角色扮演 · AI WITH U',
  'badge.open': '打开角色管理器',

  'panel.kicker': 'AI WITH U',
  'panel.title': '角色管理器',
  'panel.close': '收起面板',
  'panel.refresh': '刷新数据',
  'panel.tab.roster': '角色簿',
  'panel.tab.diary': '日记',
  'panel.tab.stats': '统计',

  'stats.characters': '角色',
  'stats.memory': '记忆',
  'stats.turns': '对话',

  'active.none.title': '当前没有启用角色',
  'active.none.hint': '挑一张角色卡启用，人设即刻插上；退出时干净拔出，不留痕迹。',
  'active.since': '已启用',
  'active.mode.text': '纯文本',
  'active.mode.action': '文本 + 动作',
  'active.exit': '退出',
  'active.mode.switch': '切换模式',

  'roster.empty.title': '角色簿还是空的',
  'roster.empty.hint': '新建一张角色卡就能开始；也可以把原 ai-with-u 的 characters 目录搬进插件目录。',
  'roster.new': '新建角色',
  'roster.count': '共 {n} 位',
  'roster.memory': '{n} 条记忆',
  'roster.never': '从未互动',
  'roster.pick': '从左栏选一张卡',
  'roster.pickHint': '点开一张卡可以看详情、改人设、翻日记',
  'roster.enable': '启用',
  'roster.enabled': '启用中',
  'roster.detail': '查看',
  'roster.open': '打开 {name} 的角色页',

  'diary.pick': '先启用或选择一位角色，才能翻它的日记。',
  'diary.empty': '还没有写下任何一天。你们聊过的内容会被自动记进来。',
  'diary.marker.timeline': '时',
  'diary.marker.notes': '记',

  'stats.title': '这一册的厚度',
  'stats.characters.full': '位角色',
  'stats.memory.full': '条记忆',
  'stats.turns.full': '轮对话',
  'stats.source': '角色来源',
  'stats.recent': '最近活跃',
  'stats.root': '存放位置',
  'stats.none': '暂无数据',

  'detail.back': '返回',
  'detail.card': '角色卡',
  'detail.personality': '性格',
  'detail.voice': '声音',
  'detail.relationship': '关系',
  'detail.activate': '启用',
  'detail.activateReplace': '替换启用',
  'detail.deactivate': '退出',
  'detail.delete': '删除',
  'detail.diary': '最近日记',
  'detail.diaryEmpty': '这位角色还没有日记。',
  'detail.loadFailed': '这个角色没能加载出来',

  'new.title': '新建角色',
  'new.name': '角色名',
  'new.namePlaceholder': '例如：虞照',
  'new.role': '身份',
  'new.rolePlaceholder': '可选，例如：合租室友',
  'new.blurb': '一句话背景',
  'new.blurbPlaceholder': '可选，一句话说清他/她是谁、和你什么关系',
  'new.preview': '会创建：',
  'new.confirm': '创建',
  'new.cancel': '取消',
  'new.nameRequired': '先给角色起个名字。',
  'new.nameTaken': '这个名字已经有人用了。',

  'delete.title': '删除角色',
  'delete.body': '要删掉「{name}」吗？这一步不会自动备份。',
  'delete.withMemory': '连同日记与记忆一起删除（不可恢复）',
  'delete.keepMemory': '角色卡删除后，日记文件会保留在磁盘上。',
  'delete.confirm': '确认删除',
  'delete.cancel': '再想想',

  'mode.title': '切换交互模式',
  'mode.text': '纯文本',
  'mode.textHint': '不输出动作神态，只靠语气与断句表达',
  'mode.action': '文本 + 动作',
  'mode.actionHint': '动作神态用括号包起来，与台词分清界限',

  'common.loading': '载入中…',
  'common.retry': '重试',
  'common.cancel': '取消',
  'common.save': '保存',
  'common.unknown': '未知',
  'common.noMemory': '0 条记忆',
  'common.busy': '处理中…',
  'common.close': '关闭',

  // ---- 记忆与剧情维护 ----
  'relation.title': '关系',
  'relation.baseline': '起点',
  'relation.turns': '{n} 轮',
  'relation.note': '档位由模型根据对话现算，这里只显示起点锚定。',
  'relation.none': '暂无关系档案',

  'opening.title': '开场',
  'opening.next': '换一句开场',
  'opening.none': '这张卡里还没有开场白。',
  'opening.history': '已有历史档案：对话进行中不会重发开场，改由模型换声气顺口接。',
  'opening.fresh': '已重置，下一次对话从开场白开始。',
  'opening.needGenerate': '卡里没有开场候选，需要模型先生成几句才能换。',
  'opening.rotated': '开场已换。',

  'diary.actions': '维护',
  'diary.edit': '改写',
  'diary.editTitle': '改写这条日记',
  'diary.editHint': '改写后的完整文字；保存后会同步更新会话摘要。',
  'diary.editDone': '已改写。',
  'diary.editMulti': '命中了 {n} 条，写的是第一条。想改别的请用更精确的原文。',
  'diary.editRequired': '内容不能为空。',

  'forget.title': '忘记某事',
  'forget.hint': '输入关键词，会从日记、会话最近记录和角色卡里一起清掉。',
  'forget.keyword': '关键词',
  'forget.keywordPlaceholder': '例如：医院的约定',
  'forget.do': '忘记',
  'forget.nothing': '没有找到包含该关键词的记忆。',
  'forget.done': '已忘记：{diary} 条日记、{session} 条会话记录、{card} 处角色卡。',
  'forget.keywordRequired': '先输入要忘记的关键词。',

  'reset.title': '重新开始',
  'reset.session': '全新开始',
  'reset.sessionHint': '清空最近记录、心情、话题与轮数，日记保留。',
  'reset.all': '彻底重置',
  'reset.allHint': '连日记一起清空，回到初见状态。不可恢复。',
  'reset.sessionDone': '已全新开始，保留 {n} 条日记。',
  'reset.allDone': '已彻底重置，清除 {n} 条日记。',
  'reset.confirmTitle': '彻底重置「{name}」？',
  'reset.confirmBody': '这会删除全部日记与会话记忆，角色卡本身保留。这一步无法撤销。',
  'reset.confirmWord': '彻底重置',

  // ---- 角色卡编辑器 ----
  'detail.edit': '编辑',
  'edit.title': '编辑角色卡',
  'edit.kicker': '角色卡编辑',
  'edit.progressHint': '已填写字段 / 总字段',
  'edit.readonlyHint': '角色名与来源为只读：改名涉及目录重命名，暂不支持在面板内修改。',
  'edit.saved': '角色卡已保存',
  'edit.soulBadge': '灵魂字段',
  'edit.soulHint': '声线决定这个角色「听起来」像不像他，比剧情更影响观感',
  'edit.optional': '选填',
  'edit.listKind': '列表',
  'edit.listEmpty': '还没有条目',
  'edit.addItem': '添加一条',
  'edit.removeItem': '删除这条',
  'edit.save': '保存',
  'edit.dirty': '有未保存的改动',
  'edit.clean': '暂无改动',
  'edit.discardTitle': '放弃未保存的改动？',
  'edit.discardBody': '你在角色卡上的修改还没有保存，关掉就没了。',
  'edit.keepEditing': '继续编辑',
  'edit.discard': '放弃改动',

  // ---- 使用指南（第 4 个 tab）----
  'panel.tab.guide': '指南',
  'guide.notice.title': '一个会话，一个角色',
  'guide.notice.body': '切换或插拔角色卡都会改写系统提示词，缓存前缀当场失效。下一次请求要把之前整段对话按「未命中缓存」的价格重新读一遍——这一笔是一次性补交的，会话越长补得越多。频繁切换等于反复补这一笔。换角色请开新会话；同一个会话里一直聊下去本身并不涨价。',
  'guide.quickstart.title': '三步上手',
  'guide.quickstart.step1': '在角色簿里挑一张卡，点「启用」。',
  'guide.quickstart.step2': '回到任意会话直接发消息，不用重新介绍自己。',
  'guide.quickstart.step3': '不想用了点「退出」，人设和工具一起卸下。',
  'guide.help.title': '它能帮什么',
  'guide.help.1': '一张卡就是一个人：称呼、语气、节奏都按卡走。',
  'guide.help.2': '聊过的事会记进日记，下次它自己想起来。',
  'guide.help.3': '改卡、翻日记、清记忆都在面板里，不用手改文件。',
  'guide.help.4': '不启用时完全不影响写代码、查资料、跑命令。',
  'guide.sections.title': '面板里的三块',
  'guide.sections.rosterName': '角色簿',
  'guide.sections.roster': '挑卡、启用、看详情、改角色卡。',
  'guide.sections.diaryName': '日记',
  'guide.sections.diary': '按天看记录，可改写、可忘记、可重置。',
  'guide.sections.statsName': '统计',
  'guide.sections.stats': '角色数、记忆数、对话轮数、数据放在哪。',
  'guide.tools.title': '模型会做的 8 件事',
  'guide.tools.diaryName': '日记',
  'guide.tools.diary': '写新记录；按关键词翻旧的。',
  'guide.tools.fixesName': '更正',
  'guide.tools.fixes': '改写某一条；忘掉一件事，三处一起清。',
  'guide.tools.identityName': '身份',
  'guide.tools.identity': '查它现在是谁；按对话重算关系档位。',
  'guide.tools.openingName': '开场',
  'guide.tools.opening': '换一句开场；全新开始或彻底重置。',
  'guide.tools.note': '一共 8 个，只在启用角色时挂载，退出即卸下。',
  'guide.data.title': '数据在哪',
  'guide.data.root': '~/.dsh/ai-with-u/',
  'guide.data.rootWindows': 'Windows: C:\\Users\\<你>\\.dsh\\ai-with-u\\',
  'guide.data.rootHint': '换位置：设环境变量 AIWU_STORAGE_ROOT。',
  'guide.data.layout': '每个角色一个文件夹：card.json、diary.md、session.json。',
  'guide.data.backup': '备份：整个文件夹复制走；恢复就拷回原位，点刷新。',
  'guide.data.import': '导入：把原 skill 的 characters/ 里每个角色文件夹拷进 characters/，刷新面板。',
  'guide.data.note': '预置卡只在 characters/ 不存在时种一次，不会覆盖你拷进来的卡。',
  'guide.faq.title': '常见疑问',
  'guide.faq.q1': '换会话还算吗？',
  'guide.faq.a1': '算。启用状态写在磁盘上，新旧会话都带人设，重启 DSH 也会自动恢复。',
  'guide.faq.q2': '退出后有残留吗？',
  'guide.faq.a2': '没有。人设、8 个工具、底线声明一次性全卸下，系统提示词里一个字都不留（和没装插件一样）。',
  'guide.faq.q3': 'L0 底线是什么？',
  'guide.faq.a3': '启用期间注入的一段短声明（约 370 字）：让位的只有「我是谁、我怎么说话」，代码规范与安全约束照常。退出后它也随之消失。',

  // ---- 蒸馏角色卡（发送通道部分；粘贴校验的键等 CCv3 定稿再加）----
  'distill.entry': '蒸馏',
  'distill.entryTitle': '从作品蒸馏一张角色卡',
  'distill.title': '蒸馏角色卡',
  'distill.why': 'AI 会在对话里跑完整套流程，自己把卡建好并保存；你只需要回答它问的问题。',
  'distill.step1': '点「开始蒸馏」，指令会直接发进当前对话',
  'distill.step2': 'AI 按流程分阶段问你几个问题（声线、性格、关系…）',
  'distill.step3': '满意后它自己把卡存进插件，角色簿里立刻就能看到',
  'distill.noDockShort': '输入框未就绪',
  'distill.noDock': '还没有可用的会话输入框：先打开一个对话，或直接复制指令手动粘贴',
  'distill.sent': '已发送，去对话里继续',
  'distill.filled': '已填入输入框，按回车发送',
  'distill.busyFilled': '会话正在生成，先没发出去；已填入输入框，等这一轮结束再按回车',
  'distill.flowFailed': '读不到蒸馏流程文件 distill/flow.md（插件安装不完整）',
  'distill.insertFailed': '指令没能写进输入框（会话可能正在生成，或输入框刚被改动）；可以先复制，等一下再发',
  'distill.submitFailed': '已填入输入框，但自动发送失败；按回车即可',
  'distill.copy': '复制指令',
  'distill.copied': '已复制',
  'distill.copyFailed': '复制失败，请手动选中下面的文字',
  'distill.noProgress': '面板看不到对话里的进度，所以这里只显示你已经粘回来的结果；在你点保存前，磁盘上什么都没变。',
  'distill.dockDraftNotEmpty': '输入框里已有文字，先用面板里的「发送」，或清空后再点这里',
  'distill.dockFilled': '指令已填入输入框，按回车发送',
  'distill.dockUnavailable': '没拿到输入框能力：去面板里点「发送」，或复制指令手动粘贴',
  'distill.entryHint': '从作品或设定做一张卡',
  'distill.start': '开始蒸馏',
  'distill.done': '好',
  'distill.savedHint': 'AI 会自己建卡并保存，完成后面板里自动出现新卡',
  'distill.armFailed': '没能开启蒸馏通道：{reason}',
  'distill.lastSaved': '新卡已保存：{name}',
}

type Dict = { [K in keyof typeof zh]: string }

const en: Dict = {
  'badge.label': 'Characters',
  'badge.none': 'No character',
  'badge.busy': 'Switching…',
  'badge.title': 'Roleplay · AI WITH U',
  'badge.open': 'Open character manager',

  'panel.kicker': 'AI WITH U',
  'panel.title': 'Character Manager',
  'panel.close': 'Close panel',
  'panel.refresh': 'Refresh',
  'panel.tab.roster': 'Roster',
  'panel.tab.diary': 'Diary',
  'panel.tab.stats': 'Stats',

  'stats.characters': 'Characters',
  'stats.memory': 'Memories',
  'stats.turns': 'Turns',

  'active.none.title': 'No character active',
  'active.none.hint': 'Pick a card and enable it — the persona plugs in instantly and unplugs cleanly.',
  'active.since': 'Active since',
  'active.mode.text': 'Text only',
  'active.mode.action': 'Text + action',
  'active.exit': 'Exit',
  'active.mode.switch': 'Switch mode',

  'roster.empty.title': 'Your roster is empty',
  'roster.empty.hint': 'Create a card to begin, or move an existing characters folder into the plugin directory.',
  'roster.new': 'New character',
  'roster.count': '{n} total',
  'roster.memory': '{n} memories',
  'roster.never': 'Never used',
  'roster.pick': 'Pick a card on the left',
  'roster.pickHint': 'Open one to see details, edit the persona, or read its diary',
  'roster.enable': 'Enable',
  'roster.enabled': 'Active',
  'roster.detail': 'View',
  'roster.open': 'Open {name}',

  'diary.pick': 'Enable or pick a character to read its diary.',
  'diary.empty': 'No days written yet. Conversations are recorded here automatically.',
  'diary.marker.timeline': 'T',
  'diary.marker.notes': 'N',

  'stats.title': 'How thick this volume is',
  'stats.characters.full': 'characters',
  'stats.memory.full': 'memories',
  'stats.turns.full': 'turns',
  'stats.source': 'By source',
  'stats.recent': 'Recently active',
  'stats.root': 'Storage location',
  'stats.none': 'No data yet',

  'detail.back': 'Back',
  'detail.card': 'Character card',
  'detail.personality': 'Personality',
  'detail.voice': 'Voice',
  'detail.relationship': 'Relationship',
  'detail.activate': 'Enable',
  'detail.activateReplace': 'Switch to this',
  'detail.deactivate': 'Exit',
  'detail.delete': 'Delete',
  'detail.diary': 'Recent diary',
  'detail.diaryEmpty': 'This character has no diary yet.',
  'detail.loadFailed': 'This character could not be loaded',

  'new.title': 'New character',
  'new.name': 'Name',
  'new.namePlaceholder': 'e.g. Yuzhao',
  'new.role': 'Role',
  'new.rolePlaceholder': 'Optional, e.g. roommate',
  'new.blurb': 'One-line background',
  'new.blurbPlaceholder': 'Optional, one line about who they are to you',
  'new.preview': 'Will create: ',
  'new.confirm': 'Create',
  'new.cancel': 'Cancel',
  'new.nameRequired': 'Give the character a name first.',
  'new.nameTaken': 'That name is already taken.',

  'delete.title': 'Delete character',
  'delete.body': 'Delete “{name}”? This cannot be undone.',
  'delete.withMemory': 'Also delete diary and memories (permanent)',
  'delete.keepMemory': 'The diary file stays on disk if you keep memories.',
  'delete.confirm': 'Delete',
  'delete.cancel': 'Keep it',

  'mode.title': 'Interaction mode',
  'mode.text': 'Text only',
  'mode.textHint': 'No action beats; tone and pauses carry it',
  'mode.action': 'Text + action',
  'mode.actionHint': 'Action beats in parentheses, separate from speech',

  'common.loading': 'Loading…',
  'common.retry': 'Retry',
  'common.cancel': 'Cancel',
  'common.save': 'Save',
  'common.unknown': 'Unknown',
  'common.noMemory': '0 memories',
  'common.busy': 'Working…',
  'common.close': 'Close',

  'relation.title': 'Relationship',
  'relation.baseline': 'Start',
  'relation.turns': '{n} turns',
  'relation.note': 'The live band is computed by the model from the conversation; this shows only the starting anchor.',
  'relation.none': 'No relationship record yet',

  'opening.title': 'Opening',
  'opening.next': 'Next opening',
  'opening.none': 'This card has no opening lines.',
  'opening.history': 'History exists: the opening is not replayed mid-conversation; the model changes tone instead.',
  'opening.fresh': 'Reset — the next turn starts from the opening.',
  'opening.needGenerate': 'No candidate openings in the card; the model must generate some first.',
  'opening.rotated': 'Opening rotated.',

  'diary.actions': 'Maintain',
  'diary.edit': 'Rewrite',
  'diary.editTitle': 'Rewrite this diary line',
  'diary.editHint': 'The full replacement text; the session summary updates too.',
  'diary.editDone': 'Rewritten.',
  'diary.editMulti': '{n} matches; the first was rewritten. Use more exact text for a different one.',
  'diary.editRequired': 'Text cannot be empty.',

  'forget.title': 'Forget something',
  'forget.hint': 'Enter a keyword to remove it from the diary, recent session records and the card.',
  'forget.keyword': 'Keyword',
  'forget.keywordPlaceholder': 'e.g. the hospital promise',
  'forget.do': 'Forget',
  'forget.nothing': 'Nothing matched that keyword.',
  'forget.done': 'Forgotten: {diary} diary lines, {session} session records, {card} card fields.',
  'forget.keywordRequired': 'Enter a keyword first.',

  'reset.title': 'Start over',
  'reset.session': 'Fresh start',
  'reset.sessionHint': 'Clears recent records, mood, topic and turn count. The diary stays.',
  'reset.all': 'Full reset',
  'reset.allHint': 'Clears the diary too, back to a first meeting. Irreversible.',
  'reset.sessionDone': 'Fresh start done; {n} diary entries kept.',
  'reset.allDone': 'Full reset done; {n} diary entries cleared.',
  'reset.confirmTitle': 'Fully reset “{name}”?',
  'reset.confirmBody': 'This deletes the entire diary and session memory. The character card itself stays. It cannot be undone.',
  'reset.confirmWord': 'Full reset',

  'detail.edit': 'Edit',
  'edit.title': 'Edit character card',
  'edit.kicker': 'CARD EDITOR',
  'edit.progressHint': 'Filled fields / total',
  'edit.readonlyHint': 'Name and source are read-only: renaming would move the folder, which the panel does not do yet.',
  'edit.saved': 'Character card saved',
  'edit.soulBadge': 'Soul field',
  'edit.soulHint': 'Voice decides whether the character sounds like himself — it shapes the feel more than the plot does.',
  'edit.optional': 'Optional',
  'edit.listKind': 'list',
  'edit.listEmpty': 'No items yet',
  'edit.addItem': 'Add item',
  'edit.removeItem': 'Remove item',
  'edit.save': 'Save',
  'edit.dirty': 'Unsaved changes',
  'edit.clean': 'No changes',
  'edit.discardTitle': 'Discard unsaved changes?',
  'edit.discardBody': 'Your edits to this character card have not been saved; closing loses them.',
  'edit.keepEditing': 'Keep editing',
  'edit.discard': 'Discard',

  // ---- Guide (4th tab) ----
  'panel.tab.guide': 'Guide',
  'guide.notice.title': 'One session, one character',
  'guide.notice.body': 'Switching or plugging cards in and out rewrites the system prompt, so the cached prefix dies on the spot. The next request has to re-read the whole history at the non-cached price — a one-off catch-up charge that grows with how long the session already is. Switching often means paying it over and over. Open a new chat when you switch characters; chatting continuously in one session does not cost extra by itself.',
  'guide.quickstart.title': 'Three steps',
  'guide.quickstart.step1': 'Pick a card in the roster and press Enable.',
  'guide.quickstart.step2': 'Return to any chat and just type; no reintroduction needed.',
  'guide.quickstart.step3': 'Press Exit and the persona and its tools come off together.',
  'guide.help.title': 'What it does',
  'guide.help.1': 'One card is one person: wording, tone and rhythm come from it.',
  'guide.help.2': 'Talks go into a diary, so the character remembers next time.',
  'guide.help.3': 'Cards, diaries and memory cleanup all live in this panel.',
  'guide.help.4': 'While off, coding, research and commands are untouched.',
  'guide.sections.title': 'The three tabs',
  'guide.sections.rosterName': 'Roster',
  'guide.sections.roster': 'pick a card, enable it, view details, edit the card.',
  'guide.sections.diaryName': 'Diary',
  'guide.sections.diary': 'entries by day; rewrite, forget or reset them.',
  'guide.sections.statsName': 'Stats',
  'guide.sections.stats': 'characters, memories, turns, and where the data lives.',
  'guide.tools.title': 'What the model can do',
  'guide.tools.diaryName': 'Diary',
  'guide.tools.diary': 'write new notes; search older ones by keyword.',
  'guide.tools.fixesName': 'Fixes',
  'guide.tools.fixes': 'rewrite a line; forget one thing across all three places.',
  'guide.tools.identityName': 'Identity',
  'guide.tools.identity': 'who it is now; recompute the relationship band.',
  'guide.tools.openingName': 'Opening',
  'guide.tools.opening': 'another opening; start over, or reset everything.',
  'guide.tools.note': 'Eight in all; mounted only while a character is enabled.',
  'guide.data.title': 'Where the data lives',
  'guide.data.root': '~/.dsh/ai-with-u/',
  'guide.data.rootWindows': 'Windows: C:\\Users\\<you>\\.dsh\\ai-with-u\\',
  'guide.data.rootHint': 'Change it with the AIWU_STORAGE_ROOT environment variable.',
  'guide.data.layout': 'One folder per character: card.json, diary.md, session.json.',
  'guide.data.backup': 'Backup: copy the whole folder; restore it and hit refresh.',
  'guide.data.import': 'Import: paste each old-skill character folder into characters/, then refresh.',
  'guide.data.note': 'Presets seed once, only when characters/ is absent; yours are never overwritten.',
  'guide.faq.title': 'Common questions',
  'guide.faq.q1': 'Does it carry into new chats?',
  'guide.faq.a1': 'Yes. The state is saved to disk; new and old chats both get the persona, and a restart keeps it.',
  'guide.faq.q2': 'Anything left after Exit?',
  'guide.faq.a2': 'Nothing. The persona, all eight tools and the baseline are unmounted together — not a single character stays in the system prompt.',
  'guide.faq.q3': 'What is the L0 baseline?',
  'guide.faq.a3': 'A short notice injected only while a character is active (~370 chars): only "who I am / how I speak" steps aside; code and safety rules still apply. It disappears on Exit.',

  // ---- Distillation (send channel only; paste-validation keys land with CCv3) ----
  'distill.entry': 'Distill',
  'distill.entryTitle': 'Distill a card from a story',
  'distill.title': 'Distill a character card',
  'distill.why': 'The AI runs the whole thing in the chat and saves the card itself — you just answer its questions.',
  'distill.step1': 'Click Start — the prompt goes straight into the current chat',
  'distill.step2': 'It asks a few questions by phase (voice, personality, relationship…)',
  'distill.step3': 'Once done it saves the card itself — it shows up in your roster right away',
  'distill.noDockShort': 'No chat yet',
  'distill.noDock': 'No chat composer available: open a chat, or copy the prompt and paste it yourself',
  'distill.sent': 'Sent — continue in the chat',
  'distill.filled': 'Filled into the input — press Enter to send',
  'distill.busyFilled': 'The chat is busy, so nothing was submitted; the prompt is in the input — press Enter once this turn ends',
  'distill.flowFailed': 'Cannot read distill/flow.md (incomplete install)',
  'distill.insertFailed': 'Could not write into the input (the chat may be busy, or the draft just changed); copy it and retry',
  'distill.submitFailed': 'Filled, but auto-submit failed — just press Enter',
  'distill.copy': 'Copy prompt',
  'distill.copied': 'Copied',
  'distill.copyFailed': 'Copy failed — select the text below manually',
  'distill.noProgress': 'The panel cannot see the chat, so it only shows what you pasted back. Nothing is written to disk until you save.',
  'distill.dockDraftNotEmpty': 'The input already has text — use Send in the panel, or clear it first',
  'distill.dockFilled': 'Prompt filled into the input — press Enter to send',
  'distill.dockUnavailable': 'Composer API unavailable: use Send in the panel, or copy the prompt',
  'distill.entryHint': 'Make a card from a story or a setup',
  'distill.start': 'Start distilling',
  'distill.done': 'Done',
  'distill.savedHint': 'The model builds and saves the card itself; it shows up in the panel when done',
  'distill.armFailed': 'Could not open the distillation channel: {reason}',
  'distill.lastSaved': 'New card saved: {name}',
}

export const localeDictionaries = { zh, en }

/** 翻译器：`t('roster.memory', { n: 3 })`。缺失的 key 原样返回，开发期一眼能看出来。 */
export type Translate = (key: string, params?: Record<string, string | number>) => string

/**
 * 生成一个翻译器。
 *
 * 宿主会在槽位注入 `t`（已绑定本插件命名空间）；拿不到时（例如早期版本）
 * 退回本地中文词典，保证文案永远不会是裸 key。
 */
export function makeTranslator(t?: (key: string, params?: Record<string, string | number>) => string): Translate {
  const fallback = zh as Record<string, string>
  return (key, params) => {
    let template: string | undefined
    if (typeof t === 'function') {
      try {
        const value = t(key, params)
        // 宿主在缺 key 时通常回显 key 本身
        if (typeof value === 'string' && value !== '' && value !== key) template = value
      } catch {
        template = undefined
      }
    }
    if (template === undefined) template = fallback[key] ?? key
    if (params === undefined) return template
    return template.replace(/\{(\w+)\}/g, (match, name: string) => {
      const value = params[name]
      return value === undefined ? match : String(value)
    })
  }
}

// ---------------------------------------------------------------- 角色卡解析

/** 从任意值里取出第一个非空字符串。 */
function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim() !== '') return value.trim()
    if (Array.isArray(value)) {
      const parts = value.filter((v): v is string => typeof v === 'string' && v.trim() !== '')
      if (parts.length > 0) return parts.join(' · ')
    }
  }
  return ''
}

/** 记录型字段转成「键 → 可读值」数组，用于详情页的字段表。 */
export function entriesOf(value: unknown): Array<[string, string]> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return []
  const out: Array<[string, string]> = []
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const text = firstString(raw, typeof raw === 'number' ? String(raw) : undefined)
    if (text !== '') out.push([key, text])
  }
  return out
}

/** 角色的「身份」一句话：身份 → 关系起点 → 一句话背景。 */
export function roleOf(card: Card | undefined): string {
  if (card === undefined) return ''
  const basic = (card.basic ?? {}) as Record<string, unknown>
  const rel = (card.relationship ?? {}) as Record<string, unknown>
  return firstString(basic['身份'], basic['身份/职业'], rel['关系起点'], basic['一句话背景'])
}

/** 简介：一句话背景，缺省时退到身份。 */
export function blurbOf(card: Card | undefined): string {
  if (card === undefined) return ''
  const basic = (card.basic ?? {}) as Record<string, unknown>
  return firstString(basic['一句话背景'], basic['身份'], (card.personality as Record<string, unknown> | undefined)?.['内在矛盾'])
}

/** 名字首字：中文取第一个汉字，拉丁取首字母大写。 */
export function initialOf(name: string): string {
  const trimmed = name.trim()
  if (trimmed === '') return '？'
  const first = Array.from(trimmed)[0] ?? '？'
  return /[a-z]/i.test(first) ? first.toUpperCase() : first
}

/** 由名字派生的稳定色相（0-3），让卡片墙的色彩分布不随机跳动。 */
export function hueOf(name: string): number {
  let hash = 0
  for (let i = 0; i < name.length; i += 1) hash = (hash * 31 + name.charCodeAt(i)) >>> 0
  return hash % 4
}

/** 「最近活跃」的短格式：今天 / 昨天 / N 天前 / 日期。 */
export function relativeDay(iso: string): string {
  if (iso === '') return ''
  const when = new Date(iso)
  if (Number.isNaN(when.getTime())) return ''
  const now = new Date()
  const dayMs = 86400000
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const startThen = new Date(when.getFullYear(), when.getMonth(), when.getDate()).getTime()
  const days = Math.round((startToday - startThen) / dayMs)
  if (days <= 0) return '今天'
  if (days === 1) return '昨天'
  if (days < 30) return `${days} 天前`
  return `${when.getFullYear()}-${String(when.getMonth() + 1).padStart(2, '0')}-${String(when.getDate()).padStart(2, '0')}`
}

/** 日记按日期倒序，空行剔除。 */
export function sortedDiary(entries: DiaryEntry[]): DiaryEntry[] {
  return [...entries]
    .map(entry => ({
      date: entry.date,
      timeline: entry.timeline.filter(line => line.trim() !== ''),
      notes: entry.notes.filter(line => line.trim() !== ''),
    }))
    .filter(entry => entry.timeline.length > 0 || entry.notes.length > 0)
    .sort((a, b) => b.date.localeCompare(a.date))
}

/** 角色簿排序：启用的置顶，其余按最近活跃时间倒序。 */
export function sortRoster(list: CharacterSummary[], activeName?: string): CharacterSummary[] {
  return [...list].sort((a, b) => {
    const aLive = a.name === activeName ? 1 : 0
    const bLive = b.name === activeName ? 1 : 0
    if (aLive !== bLive) return bLive - aLive
    return (b.lastActive || '').localeCompare(a.lastActive || '')
  })
}

/** 统计条要显示的三项数字。 */
export interface StatTriple {
  characters: number
  memory: number
  turns: number
}

/** 有总览就用总览（含轮数），否则从角色簿现算。 */
export function statTriple(
  overview: { stats?: Partial<StatTriple> & { memoryEntries?: number } } | undefined,
  list: CharacterSummary[],
): StatTriple {
  const fromList = () => ({
    characters: list.length,
    memory: list.reduce((sum, item) => sum + item.memoryCount, 0),
    turns: 0,
  })
  if (overview?.stats === undefined) return fromList()
  const raw = overview.stats
  const fallback = fromList()
  // 后端字段叫 memoryEntries（见 src/web.ts），这里做一次归一，缺什么补什么
  return {
    characters: Number(raw.characters ?? fallback.characters),
    memory: Number(raw.memory ?? raw.memoryEntries ?? fallback.memory),
    turns: Number(raw.turns ?? 0),
  }
}