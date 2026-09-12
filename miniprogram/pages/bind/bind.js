const { callLedger } = require('../../utils/api.js');
const { formatFen } = require('../../utils/money.js');
const { formatRatePercent } = require('../../utils/input.js');

Page({
  data: {
    rawToken: '',
    loading: true,
    accepting: false,
    error: '',
    preview: null,
    accepted: false,
  },

  onLoad(query) {
    const rawToken = query.token || (query.scene ? decodeURIComponent(query.scene) : '');
    this.setData({ rawToken });
    this.loadPreview();
  },

  async loadPreview() {
    if (!this.data.rawToken) {
      this.setData({ loading: false, error: '邀请链接缺少凭证' });
      return;
    }
    try {
      const preview = await callLedger('previewInvite', { rawToken: this.data.rawToken });
      this.setData({
        loading: false,
        preview: {
          proposerName: preview.proposer.displayName,
          relationText:
            preview.unknownPartyRole === 'BORROWER'
              ? `${preview.proposer.displayName} 拟借给你`
              : `你拟借给 ${preview.proposer.displayName}`,
          principal: formatFen(preview.initialPrincipalFen),
          rate: formatRatePercent(preview.rate.annualEffectiveRate),
          effectiveDate: preview.proposedEffectiveDate,
          note: preview.note || '',
        },
      });
    } catch (err) {
      this.setData({ loading: false, error: err.message || '邀请无效或已过期' });
    }
  },

  async accept() {
    if (this.data.accepting) return;
    this.setData({ accepting: true, error: '' });
    try {
      await callLedger('acceptInviteRequest', { rawToken: this.data.rawToken });
      this.setData({ accepting: false, accepted: true });
    } catch (err) {
      this.setData({ accepting: false, error: err.message || '接受邀请失败' });
    }
  },

  goHome() {
    wx.reLaunch({ url: '/pages/home/home' });
  },
});
