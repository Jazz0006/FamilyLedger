const { callLedger } = require('../../utils/api.js');

// 首次邀请绑定 (spec §7): 一次点击“确认是我”。
Page({
  data: { token: '', displayName: '', loading: true, error: '', bound: false },

  async onLoad(query) {
    // The invite link carries a one-time token as a query param.
    const token = query.token || (query.scene ? decodeURIComponent(query.scene) : '');
    this.setData({ token });
    // Read-only preview so the screen can show
    // “这是你的家庭借款账户：妈妈/爸爸/姐姐” before the user confirms.
    try {
      const preview = await callLedger('previewInvite', { token });
      this.setData({
        displayName: preview.displayName,
        error: preview.valid ? '' : '邀请无效或已过期',
        loading: false,
      });
    } catch (err) {
      this.setData({ loading: false, error: err.message || '邀请无效' });
    }
  },

  async confirm() {
    this.setData({ loading: true, error: '' });
    try {
      const res = await callLedger('bindInvite', { token: this.data.token });
      this.setData({ bound: true, displayName: res.displayName, loading: false });
      wx.redirectTo({ url: '/pages/home/home' });
    } catch (err) {
      this.setData({ loading: false, error: err.message || '绑定失败' });
    }
  },
});
