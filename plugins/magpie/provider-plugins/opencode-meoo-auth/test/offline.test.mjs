// 离线测试：假 fetch + 假 client，不碰真实网络（浏览器登录的 loopback 回调用真实 fetch 打本机端口）。
// 覆盖：模型目录解析、AK 三种登录路径、项目选择、续期、loader/config 契约。
import test from "node:test"
import assert from "node:assert/strict"
import { MeooAuthPlugin, _internal } from "../index.mjs"

const {
  parseGatewayModels,
  manualKeySignIn,
  reuseSignIn,
  readLegacyState,
  pickProject,
  resolveServiceAk,
  currentAuth,
  fetchGatewayModels,
  resetCatalogCache,
  configModels,
  runtimeModel,
  browserSignIn,
  clientIdFor,
  isStale,
} = _internal

const GATEWAY = "https://gw.test/meoo/v1"

// ---- 工具 -------------------------------------------------------------------

function fakeFetch(routes) {
  const calls = []
  const fn = async (input, init = {}) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
    calls.push({ url, init })
    for (const [match, reply] of routes) {
      if (typeof match === "string" ? url.includes(match) : match.test(url)) {
        const r = typeof reply === "function" ? await reply(url, init) : reply
        return r
      }
    }
    return new Response("no route: " + url, { status: 599 })
  }
  fn.calls = calls
  return fn
}

const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } })

function fakeClient() {
  const saved = []
  return {
    saved,
    auth: {
      async set(arg) {
        saved.push({ id: arg?.path?.id, body: arg?.body })
        return { data: true }
      },
      async get() {
        return { data: undefined }
      },
    },
  }
}

const OK_TOKEN = { access_token: "acc-1", refresh_token: "ref-1", expires_in: 3600 }

// 控制面全链路的假后端：换票 → 身份 → 项目列表 → 云服务 environment → 网关 /models
function meooBackend({ identity, projects, env, cloudPosted, gatewayModels, gatewayStatus = 200 }) {
  let cloudCalls = 0
  return fakeFetch([
    [/\/oauth\/token/, () => json(OK_TOKEN)],
    [/\/account\/identity/, () => json({ data: identity })],
    [/\/projects\?/, () => json({ data: { list: projects } })],
    [/\/cloud\/environment/, () => json({ data: env ?? {} })],
    [/\/cloud$/, () => {
      cloudCalls++
      return cloudPosted ? json({ data: {} }) : new Response("no cloud", { status: 400 })
    }],
    [/\/models/, () => (gatewayStatus === 200 ? json({ models: gatewayModels }) : new Response("denied", { status: gatewayStatus }))],
  ])
}

/** 换上假 fetch 跑 fn(mock)；fn 拿到的第二个参数是真实 fetch（loopback 回调要用它）。 */
async function withFetch(fn, routes) {
  const real = globalThis.fetch
  const mock = fakeFetch(routes)
  globalThis.fetch = mock
  try {
    return await fn(mock, real)
  } finally {
    globalThis.fetch = real
  }
}

// ---- 模型目录 ---------------------------------------------------------------

test("parseGatewayModels：字符串条目、对象条目、models/data 两种包法、去重", () => {
  assert.deepEqual(parseGatewayModels({ models: ["glm-5.2", { id: "qwen3.8-max", name: "Qwen3.8-Max" }, "glm-5.2"] }).map((m) => [m.id, m.name]), [
    ["glm-5.2", "GLM-5.2"],
    ["qwen3.8-max", "Qwen3.8-Max"],
  ])
  assert.deepEqual(parseGatewayModels({ data: [{ id: "glm-5.2" }] })[0].name, "GLM-5.2")
  assert.deepEqual(parseGatewayModels({ data: [{ id: "whatever-x" }] })[0].name, "whatever-x")
  assert.deepEqual(parseGatewayModels({ data: [{ id: "m1", name: "M1", max_tokens: 8000 }] })[0].output, 8000)
  assert.deepEqual(parseGatewayModels({}), [])
})

