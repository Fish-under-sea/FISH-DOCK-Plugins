// OpenCode & Magpie provider plugin for Meoo 秒悟 (meoo.com).
//
// 由 dsh-meoo-connect（dsh/DeepSeek Harness 插件）迁移而来，同一套 Meoo
// 官方「AI 服务」链路，换到 Magpie 的 provider 插件平面上：
//
//   登录      OAuth Authorization Code + PKCE（public client，本机 loopback 回调）
//   项目 AK   控制面 /open/v1/cli-compat/...（身份 → 项目 → 云服务 environment）
//   模型目录  网关 {gateway}/models（OpenAI 兼容，Bearer 项目服务 AK）
//   转发      不自己做适配器——声明 @ai-sdk/openai-compatible，由宿主 SDK 走网关
//
// 三种登录方式：
//   1. 浏览器授权：点一次「授权」，之后身份/项目/云服务 AK 全自动解析。
//   2. 复用本机登录态：只读 dsh-meoo-connect（$DSH_HOME/meoo/state.json）或
//      meoo-proxy（~/.meoo-proxy/config.json）已保存的登录态，连授权点击都省了。
//   3. 手填项目服务 AK：meoo_project_service_v1.* 开头，适合不想走 OAuth 的人。
//
// 凭证只存放在宿主的账号记录里（client.auth.set），本插件不落地任何文件。
// 调用消耗 Meoo 账号自身额度，不绕过任何计费；与 Meoo 官方无关联。

