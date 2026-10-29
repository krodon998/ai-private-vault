# AI Private Vault

给 AI 一个可长期使用、由你掌控的加密私人空间。它适合保存个人日记、跨窗口交接、长期记忆和私密备忘。

正文在离开本机前使用 AES-256-GCM 加密，临时 AES 密钥再由 RSA-OAEP-256 公钥加密。Supabase 数据表只保存加密信封；私钥仅存在 Edge Function 的服务端 Secret 中。获得授权的 AI 工具可以归档密文、列出元数据，并按完整来源标签读取一条正文。

> 这不是密码管理器。不要保存银行卡密码、恢复短语或能够直接接管其他账户的最高权限认证信息。

## 它解决什么

- 数据库泄露或误开放时，不直接暴露正文。
- 公开仓库只需放代码、SQL、示例配置和公钥。
- AI 前端可以更换，私库与具体平台解耦。
- `list` 不返回密文或明文；`read` 只接受精确 `source_tag`。

## 数据流

```text
明文（本机）
  └─ AES-256-GCM 加密正文
      └─ RSA-OAEP-256 加密 AES 密钥
          └─ HTTPS 发送加密信封
              └─ Supabase Postgres 保存密文
                  └─ Edge Function 鉴权并按需解密
                      └─ 授权 AI 获得指定的一条正文
```

## 仓库结构

```text
ai-private-vault/
├─ README.md
├─ LICENSE
├─ requirements.txt
├─ scripts/
│  ├─ generate_keys.py
│  └─ encrypt_entry.py
├─ supabase/
│  ├─ config.toml
│  ├─ migrations/202610290001_init.sql
│  └─ functions/private-vault/index.ts
└─ examples/
   ├─ envelope.example.json
   └─ cloudflare-worker.ts
```

## 快速开始

### 1. 准备环境

安装 Git、Python 3.10+、Node.js 20+ 与 Supabase CLI：

```bash
npm install -g supabase
python -m pip install -r requirements.txt
supabase login
supabase init
```

在 Supabase 新建项目，记下 Project URL 与 project ref。

### 2. 建表

在 Supabase SQL Editor 运行：

```text
supabase/migrations/202610290001_init.sql
```

数据表启用 RLS，并撤销 `anon` 与 `authenticated` 的直接访问。这个单人最小实现只允许 Edge Function 使用 service role 访问数据。

### 3. 生成密钥

```bash
python scripts/generate_keys.py
```

会生成：

- `private_key.pem`：只保存于本机与服务端 Secret，禁止提交。
- `public_key.pem`：供本地加密脚本使用，可以公开。
- `public_key.jwk.json`：JWK 格式公钥，可以公开。

请离线备份私钥。私钥遗失后，旧密文无法恢复。

### 4. 发布 Edge Function

生成高强度控制令牌：

```bash
python -c "import secrets; print(secrets.token_urlsafe(48))"
```

在 Supabase Edge Functions Secrets 中设置：

| Secret | 内容 |
| --- | --- |
| `AI_VAULT_TOKEN` | 上一步生成的随机令牌 |
| `AI_VAULT_PRIVATE_KEY` | `private_key.pem` 的完整内容 |
| `SUPABASE_SERVICE_ROLE_KEY` | 项目的 service role key |
| `SUPABASE_URL` | 项目 URL |

然后发布：

```bash
supabase link --project-ref YOUR_PROJECT_REF
supabase functions deploy private-vault --no-verify-jwt
```

这个版本使用自定义 `x-vault-token`，所以关闭平台 JWT 校验；函数内部的令牌校验不能删除。

### 5. 加密并测试

```bash
printf '这是第一条测试内容。' > test-note.txt
python scripts/encrypt_entry.py test-note.txt --output envelope.json
```

把 `envelope.json` 转成归档请求：

