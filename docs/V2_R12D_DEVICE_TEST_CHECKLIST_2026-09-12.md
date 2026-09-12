# V2 R12D 真机测试执行清单 — 2026-09-12

## 当前测试基线

- Git branch: `codex/v2-r12-cutover-audit`
- Draft PR: `#12`
- Mini Program AppID: `wxa6b778821b3ccbc9`
- 当前 Mini Program CloudBase env: `cloudbase-d4gza0wljf6505629`
- Cloud function: `ledger`
- Cloud function handler: `index.main`
- Cloud function runtime: `Nodejs20.19`
- Ledger timezone: `Asia/Shanghai`

本清单用于 **开发/体验环境**。不要对生产数据执行 R12D smoke 或清库操作。

---

## A. 真机测试前必须完成

### A1. 确认开发环境数据可用

v2 是 clean rewrite，不兼容 v1 family/admin 数据模型。

如果 `cloudbase-d4gza0wljf6505629` 里还保存着旧 v1 开发数据：

- 先导出你想保留的数据；或
- 新建一个专门的 v2 开发 CloudBase 环境，并同步修改 `miniprogram/config.js` 与本地 `CLOUDBASE_ENV_ID`。

不要把旧 v1 文档直接解释成 v2 数据。

### A2. CloudBase 关联 Mini Program AppID

在 CloudBase 控制台进入目标环境：

`环境配置 → 安全配置 → 小程序关联`

确认已关联：

```text
wxa6b778821b3ccbc9
```

并确认 `miniprogram/config.js` 的 `cloudbaseEnvId` 与控制台环境 ID 完全一致。

如果这里错误，真机通常会报 `invalid env` / `非法的 env`，后续测试全部没有意义。

### A3. 本地 checkout + repository gate

```bash
git fetch origin
git checkout codex/v2-r12-cutover-audit
git pull --ff-only

node --version
# 预期 20.19.x；可用 nvm use

npm ci
npm run build
npm run typecheck
npm test
npm run bundle -w @family-ledger/cloud-ledger
npm run deployment:check -w @family-ledger/cloud-ledger
```

### A4. 创建 v2 core collections

目标开发环境中确认存在：

```text
users
loans
ledger_requests
loan_events
invite_tokens
audit_logs
```

`rate_references` 当前不是核心必需。

不要创建/依赖旧 v1：

```text
loan_accounts
loan_terms
change_requests
```

### A5. 建立必需 indexes

先生成权威计划：

```bash
npm run schema:plan -w @family-ledger/cloud-ledger -- --env cloudbase-d4gza0wljf6505629
```

按输出执行 `tcb db nosql execute ... createIndexes ...` 命令。

控制台最终应看到：

```text
users
  uniq_openid                         UNIQUE

loans
  uniq_created_from_request           UNIQUE
  lender_status_created_cursor
  borrower_status_created_cursor

ledger_requests
  uniq_idempotency_key                UNIQUE
  counterparty_status_created_cursor
  proposer_status_created_cursor
  loan_created_cursor

loan_events
  uniq_event_idempotency_key          UNIQUE
  uniq_loan_sequence                  UNIQUE
  source_request_lookup               NON-UNIQUE

invite_tokens
  uniq_token_hash                     UNIQUE
```

### A6. 部署 `ledger` 云函数

推荐只用 CloudBase CLI 部署本项目的 bundled function，不要在微信开发者工具里把 `cloud/functions/ledger/src` 直接上传。

```bash
npm i -g @cloudbase/cli
tcb login

export CLOUDBASE_ENV_ID=cloudbase-d4gza0wljf6505629
npm run bundle -w @family-ledger/cloud-ledger
tcb deploy --yes
```

控制台确认：

```text
name       ledger
handler    index.main
runtime    Nodejs20.19
timeout    20s
memory     256MB
```

### A7. 可选但强烈建议：真实 CloudBase persistence smoke

只在确认该环境是可清理的开发环境后执行。

脚本需要管理员凭证，并有双重 mutation guard：

```bash
export CLOUDBASE_ENV_ID=cloudbase-d4gza0wljf6505629
export R12D_ALLOW_MUTATION=cloudbase-d4gza0wljf6505629

# 二选一：
export CLOUDBASE_APIKEY='...'
# 或：
export TENCENTCLOUD_SECRETID='...'
export TENCENTCLOUD_SECRETKEY='...'

npm run r12d:smoke -w @family-ledger/cloud-ledger
```

预期最后看到：

```text
R12D CloudBase persistence smoke PASS
```

这个 smoke 验证真实 CloudBase 唯一索引、事务、event sequence 和 rollback，但它使用 synthetic OPENID，**不能替代下面的真实微信双账号测试**。