import { createHash, randomBytes } from "node:crypto"
import { createServer } from "node:http"
import { readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

const PROVIDER_ID = "meoo"
const PROVIDER_NAME = "Meoo 秒悟"
const NPM = "@ai-sdk/openai-compatible"

const DEFAULT_API_BASE = "https://meoo.com"
const DEFAULT_GATEWAY = "https://api.meoo.host/meoo-ai/compatible-mode/v1"
const PROD_CLIENT_ID = "meoo_app_tdWlRbpvAxN1EjmZ8XICxdTh"
const TEST_CLIENT_ID = "meoo_app_SFNvmHUFNePxyyfGjCd9hyaE"
const OAUTH_SCOPE = "cli.compat"
const CALLBACK_PATH = "/oauth/callback"
// 控制面要求 CLI 客户端标记（与 dsh-meoo-connect 同一套公开契约）。
const CLI_HEADERS = { "x-meoo-client": "cli", "x-meoo-cli-version": "0.5.6" }

const EARLY_MS = 60 * 1000
const LEAD_MS = 5 * 60 * 1000
const KEEP_RENEWED_MS = 60 * 1000
const CATALOG_TTL_MS = 10 * 60 * 1000
const CONTEXT_WINDOW = 200_000
const DEFAULT_MAX_TOKENS = 64_000

/** 网关目录拿不到时的兜底清单（id → 展示名，取自 meoo 文档与控制台）。 */
const FALLBACK_MODELS = [
  { id: "qwen3.8-flash", name: "Qwen3.8-Flash" },
  { id: "qwen3.8-max", name: "Qwen3.8-Max" },
  { id: "qwen3.7-max", name: "Qwen3.7-Max" },
  { id: "qwen3.7-plus", name: "Qwen3.7-Plus" },
  { id: "deepseek-v4.1-flash-1017", name: "DeepSeek V4.1 Flash" },
  { id: "deepseek-v4-pro-0813", name: "DeepSeek V4 Pro" },
  { id: "deepseek-v4-flash-0731", name: "DeepSeek V4 Flash" },
  { id: "glm-5.2-fast-preview", name: "GLM-5.2-Fast" },
  { id: "glm-5.2", name: "GLM-5.2" },
]

const mainOrigin = () => String(process.env.MEOO_MAIN_SITE_URL || DEFAULT_API_BASE).replace(/\/+$/, "")
const gatewayBase = () => String(process.env.MEOO_GATEWAY_BASE_URL || DEFAULT_GATEWAY).replace(/\/+$/, "")
// apiBase 跟着账号记录走（登录用的哪个站点，续期/控制面就打哪个），环境变量只是兜底。
const apiBaseOf = (a) => String(a?.apiBase || mainOrigin()).replace(/\/+$/, "")

function clientIdFor(apiBaseUrl) {
  try {
    return new URL(apiBaseUrl).hostname.toLowerCase() === "meoo.com" ? PROD_CLIENT_ID : TEST_CLIENT_ID
  } catch {
    return TEST_CLIENT_ID
  }
}

const labelOf = (id) => FALLBACK_MODELS.find((m) => m.id === id)?.name || id
const int = (n, fallback = 0) => {
  const v = Math.trunc(Number(n))
  return Number.isFinite(v) && v >= 0 ? v : fallback
}
const vendorError = (json, text) => json?.detail || json?.message || String(text ?? "").slice(0, 160)

// ---- OAuth（Authorization Code + PKCE，public client）----------------------

async function tokenRequest(apiBaseUrl, params) {
  const res = await fetch(`${apiBaseUrl}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams(params).toString(),
    signal: AbortSignal.timeout(20_000),
  })
  const text = await res.text()
  let json = {}
  try {
    json = JSON.parse(text)
  } catch {}
  if (!res.ok) throw new Error(`OAuth 换票失败 HTTP ${res.status}: ${json.error || text.slice(0, 160)}`)
  return json
}

// 单飞续期：同一 refresh token 的并发续期共享一次请求，60 秒内的结果直接复用。
const renewed = new Map()
const renewing = new Map()

async function callRefreshApi(a) {
  const base = apiBaseOf(a)
  const token = await tokenRequest(base, {
    grant_type: "refresh_token",
    client_id: clientIdFor(base),
    refresh_token: a.refresh,
  })
  return {
    access: token.access_token,
    ...(token.refresh_token ? { refresh: token.refresh_token } : {}),
    expires: Date.now() + int(token.expires_in || 3600, 3600) * 1000,
    ...(token.scope ? { scope: token.scope } : {}),
    ...(token.openid ? { openid: token.openid } : {}),
  }
}

async function renewToken(a, save) {
  const key = a.refresh
  const done = renewed.get(key)
  if (done && Date.now() - done.at < KEEP_RENEWED_MS) {
    const merged = { ...a, ...done.next }
    await save?.(merged)
    return merged
  }
  let r = renewing.get(key)
  if (!r) {
    r = (async () => {
      const next = await callRefreshApi(a)
      renewed.set(key, { next, at: Date.now() })
      return next
    })().finally(() => renewing.delete(key))
    renewing.set(key, r)
  }
  const next = await r
  const merged = { ...a, ...next }
  await save?.(merged)
  return merged
}

// Meoo 的 access token 过期时间是登录/续期时给的 expires_in，不是 JWT 声明；
// 没有 expires 就当过期（与 dsh 的 ensureAccessToken 语义一致）。
function isStale(a, marginMs = EARLY_MS) {
  const exp = Number(a?.expires) || 0
  return !(exp > Date.now() + marginMs)
}

async function currentAuth(ctx, auth, force = false) {
  let a = { ...auth }
  for (let i = 0; i < 8 && a.refresh; i++) {
    const d = renewed.get(a.refresh)
    if (!d || Date.now() - d.at >= KEEP_RENEWED_MS) break
    a = { ...a, ...d.next }
  }
  const alreadyRenewed = a.access !== auth.access || a.refresh !== auth.refresh
  if ((alreadyRenewed || !force) && !isStale(a, EARLY_MS)) {
    if (alreadyRenewed) await persistOf(ctx)(a)
    return { a, didRenew: alreadyRenewed }
  }
  if (!a.refresh) {
    if (!force && a.access && !isStale(a, 0)) return { a, didRenew: alreadyRenewed }
    const err = new Error("Meoo 登录态已过期且没有 refresh token，请重新登录")
    err.signIn = "expired"
    throw err
  }
  const next = await renewToken(a, persistOf(ctx))
  return { a: next, didRenew: true }
}

// ---- 控制面：账号 / 项目 / 项目服务 AK --------------------------------------

async function controlCall(apiBase, access, method, apiPath, body) {
  const res = await fetch(`${apiBase}${apiPath}`, {
    method,
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      ...CLI_HEADERS,
      authorization: `Bearer ${access}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(45_000),
  })
  const text = await res.text()
  let json = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = null
  }
  // Meoo 的业务错误也走 HTTP 200（{"success":false,"errCode":...}），要在这里拦下来
  if (json && typeof json === "object" && json.success === false) {
    const err = new Error(`${apiPath} 失败: ${json.message || json.errCode || "unknown error"}`)
    err.status = res.status
    err.errCode = json.errCode
    throw err
  }
  if (!res.ok) {
    const err = new Error(
      res.status === 401
        ? `${apiPath} 失败 HTTP 401（登录态已失效，请重新登录）: ${vendorError(json, text)}`
        : `${apiPath} 失败 HTTP ${res.status}: ${vendorError(json, text)}`,
    )
    err.status = res.status
    throw err
  }
  return json?.data !== undefined ? json.data : json
}

