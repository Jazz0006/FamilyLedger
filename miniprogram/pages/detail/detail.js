const { callLedger } = require('../../utils/api.js');
const { formatFen } = require('../../utils/money.js');
const {
  formatRatePercent,
  ledgerToday,
  makeIdempotencyKey,
  parseYuanToFen,
  percentToRateString,
} = require('../../utils/input.js');

function eventPresentation(event) {
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
  return { title, value };
}

function mapEvent(event) {
  const display = eventPresentation(event);
  return {
    id: event._id,
    title: display.title,
    value: display.value,
    effectiveDate: event.effectiveDate,
    sequence: event.sequence,
  };
}

function correctionTargets(events) {
  const principal = [];
  const rateWinnerByDate = new Map();

  events.forEach((event) => {
    const display = eventPresentation(event);
    const label = `${event.effectiveDate} · ${display.title} ${display.value}`;
    const principalAffecting =
      event.eventType === 'PRINCIPAL_ADD' ||
      event.eventType === 'PRINCIPAL_REPAY' ||
      (event.eventType === 'CORRECTION' && event.amountFen != null);
    if (principalAffecting) {
      principal.push({ eventId: event._id, label, sequence: event.sequence });
    }

    const rateAffecting =
      (event.eventType === 'RATE_CHANGE' || event.eventType === 'CORRECTION') &&
      event.rate != null &&
      event.amountFen == null;
    if (rateAffecting) {
      const current = rateWinnerByDate.get(event.effectiveDate);
      if (!current || event.sequence > current.event.sequence) {
        rateWinnerByDate.set(event.effectiveDate, { event, label });
      }
    }
  });

  const rate = [...rateWinnerByDate.values()]
    .sort((a, b) => a.event.sequence - b.event.sequence)
    .map(({ event, label }) => ({ eventId: event._id, label, sequence: event.sequence }));
  return { principal, rate };
}