---

## B. 准备两个真实微信测试账号

建议：

- A = 你的开发者/管理员微信；
- B = 家人或另一个微信号；
- 可选 C = 第三个账号，用于“错误领取邀请 / 并发领取”测试。

### B1. 微信开发者工具导入

导入目录：

```text
FamilyLedger/miniprogram
```

确认 AppID：

```text
wxa6b778821b3ccbc9
```

编译后先确认模拟器首页没有 `invalid env` 或 `function not exists`。

### B2. A 账号快速预览

微信开发者工具点击 `预览`，A 扫二维码。

只做最小 smoke：

- 首页能打开；
- `ensureUser` 成功；
- CloudBase `users` 中只出现一个属于 A 的用户；
- 重新进入不会重复创建 User。

### B3. 给 B 使用体验版

因为 B 不是当前开发者，推荐使用体验版而不是开发者预览二维码：

1. 微信开发者工具点击 `上传`；
2. 建议版本号 `0.12.0-r12d`，备注 `R12D bilateral ledger device test`；
3. 登录 `mp.weixin.qq.com` 对应的小程序；
4. 在版本管理中把刚上传的开发版本设为体验版；
5. 在成员/体验成员管理中把 B 加为体验成员；
6. B 用体验版二维码打开小程序。

如使用 C，也将 C 加入体验成员。

---

## C. 双账号核心验收顺序

为了排错清晰，按下面顺序执行，不要一次性乱点所有功能。

### C1. 身份基线

A、B 分别打开首页。

数据库预期：

- `users` 中 A/B 各一个 User；
- 同一账号重复进入不生成第二个 User；
- UI/API 返回中不出现 OPENID。

如果出现 `UNAUTHENTICATED`，立即停止测试并查看 `ledger` 云函数日志；**不要通过客户端传 openid 来绕过问题**。

### C2. 第一次往来：A 借给 B

A：

1. `新建一笔往来`；
2. `新联系人`；
3. `我借给别人`；
4. 测试金额建议 `100.00` 元；
5. 年利率建议 `5`%；
6. 生效日期今天；
7. 点击 `发起确认`；
8. 点击 `发送给微信好友`，发给 B。

B：

1. 从 A 的真实微信分享打开；
2. 应直接进入邀请确认页；
3. 检查 A、金额、利率、日期；
4. 接受邀请。

此时先不要让 A 确认身份。

CloudBase 预期：

- request = `PENDING_INITIATOR_VERIFY`；
- `counterpartyUserId` 已绑定 B；
- invite = CLAIMED；
- **还没有 Loan**；
- **还没有 genesis LoanEvent**。

然后 A：

1. 首页 → `待确认与已发起`；
2. 看到 B 的名字；
3. `确认是这位对方`。

确认后预期：

- exactly 1 ACTIVE Loan；
- lender = A；
- borrower = B；
- exactly 2 genesis events；
- sequence = 1 `PRINCIPAL_ADD`；
- sequence = 2 `RATE_CHANGE`；
- 两个 event `sourceRequestId` 相同；
- request = `APPLIED`。

A/B 两台手机打开该 Loan，金额与正式事件历史应一致，只是 A 显示“别人欠我的”，B 显示“我欠别人的”。

### C3. 反方向：B 借给 A

B 再创建一笔：

- 新联系人或已有往来人均可；
- 选择 `我借给别人`；
- A 接受。

最终验证同一个真实 User 可以在一笔 Loan 中是 borrower，在另一笔 Loan 中是 lender；不存在全局角色。

### C4. 已有往来人直接创建第二笔 Loan

A：

1. 新建往来；
2. `已有往来人`；
3. 选择 B；
4. 创建一笔小额 Loan。

B：

- `待确认与已发起` → 接受。

预期：

- 不再需要 bearer invite；
- 直接生成一笔新的 Loan + 两个 genesis events；
- 与第一笔 Loan 完全独立。

### C5. 发起请求可见 + 可取消

A 在某个 ACTIVE Loan 里发起 `新增本金`，先不要让 B 接受。

预期：

- A 在 `我发起的 · 等待对方确认` 看得到；
- B 在 `待我处理` 看得到；
- A 可以取消；
- 取消后两边都不再显示；
- `loan_events` 不新增正式 event。

### C6. 新增本金 / 拒绝 / 接受

A 发起新增本金 ¥10：

- 先让 B 拒绝一次 → 不应有 event；
- 再发起一次，让 B 接受 → exactly 1 `PRINCIPAL_ADD` event。

A/B 刷新后本金与总额一致。

### C7. 归还本金

B 或 A 发起归还本金，例如 ¥20，对方接受。

