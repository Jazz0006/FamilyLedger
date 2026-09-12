const { callLedger } = require('../../utils/api.js');
const { formatFen } = require('../../utils/money.js');
const { formatRatePercent } = require('../../utils/input.js');

function requestDescription(request) {
  const payload = request.payload || {};
  switch (request.type) {
    case 'CREATE_LOAN':
      return `本金 ${formatFen(payload.initialPrincipalFen || 0)} · 年利率 ${formatRatePercent(payload.rate && payload.rate.annualEffectiveRate)}% · ${payload.proposedEffectiveDate}`;
    case 'PRINCIPAL_ADD':
      return `新增本金 ${formatFen(payload.amountFen || 0)} · ${payload.proposedEffectiveDate}`;
    case 'PRINCIPAL_REPAY':
      return `归还本金 ${formatFen(payload.amountFen || 0)} · ${payload.proposedEffectiveDate}`;
    case 'RATE_CHANGE':
      return `调整年利率为 ${formatRatePercent(payload.rate && payload.rate.annualEffectiveRate)}% · ${payload.proposedEffectiveDate}`;
    case 'CORRECTION':
      if (payload.correctionKind === 'PRINCIPAL') {
        const delta = payload.principalDeltaFen || 0;
        return `本金更正 ${delta >= 0 ? '+' : '-'}${formatFen(Math.abs(delta))}`;
      }
      return `利率更正为 ${formatRatePercent(payload.replacementRate && payload.replacementRate.annualEffectiveRate)}%`;
    case 'CLOSE_LOAN':
      return `结清账本 · ${payload.proposedEffectiveDate}`;
    default:
      return request.type;
  }
}

function requestTitle(request) {
  const names = {
    CREATE_LOAN: '新建往来',
    PRINCIPAL_ADD: '新增本金',
    PRINCIPAL_REPAY: '归还本金',
    RATE_CHANGE: '调整利率',
    CORRECTION: '账本更正',
    CLOSE_LOAN: '结清账本',
  };
  return names[request.type] || request.type;
}

function mapPending(entry) {
  const request = entry.request;
  const verifying = request.status === 'PENDING_INITIATOR_VERIFY';
  return {
    id: request._id,
    type: request.type,
    title: verifying ? '确认对方身份' : requestTitle(request),
    otherPartyName: entry.otherParty.displayName,
    description: requestDescription(request),
    note: (request.payload && (request.payload.note || request.payload.reason)) || '',
    actionKind: verifying
      ? 'VERIFY'
      : request.type === 'CREATE_LOAN'
        ? 'ACCEPT_CREATE'
        : 'ACCEPT_CHANGE',
    canReject: !verifying,
    canCancel: verifying,
  };
}

async function readAllPending() {
  const items = [];
  let cursor = null;
  do {
    const page = await callLedger('listPendingRequests', { limit: 100, cursor });
    items.push(...(page.items || []));
    cursor = page.nextCursor || null;
  } while (cursor);
  return items;
}

Page({
  data: { loading: true, error: '', requests: [], actingId: '' },

  onShow() {
    this.load();
  },

  async load() {
    this.setData({ loading: true, error: '' });
    try {
      const items = await readAllPending();
      this.setData({ loading: false, requests: items.map(mapPending), actingId: '' });
    } catch (err) {
      this.setData({ loading: false, error: err.message || '加载失败', actingId: '' });
    }
  },

  async accept(e) {
    const { id, kind } = e.currentTarget.dataset;
    this.setData({ actingId: id, error: '' });
    try {
      if (kind === 'VERIFY') {
        await callLedger('verifyFirstCounterparty', { requestId: id });
      } else if (kind === 'ACCEPT_CREATE') {
        await callLedger('acceptKnownLoanRequest', { requestId: id });
      } else {
        await callLedger('acceptRequest', { requestId: id });
      }
      await this.load();
    } catch (err) {
      this.setData({ actingId: '', error: err.message || '确认失败' });
    }
  },

  async reject(e) {
    const id = e.currentTarget.dataset.id;
    this.setData({ actingId: id, error: '' });
    try {
      await callLedger('rejectRequest', { requestId: id });
      await this.load();
    } catch (err) {
      this.setData({ actingId: '', error: err.message || '拒绝失败' });
    }
  },

  async cancel(e) {
    const id = e.currentTarget.dataset.id;
    this.setData({ actingId: id, error: '' });
    try {
      await callLedger('cancelRequest', { requestId: id });
      await this.load();
    } catch (err) {
      this.setData({ actingId: '', error: err.message || '取消失败' });
    }
  },
});
