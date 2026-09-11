# CloudBase 设置指南（一次性）

按顺序做完这份清单，数据库就绪。全程在**微信开发者工具**里点，不需要命令行。

- 环境 ID：`cloudbase-d4gza0wljf6505629`
- 小程序 AppID：`wxa6b778821b3ccbc9`（已配置）

---

## 第 0 步：打开云开发控制台

1. 用微信开发者工具打开本项目（`miniprogram/` 目录）。
2. 顶部工具栏点 **云开发 / Cloud**。
3. 如果第一次用：按提示 **开通**，完成 **实名认证**（腾讯要求，有免费额度）。
4. 确认左上角显示的环境是 `cloudbase-d4gza0wljf6505629`。

---

## 第 1 步：创建 7 个集合（collection）

名字必须**完全一致**（全小写、下划线）：

| # | 集合名称 |
|---|---|
| 1 | `users` |
| 2 | `loan_accounts` |
| 3 | `loan_terms` |
| 4 | `change_requests` |
| 5 | `loan_events` |
| 6 | `invite_tokens` |
| 7 | `audit_logs` |

### 方式 A（推荐，省手动）：先部署函数，再一键创建

如果你打算先部署云函数（第 4 步），可以跳过手动新建，改为调用一次
`setupCollections`（在小程序里或云函数测试面板里传 `{ "action": "setupCollections" }`）。
它会自动创建缺失的 7 个集合，返回 `{ created, existing }`，可重复调用。

> 顺序：`setupCollections` 只需要函数已部署，不需要管理员存在。流程可以是
> 部署函数 → 调 `setupCollections` → 建索引/权限 → 调 `bootstrapAdmin`。
> 注意：它**不建索引**（SDK 不支持），第 2 步仍需手动。

### 方式 B（纯手动）：控制台点 7 次

进入左侧 **数据库** → “集合”列表 → 点 **+**（新建集合），逐个输入上表名字。
创建时不需要填任何字段——集合是无模式的，字段由云函数写入时自然产生。

---

## 第 2 步：创建唯一索引（**最关键，别跳过**）

索引是数据库层面的“防重复”保障。没有它，用户狂点或网络重试可能造成重复入账、
重复绑定。代码里的检查是第二道防线，索引是第一道。

对每个集合：在数据库里 **选中该集合 → 打开“索引管理”标签 → 新建索引**，按下表设置。
“唯一”一定要打开。

| 集合 | 索引字段 | 唯一？ | 说明 |
|---|---|---|---|
| `users` | `openid` | ✅ 唯一 | 一个微信身份只绑定一个账户 |
| `loan_events` | `idempotencyKey` | ✅ 唯一 | 防止重复入账（狂点/重试） |
| `loan_events` | `sourceRequestId` | ✅ 唯一 | 一个归还请求最多产生一条事件 |
| `invite_tokens` | `tokenHash` | ✅ 唯一 | 邀请令牌唯一 |
| `change_requests` | `idempotencyKey` | ✅ 唯一 | 防止重复归还请求 |

新建索引界面里通常需要：
- **索引名称**：随便起，例如 `uniq_openid`。
- **索引属性**：选 **唯一**。
- **字段**：输入字段名（如 `openid`），排序选 **升序 (1)**。
- 保存。

> 关于 `sourceRequestId` 唯一索引：目前多数事件该字段为 `null`。如果控制台不允许多个
> `null` 并存，请把它建成 **稀疏（sparse）/ 部分索引**（只对存在该字段的文档生效）。
> 若控制台没有稀疏选项，可以先跳过这一条，等归还功能上线时再加。其余 4 个唯一索引现在就建。

---

## 第 3 步：关闭客户端写权限（安全边界）

对**每个**集合：**权限设置** → 选择 **仅创建者可读写** 之外最严格的一档，
目标是**禁止小程序端直接写**。推荐选“**所有用户可读，仅管理端可写**”里最接近
“客户端只读、写入只走云函数”的规则；如果控制台提供自定义安全规则，用：

```json
{
  "read": false,
  "write": false
}
```

（客户端读写全部关闭，一切经由 `ledger` 云函数。这是 spec §14–§15 的强制要求。）

`audit_logs`、`loan_events`、`change_requests`、`loan_terms`、`invite_tokens`
尤其必须禁止客户端写。

---

## 第 4 步：部署云函数并初始化管理员

数据库就绪后：

```bash
# 仓库根目录
npm run build
npm run bundle -w @family-ledger/cloud-ledger   # 生成自包含的 dist-bundle/

npm i -g @cloudbase/cli    # 提供 tcb 命令
tcb login
tcb fn deploy ledger       # 读取 cloudbaserc.json
```

（也可以在微信开发者工具的云函数面板里，把 `ledger` 函数指向 `dist-bundle/` 上传。）

然后用**你自己的手机**在小程序里触发一次 `bootstrapAdmin`：第一个调用的微信账号
成为管理员（曾骏），之后该操作永久失效。详见 `cloud/README.md`。

---

## 完成标志

- 7 个集合都在。
- 至少 4 个唯一索引已建（`users.openid`、`loan_events.idempotencyKey`、
  `invite_tokens.tokenHash`、`change_requests.idempotencyKey`）。
- 所有集合客户端写权限已关闭。
- `ledger` 云函数已部署，`bootstrapAdmin` 调用成功一次。
