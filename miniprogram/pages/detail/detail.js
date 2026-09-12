const { callLedger } = require('../../utils/api.js');
const { formatFen } = require('../../utils/money.js');
const { formatRatePercent } = require('../../utils/input.js');

function mapEvent(event) {
  let title = event.eventType;
  let value = '';
  if (event.eventType === 'PRINCIPAL_ADD') {
    title = '新增本金';
    value = `+${formatFen(event.amountFen || 0)}`;
  } else if (event.eventType === 'PRINCIPAL_REPAY') {
    title = '归还本金';
    value = `-${formatFen(event.amountFen || 0)}`;
  } else if (event.eventType === 'RATE_CHANGE') {
    title = '调整利率';
    value = `${formatRatePercent(event.rate && event.rate.annualEffectiveRate)}%`;
  } else if (event.eventType === 'CORRECTION') {
    title = event.amountFen == null ? '利率更正' : '本金更正';
    value = event.amountFen == null
      ? `${formatRatePercent(event.rate && event.rate.annualEffectiveRate)}%`
      : `${event.amountFen >= 0 ? '+' : '-'}${formatFen(Math.abs(event.amountFen))}`;
  } else if (event.eventType === 'LOAN_CLOSED') {
    title = '账本结清';
    value = '已结清';
  }
  return {
    id: event._id,
    title,
    value,
    effectiveDate: event.effectiveDate,
    sequence: event.sequence,
  };
}

async function readAllEvents(loanId) {
  const events = [];
  let cursor = null;
  do {
    const page = await callLedger('listLoanEvents', { loanId, limit: 100, cursor });
    events.push(...(page.items || []));
    cursor = page.nextCursor || null;
  } while (cursor);
  return events;
}

Page({
  data: {
    loanId: '',
    loading: true,
    error: '',
    loan: null,
    events: [],
  },

  onLoad(query) {
    this.setData({ loanId: query.loanId || '' });
  },

  onShow() {
    if (this.data.loanId) this.load();
  },

  async load() {
    this.setData({ loading: true, error: '' });
    try {
      const [view, events] = await Promise.all([
        callLedger('getLoan', { loanId: this.data.loanId }),
        readAllEvents(this.data.loanId),
      ]);
      this.setData({
        loading: false,
        loan: {
          counterpartyName: view.counterparty.displayName,
          directionLabel: view.direction === 'LENDER' ? '别人欠我的' : '我欠别人的',
          statusLabel: view.loan.status === 'CLOSED' ? '已结清' : '进行中',
          total: formatFen(view.summary.totalFen),
          principal: formatFen(view.summary.principalFen),
          interest: formatFen(view.summary.interestFen),
          todayInterest: formatFen(view.summary.todayInterestFen),
          rate: formatRatePercent(view.summary.currentRate.annualEffectiveRate),
          asOfDate: view.summary.asOfDate,
        },
        events: events.map(mapEvent),
      });
    } catch (err) {
      this.setData({ loading: false, error: err.message || '加载失败' });
    }
  },
});
