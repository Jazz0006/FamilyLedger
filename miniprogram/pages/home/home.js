const { callLedger } = require('../../utils/api.js');
const { formatFen } = require('../../utils/money.js');

Page({
  data: {
    loading: true,
    error: '',
    mine: null, // formatted strings for display
    family: [],
    familyTotalDue: '',
    pendingCount: 0,
  },

  onShow() {
    this.load();
  },

  onPullDownRefresh() {
    this.load().then(() => wx.stopPullDownRefresh());
  },

  async load() {
    this.setData({ loading: true, error: '' });
    try {
      const summary = await callLedger('getHomeSummary');
      this.setData({
        loading: false,
        mine: summary.mine
          ? {
              displayName: summary.mine.displayName,
              totalDue: formatFen(summary.mine.totalDueFen),
              principal: formatFen(summary.mine.principalFen),
              interest: formatFen(summary.mine.interestFen),
              todayInterest: formatFen(summary.mine.todayInterestFen),
              rate: (Number(summary.mine.annualEffectiveRate) * 100).toFixed(2),
            }
          : null,
        family: summary.family.map((m) => ({
          displayName: m.displayName,
          principal: formatFen(m.principalFen),
          totalDue: formatFen(m.totalDueFen),
        })),
        familyTotalDue: formatFen(summary.familyTotalDueFen),
      });
    } catch (err) {
      // NOT_BOUND -> route to bind flow; otherwise show a friendly message.
      if (err.code === 'NOT_BOUND') {
        wx.redirectTo({ url: '/pages/bind/bind' });
        return;
      }
      this.setData({ loading: false, error: err.message || '加载失败' });
    }
  },

  goDetail() {
    wx.navigateTo({ url: '/pages/detail/detail' });
  },
});