/** 运行期控制面调用：先确保 access 新鲜，401 时强制续期重试一次。 */
async function controlRequest(ctx, a, method, apiPath, body) {
  const { a: fresh } = await currentAuth(ctx, a)
  try {
    return await controlCall(apiBaseOf(fresh), fresh.access, method, apiPath, body)
  } catch (e) {
    if (e?.status === 401 && fresh.refresh) {
      const next = await renewToken(fresh, persistOf(ctx))
      return controlCall(apiBaseOf(fresh), next.access, method, apiPath, body)
    }
    throw e
  }
}

async function fetchIdentity(ctx, a) {
  return await controlRequest(ctx, a, "GET", "/open/v1/cli-compat/account/identity")
}

async function listProjects(ctx, a, limit = 50) {
  const data = await controlRequest(ctx, a, "GET", `/open/v1/cli-compat/projects?page_size=${limit}`)
  return data?.list || data?.items || data?.projects || (Array.isArray(data) ? data : [])
}

/**
 * 新账号常常一个项目都没有（项目服务 AK 挂在项目下，没有项目就没有 AK）。
 * 控制面的项目创建接口已验证可用：先试带名字，失败退回空请求体（Meoo 会建
 * 一个 "untitled" 项目）。创建失败返回 null，由调用方决定怎么报错。
 */
async function createProject(ctx, a) {
  try {
    return await controlRequest(ctx, a, "POST", "/open/v1/cli-compat/projects", { name: "AI 服务" })
  } catch {
    try {
      return await controlRequest(ctx, a, "POST", "/open/v1/cli-compat/projects", {})
    } catch {
      return null
    }
  }
}

/**
 * 选中一个项目：显式指定 > 记录里的 projectUrlId > 身份默认项目 > 唯一项目。
 * 多个项目时不替用户做主（计费归属不同），报错并列出可选项。
 */
async function pickProject(ctx, a, explicitUrlId) {
  if (explicitUrlId) return explicitUrlId
  let preferred = a?.projectUrlId || ""
  if (!preferred) {
    try {
      const me = await fetchIdentity(ctx, a)
      preferred = me?.project_url_id || me?.projectUrlId || ""
    } catch {}
  }
  if (preferred) return preferred
  const projects = await listProjects(ctx, a)
  if (!projects.length) {
    const created = await createProject(ctx, a)
    const urlId = created?.url_id || created?.urlId
    if (!urlId) throw new Error("账号下还没有项目，自动创建也失败了：请在 meoo.com 手动建一个项目后重试")
    return urlId
  }
  if (projects.length === 1) {
    const only = projects[0]?.url_id || projects[0]?.urlId
    if (!only) throw new Error("项目列表里没有 url_id，无法定位项目")
    return only
  }
  const options = projects.map((p) => `${p.url_id || p.urlId}（${p.name || "未命名"}）`).join("、")
  const err = new Error(`账号下有多个项目，请改用「项目服务 AK」登录方式并指定项目，或先在 meoo.com 设为默认项目。可选：${options}`)
  err.projects = projects
  throw err
}

