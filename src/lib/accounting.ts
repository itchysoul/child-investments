import type {
  CdLotMetrics,
  CdLotRecord,
  ChildMetrics,
  ChildProfile,
  PortfolioSnapshot,
  PriceSnapshot,
  TimelinePoint,
  TransactionRecord,
} from '../types';
import { SATOSHIS_PER_BTC } from './format';

function startOfDay(dateLike: string | Date): Date {
  const date = new Date(dateLike);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function daysBetween(start: string | Date, end: string | Date): number {
  const startDate = startOfDay(start);
  const endDate = startOfDay(end);
  const diff = endDate.getTime() - startDate.getTime();
  return diff <= 0 ? 0 : Math.floor(diff / 86_400_000);
}

function addMonths(value: string | Date, months: number): Date {
  const base = startOfDay(value);
  const next = new Date(base);
  next.setUTCMonth(next.getUTCMonth() + months);
  return startOfDay(next);
}

function completedQuarterCount(openedOn: string, asOf: string): number {
  let count = 0;
  let cursor = addMonths(openedOn, 3);
  const target = startOfDay(asOf);

  while (cursor.getTime() <= target.getTime()) {
    count += 1;
    cursor = addMonths(cursor, 3);
  }

  return count;
}

function nextQuarterDate(openedOn: string, asOf: string): string {
  return addMonths(openedOn, (completedQuarterCount(openedOn, asOf) + 1) * 3)
    .toISOString()
    .slice(0, 10);
}

export function getLatestBitcoinPrice(priceSnapshots: PriceSnapshot[]): number {
  return [...priceSnapshots]
    .sort((a, b) => a.pricedAt.localeCompare(b.pricedAt))
    .at(-1)?.priceUsdCents ?? 0;
}

export function calculateCdLotMetrics(lot: CdLotRecord, asOf: string): CdLotMetrics {
  const daysElapsed = daysBetween(lot.openedOn, asOf);
  const principalRemaining = Math.max(0, lot.principalCents - lot.withdrawnPrincipalCents);
  const accruedInterest = Math.max(
    0,
    Math.floor((principalRemaining * lot.annualRateBps * daysElapsed) / (10_000 * 365)),
  );

  const vestedQuarters = completedQuarterCount(lot.openedOn, asOf);
  const vestedDate = vestedQuarters > 0 ? addMonths(lot.openedOn, vestedQuarters * 3) : startOfDay(lot.openedOn);
  const vestedDays = vestedQuarters > 0 ? daysBetween(lot.openedOn, vestedDate) : 0;
  const vestedInterest = Math.max(
    0,
    Math.floor((principalRemaining * lot.annualRateBps * vestedDays) / (10_000 * 365)),
  );

  const withdrawablePrincipal = vestedQuarters > 0 ? principalRemaining : 0;
  const withdrawableInterest = Math.max(0, vestedInterest - lot.withdrawnInterestCents);
  const totalValue = principalRemaining + Math.max(0, accruedInterest - lot.withdrawnInterestCents);

  return {
    lotId: lot.id,
    childId: lot.childId,
    openedOn: lot.openedOn,
    principalRemainingCents: principalRemaining,
    accruedInterestCents: Math.max(0, accruedInterest - lot.withdrawnInterestCents),
    vestedInterestCents: withdrawableInterest,
    withdrawablePrincipalCents: withdrawablePrincipal,
    withdrawableInterestCents: withdrawableInterest,
    totalValueCents: totalValue,
    withdrawableValueCents: withdrawablePrincipal + withdrawableInterest,
    nextQuarterDate: nextQuarterDate(lot.openedOn, asOf),
  };
}

function computeBitcoinCostBasis(transactions: TransactionRecord[], childId: string): { sats: number; costBasisCents: number } {
  const relevant = transactions
    .filter((transaction) => transaction.childId === childId && transaction.assetType === 'bitcoin')
    .sort((a, b) => a.effectiveAt.localeCompare(b.effectiveAt));

  let satsHeld = 0;
  let costBasisCents = 0;

  for (const transaction of relevant) {
    if (transaction.bitcoinSatsDelta > 0) {
      satsHeld += transaction.bitcoinSatsDelta;
      costBasisCents += Math.abs(transaction.cashCentsDelta);
      continue;
    }

    if (transaction.bitcoinSatsDelta < 0 && satsHeld > 0) {
      const satsSold = Math.abs(transaction.bitcoinSatsDelta);
      const averageCostPerSat = costBasisCents / satsHeld;
      costBasisCents = Math.max(0, Math.round(costBasisCents - averageCostPerSat * satsSold));
      satsHeld = Math.max(0, satsHeld - satsSold);
    }
  }

  return { sats: satsHeld, costBasisCents };
}

export function buildPortfolioSnapshot(
  children: ChildProfile[],
  transactions: TransactionRecord[],
  cdLots: CdLotRecord[],
  priceSnapshots: PriceSnapshot[],
  asOf: string,
): PortfolioSnapshot {
  const bitcoinPriceUsdCents = getLatestBitcoinPrice(priceSnapshots);

  const childMetrics: ChildMetrics[] = children.map((child) => {
    const childTransactions = transactions.filter(
      (transaction) => transaction.childId === child.id && transaction.effectiveAt <= asOf,
    );
    const childCashBalance = childTransactions.reduce((sum, transaction) => sum + transaction.cashCentsDelta, 0);
    const childBitcoinSats = childTransactions.reduce((sum, transaction) => sum + transaction.bitcoinSatsDelta, 0);
    const childLots = cdLots
      .filter((lot) => lot.childId === child.id && lot.openedOn <= asOf)
      .map((lot) => calculateCdLotMetrics(lot, asOf));

    const cdPrincipalCents = childLots.reduce((sum, lot) => sum + lot.principalRemainingCents, 0);
    const cdAccruedInterestCents = childLots.reduce((sum, lot) => sum + lot.accruedInterestCents, 0);
    const cdWithdrawableCents = childLots.reduce((sum, lot) => sum + lot.withdrawableValueCents, 0);
    const bitcoinValueCents = Math.round((childBitcoinSats / SATOSHIS_PER_BTC) * bitcoinPriceUsdCents);
    const totalValueCents = childCashBalance + cdPrincipalCents + cdAccruedInterestCents + bitcoinValueCents;
    const totalContributionsCents = childTransactions
      .filter((transaction) => transaction.transactionType === 'deposit')
      .reduce((sum, transaction) => sum + Math.max(0, transaction.cashCentsDelta), 0);
    const totalWithdrawalsCents = Math.abs(
      childTransactions
        .filter((transaction) => transaction.transactionType === 'withdraw')
        .reduce((sum, transaction) => sum + Math.min(0, transaction.cashCentsDelta), 0),
    );
    const costBasis = computeBitcoinCostBasis(transactions, child.id);
    const allocationDenominator = totalValueCents || 1;

    return {
      child,
      cashBalanceCents: childCashBalance,
      bitcoinSats: childBitcoinSats,
      bitcoinCostBasisCents: costBasis.costBasisCents,
      bitcoinValueCents,
      cdPrincipalCents,
      cdAccruedInterestCents,
      cdWithdrawableCents,
      totalValueCents,
      totalContributionsCents,
      totalWithdrawalsCents,
      netContributionsCents: totalContributionsCents - totalWithdrawalsCents,
      unrealizedGainLossCents: totalValueCents - (totalContributionsCents - totalWithdrawalsCents),
      allocation: {
        cashPct: (childCashBalance / allocationDenominator) * 100,
        cdPct: ((cdPrincipalCents + cdAccruedInterestCents) / allocationDenominator) * 100,
        bitcoinPct: (bitcoinValueCents / allocationDenominator) * 100,
      },
      lots: childLots,
    };
  });

  return {
    asOf,
    bitcoinPriceUsdCents,
    children: childMetrics,
    familyTotalValueCents: childMetrics.reduce((sum, child) => sum + child.totalValueCents, 0),
    totalBitcoinSats: childMetrics.reduce((sum, child) => sum + child.bitcoinSats, 0),
    totalCdValueCents: childMetrics.reduce(
      (sum, child) => sum + child.cdPrincipalCents + child.cdAccruedInterestCents,
      0,
    ),
    totalCashCents: childMetrics.reduce((sum, child) => sum + child.cashBalanceCents, 0),
  };
}

function getHistoricalBitcoinPrice(priceSnapshots: PriceSnapshot[], date: string, fallback: number): number {
  const matching = [...priceSnapshots]
    .filter((snapshot) => snapshot.pricedAt.slice(0, 10) <= date)
    .sort((a, b) => a.pricedAt.localeCompare(b.pricedAt))
    .at(-1);

  return matching?.priceUsdCents ?? fallback;
}

export function buildChildTimeline(
  childId: string,
  transactions: TransactionRecord[],
  cdLots: CdLotRecord[],
  priceSnapshots: PriceSnapshot[],
  asOf: string,
): TimelinePoint[] {
  const childTransactions = transactions.filter((transaction) => transaction.childId === childId);
  const firstDate = childTransactions
    .map((transaction) => transaction.effectiveAt)
    .sort()[0] ?? asOf;

  const start = startOfDay(firstDate);
  const end = startOfDay(asOf);
  const points: TimelinePoint[] = [];
  const fallbackPrice = getLatestBitcoinPrice(priceSnapshots);

  for (let cursor = new Date(start); cursor.getTime() <= end.getTime(); cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    const date = cursor.toISOString().slice(0, 10);
    const snapshot = buildPortfolioSnapshot(
      [{ id: childId, name: '', slug: '', accentColor: '', avatarEmoji: '' }],
      childTransactions,
      cdLots.filter((lot) => lot.childId === childId),
      [
        ...priceSnapshots.filter((price) => price.pricedAt.slice(0, 10) <= date),
        {
          id: 'fallback-price',
          assetType: 'bitcoin',
          pricedAt: `${date}T23:59:59.000Z`,
          priceUsdCents: getHistoricalBitcoinPrice(priceSnapshots, date, fallbackPrice),
          source: 'timeline_fallback',
        },
      ],
      date,
    );

    const child = snapshot.children[0];
    points.push({
      date,
      totalValueCents: child.totalValueCents,
      cashValueCents: child.cashBalanceCents,
      cdValueCents: child.cdPrincipalCents + child.cdAccruedInterestCents,
      bitcoinValueCents: child.bitcoinValueCents,
      bitcoinPriceUsdCents: snapshot.bitcoinPriceUsdCents,
    });
  }

  return points;
}

export function buildCdWithdrawalBreakdown(lot: CdLotRecord, amountCents: number, asOf: string) {
  const metrics = calculateCdLotMetrics(lot, asOf);
  if (amountCents > metrics.withdrawableValueCents) {
    throw new Error('Requested CD withdrawal is larger than the withdrawable amount.');
  }

  const interestPortion = Math.min(metrics.withdrawableInterestCents, amountCents);
  const principalPortion = Math.max(0, amountCents - interestPortion);

  return {
    interestPortionCents: interestPortion,
    principalPortionCents: principalPortion,
  };
}
