// 来往账 — WeChat Mini Program app shell.
const { cloudbaseEnvId } = require('./config.js');

App({
  onLaunch() {
    if (!wx.cloud) {
      console.error('请使用 2.2.3 或以上的基础库以使用云能力');
      return;
    }
    wx.cloud.init({
      // Mini Program client SDK expects an explicit environment ID. The AppID
      // must be associated with this environment in CloudBase Security Settings.
      env: cloudbaseEnvId,
      traceUser: true,
    });
  },
  globalData: {},
});