/** 取项目服务 AK；项目没开云服务时自动开通一次再取。 */
async function resolveServiceAk(ctx, a, { projectUrlId } = {}) {
  const urlId = await pickProject(ctx, a, projectUrlId)
  if (a?.serviceAk && a.serviceAkProjectId === urlId) return { urlId, ak: a.serviceAk }

  const envPath = `/open/v1/cli-compat/projects/${encodeURIComponent(urlId)}/cloud/environment`
  let ak = null
  try {
    const env = await controlRequest(ctx, a, "GET", envPath)
    ak = env?.meooProjectApiKey || env?.instance?.meooProjectApiKey || null
  } catch {
    ak = null
  }
  let cloudErrMessage = null
  if (!ak) {
    try {
      await controlRequest(ctx, a, "POST", `/open/v1/cli-compat/projects/${encodeURIComponent(urlId)}/cloud`, {
        description: "opencode-meoo-auth: AI 服务",
      })
      const env = await controlRequest(ctx, a, "GET", envPath)
      ak = env?.meooProjectApiKey || env?.instance?.meooProjectApiKey || null
    } catch (e) {
      cloudErrMessage = e?.message ?? String(e)
      ak = null
    }
  }
  if (!ak) {
    throw new Error(
      `项目 ${urlId} 还没开通 Meoo AI 服务：在 meoo.com 打开该项目，在对话框里发一句「帮我开启云服务」（或让 AI 加一个需要后端/AI 的功能，平台会自动开通并签发 AK），开通后重试` +
        (cloudErrMessage ? `（自动开通失败：${cloudErrMessage}）` : ""),
    )
  }
  return { urlId, ak }
}

/** 运行期取 AK：有缓存就用缓存，否则解析并持久化进账号记录。 */
async function serviceAkOf(ctx, a) {
  const urlId = await pickProject(ctx, a)
  if (a?.serviceAk && a.serviceAkProjectId === urlId) return a.serviceAk
  const { urlId: resolved, ak } = await resolveServiceAk(ctx, a, { projectUrlId: urlId })
  await persistOf(ctx)({ ...a, projectUrlId: resolved, serviceAk: ak, serviceAkProjectId: resolved })
  return ak
}

// ---- 模型目录 ---------------------------------------------------------------

let catalogCache = { origin: "", models: null, at: 0 }

const resetCatalogCache = () => {
  catalogCache = { origin: "", models: null, at: 0 }
}

function parseGatewayModels(payload) {
  const list = payload?.models || payload?.data || (Array.isArray(payload) ? payload : [])
  const seen = new Set()
  const out = []
  for (const entry of Array.isArray(list) ? list : []) {
    const id = typeof entry === "string" ? entry.trim() : String(entry?.id ?? "").trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    const name = typeof entry === "string" ? labelOf(id) : String(entry?.name || labelOf(id))
    out.push({ id, name, context: int(entry?.context) || CONTEXT_WINDOW, output: int(entry?.max_output || entry?.max_output_tokens || entry?.max_tokens) || DEFAULT_MAX_TOKENS })
  }
  return out
}

async function fetchGatewayModels(ak) {
  const base = gatewayBase()
  if (catalogCache.models && catalogCache.origin === base && Date.now() - catalogCache.at < CATALOG_TTL_MS) {
    return catalogCache.models
  }
  const res = await fetch(`${base}/models`, {
    headers: { authorization: `Bearer ${ak}`, accept: "application/json" },
    signal: AbortSignal.timeout(25_000),
  })
  if (!res.ok) throw new Error(`模型目录 HTTP ${res.status}`)
  const models = parseGatewayModels(await res.json())
  if (!models.length) throw new Error("empty catalog")
  catalogCache = { origin: base, models, at: Date.now() }
  return models
}

// 思考档位：AI SDK 的 openai-compatible 线把 reasoningEffort 映射成请求体的
// reasoning_effort。网关实测（qwen3.8-flash，2026-11）：low/medium/high 都被
// 接受且真的影响思考长度（reasoning tokens：low≈13、medium/high≈30），不带
// 该参数时走上游默认思考。对应 UI 的 快速/适中/极致 三档。
const REASONING_VARIANTS = {
  low: { reasoningEffort: "low" },
  medium: { reasoningEffort: "medium" },
  high: { reasoningEffort: "high" },
}

function configModels() {
  return Object.fromEntries(
    FALLBACK_MODELS.map((m) => [
      m.id,
      {
        name: m.name,
        limit: { context: CONTEXT_WINDOW, output: DEFAULT_MAX_TOKENS },
        tool_call: true,
        reasoning: true,
        attachment: false,
        modalities: { input: ["text"], output: ["text"] },
        variants: REASONING_VARIANTS,
      },
    ]),
  )
}

