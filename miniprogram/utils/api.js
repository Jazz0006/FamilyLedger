// Thin wrapper over wx.cloud.callFunction for the single `ledger` router.
// Returns the server's { ok, data } envelope; throws an Error with .code on
// failure so pages can map codes to friendly, elder-readable messages.

function callLedger(action, payload) {
  return new Promise((resolve, reject) => {
    wx.cloud.callFunction({
      name: 'ledger',
      data: { action, payload },
      success: (res) => {
        const result = res && res.result;
        if (result && result.ok) {
          resolve(result.data);
        } else {
          const err = new Error((result && result.message) || '请求失败');
          err.code = (result && result.code) || 'INTERNAL';
          reject(err);
        }
      },
      fail: (err) => {
        const e = new Error(err.errMsg || '网络错误');
        e.code = 'NETWORK';
        reject(e);
      },
    });
  });
}

module.exports = { callLedger };
