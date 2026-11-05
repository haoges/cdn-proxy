# Universal CDN Proxy v3

跨平台 HTTP/HTTPS Fetch 代理，核心逻辑仅依赖 Web 标准 API。

## 平台与目录

- Cloudflare Workers：wrangler.jsonc + src/index.js
- Cloudflare Pages：根目录 functions/，静态输出 public/
- EdgeOne Makers：根目录 edge-functions/（Edge Functions 模式）

EdgeOne 本项目使用 Edge Functions，不是 Node.js Cloud Functions。函数路由由 edge-functions 目录结构生成。

## 使用

访问代理域名后追加目标 URL：

    https://proxy.example.com/https://example.com/path

也支持 URL 编码形式。目标协议只允许 HTTP/HTTPS。目标 URL 自带 query 会保留，代理入口 query 会追加到目标 URL（token 参数除外）。

健康检查：/health 或 /healthz

## 安全配置（公开部署前强烈建议）

设置 PROXY_TOKEN：

- Workers：npx wrangler secret put PROXY_TOKEN
- Pages：项目 Settings → Variables and Secrets
- EdgeOne Makers：项目环境变量

请求示例：

    curl -H "Authorization: Bearer YOUR_TOKEN" https://proxy.example.com/https://example.com/

支持 ?token= 兼容方式，但不推荐，令牌可能进入浏览器历史和访问日志。

可选环境变量：

| 名称 | 默认值 | 说明 |
|---|---:|---|
| PROXY_TOKEN | 空 | 访问令牌；为空时不启用认证 |
| CORS_ORIGIN | * | CORS 允许来源 |
| MAX_REDIRECTS | 3 | GET/HEAD 最大重定向次数，范围 0–5 |
| REQUEST_TIMEOUT_MS | 20000 | 单次上游请求超时 |
| MAX_URL_LENGTH | 8192 | 目标 URL 最大长度 |
| UPSTREAM_USER_AGENT | 空 | 可选覆盖上游 User-Agent |

## Cloudflare Workers

使用仓库根目录 wrangler.jsonc。连接 Git 仓库或本地克隆后：

    npm install
    npx wrangler secret put PROXY_TOKEN
    npm run dev
    npm run deploy

## Cloudflare Pages

Git 集成配置：

- Root directory：/
- Framework preset：None
- Build command：留空
- Build output directory：public
- functions/ 必须位于仓库根目录，不能放进 public/functions/

在 Pages 项目环境变量中设置 PROXY_TOKEN。Pages Functions 根据根目录 functions/ 文件路由。

## EdgeOne Makers

1. 可通过 [EdgeOne Makers 一键导入部署](https://edgeone.ai/pages/new?repository-url=https%3A%2F%2Fgithub.com%2Fhaoges%2Fcdn-proxy%26project-name%3Dcdn-proxy%26output-directory%3Dpublic%26install-command%3Dnpm%2520install%2520--omit%253Ddev) 导入本仓库，或在控制台手动导入。
2. 选择 Edge Functions（不是 Cloud Functions）。
3. 函数目录使用仓库根目录下的 edge-functions。
4. 使用 Handler / Functions 模式，入口为 onRequest(context)。
5. 设置 PROXY_TOKEN 后部署。

路由：
- edge-functions/index.js → /
- edge-functions/health.js → /health
- edge-functions/[[default]].js → 其余多级路径

## 安全与平台限制

- 拒绝 localhost、私有/保留 IPv4、非全球单播 IPv6、内网域名和 URL 用户密码。
- 每次 GET/HEAD 重定向都会重新校验目标；最多 5 跳。
- 非 GET/HEAD 请求不自动跟随重定向，避免重放流式请求体。
- 不转发 Cookie、Authorization、Origin、Referer、客户端伪造的转发 IP 头及 Hop-by-Hop 请求头，避免代理令牌或用户凭据泄漏到目标站点。
- 不信任任意请求头作为客户端真实 IP；平台无法确认时显示 unknown。
- 不使用 Cloudflare 专属 fetch cf 参数，代理核心只使用 Web 标准 Fetch API。
- DNS 解析结果由平台网络栈处理。纯 Web Fetch 代码无法在所有平台可靠执行解析后 IP 限制；高保证 SSRF 防护应采用目标域名白名单或受控出口。
- 平台对请求体大小、执行时长、并发和网络访问各有配额，大文件能力以部署平台当前限制为准。
- 公开代理应启用令牌，并遵守目标站点的访问授权与法律要求。

## 本地开发

    npm install
    npm run dev
    curl -i http://localhost:8787/health
    curl -i http://localhost:8787/https://example.com/