function runtimeModel(provider, m) {
  return {
    id: m.id,
    providerID: provider.id,
    name: m.name,
    api: { id: m.id, url: gatewayBase(), npm: NPM },
    status: "active",
    headers: {},
    options: {},
    cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
    limit: { context: m.context ?? CONTEXT_WINDOW, output: m.output ?? DEFAULT_MAX_TOKENS },
    capabilities: {
      temperature: true,
      reasoning: true,
      attachment: false,
      toolcall: true,
      input: { text: true, image: false, audio: false, video: false, pdf: false },
      output: { text: true, image: false, audio: false, video: false, pdf: false },
      interleaved: false,
    },
    release_date: "",
    variants: REASONING_VARIANTS,
  }
}

// ---- 登录 -------------------------------------------------------------------

/**
 * 登录成功后的账号记录：token + 控制面解析出的身份/项目/AK，一起交给宿主保存。
 */
async function buildSignedInAuth(tokens, apiBase) {
  const access = tokens.access_token
  if (!access) throw new Error("OAuth 响应里没有 access_token")
  const a = {
    apiBase: apiBase.replace(/\/+$/, ""),
    access,
    refresh: tokens.refresh_token || "",
    expires: Date.now() + int(tokens.expires_in || 3600, 3600) * 1000,
    ...(tokens.scope ? { scope: tokens.scope } : {}),
    ...(tokens.openid ? { openid: tokens.openid } : {}),
  }
  const me = await controlCall(apiBase, access, "GET", "/open/v1/cli-compat/account/identity")
  if (me?.name) a.username = me.name
  if (me?.user_id) a.userId = me.user_id
  if (me?.project_url_id || me?.projectUrlId) a.projectUrlId = me.project_url_id || me.projectUrlId
  const { urlId, ak } = await resolveServiceAk({ client: null }, a)
  a.projectUrlId = urlId
  a.serviceAk = ak
  a.serviceAkProjectId = urlId
  return {
    type: "success",
    access: a.access,
    refresh: a.refresh,
    expires: a.expires,
    accountId: a.username || a.openid || PROVIDER_NAME,
    ...(a.username ? { username: a.username } : {}),
    ...(a.userId ? { userId: a.userId } : {}),
    ...(a.openid ? { openid: a.openid } : {}),
    ...(a.scope ? { scope: a.scope } : {}),
    apiBase: a.apiBase,
    projectUrlId: a.projectUrlId,
    serviceAk: a.serviceAk,
    serviceAkProjectId: a.serviceAkProjectId,
  }
}

