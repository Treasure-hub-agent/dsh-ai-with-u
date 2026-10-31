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
  // ---- 注入预览（GET /preview，只读快照）----
  'preview.entry': '注入预览',
  'preview.title': '本轮注入了什么',
  'preview.hint': '只读快照：当前会话下一次请求会拼进提示词的内容。',
  'preview.loading': '正在读取注入内容…',
  'preview.failed': '读不到注入预览：{reason}',
  'preview.unavailable': '宿主的注入预览接口还没就绪（GET /preview）。',
  'preview.inactive': '先启用一张卡才会注入。',
  'preview.total': '总字符',
  'preview.l1': 'L1 角色设定',
  'preview.discipline': '纪律包',
  'preview.discipline.off': '关闭',
  'preview.discipline.lite': '精简',
  'preview.discipline.full': '完整',
  'preview.chars': '{n} 字',
  'preview.order': '顺序 {n}',
  'preview.emptySegment': '本轮为空',
  'preview.noSegments': '宿主没有返回任何注入段。',
  'preview.refresh': '刷新',
  'preview.activeLabel': '启用中',
  'panel.dropCard': '卡文件请从「导入角色卡」拖进虚线框。',
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
  'active.gExit': '退出全局',
  'active.mode.switch': '切换模式',
  'active.session': '当前会话',
  'active.global': '全局',
  'active.sessionBound': '已绑定',
  'active.sessionInherit': '沿用全局',
  'active.globalNone': '未启用',
  'active.both': '本会话 / 全局',

  'roster.empty.title': '角色簿还是空的',
  'roster.empty.hint': '新建一张角色卡就能开始；也可以把原 ai-with-u 的 characters 目录搬进插件目录。',
  'roster.count': '共 {n} 位',
  'roster.memory': '{n} 条记忆',
  'roster.never': '从未互动',
  'roster.pick': '从左栏选一张卡',
  'roster.pickHint': '点开一张卡可以看详情、改人设、翻日记',
  'roster.enable': '启用',
  'roster.enabled': '启用中',
  'roster.detail': '查看',
  'roster.open': '打开 {name} 的角色页',

  // ---- 导入酒馆卡（PNG / CHARX / JSON）----
  // ---- 两张卡的入口（同级并排：蒸馏 / 自创）----
  'cta.distill': '蒸馏角色卡',
  'cta.distillHint': '从作品或设定做一张新卡',
  'cta.selfCreate': '自创角色卡',
  'cta.selfCreateHint': '从零写一张，可让 AI 补全',
  'import.entry': '导入角色卡',
  'import.title': '导入角色卡',
  'import.hint': '支持酒馆 PNG 卡（tEXt / iTXt）、CHARX 压缩包和裸 JSON。解析这一步不写盘，确认后才落盘。',
  'import.pick': '选择文件',
  'import.pickHint': '或把 .png / .charx / .json 拖进这个框',
  'import.dropHint': '把卡拖到虚线框里，或点「选择文件」。',
  'import.limit': '单文件上限 {max}（base64 会把体积放大 4/3，宿主请求体上限 16 MB 就是这么换算的）',
  'import.parsing': '正在解析卡片…',
  'import.tooLarge': '文件 {size} 超过上限 {max}：宿主导入接口走 base64（体积 ×4/3），16 MB 的请求体换算下来就是这个数。',
  'import.empty': '这个文件是空的，换一张卡试试。',
  'import.badType': '只认得 .png / .charx / .json 这三种卡文件（CHARX 也可能是 .zip）。',
  'import.format': '格式',
  'import.format.png': '酒馆 PNG',
  'import.format.charx': 'CHARX 压缩包',
  'import.format.json': 'JSON 卡',
  'import.name': '角色名',
  'import.warnings': '解析提示（{n} 条）',
  'import.noWarnings': '解析干净，没有需要提示的地方。',
  'import.warnGroup.parse': '解析提示',
  'import.warnGroup.lore': '世界书提示',
  'import.warnGroup.unsupported': '不支持的酒馆特性',
  'import.warnGroup.more': '还有 {n} 条',
  'import.conflictTitle': '已存在同名角色「{name}」',
  'import.conflictBody': '继续会覆盖这张角色卡的内容；它的日记与会话记录仍然保留。',
  'import.overwrite': '覆盖并导入',
  'import.overwriteConfirm': '确认覆盖「{name}」的卡片内容？这一步不可撤销。',
  'import.overwriteYes': '确认覆盖',
  'import.confirm': '保存到角色簿',
  'import.done': '已导入「{name}」',
  'import.readFailed': '读不了这个文件（{name}）：换一张卡，或先确认它没被别的程序占用。',
  'import.fileName': '文件',
  'import.retry': '重选文件',
  'import.mismatch': '保存后回读的名字对不上：期望「{expect}」，回读到「{actual}」。磁盘可能没写进去，请重试。',

  'diary.pick': '先启用或选择一位角色，才能翻它的日记。',
  'diary.empty': '还没有写下任何一天。你们聊过的内容会被自动记进来。',
  'diary.marker.timeline': '时',
  'diary.marker.notes': '记',
  'diary.search': '搜索日记',
  'diary.searchPlaceholder': '关键词：时间线 / 心情札记都搜',
  'diary.searchClear': '清除',
  'diary.hitCount': '{n} 条',
  'diary.noMatch': '没有命中「{keyword}」的日记。',
  'diary.monthTitle': '{year} 年 {month} 月',
  'diary.export': '导出',
  'diary.exportHint': '导出为 markdown（{name}-日记-YYYYMMDD.md）',
  'diary.emptyFor': '{name} 还没有日记',
  'diary.emptyForHint': '聊几句之后 TA 会开始记；日记会按天记在这里。',
  'diary.loadFailed': '这段日记没能加载出来',


  'stats.title': '这一册的厚度',
  'stats.characters.full': '位角色',
  'stats.memory.full': '条记忆',
  'stats.turns.full': '轮对话',
  'stats.source': '角色来源',
  'stats.source.custom': '自己建的',
  'stats.source.distill': '蒸馏',
  'stats.source.import': '导入',
  'stats.source.count': '{n} 张',
  'stats.recent': '最近活跃',
  'stats.root': '存放位置',
  'stats.none': '暂无数据',

  'detail.back': '返回',
  'detail.card': '角色卡',
  'detail.personality': '性格',
  'detail.voice': '声音',
  'detail.relationship': '关系',
  'detail.bindSession': '当前会话启用',
  'detail.bindSessionOff': '解除本会话绑定',
  'detail.globalOn': '全局启用',
  'detail.globalOff': '退出全局',
  'detail.delete': '删除',
  'detail.diary': '最近日记',
  'detail.diaryEmpty': '这位角色还没有日记。',
  'detail.loadFailed': '这个角色没能加载出来',

  'new.title': '自创角色卡',
  'new.name': '角色名',
  'new.namePlaceholder': '例如：虞照',
  'new.role': '身份',
  'new.rolePlaceholder': '可选，例如：合租室友',
  'new.blurb': '一句话背景',
  'new.blurbPlaceholder': '可选，一句话说清他/她是谁、和你什么关系',
  'new.preview': '会创建：',
  'new.confirm': '创建',
  'new.confirmAi': '保存并发给 AI',
  'new.cancel': '取消',
  'new.nameRequired': '先给角色起个名字。',
  'new.nameTaken': '这个名字已经有人用了。',
  'new.aiFill': '让 AI 补全人设',
  'new.aiFillHint': '先存下这张骨架卡，再把补全指令发进当前会话：AI 会先问你几个问题，然后自己把卡补完。',
  'new.aiFillSent': '骨架卡已保存，指令已发到当前会话——AI 会先问你几个问题。',
  'new.aiFillFilled': '骨架卡已保存，指令已填进输入框：按回车发给 AI。',
  'new.aiFillFilledBusy': '骨架卡已保存；会话正在生成，指令已填进输入框，等这一轮结束再按回车。',
  'new.aiArmFailed': '骨架卡已保存，但没能开启补全通道：{reason}',
  'new.saveFailed': '骨架卡保存失败：{reason}',
  'new.done': '已创建「{name}」',
  'new.createdTag': '这张卡：',
  'new.saveWarnHead': '「{name}」已保存，但有几条提示：',

  'delete.title': '删除角色',
  'delete.body': '要删掉「{name}」吗？这一步不会自动备份。',
  'delete.withMemory': '连同日记与记忆一起删除（不可恢复）',
  'delete.keepMemory': '角色卡删除后，日记文件会保留在磁盘上。',
  'delete.confirm': '确认删除',
  'delete.cancel': '再想想',
  'delete.done': '已删除角色卡',
  'delete.doneWithMemory': '已连同记忆一起删除',
  'forget.none': '没有找到包含该关键词的记忆。',

  'mode.title': '切换交互模式',
  'mode.text': '纯文本',
  'mode.textHint': '不输出动作神态，只靠语气与断句表达',
  'mode.action': '文本 + 动作',
  'mode.actionHint': '动作神态用括号包起来，与台词分清界限',
  'mode.pending': '先记为默认：启用角色后会自动切到这个模式。',
  'mode.picked': '已切到「{mode}」。',

  'common.loading': '载入中…',
  'time.today': '今天',
  'time.yesterday': '昨天',
  'time.daysAgo': '{n} 天前',
  'common.retry': '重试',
  'common.cancel': '取消',
  'common.save': '保存',
  'common.unknown': '未知',
  'common.noMemory': '0 条记忆',
  'common.busy': '处理中…',
  'common.close': '关闭',
  'notice.close': '关闭提示',
  'notice.warnHead': '还有 {n} 条提示：',

  // ---- 记忆与剧情维护 ----
  'relation.title': '关系',
  'relation.baseline': '起点',
  'relation.turns': '{n} 轮',
  'relation.note': '档位由模型根据对话现算，这里只显示起点锚定。',
  'relation.baselineShort': '关系起点',
  'detail.lastActive': '最近互动',
  // ---- 会话绑定 / 全局启用的边界说明（可见文案，不塞 tooltip）----
  'bind.hint.session': '本会话的提示词、日记、关系都会跟这个角色走；其它会话不受影响。',
  'bind.hint.global': '所有未绑定会话会切到该角色；已绑定的会话不变。',
  'bind.hint.subagent': '子代理固定使用全局角色，不继承本会话绑定。',
  'bind.noSession': '当前会话不可识别，只能用全局启用。',
  'bind.done.session': '已把「{name}」绑定到当前会话（本会话的提示词、日记、关系都跟着它走）。',
  'bind.done.unbind': '已解除本会话绑定，这个会话回到全局角色。',
  'bind.done.global': '已全局启用「{name}」，未绑定的会话都会切到它。',
  'bind.done.exitGlobal': '已退出全局启用。',
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
  'reset.sessionTitle': '全新开始「{name}」？',
  'reset.sessionBody': '清空最近记录、心情、话题与轮数；日记会保留。这一步不可撤销。',
  'reset.sessionWord': '全新开始',

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
  'edit.chars': '{n} 字',

  // ---- 世界书（角色卡编辑器第 11 个分区）----
  'lore.title': '世界书（设定条目）',
  'lore.hint': '关键词命中时才带进上下文；常驻条目每轮都带。改动只在你点保存后落盘。',
  'regex.blocked': '本卡含 {n} 条酒馆正则脚本，已屏蔽：不执行、不注入提示词、不影响对话。',
  'lore.unsupported': '这张卡没有完整 CCv3 对象（旧格式或后端未提供），暂时不能编辑世界书。',
  'lore.entryCount': '{n} 条',
  'lore.chars': '{n} 字',
  'lore.empty': '还没有设定条目。',
  'lore.emptyHint': '关键词命中时才交给模型 —— 地名、人物小传、专有名词这类「用到才需要」的背景最适合放在这里。',
  'lore.addFirst': '添加第一条设定',
  'lore.add': '添加条目',
  'lore.delete': '删除条目',
  'lore.moveUp': '上移',
  'lore.moveDown': '下移',
  'lore.expand': '展开编辑',
  'lore.collapse': '收起',
  'lore.name': '条目名',
  'lore.namePlaceholder': '如：雾港',
  'lore.keys': '关键词',
  'lore.keysPlaceholder': '用逗号分隔；命中任意一个就触发',
  'lore.secondaryKeys': '次级关键词',
  'lore.secondaryKeysPlaceholder': '仅在「需同时命中次级词」开启时参与判断',
  'lore.content': '内容',
  'lore.contentPlaceholder': '命中后要交给模型的那段设定',
  'lore.constant': '常驻（不看关键词，每轮都带）',
  'lore.constantShort': '常驻',
  'lore.noKeysShort': '无关键词',
  'lore.enabled': '启用',
  'lore.priority': '优先级',
  'lore.order': '插入顺序',
  'lore.advanced': '高级',
  'lore.position': '插入位置',
  'lore.position.before': '角色设定之前',
  'lore.position.after': '角色设定之后',
  'lore.caseSensitive': '区分大小写',
  'lore.selective': '需同时命中次级词',
  'lore.useRegex': '关键词按正则匹配',
  'lore.book': '书级设置',
  'lore.bookName': '世界书名',
  'lore.bookNamePlaceholder': '选填，只用于展示',
  'lore.bookDescription': '描述',
  'lore.bookDescriptionPlaceholder': '选填',
  'lore.scanDepth': '扫描深度',
  'lore.tokenBudget': 'token 预算',
  'lore.recursiveScanning': '递归扫描',
  'lore.healthPass': '体检通过：没有需要处理的条目',
  'lore.level.error': '错误',
  'lore.level.warn': '提醒',
  'lore.level.info': '提示',
  'lore.levelBadge': '{level} · {n} 条',
  'lore.summary': '{count} 条 · {chars} · 常驻 {constant} 条 · 本轮预算 {budgetEntries} 条 / {budgetChars} 字',
  'lore.issues.showInfo': '提示 {n} 条',
  'lore.issues.hideInfo': '收起提示',
  'lore.dropped.title': '本轮有 {n} 条设定超出预算未注入',
  'lore.dropped.budget': '预算 {entries} 条 / {chars} 字',
  'lore.dropped.budgetBoth': '最多 {entries} 条 · 关键词 {chars} 字 / 常驻 {constant} 字',
  'lore.dropped.constant': '常驻',
  'lore.dropped.keyword': '关键词命中',
  'lore.dropped.unknown': '超预算',
  'lore.issue.no-keys': '没关键词又不是常驻：这条永远不会被触发。',
  'lore.issue.empty-content': '内容是空的。',
  'lore.issue.long-entries': '{count} 条偏长（最长 {detail} 字）· 条目按需注入，命中时才占预算，通常不用改。',
  'lore.issue.shared-keys': '{count} 个关键词被多条共用（最多 {detail} 条）· 酒馆里本来就会一起注入，命中时会成组出现。',
  'lore.issue.content-too-long': '这一条 {detail}，命中一次就会挤掉别人的额度（超过关键词预算的一半），建议拆成几条。',
  'lore.issue.too-many-entries': '{detail} 条超出 {max} 条建议上限 · 不会报错；超出预算的条目不会进提示词，可在本页顶部「被裁条目」里看清单。',
  'lore.issueFor': '「{name}」',
  'lore.issueUnnamed': '第 {n} 条',
  'lore.saveMismatch': '世界书没写进去：期望 {expect} 条，回读到 {actual} 条。请重试；一直这样就说明后端把 character_book 洗掉了。',
  'lore.saved': '世界书已保存',
  'lore.fullscreen': '全屏写',
  'lore.focusTitle': '编辑「{name}」的内容',

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
  'distill.why': 'AI 会把这件事交给一个子代理去做——它自己查资料、建卡并保存，你的对话不会被六步流程占满；你只需要回答它问的问题。',
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
  'distill.entryHint': '从作品或设定做一张卡',
  'distill.start': '开始蒸馏',
  'distill.done': '好',
  'distill.savedHint': '子代理跑完会自动出现在角色簿里，不用你做任何操作',
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
  // ---- Injection preview (GET /preview, read-only snapshot) ----
  'preview.entry': 'Injection preview',
  'preview.title': 'What goes into this turn',
  'preview.hint': 'Read-only snapshot of what the next request in this chat will inject into the prompt.',
  'preview.loading': 'Reading the injected content…',
  'preview.failed': 'Could not load the preview: {reason}',
  'preview.unavailable': 'The host preview endpoint is not ready yet (GET /preview).',
  'preview.inactive': 'Enable a card first — nothing is injected while idle.',
  'preview.total': 'Total chars',
  'preview.l1': 'L1 character',
  'preview.discipline': 'Discipline',
  'preview.discipline.off': 'Off',
  'preview.discipline.lite': 'Lite',
  'preview.discipline.full': 'Full',
  'preview.chars': '{n} chars',
  'preview.order': 'order {n}',
  'preview.emptySegment': 'Empty this turn',
  'preview.noSegments': 'The host returned no segments.',
  'preview.refresh': 'Refresh',
  'preview.activeLabel': 'Active',
  'panel.dropCard': 'Drop card files into “Import card”.',
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
  'active.gExit': 'Exit global',
  'active.mode.switch': 'Switch mode',
  'active.session': 'This chat',
  'active.global': 'Global',
  'active.sessionBound': 'bound',
  'active.sessionInherit': 'inherits global',
  'active.globalNone': 'not enabled',
  'active.both': 'this chat / global',

  'roster.empty.title': 'Your roster is empty',
  'roster.empty.hint': 'Create a card to begin, or move an existing characters folder into the plugin directory.',
  'roster.count': '{n} total',
  'roster.memory': '{n} memories',
  'roster.never': 'Never used',
  'roster.pick': 'Pick a card on the left',
  'roster.pickHint': 'Open one to see details, edit the persona, or read its diary',
  'roster.enable': 'Enable',
  'roster.enabled': 'Active',
  'roster.detail': 'View',
  'roster.open': 'Open {name}',

  // ---- Importing a tavern card (PNG / CHARX / JSON) ----
  // ---- Card entries (peers in one row: distill / self-create) ----
  'cta.distill': 'Distill card',
  'cta.distillHint': 'Make a new card from a story or a setup',
  'cta.selfCreate': 'Create card',
  'cta.selfCreateHint': 'Write one from scratch, optionally AI-filled',
  'import.entry': 'Import card',
  'import.title': 'Import character card',
  'import.hint': 'Tavern PNG cards (tEXt / iTXt), CHARX archives and plain JSON are supported. Parsing writes nothing — the card lands only after you confirm.',
  'import.pick': 'Choose a file',
  'import.pickHint': 'Or drag a .png / .charx / .json into this box',
  'import.dropHint': 'Drop the card into the dashed box, or choose a file.',
  'import.limit': 'One file up to {max} (base64 inflates by 4/3 — that is how the 16 MB request cap translates).',
  'import.parsing': 'Parsing the card…',
  'import.tooLarge': 'This file is {size}, over the {max} limit: the host import route carries base64 (×4/3), so a 16 MB request body works out to that.',
  'import.empty': 'That file is empty — try another card.',
  'import.badType': 'Only .png / .charx / .json card files are recognized (a CHARX may also be .zip).',
  'import.format': 'Format',
  'import.format.png': 'Tavern PNG',
  'import.format.charx': 'CHARX archive',
  'import.format.json': 'JSON card',
  'import.name': 'Name',
  'import.warnings': 'Parse notes ({n})',
  'import.noWarnings': 'Parsed cleanly — nothing to flag.',
  'import.warnGroup.parse': 'Parse notes',
  'import.warnGroup.lore': 'World-book notes',
  'import.warnGroup.unsupported': 'Unsupported Tavern features',
  'import.warnGroup.more': '{n} more',
  'import.conflictTitle': 'A character named “{name}” already exists',
  'import.conflictBody': 'Continuing overwrites this card’s content; its diary and session stay.',
  'import.overwrite': 'Overwrite and import',
  'import.overwriteConfirm': 'Overwrite the card content of “{name}”? This cannot be undone.',
  'import.overwriteYes': 'Overwrite',
  'import.confirm': 'Save to roster',
  'import.done': 'Imported “{name}”',
  'import.readFailed': 'Could not read {name}: try another card, or make sure no other program holds it open.',
  'import.fileName': 'File',
  'import.retry': 'Pick another file',
  'import.mismatch': 'Read-back name does not match: expected “{expect}”, got “{actual}”. The write may not have landed — please retry.',

  'diary.pick': 'Enable or pick a character to read its diary.',
  'diary.empty': 'No days written yet. Conversations are recorded here automatically.',
  'diary.marker.timeline': 'T',
  'diary.marker.notes': 'N',
  'diary.search': 'Search diary',
  'diary.searchPlaceholder': 'Keyword — searches timeline and notes',
  'diary.searchClear': 'Clear',
  'diary.hitCount': '{n} lines',
  'diary.noMatch': 'No diary lines matched “{keyword}”.',
  'diary.monthTitle': '{month}/{year}',
  'diary.export': 'Export',
  'diary.exportHint': 'Export as markdown ({name}-diary-YYYYMMDD.md)',
  'diary.emptyFor': '{name} has no diary yet',
  'diary.emptyForHint': 'Chat a little and TA will start keeping notes; days are recorded here.',
  'diary.loadFailed': 'This diary could not be loaded',


  'stats.title': 'How thick this volume is',
  'stats.characters.full': 'characters',
  'stats.memory.full': 'memories',
  'stats.turns.full': 'turns',
  'stats.source': 'By source',
  'stats.source.custom': 'Created here',
  'stats.source.distill': 'Distilled',
  'stats.source.import': 'Imported',
  'stats.source.count': '{n} cards',
  'stats.recent': 'Recently active',
  'stats.root': 'Storage location',
  'stats.none': 'No data yet',

  'detail.back': 'Back',
  'detail.card': 'Character card',
  'detail.personality': 'Personality',
  'detail.voice': 'Voice',
  'detail.relationship': 'Relationship',
  'detail.bindSession': 'Enable in this chat',
  'detail.bindSessionOff': 'Unbind this chat',
  'detail.globalOn': 'Enable globally',
  'detail.globalOff': 'Exit global',
  'detail.delete': 'Delete',
  'detail.diary': 'Recent diary',
  'detail.diaryEmpty': 'This character has no diary yet.',
  'detail.loadFailed': 'This character could not be loaded',

  'new.title': 'Create a card',
  'new.name': 'Name',
  'new.namePlaceholder': 'e.g. Yuzhao',
  'new.role': 'Role',
  'new.rolePlaceholder': 'Optional, e.g. roommate',
  'new.blurb': 'One-line background',
  'new.blurbPlaceholder': 'Optional, one line about who they are to you',
  'new.preview': 'Will create: ',
  'new.confirm': 'Create',
  'new.confirmAi': 'Save and send to AI',
  'new.cancel': 'Cancel',
  'new.nameRequired': 'Give the character a name first.',
  'new.nameTaken': 'That name is already taken.',
  'new.aiFill': 'Let the AI fill in the persona',
  'new.aiFillHint': 'The skeleton card is saved first, then the fill-in prompt goes into the current chat: the AI asks a few questions and completes the card itself.',
  'new.aiFillSent': 'Skeleton card saved and the prompt sent to the current chat — the AI will ask a few questions first.',
  'new.aiFillFilled': 'Skeleton card saved and the prompt filled into the input: press Enter to send it to the AI.',
  'new.aiFillFilledBusy': 'Skeleton card saved; the chat is generating, so the prompt sits in the input — press Enter once this turn ends.',
  'new.aiArmFailed': 'Skeleton card saved, but the fill-in channel could not be opened: {reason}',
  'new.saveFailed': 'Could not save the skeleton card: {reason}',
  'new.done': 'Created “{name}”',
  'new.createdTag': 'Card: ',
  'new.saveWarnHead': '“{name}” saved, with a few notes:',

  'delete.title': 'Delete character',
  'delete.body': 'Delete “{name}”? This cannot be undone.',
  'delete.withMemory': 'Also delete diary and memories (permanent)',
  'delete.keepMemory': 'The diary file stays on disk if you keep memories.',
  'delete.confirm': 'Delete',
  'delete.cancel': 'Keep it',
  'delete.done': 'Character deleted',
  'delete.doneWithMemory': 'Character and memories deleted',
  'forget.none': 'No memory matched that keyword.',

  'mode.title': 'Interaction mode',
  'mode.text': 'Text only',
  'mode.textHint': 'No action beats; tone and pauses carry it',
  'mode.action': 'Text + action',
  'mode.actionHint': 'Action beats in parentheses, separate from speech',
  'mode.pending': 'Saved as the default: it applies as soon as a character is enabled.',
  'mode.picked': 'Mode set to {mode}.',

  'common.loading': 'Loading…',
  'time.today': 'Today',
  'time.yesterday': 'Yesterday',
  'time.daysAgo': '{n} days ago',
  'common.retry': 'Retry',
  'common.cancel': 'Cancel',
  'common.save': 'Save',
  'common.unknown': 'Unknown',
  'common.noMemory': '0 memories',
  'common.busy': 'Working…',
  'common.close': 'Close',
  'notice.close': 'Dismiss notice',
  'notice.warnHead': '{n} more note(s):',

  'relation.title': 'Relationship',
  'relation.baseline': 'Start',
  'relation.turns': '{n} turns',
  'relation.note': 'The live band is computed by the model from the conversation; this shows only the starting anchor.',
  'relation.baselineShort': 'Starts at',
  'detail.lastActive': 'Last active',
  // ---- Chat binding / global enable boundaries (visible copy, not tooltips) ----
  'bind.hint.session': 'This chat’s prompt, diary and relationship follow this character; other chats are unaffected.',
  'bind.hint.global': 'Every unbound chat switches to this character; chats that are already bound stay put.',
  'bind.hint.subagent': 'Sub-agents always use the global character; they do not inherit this chat’s binding.',
  'bind.noSession': 'This chat cannot be identified, so only global enabling is available.',
  'bind.done.session': '“{name}” is now bound to this chat (its prompt, diary and relationship follow it).',
  'bind.done.unbind': 'This chat is unbound and falls back to the global character.',
  'bind.done.global': '“{name}” is now enabled globally; unbound chats switch to it.',
  'bind.done.exitGlobal': 'Global enable turned off.',
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
  'reset.sessionTitle': 'Fresh start for “{name}”?',
  'reset.sessionBody': 'Clears recent records, mood, topic and turn count; the diary stays. This cannot be undone.',
  'reset.sessionWord': 'Fresh start',

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
  'edit.chars': '{n} chars',

  // ---- World book (11th card-editor section) ----
  'lore.title': 'World book (lore entries)',
  'lore.hint': 'Entries enter the context only when a keyword hits; constant entries ride every turn. Changes land only when you press Save.',
  'regex.blocked': 'This card carries {n} Tavern regex script(s), blocked: never executed, never injected into the prompt, no effect on chats.',
  'lore.unsupported': 'This card has no full CCv3 object (legacy format or the host did not provide it), so the world book cannot be edited here.',
  'lore.entryCount': '{n} entries',
  'lore.chars': '{n} chars',
  'lore.empty': 'No lore entries yet.',
  'lore.emptyHint': 'Entries reach the model only on a keyword hit — ideal for place names, mini-bios and jargon that matters only when used.',
  'lore.addFirst': 'Add the first entry',
  'lore.add': 'Add entry',
  'lore.delete': 'Delete entry',
  'lore.moveUp': 'Move up',
  'lore.moveDown': 'Move down',
  'lore.expand': 'Expand',
  'lore.collapse': 'Collapse',
  'lore.name': 'Title',
  'lore.namePlaceholder': 'e.g. Mistport',
  'lore.keys': 'Keywords',
  'lore.keysPlaceholder': 'Comma separated; any hit triggers the entry',
  'lore.secondaryKeys': 'Secondary keywords',
  'lore.secondaryKeysPlaceholder': 'Only used when “require secondary hit” is on',
  'lore.content': 'Content',
  'lore.contentPlaceholder': 'The lore handed to the model on a hit',
  'lore.constant': 'Constant (no keyword check, every turn)',
  'lore.constantShort': 'Constant',
  'lore.noKeysShort': 'No keywords',
  'lore.enabled': 'Enabled',
  'lore.priority': 'Priority',
  'lore.order': 'Insertion order',
  'lore.advanced': 'Advanced',
  'lore.position': 'Position',
  'lore.position.before': 'Before character',
  'lore.position.after': 'After character',
  'lore.caseSensitive': 'Case sensitive',
  'lore.selective': 'Require secondary hit',
  'lore.useRegex': 'Keywords are regex',
  'lore.book': 'Book settings',
  'lore.bookName': 'Book name',
  'lore.bookNamePlaceholder': 'Optional, display only',
  'lore.bookDescription': 'Description',
  'lore.bookDescriptionPlaceholder': 'Optional',
  'lore.scanDepth': 'Scan depth',
  'lore.tokenBudget': 'Token budget',
  'lore.recursiveScanning': 'Recursive scanning',
  'lore.healthPass': 'All clear: nothing needs your attention',
  'lore.level.error': 'Errors',
  'lore.level.warn': 'Warnings',
  'lore.level.info': 'Notes',
  'lore.levelBadge': '{level} · {n}',
  'lore.summary': '{count} entries · {chars} · {constant} constant · budget {budgetEntries} / {budgetChars} chars per turn',
  'lore.issues.showInfo': '{n} notes',
  'lore.issues.hideInfo': 'Hide notes',
  'lore.dropped.title': '{n} entries were dropped by this turn’s budget',
  'lore.dropped.budget': 'budget {entries} entries / {chars} chars',
  'lore.dropped.budgetBoth': 'up to {entries} entries · keyword {chars} / constant {constant} chars',
  'lore.dropped.constant': 'Constant',
  'lore.dropped.keyword': 'Keyword hit',
  'lore.dropped.unknown': 'Over budget',
  'lore.issue.no-keys': 'No keywords and not constant: this entry can never trigger.',
  'lore.issue.empty-content': 'Content is empty.',
  'lore.issue.long-entries': '{count} long entries (longest {detail} chars) · entries are injected on demand, so they only use the budget when they hit — usually nothing to fix.',
  'lore.issue.shared-keys': '{count} keywords are shared by several entries (up to {detail}) · Tavern injects them together anyway, so they show up as a group on a hit.',
  'lore.issue.content-too-long': '{detail} — a hit on this one alone eats half the keyword budget; consider splitting it.',
  'lore.issue.too-many-entries': '{detail} entries, above the suggested {max} · nothing errors out; entries over budget simply never reach the prompt — see the “dropped entries” list at the top of this page.',
  'lore.issueFor': '“{name}”',
  'lore.issueUnnamed': 'Entry {n}',
  'lore.saveMismatch': 'The world book did not stick: expected {expect} entries, read back {actual}. Retry; if it persists the back end is dropping character_book.',
  'lore.saved': 'World book saved',
  'lore.fullscreen': 'Full screen',
  'lore.focusTitle': 'Edit the content of “{name}”',

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
  'distill.why': 'The AI hands this to a sub-agent — it researches, builds and saves the card itself, so your chat is not taken over by the six-phase run. You just answer its questions.',
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
  'distill.entryHint': 'Make a card from a story or a setup',
  'distill.start': 'Start distilling',
  'distill.done': 'Done',
  'distill.savedHint': 'It appears in your roster automatically when the sub-agent finishes — nothing to copy',
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

