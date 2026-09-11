const { callLedger } = require('../../utils/api.js');
const { formatFen } = require('../../utils/money.js');

// 待确认卡/页 (spec §10): 明确金额和动作后确认/拒绝。
Page({
  data: { loading: true, error: '', requests: [] },

  onShow() {
    this.load();
  },

  async load() {
    this.setData({ loading: true, error: '' });
    try {
      // TODO(impl): server action 'getPendingRequests' returns requests where
      // requiredConfirmer == caller.
      const res = await callLedger('getPendingRequests');
      this.setData({
        loading: false,
        requests: (res.requests || []).map((r) => ({
          ...r,
          amount: r.amountFen == null ? '' : formatFen(r.amountFen),
          // Buttons must state action + amount (spec §22).
          confirmLabel: this.buildLabel(r),
        })),
      });
    } catch (err) {
      this.setData({ loading: false, error: err.message || '加载失败' });
    }
  },

  buildLabel(r) {
    const amt = r.amountFen == null ? '' : formatFen(r.amountFen);
    if (r.type === 'PRINCIPAL_ADD') return '确认新增本金 ' + amt;
    if (r.type === 'PRINCIPAL_REPAY') return '确认归还本金 ' + amt;
    if (r.type === 'RATE_CHANGE') return '确认利率调整';
    return '确认';
  },

  async decide(e) {
    const { id, approve } = e.currentTarget.dataset;
    try {
      await callLedger('confirmChange', {
        changeRequestId: id,
        approve: approve === 'true',
      });
      this.load();
    } catch (err) {
      this.setData({ error: err.message || '操作失败' });
    }
  },
});
