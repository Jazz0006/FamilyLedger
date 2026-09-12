const { callLedger } = require('../../utils/api.js');
const {
  ledgerToday,
  makeIdempotencyKey,
  parseYuanToFen,
  percentToRateString,
  secureRandomToken,
} = require('../../utils/input.js');

Page({
  data: {
    loading: true,
    error: '',
    submitting: false,
    submitted: false,
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
    submissionKey: '',
    inviteRawToken: '',
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

  resetDraft(patch) {
    this.setData({
      ...patch,
      error: '',
      success: '',
      invitePath: '',
      submitted: false,
      submissionKey: '',
      inviteRawToken: '',
    });
  },

  chooseMode(e) {
    this.resetDraft({ mode: e.currentTarget.dataset.mode, knownIndex: 0 });
  },

  chooseDirection(e) {
    this.resetDraft({ direction: e.currentTarget.dataset.direction });
  },

  onKnownChange(e) {
    this.resetDraft({ knownIndex: Number(e.detail.value) });
  },

  onAmountInput(e) {
    this.resetDraft({ amountYuan: e.detail.value });
  },

  onRateInput(e) {
    this.resetDraft({ ratePercent: e.detail.value });
  },

  onDateChange(e) {
    this.resetDraft({ effectiveDate: e.detail.value });
  },

  onNoteInput(e) {
    this.resetDraft({ note: e.detail.value });
  },

  async submit() {
    if (this.data.submitting || this.data.submitted) return;
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
      const prefix = this.data.mode === 'KNOWN' ? 'create-known-loan' : 'create-first-loan';
      const submissionKey = this.data.submissionKey || makeIdempotencyKey(prefix);
      if (!this.data.submissionKey) this.setData({ submissionKey });

      if (this.data.mode === 'KNOWN') {
        const selected = this.data.known[this.data.knownIndex];
        if (!selected) throw new Error('请选择已有往来人');
        await callLedger('createKnownLoanRequest', {
          ...common,
          counterpartyUserId: selected.userId,
          counterpartyRole,
          idempotencyKey: submissionKey,
        });
        this.setData({
          submitting: false,
          submitted: true,
          success: `已发给 ${selected.displayName}，等待对方确认后才会记入正式账本。`,
        });
        return;
      }

      const inviteRawToken = this.data.inviteRawToken || (await secureRandomToken());
      if (!this.data.inviteRawToken) this.setData({ inviteRawToken });

      const request = await callLedger('createLoanRequest', {
        ...common,
        unknownPartyRole: counterpartyRole,
        idempotencyKey: submissionKey,
      });
      const invite = await callLedger('createLoanInvite', {
        requestId: request._id,
        rawToken: inviteRawToken,
      });
      const invitePath = `/pages/bind/bind?token=${encodeURIComponent(invite.rawToken)}`;
      this.setData({
        submitting: false,
        submitted: true,
        invitePath,
        success: '邀请已生成。把邀请发给对方；对方接受后，你还需要再确认一次身份。',
      });
    } catch (err) {
      // Keep submissionKey / inviteRawToken intact. Retrying the unchanged form
      // is therefore the same logical mutation even when the previous response
      // was lost after the server committed it.
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
