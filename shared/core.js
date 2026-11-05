/**
 * Universal CDN Proxy v3
 * Web-standard Fetch implementation.
 */

const VERSION = "3.0.0";
const COLO_NAMES = Object.freeze({
  HKG: "香港", SIN: "新加坡", LAX: "洛杉矶", SFO: "旧金山",
  CDG: "巴黎", FRA: "法兰克福", NRT: "东京", HND: "东京",
  ICN: "首尔", MIA: "迈阿密", AMS: "阿姆斯特丹", LHR: "伦敦",
  LON: "伦敦", SYD: "悉尼", TPE: "台北", KIX: "大阪",
  IAD: "华盛顿", ORD: "芝加哥", DFW: "达拉斯", SEA: "西雅图",
  YYZ: "多伦多", GRU: "圣保罗", BOM: "孟买", DEL: "新德里"
});
const REQUEST_BLOCKED = new Set([
  "host", "connection", "keep-alive", "proxy-authenticate",
  "proxy-authorization", "te", "trailer", "transfer-encoding",
  "upgrade", "cookie", "origin", "referer", "forwarded",
  "x-forwarded-for", "x-forwarded-host", "x-forwarded-proto",
  "x-real-ip", "true-client-ip", "cf-connecting-ip", "cf-ipcountry",
  "cf-ray", "eo-connecting-ip", "accept-encoding"
]);
const RESPONSE_HOP = new Set([
  "connection", "keep-alive", "proxy-authenticate",
  "proxy-authentication-info", "te", "trailer",
  "transfer-encoding", "upgrade"
]);
const METHODS = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]);