test("fetchGatewayModels：带 AK 请求网关并缓存", async () => {
  process.env.MEOO_GATEWAY_BASE_URL = GATEWAY
  resetCatalogCache()
  await withFetch(async (fetchMock) => {
    const ms = await fetchGatewayModels("ak-1")
    assert.equal(ms.length, 2)
    assert.equal(fetchMock.calls[0].url, `${GATEWAY}/models`)
    assert.equal(fetchMock.calls[0].init.headers.authorization, "Bearer ak-1")
    // 第二次命中缓存，不再发请求
    await fetchGatewayModels("ak-1")
    assert.equal(fetchMock.calls.length, 1)
  }, [[/\/models/, () => json({ models: [{ id: "glm-5.2" }, { id: "qwen3.8-max" }] })]])
})

test("configModels/runtimeModel：兜底模型与运行期模型形状", () => {
  process.env.MEOO_GATEWAY_BASE_URL = GATEWAY
  const cm = configModels()
  assert.equal(cm["glm-5.2"].name, "GLM-5.2")
  assert.equal(cm["glm-5.2"].limit.context, 200_000)
  assert.equal(cm["glm-5.2"].tool_call, true)
  // 思考档位三档：映射成 AI SDK 的 reasoningEffort
  assert.deepEqual(cm["glm-5.2"].variants, {
    low: { reasoningEffort: "low" },
    medium: { reasoningEffort: "medium" },
    high: { reasoningEffort: "high" },
  })
  const provider = { id: "meoo" }
  const rm = runtimeModel(provider, { id: "glm-5.2", name: "GLM-5.2", context: 200_000, output: 64_000 })
  assert.equal(rm.providerID, "meoo")
  assert.equal(rm.api.npm, "@ai-sdk/openai-compatible")
  assert.equal(rm.api.url, GATEWAY)
  assert.equal(rm.capabilities.toolcall, true)
  assert.deepEqual(rm.variants, {
    low: { reasoningEffort: "low" },
    medium: { reasoningEffort: "medium" },
    high: { reasoningEffort: "high" },
  })
})

// ---- 手填 AK ----------------------------------------------------------------

test("manualKeySignIn：meoo_ak_ 前缀被拒绝，合法 AK 通过网关校验后保存", async () => {
  process.env.MEOO_GATEWAY_BASE_URL = GATEWAY
  const m = manualKeySignIn()
  assert.equal(m.method, "code")

  const empty = await m.callback("  ")
  assert.equal(empty.type, "failed")

  const userKey = await m.callback("meoo_ak_abcdef")
  assert.equal(userKey.type, "failed")
  assert.match(userKey.error, /用户 Key/)

  await withFetch(async (fetchMock) => {
    const ok = await m.callback("meoo_project_service_v1.abc")
    assert.equal(ok.type, "success")
    assert.equal(ok.key, "meoo_project_service_v1.abc")
    assert.match(fetchMock.calls[0].url, /\/models$/)
    assert.equal(fetchMock.calls[0].init.headers.authorization, "Bearer meoo_project_service_v1.abc")
  }, [[/\/models/, () => json({ models: ["glm-5.2"] })]])

  await withFetch(async () => {
    const bad = await m.callback("meoo_project_service_v1.wrong")
    assert.equal(bad.type, "failed")
    assert.match(bad.error, /被网关拒绝/)
  }, [[/\/models/, () => new Response("no", { status: 401 })]])
})

// ---- 本机登录态复用 -----------------------------------------------------------

