const { callLedger } = require('../../utils/api.js');
const {
  ledgerToday,
  makeIdempotencyKey,
  parseYuanToFen,
  percentToRateString,
} = require('../../utils/input.js');

Page({
  data: {
    loading: true,
    error: '',
    submitting: false,
    known: [],
    knownIndex: 0,
    mode: 'FIRST',
    direction: 'LEND',
    amountYuan: '',
    ratePercent: '0',
    effectiveDate: ledgerToday(),
    note: '',
    success: '',
    invitePath: '',
  },

  onLoad() {
    this.loadKnown();
  },

  async loadKnown() {
    try {
      await callLedger('ensureUser');
      const result = await callLedger('listKnownCounterparties', {});
      this.setData({
        loading: false,
        known: (result.items || []).map((item) => ({
          userId: item.user.userId,
          displayName: item.user.displayName,
        })),
      });
    } catch (err) {
      this.setData({ loading: false, error: err.message || '加载失败' });
    }
  },

  chooseMode(e) {
    this.setData({ mode: e.currentTarget.dataset.mode, error: '', success: '', invitePath: '' });
  },

  chooseDirection(e) {
    this.setData({ direction: e.currentTarget.dataset.direction, error: '', success: '', invitePath: '' });
  },

  onKnownChange(e) {
    this.setData({ knownIndex: Number(e.detail.value) });
  },

  onAmountInput(e) {
    this.setData({ amountYuan: e.detail.value });
  },

  onRateInput(e) {
    this.setData({ ratePercent: e.detail.value });
  },

  onDateChange(e) {
    this.setData({ effectiveDate: e.detail.value });
  },

  onNoteInput(e) {
    this.setData({ note: e.detail.value });
  },

  async submit() {
    if (this.data.submitting) return;
    this.setData({ submitting: true, error: '', success: '', invitePath: '' });
    try {
      const initialPrincipalFen = parseYuanToFen(this.data.amountYuan);
      const rate = {
        annualEffectiveRate: percentToRateString(this.data.ratePercent),
        rateSource: 'MANUAL',
      };
      const counterpartyRole = this.data.direction === 'LEND' ? 'BORROWER' : 'LENDER';
      const common = {
        initialPrincipalFen,
        rate,
        proposedEffectiveDate: this.data.effectiveDate,
        note: (this.data.note || '').trim() || null,
      };

      if (this.data.mode === 'KNOWN') {
        const selected = this.data.known[this.data.knownIndex];
        if (!selected) throw new Error('请选择已有往来人');
        await callLedger('createKnownLoanRequest', {
          ...common,
          counterpartyUserId: selected.userId,
          counterpartyRole,
          idempotencyKey: makeIdempotencyKey('create-known-loan'),
        });
        this.setData({
          submitting: false,
          success: `已发给 ${selected.displayName}，等待对方确认后才会记入正式账本。`,
        });
        return;
      }

      const request = await callLedger('createLoanRequest', {
        ...common,
        unknownPartyRole: counterpartyRole,
        idempotencyKey: makeIdempotencyKey('create-first-loan'),
      });
      const invite = await callLedger('createLoanInvite', { requestId: request._id });
      const invitePath = `/pages/bind/bind?token=${encodeURIComponent(invite.rawToken)}`;
      this.setData({
        submitting: false,
        invitePath,
        success: '邀请已生成。把邀请发给对方；对方接受后，你还需要再确认一次身份。',
      });
    } catch (err) {
      this.setData({ submitting: false, error: err.message || '提交失败' });
    }
  },

  copyInvite() {
    if (!this.data.invitePath) return;
    wx.setClipboardData({ data: this.data.invitePath });
  },

  onShareAppMessage() {
    return {
      title: '请确认这笔来往账',
      path: this.data.invitePath || '/pages/home/home',
    };
  },
});
