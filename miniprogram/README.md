# Miniprogram (WeChat native)

Display + request-initiation only. It never computes balances or writes the
ledger — it renders server-computed 分 amounts (spec §14, §18).

## Open in WeChat DevTools

1. Open [WeChat Developer Tools](https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html).
2. Import this `miniprogram/` directory as a Mini Program project.
3. Replace the `appid` placeholder (`touristappid`) in `project.config.json`
   with your real AppID, and set the CloudBase env in `app.js`.

## Pages (spec §17)

| Page | User | Purpose |
|---|---|---|
| `pages/bind` | member | one-tap 首次邀请绑定 |
| `pages/home` | member | 当前应还 / 本金 / 利息 / 今日增长 / 全家概览 |
| `pages/detail` | member | own transaction history (private) |
| `pages/confirm` | member / 曾骏 | confirm or reject pending changes |
| `pages/admin-family` | 曾骏 | family total + member cards |
| `pages/admin-account` | 曾骏 | one account's events + propose add/repay |
| `pages/admin-invites` | 曾骏 | create / resend one-time invites |

## Shared calc engine

`@family-ledger/calc` is the single source of truth for money math. If a screen
ever needs a live-ticking local estimate of "今日增加", do NOT re-implement the
formula here — bundle the built `packages/calc/dist` into the miniprogram (e.g.
via a `miniprogram_npm` build step) so frontend and backend stay byte-identical.
For V1 the home screen simply displays the server's computed figures.
