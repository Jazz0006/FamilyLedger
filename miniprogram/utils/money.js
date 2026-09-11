// Display-only money formatting. Amounts arrive from the server as integer 分.
// The miniprogram NEVER computes balances — it renders server figures so that
// the calc engine (@family-ledger/calc) remains the single source of truth
// (spec §18). This file only formats already-computed 分 values.

/** Format integer 分 as a ¥ string, e.g. 10500000 -> "¥105,000.00". */
function formatFen(fen) {
  const negative = fen < 0;
  const abs = Math.abs(fen | 0);
  const yuan = Math.floor(abs / 100);
  const cents = abs % 100;
  const yuanStr = yuan.toLocaleString('en-US');
  const centStr = cents < 10 ? '0' + cents : '' + cents;
  return (negative ? '-¥' : '¥') + yuanStr + '.' + centStr;
}

module.exports = { formatFen };