/** 方式一：浏览器 PKCE 授权，本机 loopback 自动收回调，AK 全自动解析。 */
async function browserSignIn(timeoutMs = 10 * 60 * 1000) {
  const apiBase = mainOrigin()
  const clientId = clientIdFor(apiBase)
  const verifier = randomBytes(32).toString("base64url")
  const challenge = createHash("sha256").update(verifier).digest("base64url")
  const state = randomBytes(32).toString("base64url")

  let complete, timer, origin, received = false, settled = false
  const done = new Promise((resolve) => {
    complete = resolve
  })
  const finish = (result) => {
    if (settled) return
    settled = true
    clearTimeout(timer)
    complete(result)
    server.close()
    server.closeIdleConnections?.()
  }
  const server = createServer(async (req, res) => {
    const reply = (status, text) => {
      res.writeHead(status, {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
        "Content-Security-Policy": "default-src 'none'",
      })
      res.end(text)
    }
    const url = new URL(req.url || "/", "http://127.0.0.1")
    if (req.headers.host !== origin || url.pathname !== CALLBACK_PATH) return reply(404, "Not found")
    if (req.method !== "GET") return reply(405, "Method not allowed")
    const q = url.searchParams
    if (q.getAll("state").length !== 1 || q.get("state") !== state) return reply(400, "回调不属于本次登录，请回到原授权页重试。")
    if (settled || received) return reply(409, "本次回调已经处理，请回到 Magpie 查看结果。")
    if (q.get("error")) {
      reply(400, "登录未获授权，请回到 Magpie 重新登录。")
      finish({ type: "failed", error: `授权被取消：${q.get("error")}${q.get("error_description") ? " " + q.get("error_description") : ""}` })
      return
    }
    const code = q.get("code") || ""
    if (q.getAll("code").length !== 1 || !code || code.length > 4096) return reply(400, "回调缺少有效授权码，请回到原授权页重试。")
    received = true
    try {
      const tokens = await tokenRequest(apiBase, {
        grant_type: "authorization_code",
        client_id: clientId,
        code,
        redirect_uri: `http://${origin}${CALLBACK_PATH}`,
        code_verifier: verifier,
      })
      const success = await buildSignedInAuth(tokens, apiBase)
      if (settled) return reply(408, "登录已超时，请回到 Magpie 重新登录。")
      reply(200, "Meoo 登录成功，可以关闭这个页面回到 Magpie。")
      finish(success)
    } catch (e) {
      // 错误详情直接写进回调页：Magpie 卡片上的报错不一定被看到，浏览器这页一定看得到
      reply(502, `登录未完成：${e?.message ?? String(e)}\n\n请返回 Magpie 处理后重新登录。`)
      finish({ type: "failed", error: e?.message ?? String(e) })
    }
  })
  await new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })
  origin = `127.0.0.1:${server.address().port}`
  const authorize = new URL("/oauth/authorize", apiBase)
  authorize.searchParams.set("client_id", clientId)
  authorize.searchParams.set("redirect_uri", `http://${origin}${CALLBACK_PATH}`)
  authorize.searchParams.set("response_type", "code")
  authorize.searchParams.set("scope", OAUTH_SCOPE)
  authorize.searchParams.set("state", state)
  authorize.searchParams.set("code_challenge", challenge)
  authorize.searchParams.set("code_challenge_method", "S256")
  timer = setTimeout(() => finish({ type: "failed", error: "Meoo 登录超时，请重新登录" }), timeoutMs)
  timer.unref?.()
  return {
    url: authorize.toString(),
    instructions: "在浏览器登录 Meoo 并点一次「授权」后，会自动返回此处；项目和 AI 服务 AK 都会自动解析。",
    method: "auto",
    async callback() {
      return await done
    },
  }
}

// ---- 本机已有登录态（只读复用，不写入任何文件）------------------------------

function dshHome() {
  return process.env.DSH_HOME || join(homedir(), ".dsh")
}

/**
 * dsh-meoo-connect（$DSH_HOME/meoo/state.json）与 meoo-proxy
 * （~/.meoo-proxy/config.json）保存的登录态，两处都读、dsh 优先、缺的互填。
 */
function readLegacyState(overrides = {}) {
  const dshFile = overrides.dshState || join(dshHome(), "meoo", "state.json")
  const proxyFile = overrides.proxyConfig || join(overrides.proxyHome || process.env.MEOO_PROXY_HOME || join(homedir(), ".meoo-proxy"), "config.json")
  const readJson = (file) => {
    try {
      return JSON.parse(readFileSync(file, "utf8"))
    } catch {
      return null
    }
  }
  const dsh = readJson(dshFile) || {}
  const proxy = readJson(proxyFile) || {}
  const merged = { ...proxy, ...Object.fromEntries(Object.entries(dsh).filter(([, v]) => v !== null && v !== undefined && v !== 0)) }
  if (!merged.refreshToken && !proxy.refreshToken && !merged.serviceAk && !proxy.serviceAk) return null
  return {
    apiBase: merged.apiBaseUrl || DEFAULT_API_BASE,
    accessToken: merged.accessToken || null,
    refreshToken: merged.refreshToken || proxy.refreshToken || null,
    expires: Number(merged.accessExpiresAt) || 0,
    scope: merged.scope || null,
    openid: merged.openid || null,
    username: merged.username || proxy.username || null,
    userId: merged.userId || proxy.userId || null,
    projectUrlId: merged.projectUrlId || proxy.projectUrlId || null,
    serviceAk: merged.serviceAk || proxy.serviceAk || null,
    serviceAkProjectId: merged.serviceAkProjectId || proxy.serviceAkProjectId || null,
  }
}

