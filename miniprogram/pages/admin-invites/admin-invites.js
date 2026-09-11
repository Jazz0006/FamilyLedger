const { callLedger } = require('../../utils/api.js');

// 邀请管理 (spec §17): 曾骏 为新家庭成员创建一次性邀请。
// 采用 auto-create-on-bind：管理员输入称呼创建邀请，家人点击“确认是我”后
// 才自动创建其账户与借款关系。服务端只存 token 哈希 (spec §15)。
Page({
  data: {
    displayName: '',
    creating: false,
    error: '',
    // The most recently created invite link, shown once for sharing.
    inviteLink: '',
  },

  onNameInput(e) {
    this.setData({ displayName: e.detail.value });
  },

  async createInvite() {
    const name = (this.data.displayName || '').trim();
    if (!name) {
      this.setData({ error: '请先输入称呼，例如“妈妈”' });
      return;
    }
    this.setData({ creating: true, error: '', inviteLink: '' });
    try {
      const res = await callLedger('createInvite', { displayName: name });
      // The raw token is returned once; build a shareable path for the bind
      // page. In practice this becomes a miniprogram link / QR the family
      // member opens. Shown here so the admin can copy it.
      const link = `/pages/bind/bind?token=${encodeURIComponent(res.rawToken)}`;
      this.setData({ creating: false, inviteLink: link, displayName: '' });
    } catch (err) {
      this.setData({ creating: false, error: err.message || '创建失败' });
    }
  },

  copyLink() {
    wx.setClipboardData({ data: this.data.inviteLink });
  },
});
