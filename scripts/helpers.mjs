/**
 * verify 脚本共享的 HTTP fake 夹具（单一真源）。
 *
 * 以 verify-session.mjs 原版语义为基准，统一带 `socket: { localAddress: '127.0.0.1' }`：
 * 来源栅栏（src/web.ts）目前只读 Host / Origin / Sec-Fetch-Site，但「本机请求」的
 * 判定依据本来就有 socket 一说——栅栏将来开始读 socket 时，其余夹具不会静默假绿
 * （曾有一段时期 tavern/host/distill 三套不带 socket，正落在栅栏接触面上）。
 *
 * 行为要点（与 src/web.ts readBody 对齐，改这里前先读那个函数）：
 *   · body 是对象  → JSON.stringify 发送，自动带 application/json;
 *   · body 是字符串 → 原样发送，不带 content-type（测试 text/plain 拒绝时用
 *     headers 显式传 content-type，见 verify-session §11）;
 *   · body 缺省    → 不发任何字节（readBody 对空体直接返回 {}，不查 content-type）。
 *
 * 用法（各 verify 脚本相对自身引用）：
 *   import { makeReq, makeRes, restCall } from './helpers.mjs'
 *   const { out, res } = makeRes()
 *   await route.handler(makeReq({ method: 'POST', body: { name: 'x' } }), res)
 */

/** 假 ServerResponse：把状态码与 JSON 体收进普通对象。 */
export const makeRes = () => {
  const out = { status: 0, body: undefined }
  return {
    out,
    res: {
      setHeader: () => {},
      writeHead: (status) => { out.status = status },
      end: (bytes) => {
        try { out.body = JSON.parse(String(bytes)) } catch { out.body = String(bytes ?? '') }
      },
    },
  }
}

/** 假 IncomingMessage：带本机 Host（来源栅栏放行）与本机 socket 折映。 */
export const makeReq = (opts = {}) => {
  const raw = opts.body
  const isObject = raw !== undefined && typeof raw !== 'string'
  const body = raw === undefined ? '' : (isObject ? JSON.stringify(raw) : raw)
  return {
    method: opts.method ?? 'POST',
    url: opts.url ?? '/',
    headers: {
      host: '127.0.0.1:50143',
      ...(isObject ? { 'content-type': 'application/json' } : {}),
      ...(opts.headers ?? {}),
    },
    socket: { localAddress: '127.0.0.1' },
    async *[Symbol.asyncIterator]() { if (body !== '') yield Buffer.from(body) },
  }
}

/** 调一条已注册的 REST 路由（路径只写 / 之后的部分），返回 { status, body }。 */
export const restCall = async (routes, method, suffix, opts = {}) => {
  const route = routes.find(r => r.path === `/_dsh/ai-with-u${suffix}`)
  if (route === undefined) return { status: -1, body: undefined }
  const { out, res } = makeRes()
  await route.handler(makeReq({ method, ...opts }), res)
  return out
}