预期：

- exactly 1 `PRINCIPAL_REPAY`；
- principal 正确下降；
- 不允许归还超过合法本金；
- 重复点击/网络重试不能生成重复 event。

### C8. 利率变更

任一方发起利率改为例如 3%，对方接受。

预期：

- exactly 1 `RATE_CHANGE`；
- 双方详情显示相同当前利率；
- 原历史不被修改。

### C9. Correction

先做本金更正：

- 发起方必须从正式历史中选 target event；
- 对方确认页必须显示被更正 event 的日期/类型/原值；
- 接受后只新增一个 `CORRECTION`；
- target event 本身保持原样。

再做一次 rate Correction，验证同样行为。

### C10. 结清

为了简化测试，可选一笔 `0%` 或短期测试 Loan。

1. 把本金通过已确认 repayment 归还到 0；
2. 发起 `结清账本`；
3. 对方确认。

预期：

- exactly 1 `LOAN_CLOSED`；
- Loan = CLOSED；
- close event 保存 settlement snapshot；
- 当前 principal/interest/total = 0；
- 关闭前历史仍可读；
- 关闭后不再出现正常变更入口，也不能应用旧 pending mutation。

---

## D. 第三个账号 C 的安全测试

### D1. 错误领取邀请

A 发一个准备给 B 的 first-contact invite，但让 C 先打开并接受。

预期：

- C 成为唯一 claimant；
- B 后续不能再领取；
- A 在身份确认页看到 C；
- A 选择“不是这位对方，取消本次邀请”；
- 不创建 Loan/event。

### D2. 并发领取

A 新建一个 first-contact invite，把链接同时给 B/C，尽量同时点接受。

预期：

- 只能有一个赢家；
- loser 收到安全错误；
- request 只有一个 counterparty；
- invite 只有一个 claimant；
- A 未确认前仍然没有 Loan。

---

## E. 测试时建议盯住的 CloudBase 数据

每做一步都不需要查全部文档，重点检查：

```text
users
  openid 唯一

ledger_requests
  PENDING → APPLIED / REJECTED / CANCELLED
  PENDING_INITIATOR_VERIFY → APPLIED / CANCELLED

invite_tokens
  只有 tokenHash
  绝不能出现 rawToken 明文字段

loans
  lenderUserId / borrowerUserId 正确
  status 正确
  nextEventSequence 与实际正式 event 序列一致

loan_events
  append-only
  sequence 在每个 Loan 内严格递增
  sourceRequestId 正确
  同一正式动作不重复
```

---

## F. 一旦遇到这些错误，先停止业务测试

### `invalid env` / `非法的 env`

先检查：

- `miniprogram/config.js` env ID；
- CloudBase 控制台的小程序 AppID 关联；
- 是否打开了错误的 CloudBase 环境。

### `function not exists`

确认 `ledger` 已部署到同一个环境，且 handler 为 `index.main`。

### `UNAUTHENTICATED`

查看云函数日志，确认真实微信调用上下文是否带 OPENID。不要增加客户端 `openid` 参数作为修复。

### 查询提示缺索引 / index not found

停止测试，先按 `schema:plan` 补齐索引。

### 数据出现半套提交

例如：

- 有 Loan 但 request 仍 PENDING；
- 只有一个 genesis event；
- event 写入但 sequence counter 没同步；

立即停止真机测试，保存相关 request/loan/event ID 和云函数日志。这属于 R12D release blocker。

---

## G. 当前安全审计状态

截至本清单生成时：

- workspace CI 在 Node 20.19.x 下通过 build/typecheck/test；
- runtime dependency audit 没有 critical；
- 仍有 4 high + 1 moderate，来自当前 CloudBase SDK 依赖链中的 axios / lodash.set / lodash.unset；
- 这些问题不阻止对**可丢弃开发环境**进行 R12D 真机验证；
- 但正式上线前必须完成 CloudBase SDK/依赖安全处置记录；
- 不允许使用 `npm audit fix --force` 盲目降级/破坏 SDK。

---

## 真机阶段结束的通过标准

只有以下全部通过，才可以把 PR #12 从 Draft release gate 往前推进：

- A/B 真实 OPENID 身份正确且唯一；
- first-contact 双方向通过；
- known-counterparty 第二笔 Loan 通过；
- invite 分享真实打开 bind 页；
- pending accept/reject/cancel 通过；
- add/repay/rate/correction/close 通过；
- C 的错误领取/并发领取单赢家通过；
- CloudBase transaction/rollback smoke 通过；
- 数据库唯一索引和 event sequence 与设计一致；
- 未发现 v1 family/admin runtime dependency；
- 所有 blocker 都有明确记录和修复。