function intSetting(value, fallback, min, max) {
  if (value === undefined || value === null || value === "") return fallback;
  const n = Number.parseInt(String(value), 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}
function getConfig(env) {
  env = env || {};
  return {
    token: String(env.PROXY_TOKEN || ""),
    corsOrigin: String(env.CORS_ORIGIN || "*"),
    redirects: intSetting(env.MAX_REDIRECTS, 3, 0, 5),
    timeout: intSetting(env.REQUEST_TIMEOUT_MS, 20000, 1000, 120000),
    maxUrl: intSetting(env.MAX_URL_LENGTH, 8192, 256, 32768),
    userAgent: String(env.UPSTREAM_USER_AGENT || "")
  };
}
function cors(config) {
  return {
    "Access-Control-Allow-Origin": config.corsOrigin,
    "Access-Control-Allow-Methods": "GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, Range, Accept, User-Agent, If-Modified-Since, If-None-Match",
    "Access-Control-Expose-Headers": "Content-Length, Content-Range, Accept-Ranges, ETag, Last-Modified, X-Proxy-Platform, X-Proxy-Colo, X-Proxy-Version",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };
}
export async function handleRequest(request, env = {}, platform = {}) {
  const config = getConfig(env);
  const incoming = new URL(request.url);
  const edge = getEdgeInfo(request, platform);

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: { ...cors(config), "Cache-Control": "no-store" } });
  }
  if (!METHODS.has(request.method.toUpperCase())) {
    return textError("不支持的请求方法", 405, config, { Allow: Array.from(METHODS).join(", ") });
  }
  if (incoming.pathname === "/health" || incoming.pathname === "/healthz") {
    return json({ ok: true, service: "universal-cdn-proxy", version: VERSION, platform: edge.platform }, 200, config);
  }
  if (incoming.pathname === "/" || incoming.pathname === "") return home(edge, config);

  if (config.token && !(await authorized(request, incoming, config.token))) {
    return textError("Unauthorized", 401, config, { "WWW-Authenticate": "Bearer" });
  }

  let target;
  try {
    target = parseTarget(incoming, config.maxUrl);
  } catch (error) {
    return textError(error.message || "目标 URL 无效", 400, config);
  }
  const check = validateTarget(target);
  if (!check.ok) return textError(check.message, 403, config);

  const headers = filterRequestHeaders(request.headers);
  if (config.userAgent) headers.set("User-Agent", config.userAgent);

  try {
    const result = await fetchRedirects(request, target, headers, config);
    return makeProxyResponse(result.response, result.url, incoming, edge, config);
  } catch (error) {
    const status = error && error.name === "AbortError" ? 504 : 502;
    return textError(status === 504 ? "上游请求超时" : "代理请求失败，请检查目标地址或上游连接", status, config);
  }
}
async function authorized(request, incoming, expected) {
  let supplied = request.headers.get("Authorization") || "";
  if (supplied.startsWith("Bearer ")) supplied = supplied.slice(7);
  if (!supplied) supplied = incoming.searchParams.get("token") || "";
  if (supplied.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ supplied.charCodeAt(i);
  return diff === 0;
}
function parseTarget(incoming, maxLength) {
  let raw = incoming.pathname.slice(1);
  if (!raw) throw new Error("缺少目标 URL");
  try { raw = decodeURIComponent(raw); } catch { throw new Error("URL 编码无效"); }
  if (raw.length > maxLength) throw new Error("目标 URL 超出长度限制");
  if (!/^https?:\/\//i.test(raw)) raw = incoming.protocol + "//" + raw;
  let target;
  try { target = new URL(raw); } catch { throw new Error("目标 URL 格式无效"); }
  if (!["http:", "https:"].includes(target.protocol)) throw new Error("仅允许 HTTP 和 HTTPS 协议");
  if (target.username || target.password) throw new Error("不允许 URL 内嵌用户名或密码");
  for (const [key, value] of incoming.searchParams) {
    if (key.toLowerCase() !== "token") target.searchParams.append(key, value);
  }
  return target;
}
function validateTarget(url) {
  const host = url.hostname.toLowerCase().replace(/\.$/, "").replace(/^\[|\]$/g, "");
  if (!host) return { ok: false, message: "目标主机名为空" };
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") ||
      host.endsWith(".internal") || host.endsWith(".test") || host.endsWith(".invalid") ||
      host === "metadata.google.internal") {
    return { ok: false, message: "禁止访问本地或内部域名" };
  }
  if (isIPv4(host) && nonPublicIPv4(host)) return { ok: false, message: "禁止访问私有或保留 IPv4 地址" };
  if (host.includes(":") && nonPublicIPv6(host)) return { ok: false, message: "禁止访问非公网 IPv6 地址" };
  return { ok: true };
}
function isIPv4(host) { return /^(?:\d{1,3}\.){3}\d{1,3}$/.test(host); }
function nonPublicIPv4(host) {
  const p = host.split(".").map(Number);
  if (p.length !== 4 || p.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b, c] = p;
  return a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 0 || b === 168)) ||
    (a === 192 && b === 88 && c === 99) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113);
}
function nonPublicIPv6(host) {
  const ip = host.toLowerCase();
  if (ip.startsWith("::ffff:") || ip.startsWith("64:ff9b:")) return true;
  const first = Number.parseInt(ip.split(":")[0] || "0", 16);
  if (!Number.isFinite(first) || first < 0x2000 || first > 0x3fff) return true;
  return ip.startsWith("2001:db8:") || ip.startsWith("2001:10:") ||
    ip.startsWith("2001:20:") || ip.startsWith("2001:0:") ||
    ip.startsWith("2002:") || ip.startsWith("3fff:");
}
function filterRequestHeaders(source) {
  const result = new Headers();
  const connection = new Set((source.get("Connection") || "").split(",").map(v => v.trim().toLowerCase()).filter(Boolean));
  for (const [name, value] of source.entries()) {
    const key = name.toLowerCase();
    if (REQUEST_BLOCKED.has(key) || connection.has(key)) continue;
    result.set(name, value);
  }
  return result;
}
async function fetchRedirects(request, target, headers, config) {
  let current = new URL(target.toString());
  let method = request.method.toUpperCase();
  let body = ["GET", "HEAD"].includes(method) ? undefined : request.body;

  for (let hop = 0; ; hop++) {
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, config.timeout);
    let response;
    try {
      response = await fetch(current.toString(), {
        method, headers, body: ["GET", "HEAD"].includes(method) ? undefined : body,
        redirect: "manual", signal: controller.signal
      });
    } catch (error) {
      if (timedOut) {
        const timeoutError = new Error("Upstream request timed out");
        timeoutError.name = "AbortError";
        throw timeoutError;
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }

    const location = response.headers.get("Location");
    if (![301, 302, 303, 307, 308].includes(response.status) || !location) return { response, url: current };
    if (!["GET", "HEAD"].includes(method) || hop >= config.redirects) return { response, url: current };

    let next;
    try { next = new URL(location, current); } catch { return { response, url: current }; }
    const nextCheck = validateTarget(next);
    if (!nextCheck.ok) {
      return { response: new Response("重定向目标被安全策略拦截", { status: 502 }), url: current };
    }
    if (next.origin !== current.origin) headers.delete("Authorization");
    if (response.status === 303 && method !== "HEAD") {
      method = "GET";
      body = undefined;
      headers.delete("Content-Type");
      headers.delete("Content-Length");
    }
    current = next;
    try { if (response.body) await response.body.cancel(); } catch {}
  }
}
function makeProxyResponse(response, finalUrl, incoming, edge, config) {
  const headers = new Headers(response.headers);
  const connection = new Set((headers.get("Connection") || "").split(",").map(v => v.trim().toLowerCase()).filter(Boolean));
  for (const name of RESPONSE_HOP) headers.delete(name);
  for (const name of connection) headers.delete(name);
  for (const [name, value] of Object.entries(cors(config))) headers.set(name, value);

  headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
  headers.set("Pragma", "no-cache");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("X-Proxy-Version", VERSION);
  headers.set("X-Proxy-Platform", edge.platform);
  headers.set("X-Proxy-Colo", edge.node);
  if (edge.ip !== "unknown") headers.set("X-Proxy-Client-IP", edge.ip);

  const location = headers.get("Location");
  if (location) {
    try {
      const next = new URL(location, finalUrl);
      headers.set("Location", new URL("/" + encodeURIComponent(next.toString()), incoming.origin).toString());
    } catch { headers.delete("Location"); }
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
function getEdgeInfo(request, platform) {
  const cf = request.cf || {};
  const eo = platform.eo || request.eo || {};
  if (platform.name === "EdgeOne Makers") {
    const colo = String(eo.colo || eo.city || eo.region || "unknown");
    return { platform: "EdgeOne Makers", node: colo === "unknown" ? "unknown" : (COLO_NAMES[colo] || colo) + " (" + colo + ")", ip: "unknown" };
  }
  const colo = String(cf.colo || "unknown");
  return {
    platform: platform.name || (request.cf ? "Cloudflare" : "Web Runtime"),
    node: colo === "unknown" ? "unknown" : (COLO_NAMES[colo] || colo) + " (" + colo + ")",
    ip: request.headers.get("cf-connecting-ip") || "unknown"
  };
}
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
}
function home(edge, config) {
  const html = '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Universal CDN Proxy</title><style>*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:#101827;color:#e8eef8;font-family:system-ui,-apple-system,"Segoe UI",sans-serif}main{width:min(720px,100%);padding:34px;border:1px solid #344258;border-radius:18px;background:#172235;box-shadow:0 18px 60px #0005}h1{margin:0 0 8px;font-size:clamp(24px,5vw,34px)}p{line-height:1.7;color:#b9c7da}code{display:block;padding:14px;border-radius:10px;background:#0d1522;color:#9ee6c2;overflow-wrap:anywhere}.tag{display:inline-block;padding:7px 10px;margin:4px;border:1px solid #3b4a60;border-radius:999px;color:#cbd7e7;font-size:13px}small{color:#93a4ba}</style></head><body><main><h1>Universal CDN Proxy</h1><p>跨平台 HTTP / HTTPS 边缘代理服务</p><span class="tag">' + escapeHtml(edge.platform) + '</span><span class="tag">节点：' + escapeHtml(edge.node) + '</span><span class="tag">版本：' + VERSION + '</span><p>使用方式：在代理域名后添加目标 HTTP/HTTPS URL。</p><code>https://proxy.example.com/https://example.com/path</code><p>健康检查：<a href="/health">/health</a></p><small>公开部署建议配置访问令牌。</small></main></body></html>';
  return new Response(html, { status: 200, headers: {
    "Content-Type": "text/html; charset=UTF-8", "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", ...cors(config)
  }});
}
function textError(message, status, config, extra = {}) {
  return new Response(message, { status, headers: {
    "Content-Type": "text/plain; charset=UTF-8", "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff", ...cors(config), ...extra
  }});
}
function json(data, status, config) {
  return new Response(JSON.stringify(data, null, 2), { status, headers: {
    "Content-Type": "application/json; charset=UTF-8", "Cache-Control": "no-store", ...cors(config)
  }});
}
