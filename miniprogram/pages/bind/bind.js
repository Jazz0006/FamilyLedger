const { callLedger } = require('../../utils/api.js');

// 首次邀请绑定 (spec §7): 一次点击“确认是我”。
Page({
  data: { token: '', displayName: '', loading: true, error: '', bound: false },

  onLoad(query) {
    // The invite link carries a one-time token as a query param.
    const token = query.token || (query.scene ? decodeURIComponent(query.scene) : '');
    this.setData({ token });
    // TODO(impl): optionally pre-fetch the invited displayName for confirmation
    // via a read-only "previewInvite" action so the screen can show
    // “这是你的家庭借款账户：妈妈/爸爸/姐姐”.
    this.setData({ loading: false });
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
