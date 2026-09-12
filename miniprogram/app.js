// 来往账 — WeChat Mini Program app shell.
App({
  onLaunch() {
    if (!wx.cloud) {
      console.error('请使用 2.2.3 或以上的基础库以使用云能力');
      return;
    }
    wx.cloud.init({
      // Use the CloudBase environment bound to this Mini Program.
      env: wx.cloud.DYNAMIC_CURRENT_ENV,
      traceUser: true,
    });
  },
  globalData: {},
});
