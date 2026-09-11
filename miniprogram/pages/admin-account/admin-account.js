const { callLedger } = require('../../utils/api.js');

// 成员账本 (spec §9, §17): 全部事件、录入新增本金 / 发起归还本金。
// v1.1 Rule B（按方向）：新增本金增加债务 -> 管理员直接录入、即时生效，无需确认；
// 归还本金减少债务 -> 管理员发起后需出借人确认。
Page({
  data: { loanId: '', loading: true, error: '', events: [] },

  onLoad(query) {
    this.setData({ loanId: query.loanId || '' });
  },

  onShow() {
    if (this.data.loanId) this.load();
  },

  async load() {
    this.setData({ loading: true, error: '' });
    try {
      const res = await callLedger('getAccountLedger', { loanId: this.data.loanId });
      this.setData({ loading: false, events: res.events || [] });
    } catch (err) {
      this.setData({ loading: false, error: err.message || '加载失败' });
    }
  },

  // TODO(impl): amount input + confirm dialog, then call the actions below with
  // a client-generated idempotencyKey (uuid). Buttons must state action +
  // amount, e.g. “录入新增本金 ¥20,000” / “发起归还本金 ¥30,000” (spec §22).

  // 新增本金：直接录入，即时生效，无需出借人确认 (v1.1 Rule B)。
  recordLodgment() {
    this.setData({ error: '尚未实现：录入新增本金（待接入 recordLodgment）' });
  },
  // 归还本金：发起后进入待确认，需出借人确认 (v1.1 Rule B)。
  proposeRepay() {
    this.setData({ error: '尚未实现：发起归还本金（待接入 proposeRepayment）' });
  },
});
