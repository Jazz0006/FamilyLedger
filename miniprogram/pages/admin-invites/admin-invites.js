const { callLedger } = require('../../utils/api.js');

// 邀请管理 (spec §17): 曾骏 创建 / 重发一次性邀请。
Page({
  data: { loading: false, error: '', members: [] },

  onShow() {
    this.load();
  },

  async load() {
    this.setData({ loading: true, error: '' });
    try {
      const res = await callLedger('listMembers');
      this.setData({ loading: false, members: res.members || [] });
    } catch (err) {
      this.setData({ loading: false, error: err.message || '加载失败' });
    }
  },

  // TODO(impl): 'createInvite' returns a one-time token; server stores only its
  // hash (spec §15). Present a shareable invite path/QR for the family member.
  createInvite(e) {
    const { userid } = e.currentTarget.dataset;
    void userid;
    this.setData({ error: '尚未实现：创建邀请（待接入 createInvite）' });
  },
});
