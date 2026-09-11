// 家庭借款账本 — app shell.
App({
  onLaunch() {
    if (!wx.cloud) {
      console.error('请使用 2.2.3 或以上的基础库以使用云能力');
      return;
    }
    wx.cloud.init({
      // TODO: replace with your CloudBase env id, or use DYNAMIC_CURRENT_ENV
      // when the miniprogram and cloud env are bound 1:1.
      env: wx.cloud.DYNAMIC_CURRENT_ENV,
      traceUser: true,
    });
  },
  globalData: {},
});