/** 「最近活跃」的短格式：今天 / 昨天 / N 天前 / 日期。传入 `t` 时走当前语言。 */
export function relativeDay(iso: string, t?: Translate): string {
  if (iso === '') return ''
  const when = new Date(iso)
  if (Number.isNaN(when.getTime())) return ''
  const now = new Date()
  const dayMs = 86400000
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const startThen = new Date(when.getFullYear(), when.getMonth(), when.getDate()).getTime()
  const days = Math.round((startToday - startThen) / dayMs)
  const label = (key: string, fallback: string, params?: Record<string, string | number>): string => {
    if (t !== undefined) return t(key, params)
    return params === undefined ? fallback : fallback.replace('{n}', String(params['n'] ?? ''))
  }
  if (days <= 0) return label('time.today', '今天')
  if (days === 1) return label('time.yesterday', '昨天')
  if (days < 30) return label('time.daysAgo', '{n} 天前', { n: days })
  return `${when.getFullYear()}-${String(when.getMonth() + 1).padStart(2, '0')}-${String(when.getDate()).padStart(2, '0')}`
}

/**
 * 「角色来源」的显示名：三个已知出处映射成当前语言，其余原样（URL 缩成域名）。
 *
 * 为什么要映射：source 是 CCv3 的出处标识（custom / distill / import），
 * 直接铺英文在中文界面里像裸 key；外部导入卡可能塞 URL，所以还要兜一层缩域名。
 */
export function sourceLabelOf(key: string, t: Translate): string {
  if (key === 'custom') return t('stats.source.custom')
  if (key === 'distill') return t('stats.source.distill')
  if (key === 'import') return t('stats.source.import')
  return sourceLabel(key)
}

export function sourceLabel(key: string): string {
  if (!/^https?:\/\//i.test(key)) return key
  try {
    return new URL(key).hostname.replace(/^www\./, '')
  } catch {
    return key
  }
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