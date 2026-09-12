function parseYuanToFen(value) {
  const text = String(value == null ? '' : value).trim();
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) throw new Error('金额请输入数字，最多两位小数');
  const whole = Number(match[1]);
  const cents = Number((match[2] || '').padEnd(2, '0'));
  const fen = whole * 100 + cents;
  if (!Number.isSafeInteger(fen) || fen <= 0) {
    throw new Error('金额必须大于 0 且不能过大');
  }
  return fen;
}

function percentToRateString(value) {
  const text = String(value == null ? '' : value).trim();
  const match = /^(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match) throw new Error('年利率请输入非负数字');
  const digits = `${match[1]}${match[2] || ''}`.replace(/^0+(?=\d)/, '');
  const scale = (match[2] || '').length + 2;
  const padded = digits.padStart(scale + 1, '0');
  const point = padded.length - scale;
  const whole = padded.slice(0, point) || '0';
  const fraction = padded.slice(point).replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole;
}

function formatRatePercent(rate) {
  const numeric = Number(rate || 0) * 100;
  if (!Number.isFinite(numeric)) return '';
  return numeric.toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
}

function makeIdempotencyKey(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function secureRandomToken() {
  return new Promise((resolve, reject) => {
    if (!wx.getRandomValues || !wx.arrayBufferToBase64) {
      reject(new Error('当前微信版本不支持安全邀请凭证，请升级微信后重试'));
      return;
    }
    wx.getRandomValues({
      length: 32,
      success(res) {
        try {
          const base64 = wx.arrayBufferToBase64(res.randomValues);
          const token = base64
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=+$/, '');
          if (!/^[A-Za-z0-9_-]{43}$/.test(token)) {
            throw new Error('安全邀请凭证格式异常');
          }
          resolve(token);
        } catch (err) {
          reject(err instanceof Error ? err : new Error('无法生成安全邀请凭证'));
        }
      },
      fail(err) {
        reject(new Error((err && err.errMsg) || '无法生成安全邀请凭证'));
      },
    });
  });
}

function ledgerToday() {
  return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

module.exports = {
  parseYuanToFen,
  percentToRateString,
  formatRatePercent,
  makeIdempotencyKey,
  secureRandomToken,
  ledgerToday,
};
