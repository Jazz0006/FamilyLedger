const { callLedger } = require('../../utils/api.js');
const { formatFen } = require('../../utils/money.js');

// 我的明细 (spec §17): 自己的交易历史、月度增长（本人私有）。
Page({
  data: { loading: true, error: '', events: [] },

  onShow() {
    this.load();
  },

  async load() {
    this.setData({ loading: true, error: '' });
    try {
      // TODO(impl): server action 'getMyLedger' returns this caller's own
      // events + monthly growth only (never other members' line items).
      const res = await callLedger('getMyLedger');
      this.setData({
        loading: false,
        events: (res.events || []).map((e) => ({
          ...e,
          amount: e.amountFen == null ? '' : formatFen(e.amountFen),
        })),
      });
    } catch (err) {
      this.setData({ loading: false, error: err.message || '加载失败' });
    }
  },
});