test("readLegacyState：dsh 优先、proxy 互填、两处都没有返回 null", async () => {
  const { mkdtempSync, writeFileSync, rmSync, mkdirSync } = await import("node:fs")
  const { tmpdir } = await import("node:os")
  const { join } = await import("node:path")
  const dir = mkdtempSync(join(tmpdir(), "meoo-test-"))
  try {
    mkdirSync(join(dir, "proxy"), { recursive: true })
    const stateFile = join(dir, "state.json")
    const proxyFile = join(dir, "proxy", "config.json")
    writeFileSync(stateFile, JSON.stringify({ refreshToken: "ref-dsh", username: "陈同学", projectUrlId: "proj-a", serviceAk: null, accessExpiresAt: 0 }))
    writeFileSync(proxyFile, JSON.stringify({ refreshToken: "ref-proxy", serviceAk: "meoo_project_service_v1.p", serviceAkProjectId: "proj-b" }))

    const onlyDsh = readLegacyState({ dshState: stateFile, proxyConfig: join(dir, "nope.json") })
    assert.equal(onlyDsh.refreshToken, "ref-dsh")
    assert.equal(onlyDsh.username, "陈同学")
    assert.equal(onlyDsh.projectUrlId, "proj-a")
    assert.equal(onlyDsh.serviceAk, null)

    const onlyProxy = readLegacyState({ dshState: join(dir, "nope.json"), proxyConfig: proxyFile })
    assert.equal(onlyProxy.refreshToken, "ref-proxy")
    assert.equal(onlyProxy.serviceAk, "meoo_project_service_v1.p")
    assert.equal(onlyProxy.apiBase, "https://meoo.com")

    const none = readLegacyState({ dshState: join(dir, "nope.json"), proxyConfig: join(dir, "also-nope.json") })
    assert.equal(none, null)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("reuseSignIn：没有任何本机登录态 → 失败并说明找过哪里", async () => {
  const { mkdtempSync, rmSync } = await import("node:fs")
  const { tmpdir } = await import("node:os")
  const { join } = await import("node:path")
  const dir = mkdtempSync(join(tmpdir(), "meoo-test-"))
  const origDsh = process.env.DSH_HOME
  const origProxy = process.env.MEOO_PROXY_HOME
  process.env.DSH_HOME = join(dir, "empty-dsh")
  process.env.MEOO_PROXY_HOME = join(dir, "empty-proxy")
  try {
    const missing = await reuseSignIn().callback()
    assert.equal(missing.type, "failed")
    assert.match(missing.error, /未找到本机 Meoo 登录态/)
  } finally {
    if (origDsh === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = origDsh
    if (origProxy === undefined) delete process.env.MEOO_PROXY_HOME
    else process.env.MEOO_PROXY_HOME = origProxy
    rmSync(dir, { recursive: true, force: true })
  }
})

test("reuseSignIn：带 refresh token 的旧登录态会续期并解析 AK", async () => {
  process.env.MEOO_GATEWAY_BASE_URL = GATEWAY
  const { mkdtempSync, writeFileSync, rmSync, mkdirSync } = await import("node:fs")
  const { tmpdir } = await import("node:os")
  const { join } = await import("node:path")
  const dir = mkdtempSync(join(tmpdir(), "meoo-test-"))
  const origDshHome = process.env.DSH_HOME
  process.env.DSH_HOME = dir
  try {
    mkdirSync(join(dir, "meoo"), { recursive: true })
    writeFileSync(join(dir, "meoo", "state.json"), JSON.stringify({
      apiBaseUrl: "https://meoo.com",
      refreshToken: "ref-reuse",
      accessToken: "acc-old",
      accessExpiresAt: 0, // 已过期 → 触发续期
      username: "陈同学",
      projectUrlId: "proj-a",
    }))
    const backend = meooBackend({
      identity: { name: "陈同学", user_id: "u1", project_url_id: "proj-a" },
      projects: [{ url_id: "proj-a", name: "默认" }],
      env: { meooProjectApiKey: "meoo_project_service_v1.new" },
      gatewayModels: [{ id: "glm-5.2" }],
    })
    const prev = globalThis.fetch
    globalThis.fetch = backend
    try {
      const result = await reuseSignIn().callback()
      assert.equal(result.type, "success", JSON.stringify(result))
      assert.equal(result.username, "陈同学")
      assert.equal(result.access, "acc-1") // 续期后的 token
      assert.equal(result.serviceAk, "meoo_project_service_v1.new")
      assert.equal(result.projectUrlId, "proj-a")
      // 续期请求打到 OAuth token 端点
      assert.ok(backend.calls.some((c) => c.url.endsWith("/oauth/token")))
    } finally {
      globalThis.fetch = prev
    }
  } finally {
    process.env.DSH_HOME = origDshHome
    rmSync(dir, { recursive: true, force: true })
  }
})

// ---- 项目选择与 AK 解析 --------------------------------------------------------

const AUTH = { apiBase: "https://meoo.test", access: "acc-1", refresh: "ref-cur", expires: Date.now() + 3600_000 }

test("pickProject：显式 > 记录 > 身份默认 > 唯一项目；多项目报错列出可选项", async () => {
  await withFetch(async () => {
    assert.equal(await pickProject({ client: null }, AUTH, "explicit-1"), "explicit-1")
    assert.equal(await pickProject({ client: null }, { ...AUTH, projectUrlId: "saved" }), "saved")
  }, [])

  // 身份有默认项目
  await withFetch(async () => {
    assert.equal(await pickProject({ client: null }, AUTH), "from-identity")
  }, [
    [/\/account\/identity/, () => json({ data: { name: "陈同学", project_url_id: "from-identity" } })],
  ])

  // 多个项目 → 报错并列出
  await withFetch(async () => {
    await assert.rejects(() => pickProject({ client: null }, AUTH), (e) => {
      assert.match(e.message, /多个项目/)
      assert.match(e.message, /p1（A）/)
      assert.match(e.message, /p2（B）/)
      return true
    })
  }, [
    [/\/account\/identity/, () => json({ data: { project_url_id: null } })],
    [/\/projects\?/, () => json({ data: { list: [{ url_id: "p1", name: "A" }, { url_id: "p2", name: "B" }] } })],
  ])

  // 没有项目 → 自动创建（先带名字，失败退回空请求体）
  await withFetch(async (fetchMock) => {
    assert.equal(await pickProject({ client: null }, AUTH), "new-1")
    const posts = fetchMock.calls.filter((c) => c.init.method === "POST" && c.url.endsWith("/projects"))
    assert.equal(posts.length, 1)
    assert.deepEqual(JSON.parse(posts[0].init.body), { name: "AI 服务" })
  }, [
    [/\/account\/identity/, () => json({ data: { project_url_id: null } })],
    [/\/projects\?/, () => json({ data: { list: [] } })],
    [/\/projects$/, () => json({ data: { url_id: "new-1", name: "AI 服务" } })],
  ])

  // 自动创建也失败 → 报错提示手动建项目
  await withFetch(async () => {
    await assert.rejects(() => pickProject({ client: null }, AUTH), /自动创建也失败/)
  }, [
    [/\/account\/identity/, () => json({ data: { project_url_id: null } })],
    [/\/projects\?/, () => json({ data: { list: [] } })],
    [/\/projects$/, () => new Response("denied", { status: 400 })],
  ])

  // 唯一项目 → 直接选它
  await withFetch(async () => {
    assert.equal(await pickProject({ client: null }, AUTH), "only-1")
  }, [
    [/\/account\/identity/, () => json({ data: { project_url_id: null } })],
    [/\/projects\?/, () => json({ data: { list: [{ url_id: "only-1", name: "唯一" }] } })],
  ])
})

test("resolveServiceAk：environment 有 AK 直接用；没有就自动开通云服务再取", async () => {
  await withFetch(async (fetchMock) => {
    const r1 = await resolveServiceAk({ client: null }, AUTH, { projectUrlId: "p1" })
    assert.equal(r1.ak, "meoo_project_service_v1.env")
    assert.equal(r1.urlId, "p1")
    assert.equal(fetchMock.calls.filter((c) => c.url.includes("/cloud/environment")).length, 1)
    assert.equal(fetchMock.calls.filter((c) => c.init.method === "POST" && c.url.endsWith("/cloud")).length, 0)
  }, [
    [/\/cloud\/environment/, () => json({ data: { meooProjectApiKey: "meoo_project_service_v1.env" } })],
  ])

  await withFetch(async (fetchMock) => {
    const r2 = await resolveServiceAk({ client: null }, AUTH, { projectUrlId: "p1" })
    assert.equal(r2.ak, "meoo_project_service_v1.after")
    assert.equal(fetchMock.calls.filter((c) => c.init.method === "POST" && c.url.endsWith("/cloud")).length, 1)
  }, (() => {
    const posts = { n: 0 }
    return [
      [/\/cloud\/environment/, () => json({ data: posts.n ? { meooProjectApiKey: "meoo_project_service_v1.after" } : {} })],
      [/\/cloud$/, () => {
        posts.n++
        return json({ data: {} })
      }],
    ]
  })())

  await withFetch(async () => {
    await assert.rejects(() => resolveServiceAk({ client: null }, AUTH, { projectUrlId: "p1" }), /还没开通 Meoo AI 服务/)
  }, [
    [/\/cloud\/environment/, () => json({ data: {} })],
    [/\/cloud$/, () => new Response("denied", { status: 400 })],
  ])

  // Meoo 的业务错误走 HTTP 200 + success:false（如 QUOTA_EXCEEDED），错误信息要透传出来
  await withFetch(async () => {
    await assert.rejects(
      () => resolveServiceAk({ client: null }, AUTH, { projectUrlId: "p1" }),
      (e) => {
        assert.match(e.message, /还没开通 Meoo AI 服务/)
        assert.match(e.message, /实例数已达上限/)
        return true
      },
    )
  }, [
    [/\/cloud\/environment/, () => json({ data: { enabled: false, instance: null } })],
    [/\/cloud$/, () => json({ success: false, errCode: "QUOTA_EXCEEDED", message: "云服务实例数已达上限，请提醒升级套餐或释放实例后再试。" })],
  ])
})

// ---- 续期 -------------------------------------------------------------------

test("currentAuth：新鲜 token 原样返回；过期走续期并持久化", async () => {
  const fresh = { ...AUTH, expires: Date.now() + 1800_000 }
  const client = fakeClient()
  const r1 = await currentAuth({ client }, fresh)
  assert.equal(r1.didRenew, false)
  assert.equal(r1.a.access, "acc-1")
  assert.equal(client.saved.length, 0)

  const stale = { ...AUTH, expires: Date.now() - 1000, access: "acc-old", refresh: "ref-stale-only" }
  await withFetch(async () => {
    const r2 = await currentAuth({ client }, stale)
    assert.equal(r2.didRenew, true)
    assert.equal(r2.a.access, "acc-1")
    assert.equal(r2.a.refresh, "ref-1")
    assert.equal(client.saved.length, 1)
    assert.equal(client.saved[0].id, "meoo")
    assert.equal(client.saved[0].body.access, "acc-1")
  }, [[/\/oauth\/token/, () => json(OK_TOKEN)]])

  await assert.rejects(() => currentAuth({ client }, { ...AUTH, refresh: "", access: "x", expires: Date.now() - 1000 }), (e) => e.signIn === "expired")
})

test("isStale：没有 expires 视为过期（与 dsh 的 ensureAccessToken 语义一致）", () => {
  assert.equal(isStale({ expires: 0, access: "x" }), true)
  assert.equal(isStale({ expires: Date.now() + 120_000 }), false)
  assert.equal(isStale({ expires: Date.now() + 10_000 }), true) // 60 秒提前量内算临期
})

test("clientIdFor：meoo.com 用生产 client_id，其他用测试", () => {
  assert.equal(clientIdFor("https://meoo.com"), "meoo_app_tdWlRbpvAxN1EjmZ8XICxdTh")
  assert.equal(clientIdFor("https://meoo-dev.example"), "meoo_app_SFNvmHUFNePxyyfGjCd9hyaE")
})

// ---- 插件契约（magpie 1.x host 的入口）----------------------------------------

async function plugin(client = fakeClient()) {
  const hooks = await MeooAuthPlugin({ client })
  return { hooks, client }
}

test("config：注册 meoo provider（name/npm/api/兜底模型）", async () => {
  process.env.MEOO_GATEWAY_BASE_URL = GATEWAY
  const { hooks } = await plugin()
  const config = {}
  await hooks.config(config)
  const p = config.provider.meoo
  assert.equal(p.name, "Meoo 秒悟")
  assert.equal(p.npm, "@ai-sdk/openai-compatible")
  assert.equal(p.api, GATEWAY)
  assert.ok(p.models["glm-5.2"])
})

test("provider.models：api 账号用 key，失败回落原模型表", async () => {
  process.env.MEOO_GATEWAY_BASE_URL = GATEWAY
  resetCatalogCache()
  const { hooks } = await plugin()
  const provider = { id: "meoo", models: { "fallback-1": { name: "F1" } } }

  await withFetch(async (fetchMock) => {
    const ms = await hooks.provider.models(provider, { auth: { type: "api", key: "meoo_project_service_v1.k" } })
    assert.ok(ms["glm-5.2"])
    assert.equal(fetchMock.calls[0].init.headers.authorization, "Bearer meoo_project_service_v1.k")
  }, [[/\/models/, () => json({ models: [{ id: "glm-5.2", name: "GLM-5.2" }] })]])

  // 网关挂了（先清缓存强制重发）→ 回落 provider.models
  resetCatalogCache()
  await withFetch(async () => {
    const ms = await hooks.provider.models(provider, { auth: { type: "api", key: "meoo_project_service_v1.k" } })
    assert.deepEqual(ms, provider.models)
  }, [[/\/models/, () => new Response("x", { status: 500 })]])

  // 没有可用的 auth → 原样返回
  const none = await hooks.provider.models(provider, {})
  assert.deepEqual(none, provider.models)
})

test("loader：api 账号给 baseURL+apiKey；oauth 账号续期后用缓存的 AK", async () => {
  process.env.MEOO_GATEWAY_BASE_URL = GATEWAY
  const client = fakeClient()
  const { hooks } = await plugin(client)

  const l1 = await hooks.auth.loader(async () => ({ type: "api", key: "meoo_project_service_v1.k" }))
  assert.equal(l1.baseURL, GATEWAY)
  assert.equal(l1.apiKey, "meoo_project_service_v1.k")
  assert.equal(l1.fetch, undefined)

  const staleAuth = {
    type: "oauth", apiBase: "https://meoo.test", access: "acc-old", refresh: "ref-loader",
    expires: Date.now() - 1000, projectUrlId: "proj-a", serviceAk: "meoo_project_service_v1.cached", serviceAkProjectId: "proj-a",
  }
  const backend = meooBackend({ identity: {}, projects: [], env: {}, gatewayModels: [] })
  const prev = globalThis.fetch
  globalThis.fetch = backend
  try {
    const l2 = await hooks.auth.loader(async () => staleAuth)
    assert.equal(l2.baseURL, GATEWAY)
    assert.equal(l2.apiKey, "meoo_project_service_v1.cached") // serviceAk 与项目匹配 → 用缓存
    assert.equal(client.saved.length, 1) // 续期结果持久化
    assert.equal(client.saved[0].body.access, "acc-1")
  } finally {
    globalThis.fetch = prev
  }
})

test("loader：登录态彻底过期时返回合成 401 fetch，让宿主提示重新登录", async () => {
  process.env.MEOO_GATEWAY_BASE_URL = GATEWAY
  const { hooks } = await plugin()
  const l = await hooks.auth.loader(async () => ({ type: "oauth", access: "acc", refresh: "", expires: Date.now() - 1000 }))
  assert.equal(typeof l.fetch, "function")
  const res = await l.fetch("https://irrelevant")
  assert.equal(res.status, 401)
  const body = await res.json()
  assert.equal(body.error.type, "authentication_error")
})

test("refresh 钩子：oauth 账号续期并保留 AK/项目字段；api 账号不适用", async () => {
  process.env.MEOO_GATEWAY_BASE_URL = GATEWAY
  const client = fakeClient()
  const { hooks } = await plugin(client)
  assert.equal(await hooks.auth.refresh({ type: "api", key: "k" }), undefined)

  const auth = {
    type: "oauth", apiBase: "https://meoo.test", access: "acc-old", refresh: "ref-refresh",
    expires: Date.now() - 1000, serviceAk: "ak", serviceAkProjectId: "proj-a", projectUrlId: "proj-a",
  }
  await withFetch(async () => {
    const next = await hooks.auth.refresh(auth)
    assert.equal(next.access, "acc-1")
    assert.equal(next.refresh, "ref-1")
    assert.equal(next.serviceAk, "ak")
    assert.equal(next.apiBase, "https://meoo.test")
    assert.equal(client.saved.length, 1)
  }, [[/\/oauth\/token/, () => json(OK_TOKEN)]])
})

// ---- 浏览器 PKCE 登录（loopback 回调全流程，回调用真实 fetch 打本机端口）----------

test("browserSignIn：授权 URL 带齐 PKCE 参数；回调 state 校验；换票后自动解析身份与 AK", async () => {
  process.env.MEOO_GATEWAY_BASE_URL = GATEWAY
  process.env.MEOO_MAIN_SITE_URL = "https://meoo.test"
  const backend = meooBackend({
    identity: { name: "陈同学", user_id: "u1", project_url_id: "proj-a" },
    projects: [{ url_id: "proj-a", name: "默认" }],
    env: { meooProjectApiKey: "meoo_project_service_v1.auto" },
    gatewayModels: [{ id: "glm-5.2" }],
  })
  const prev = globalThis.fetch
  globalThis.fetch = backend
  try {
    const m = await browserSignIn(60_000)
    assert.equal(m.method, "auto")
    const url = new URL(m.url)
    assert.equal(url.origin + url.pathname, "https://meoo.test/oauth/authorize")
    assert.equal(url.searchParams.get("response_type"), "code")
    assert.equal(url.searchParams.get("scope"), "cli.compat")
    assert.equal(url.searchParams.get("code_challenge_method"), "S256")
    const redirect = url.searchParams.get("redirect_uri")
    assert.match(redirect, /^http:\/\/127\.0\.0\.1:\d+\/oauth\/callback$/)
    const state = url.searchParams.get("state")

    // 错误 state 被拒（真实 fetch 打 loopback）
    const bad = await prev(`${redirect}?code=x&state=wrong`)
    assert.equal(bad.status, 400)

    // 正确回调：换票 + 身份 + AK 全链路成功
    const good = await prev(`${redirect}?code=the-code&state=${encodeURIComponent(state)}`)
    assert.equal(good.status, 200)
    const result = await m.callback()
    assert.equal(result.type, "success", JSON.stringify(result))
    assert.equal(result.access, "acc-1")
    assert.equal(result.accountId, "陈同学")
    assert.equal(result.serviceAk, "meoo_project_service_v1.auto")
    assert.equal(result.projectUrlId, "proj-a")
    const tokenCall = backend.calls.find((c) => c.url.endsWith("/oauth/token"))
    assert.ok(tokenCall)
    const body = new URLSearchParams(tokenCall.init.body)
    assert.equal(body.get("grant_type"), "authorization_code")
    assert.equal(body.get("redirect_uri"), redirect)
    assert.ok(body.get("code_verifier"))
  } finally {
    globalThis.fetch = prev
    delete process.env.MEOO_MAIN_SITE_URL
  }
})

test("browserSignIn：授权被拒 → failed；回调服务器会收尾", async () => {
  process.env.MEOO_MAIN_SITE_URL = "https://meoo.test"
  const prev = globalThis.fetch
  globalThis.fetch = fakeFetch([])
  try {
    const m = await browserSignIn(60_000)
    const url = new URL(m.url)
    const redirect = url.searchParams.get("redirect_uri")
    await prev(`${redirect}?error=access_denied&state=${encodeURIComponent(url.searchParams.get("state"))}`)
    const result = await m.callback()
    assert.equal(result.type, "failed")
    assert.match(result.error, /授权被取消/)
  } finally {
    globalThis.fetch = prev
    delete process.env.MEOO_MAIN_SITE_URL
  }
})
