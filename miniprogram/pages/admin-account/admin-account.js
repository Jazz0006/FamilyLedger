const { callLedger } = require('../../utils/api.js');

// 成员账本 (spec §9, §17): 全部事件、发起新增本金 / 归还本金。
// 发起后进入 PENDING，需对方确认（spec Rule B）。
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

  // TODO(impl): forms for PRINCIPAL_ADD / PRINCIPAL_REPAY that call
  // 'proposeChange' with a client-generated idempotencyKey (uuid). Buttons must
  // state action + amount, e.g. “发起新增本金 ¥20,000” (spec §22).
  proposeAdd() {
    this.setData({ error: '尚未实现：发起新增本金（待接入 proposeChange）' });
  },
  proposeRepay() {
    this.setData({ error: '尚未实现：发起归还本金（待接入 proposeChange）' });
  },
});