```bash
python - <<'PY' > request.json
import json
d=json.load(open('envelope.json', encoding='utf-8'))
print(json.dumps({
  'action':'archive',
  'source_tag':d['source_tag'],
  'cipher_envelope':d['cipher_envelope']
}))
PY
```

```bash
export VAULT_URL='https://YOUR_PROJECT_REF.supabase.co/functions/v1/private-vault'
export AI_VAULT_TOKEN='YOUR_RANDOM_TOKEN'

curl "$VAULT_URL" \
  -H 'content-type: application/json' \
  -H "x-vault-token: $AI_VAULT_TOKEN" \
  --data @request.json

curl "$VAULT_URL" \
  -H 'content-type: application/json' \
  -H "x-vault-token: $AI_VAULT_TOKEN" \
  --data '{"action":"list","limit":10}'
```

读取时必须替换为完整来源标签：

```bash
curl "$VAULT_URL" \
  -H 'content-type: application/json' \
  -H "x-vault-token: $AI_VAULT_TOKEN" \
  --data '{"action":"read","source_tag":"AI-VAULT-完整标签"}'
```

合格结果：`archive` 返回 201；`list` 只返回元数据；`read` 返回指定正文；删除 `x-vault-token` 后返回 401。

## 接入 AI 前端

### ChatGPT 或支持服务端 Secret 的平台

把 `VAULT_URL` 与 `AI_VAULT_TOKEN` 保存为服务端 Secret，由服务端动作调用。令牌不能进入浏览器 JavaScript、页面源码、截图或公开仓库。

### 不使用 ChatGPT

Cloudflare Workers、Vercel Functions、Netlify Functions、Deno Deploy、自有服务器、NAS 或本地常驻进程都可以作为代理层。浏览器只访问代理，代理从 Secret 中读取令牌后调用私库。示例见 [`examples/cloudflare-worker.ts`](examples/cloudflare-worker.ts)。

建议对 AI 暴露三个工具：

```text
archive_ciphertext({ source_tag, cipher_envelope })
list_entries({ limit })
read_by_source_tag({ source_tag })
```

其中 `archive_ciphertext` 只接受已经加密的信封，不接受明文。

## 安全边界

这套最小实现可以降低误公开数据表、只读数据库暴露、公开仓库泄密与普通浏览器查看造成的风险。它不能抵御服务端账户和 Secret 同时被攻破、用户设备中毒，或已授权 AI 会话被他人控制。

上线前至少确认：

- Git 历史从未出现私钥、service role key、控制令牌或真实明文。
- RLS 已开启，`anon` 与 `authenticated` 无直接表权限。
- 所有函数动作先鉴权，错误响应不回显内部异常与秘密。
- `archive` 只接受密文，且 AAD 与 `source_tag` 一致。
- `list` 不返回密文或明文；`read` 只按精确标签读取。
- 私钥存在离线备份；控制令牌可以随时轮换。

发现秘密曾被提交时，不要只删除文件：立即轮换或撤销旧值，再清理 Git 历史。

## 常见问题

| 现象 | 优先检查 |
| --- | --- |
| `401 unauthorized` | `x-vault-token` 缺失、错误或包含多余空格 |
| `500 request failed` | 表名、服务密钥、私钥 PEM 换行与函数日志 |
| `AAD mismatch` | `source_tag` 是否与 `envelope.aad` 完全相同 |
| `OperationError` | RSA 公私钥是否配对、key version 是否正确 |
| `duplicate key` | `source_tag` 已存在，应重新生成标签 |
| 发布成功却 404 | 函数名与 URL 末尾是否为 `private-vault` |

## 后续升级

多人使用时应加入 Supabase Auth、`owner_id`、按用户隔离的 RLS 与审计日志；公开 MCP 或跨设备授权时再加入 OAuth 2.1；密钥轮换时用 `key_version` 保留旧钥只读。

## 免责声明

这是用于学习和个人实验的最小实现。部署者需要自行负责账户安全、密钥备份、日志脱敏、依赖更新与平台费用。

## License

[MIT](LICENSE)