/** 方式三：复用本机 dsh-meoo-connect / meoo-proxy 的登录态（严格只读）。 */
function reuseSignIn() {
  return {
    url: "",
    instructions: "只读复用本机已有的 Meoo 登录态（dsh-meoo-connect 的 $DSH_HOME/meoo/state.json 或 meoo-proxy 的 ~/.meoo-proxy/config.json），不会写入这两个文件。",
    method: "auto",
    async callback() {
      const legacy = readLegacyState()
      if (!legacy || (!legacy.refreshToken && !legacy.serviceAk)) {
        return {
          type: "failed",
          error: "未找到本机 Meoo 登录态（已查找 $DSH_HOME/meoo/state.json 与 ~/.meoo-proxy/config.json）；请先用浏览器授权登录一次",
        }
      }
      try {
        const a = {
          apiBase: apiBaseOf(legacy),
          access: legacy.accessToken || "",
          refresh: legacy.refreshToken || "",
          expires: legacy.expires || 0,
          ...(legacy.scope ? { scope: legacy.scope } : {}),
          ...(legacy.openid ? { openid: legacy.openid } : {}),
          ...(legacy.username ? { username: legacy.username } : {}),
          ...(legacy.userId ? { userId: legacy.userId } : {}),
          projectUrlId: legacy.projectUrlId || "",
          serviceAk: legacy.serviceAk || "",
          serviceAkProjectId: legacy.serviceAkProjectId || "",
        }
        if (!a.serviceAk && !a.refresh) {
          return { type: "failed", error: "本机登录态既没有项目服务 AK 也没有 refresh token，无法复用；请用浏览器授权重新登录" }
        }
        if (a.refresh) {
          // 过期就续期（只动宿主自己的账号记录，不碰 dsh/meoo-proxy 的文件）
          const { a: fresh } = await currentAuth({ client: null }, a, isStale(a, 0))
          a.access = fresh.access || a.access
          a.expires = fresh.expires || a.expires
          a.refresh = fresh.refresh || a.refresh
        }
        if (!a.serviceAk) {
          const { urlId, ak } = await resolveServiceAk({ client: null }, a)
          a.projectUrlId = urlId
          a.serviceAk = ak
          a.serviceAkProjectId = urlId
        } else if (!a.projectUrlId) {
          a.projectUrlId = a.serviceAkProjectId
        }
        return {
          type: "success",
          access: a.access,
          refresh: a.refresh,
          expires: a.expires,
          accountId: a.username || a.openid || PROVIDER_NAME,
          ...(a.username ? { username: a.username } : {}),
          ...(a.openid ? { openid: a.openid } : {}),
          ...(a.scope ? { scope: a.scope } : {}),
          apiBase: a.apiBase,
          projectUrlId: a.projectUrlId,
          serviceAk: a.serviceAk,
          serviceAkProjectId: a.serviceAkProjectId,
        }
      } catch (e) {
        return { type: "failed", error: `复用本机登录态失败：${e?.message ?? String(e)}` }
      }
    },
  }
}

