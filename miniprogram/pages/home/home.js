const { callLedger } = require('../../utils/api.js');
const { formatFen } = require('../../utils/money.js');
const { formatRatePercent } = require('../../utils/input.js');

function mapLoanView(view) {
  return {
    loanId: view.loan._id,
    counterpartyName: view.counterparty.displayName,
    direction: view.direction,
    directionLabel: view.direction === 'LENDER' ? '别人欠我的' : '我欠别人的',
    total: formatFen(view.summary.totalFen),
    principal: formatFen(view.summary.principalFen),
    interest: formatFen(view.summary.interestFen),
    rate: formatRatePercent(view.summary.currentRate.annualEffectiveRate),
  };
}

Page({
  data: {
    loading: true,
    error: '',
    summary: null,
    receivableLoans: [],
    payableLoans: [],
    pendingCount: 0,
  },

  onShow() {
    this.load();
  },

  onPullDownRefresh() {
    this.load().finally(() => wx.stopPullDownRefresh());
  },

  async load() {
    this.setData({ loading: true, error: '' });
    try {
      await callLedger('ensureUser');
      const [summary, receivable, payable] = await Promise.all([
        callLedger('getHomeSummary'),
        callLedger('listLoans', { direction: 'LENDER', status: 'ACTIVE', limit: 20 }),
        callLedger('listLoans', { direction: 'BORROWER', status: 'ACTIVE', limit: 20 }),
      ]);
      this.setData({
        loading: false,
        pendingCount: summary.pendingRequestCount,
        summary: {
          receivable: formatFen(summary.receivable.totalFen),
          receivablePrincipal: formatFen(summary.receivable.principalFen),
          payable: formatFen(summary.payable.totalFen),
          payablePrincipal: formatFen(summary.payable.principalFen),
        },
        receivableLoans: (receivable.items || []).map(mapLoanView),
        payableLoans: (payable.items || []).map(mapLoanView),
      });
    } catch (err) {
      this.setData({ loading: false, error: err.message || '加载失败' });
    }
  },

  goCreate() {
    wx.navigateTo({ url: '/pages/create/create' });
  },

  goConfirm() {
    wx.navigateTo({ url: '/pages/confirm/confirm' });
  },

  openLoan(e) {
    const loanId = e.currentTarget.dataset.loanid;
    wx.navigateTo({ url: `/pages/detail/detail?loanId=${encodeURIComponent(loanId)}` });
  },
});