function latestEffectiveDate(events) {
  return events.reduce(
    (latest, event) => (!latest || event.effectiveDate > latest ? event.effectiveDate : latest),
    '',
  );
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
    today: ledgerToday(),
    principalTargets: [],
    principalTargetIndex: 0,
    rateTargets: [],
    rateTargetIndex: 0,
    mutationOpen: false,
    mutationType: 'REPAY',
    mutationAmountYuan: '',
    mutationRatePercent: '',
    mutationDate: ledgerToday(),
    mutationNote: '',
    correctionDirection: 'ADD',
    mutationSubmitting: false,
    mutationSubmitted: false,
    mutationKey: '',
    mutationSuccess: '',
    canClose: false,
    closeMinDate: ledgerToday(),
    closeBlockReason: '',
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
      const targets = correctionTargets(events);
      const today = ledgerToday();
      const latestDate = latestEffectiveDate(events);
      const active = view.loan.status === 'ACTIVE';
      const zeroPrincipal = view.summary.principalFen === 0;
      const noFutureFormalEvent = !latestDate || latestDate <= today;
      const canClose = active && zeroPrincipal && noFutureFormalEvent;
      let closeBlockReason = '';
      if (!active) closeBlockReason = '账本已经结清';
      else if (!zeroPrincipal) closeBlockReason = '结清前必须先把本金归还到 0';
      else if (!noFutureFormalEvent) closeBlockReason = `已有 ${latestDate} 生效的未来正式记录，当前不能结清`;

      this.setData({
        loading: false,
        today,
        canClose,
        closeMinDate: latestDate && latestDate <= today ? latestDate : today,
        closeBlockReason,
        loan: {
          counterpartyName: view.counterparty.displayName,
          directionLabel: view.direction === 'LENDER' ? '别人欠我的' : '我欠别人的',
          status: view.loan.status,
          statusLabel: view.loan.status === 'CLOSED' ? '已结清' : '进行中',
          total: formatFen(view.summary.totalFen),
          principal: formatFen(view.summary.principalFen),
          interest: formatFen(view.summary.interestFen),
          todayInterest: formatFen(view.summary.todayInterestFen),
          rate: formatRatePercent(view.summary.currentRate.annualEffectiveRate),
          asOfDate: view.summary.asOfDate,
        },
        events: events.map(mapEvent),
        principalTargets: targets.principal,
        rateTargets: targets.rate,
      });
    } catch (err) {
      this.setData({ loading: false, error: err.message || '加载失败' });
    }
  },

  openMutations() {
    if (!this.data.loan || this.data.loan.status !== 'ACTIVE') return;
    this.setData({ mutationOpen: true, mutationSuccess: '', error: '' });
  },

  closeMutations() {
    this.setData({
      mutationOpen: false,
      mutationSuccess: '',
      error: '',
      mutationSubmitted: false,
      mutationSubmitting: false,
      mutationKey: '',
    });
  },

  resetMutation(patch) {
    this.setData({
      ...patch,
      error: '',
      mutationSuccess: '',
      mutationSubmitted: false,
      mutationKey: '',
    });
  },

  chooseMutation(e) {
    this.resetMutation({
      mutationType: e.currentTarget.dataset.type,
      mutationAmountYuan: '',
      mutationRatePercent: '',
      mutationDate: this.data.today,
      mutationNote: '',
      correctionDirection: 'ADD',
      principalTargetIndex: 0,
      rateTargetIndex: 0,
    });
  },

  chooseCorrectionDirection(e) {
    this.resetMutation({ correctionDirection: e.currentTarget.dataset.direction });
  },

  onMutationAmount(e) {
    this.resetMutation({ mutationAmountYuan: e.detail.value });
  },

  onMutationRate(e) {
    this.resetMutation({ mutationRatePercent: e.detail.value });
  },

  onMutationDate(e) {
    this.resetMutation({ mutationDate: e.detail.value });
  },

  onMutationNote(e) {
    this.resetMutation({ mutationNote: e.detail.value });
  },

  onPrincipalTarget(e) {
    this.resetMutation({ principalTargetIndex: Number(e.detail.value) });
  },

  onRateTarget(e) {
    this.resetMutation({ rateTargetIndex: Number(e.detail.value) });
  },

  async submitMutation() {
    if (this.data.mutationSubmitting || this.data.mutationSubmitted) return;
    this.setData({ mutationSubmitting: true, error: '', mutationSuccess: '' });
    try {
      const type = this.data.mutationType;
      const key = this.data.mutationKey || makeIdempotencyKey(`loan-${type.toLowerCase()}`);
      if (!this.data.mutationKey) this.setData({ mutationKey: key });
      const note = (this.data.mutationNote || '').trim() || null;
      const common = { loanId: this.data.loanId, idempotencyKey: key };

      if (type === 'REPAY' || type === 'ADD') {
        const action = type === 'REPAY' ? 'createRepaymentRequest' : 'createPrincipalAddRequest';
        await callLedger(action, {
          ...common,
          amountFen: parseYuanToFen(this.data.mutationAmountYuan),
          proposedEffectiveDate: this.data.mutationDate,
          note,
        });
      } else if (type === 'RATE') {
        await callLedger('createRateChangeRequest', {
          ...common,
          rate: {
            annualEffectiveRate: percentToRateString(this.data.mutationRatePercent),
            rateSource: 'MANUAL',
          },
          proposedEffectiveDate: this.data.mutationDate,
          note,
        });
      } else if (type === 'CORRECT_PRINCIPAL') {
        const target = this.data.principalTargets[this.data.principalTargetIndex];
        if (!target) throw new Error('请选择要更正的本金记录');
        const amountFen = parseYuanToFen(this.data.mutationAmountYuan);
        await callLedger('createCorrectionRequest', {
          ...common,
          correctionKind: 'PRINCIPAL',
          targetEventId: target.eventId,
          principalDeltaFen: this.data.correctionDirection === 'ADD' ? amountFen : -amountFen,
          reason: note,
        });
      } else if (type === 'CORRECT_RATE') {
        const target = this.data.rateTargets[this.data.rateTargetIndex];
        if (!target) throw new Error('请选择要更正的利率记录');
        await callLedger('createCorrectionRequest', {
          ...common,
          correctionKind: 'RATE',
          targetEventId: target.eventId,
          replacementRate: {
            annualEffectiveRate: percentToRateString(this.data.mutationRatePercent),
            rateSource: 'MANUAL',
          },
          reason: note,
        });
      } else if (type === 'CLOSE') {
        if (!this.data.canClose) throw new Error(this.data.closeBlockReason || '当前不能结清');
        await callLedger('createCloseLoanRequest', {
          ...common,
          proposedEffectiveDate: this.data.mutationDate,
          note,
        });
      } else {
        throw new Error('未知变更类型');
      }

      this.setData({
        mutationSubmitting: false,
        mutationSubmitted: true,
        mutationSuccess: `已发给 ${this.data.loan.counterpartyName}，等待对方确认后才会写入正式账本。`,
      });
    } catch (err) {
      // Keep mutationKey so retrying the unchanged form is the same request.
      this.setData({
        mutationSubmitting: false,
        error: err.message || '发起变更失败',
      });
    }
  },
});