/** 方式四：手填项目服务 AK（meoo_project_service_v1.*，meoo.com 项目 → 云服务里复制）。 */
function manualKeySignIn() {
  return {
    url: "",
    instructions: "在 meoo.com 打开项目 → 云服务，复制项目服务 AK（meoo_project_service_v1. 开头）粘贴到下方；确认前会用网关 /models 校验一次。",
    method: "code",
    async callback(input) {
      try {
        const key = String(input ?? "").trim().replace(/^Bearer\s+/i, "").replace(/^["']|["']$/g, "")
        if (!key) throw new Error("请输入项目服务 AK")
        if (key.startsWith("meoo_ak_")) {
          throw new Error("这是用户 Key（meoo_ak_…），不是项目服务 AK；请填 meoo_project_service_v1. 开头的项目服务 AK")
        }
        const res = await fetch(`${gatewayBase()}/models`, {
          headers: { authorization: `Bearer ${key}`, accept: "application/json" },
          signal: AbortSignal.timeout(15_000),
        })
        if (res.status === 401 || res.status === 403) {
          throw new Error(`AK 被网关拒绝（HTTP ${res.status}）：确认是项目服务 AK，且该项目已开通云服务`)
        }
        if (!res.ok) throw new Error(`网关校验失败 HTTP ${res.status}`)
        return { type: "success", key, accountId: "Meoo 项目服务 AK" }
      } catch (e) {
        return { type: "failed", error: e?.message ?? String(e) }
      }
    },
  }
}

// ---- 插件出口 ---------------------------------------------------------------

function persistOf(ctx) {
  return async (updated) => {
    try {
      await ctx?.client?.auth?.set?.({ path: { id: PROVIDER_ID }, body: updated })
    } catch {}
  }
}

export const MeooAuthPlugin = async ({ client }) => {
  const ctx = { client }

  return {
    config: async (config) => {
      config.provider ??= {}
      const was = config.provider[PROVIDER_ID] ?? {}
      config.provider[PROVIDER_ID] = {
        name: PROVIDER_NAME,
        npm: NPM,
        api: gatewayBase(),
        ...was,
        models: { ...configModels(), ...(was.models ?? {}) },
      }
    },
    provider: {
      id: PROVIDER_ID,
      async models(provider, { auth } = {}) {
        try {
          let ak = ""
          if (auth?.type === "api") ak = auth.key || ""
          else if (auth?.type === "oauth" && (auth.access || auth.refresh || auth.serviceAk)) {
            const { a } = await currentAuth(ctx, auth)
            ak = a.serviceAk || (await serviceAkOf(ctx, a))
          }
          if (!ak) return provider.models
          const ms = await fetchGatewayModels(ak)
          if (!ms.length) return provider.models
          return Object.fromEntries(ms.map((m) => [m.id, runtimeModel(provider, m)]))
        } catch {
          return provider.models
        }
      },
    },
    auth: {
      provider: PROVIDER_ID,
      refreshLead: LEAD_MS,
      async refresh(auth) {
        if (auth?.type !== "oauth" || !auth.refresh) return undefined
        const { a, didRenew } = await currentAuth(ctx, auth, true)
        if (!didRenew) return undefined
        return {
          access: a.access,
          refresh: a.refresh,
          expires: a.expires,
          ...(a.scope ? { scope: a.scope } : {}),
          ...(a.openid ? { openid: a.openid } : {}),
          ...(a.username ? { username: a.username } : {}),
          ...(a.serviceAk ? { serviceAk: a.serviceAk, serviceAkProjectId: a.serviceAkProjectId, projectUrlId: a.projectUrlId, apiBase: a.apiBase } : {}),
        }
      },
      async loader(getAuth) {
        const auth = await getAuth()
        if (auth?.type === "api") return auth.key ? { baseURL: gatewayBase(), apiKey: auth.key } : {}
        if (auth?.type !== "oauth") return {}
        try {
          const { a } = await currentAuth(ctx, auth)
          const ak = a.serviceAk || (await serviceAkOf(ctx, a))
          if (!ak) return {}
          return { baseURL: gatewayBase(), apiKey: ak }
        } catch (e) {
          const expired = e?.signIn === "expired"
          return {
            baseURL: gatewayBase(),
            apiKey: "meoo",
            async fetch() {
              return new Response(
                JSON.stringify({ error: { message: e?.message ?? String(e), type: expired ? "authentication_error" : "api_error" } }),
                {
                  status: expired ? 401 : 502,
                  headers: { "Content-Type": "application/json", "X-Magpie-Sign-In": expired ? "expired" : "kept" },
                },
              )
            },
          }
        }
      },
      methods: [
        {
          type: "oauth",
          label: "Meoo 账号（浏览器授权，自动取项目 AK）",
          authorize: async () => browserSignIn(),
        },
        {
          type: "oauth",
          label: "复用本机登录态（dsh-meoo-connect / meoo-proxy）",
          authorize: async () => reuseSignIn(),
        },
        {
          type: "api",
          label: "项目服务 AK（meoo_project_service_v1.…）",
          placeholder: "meoo_project_service_v1.…",
          authorize: async () => manualKeySignIn(),
        },
      ],
    },
  }
}

export const _internal = {
  tokenRequest,
  renewToken,
  currentAuth,
  isStale,
  controlCall,
  controlRequest,
  fetchIdentity,
  listProjects,
  createProject,
  pickProject,
  resolveServiceAk,
  serviceAkOf,
  parseGatewayModels,
  fetchGatewayModels,
  resetCatalogCache,
  configModels,
  runtimeModel,
  buildSignedInAuth,
  browserSignIn,
  reuseSignIn,
  manualKeySignIn,
  readLegacyState,
  clientIdFor,
  apiBaseOf,
  gatewayBase,
}
