const { callLedger } = require('../../utils/api.js');
const { formatFen } = require('../../utils/money.js');

// 家庭总览 (spec §9, §17): 曾骏 视角，全家合计 + 成员卡片。
Page({
  data: { loading: true, error: '', members: [], totalDue: '' },

  onShow() {
    this.load();
  },

  async load() {
    this.setData({ loading: true, error: '' });
    try {
      // TODO(impl): server 'getFamilyOverview' — admin-only, verified by role
      // in users collection (never trust client role, spec §15).
      const res = await callLedger('getFamilyOverview');
      this.setData({
        loading: false,
        totalDue: formatFen(res.familyTotalDueFen),
        members: (res.members || []).map((m) => ({
          ...m,
          totalDue: formatFen(m.totalDueFen),
        })),
      });
    } catch (err) {
      this.setData({ loading: false, error: err.message || '加载失败' });
    }
  },

  openAccount(e) {
    const { loanid } = e.currentTarget.dataset;
    wx.navigateTo({ url: '/pages/admin-account/admin-account?loanId=' + loanid });
  },
});
