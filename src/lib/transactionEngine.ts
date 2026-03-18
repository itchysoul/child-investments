import type { CdLotRecord, NewTransactionResult, PortfolioDataBundle, PriceSnapshot, TransactionDraft, TransactionRecord } from '../types';
import { buildCdWithdrawalBreakdown, buildPortfolioSnapshot } from './accounting';
import { parseInteger, parseUsdToCents } from './format';

interface CreateTransactionOptions {
  asOf: string;
  bitcoinPriceUsdCents: number;
}

function requirePositive(value: number, message: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(message);
  }
}

function createBaseTransaction(draft: TransactionDraft, overrides: Partial<TransactionRecord>): TransactionRecord {
  return {
    id: crypto.randomUUID(),
    childId: draft.childId,
    effectiveAt: draft.effectiveAt,
    transactionType: draft.transactionType,
    assetType: draft.assetType,
    cashCentsDelta: 0,
    bitcoinSatsDelta: 0,
    bitcoinPriceUsdCents: null,
    note: draft.note.trim(),
    cdLotId: null,
    metadata: {},
    ...overrides,
  };
}

function inferBitcoinTrade(draft: TransactionDraft, bitcoinPriceUsdCents: number) {
  const usdAmountCents = parseUsdToCents(draft.usdAmount);
  const satsAmount = parseInteger(draft.bitcoinSats);

  if (usdAmountCents <= 0 && satsAmount <= 0) {
    throw new Error('Enter either a USD amount or satoshis for the bitcoin trade.');
  }

  const resolvedSats = satsAmount > 0 ? satsAmount : Math.floor((usdAmountCents * 100_000_000) / bitcoinPriceUsdCents);
  const resolvedUsdCents = usdAmountCents > 0 ? usdAmountCents : Math.round((resolvedSats * bitcoinPriceUsdCents) / 100_000_000);

  requirePositive(resolvedSats, 'Bitcoin trades must include a positive satoshi amount.');
  requirePositive(resolvedUsdCents, 'Bitcoin trades must include a positive USD value.');

  return {
    satsAmount: resolvedSats,
    usdAmountCents: resolvedUsdCents,
  };
}

function findChildSnapshot(bundle: PortfolioDataBundle, childId: string, options: CreateTransactionOptions) {
  const snapshot = buildPortfolioSnapshot(
    bundle.children,
    bundle.transactions,
    bundle.cdLots,
    bundle.priceSnapshots.length
      ? bundle.priceSnapshots
      : [
          {
            id: 'ephemeral-price',
            assetType: 'bitcoin',
            pricedAt: new Date().toISOString(),
            priceUsdCents: options.bitcoinPriceUsdCents,
            source: 'ephemeral',
          },
        ],
    options.asOf,
  );

  const child = snapshot.children.find((entry) => entry.child.id === childId);
  if (!child) {
    throw new Error('Child account not found.');
  }
  return child;
}

export function createTransactionResult(
  bundle: PortfolioDataBundle,
  draft: TransactionDraft,
  options: CreateTransactionOptions,
): NewTransactionResult {
  const childSnapshot = findChildSnapshot(bundle, draft.childId, options);
  const bitcoinPriceUsdCents = options.bitcoinPriceUsdCents;
  const usdAmountCents = parseUsdToCents(draft.usdAmount);

  if (draft.assetType === 'cash' && draft.transactionType === 'deposit') {
    requirePositive(usdAmountCents, 'Deposits need a positive cash amount.');
    return {
      transactions: [
        createBaseTransaction(draft, {
          cashCentsDelta: usdAmountCents,
        }),
      ],
    };
  }

  if (draft.assetType === 'cash' && draft.transactionType === 'withdraw') {
    requirePositive(usdAmountCents, 'Withdrawals need a positive cash amount.');
    if (childSnapshot.cashBalanceCents < usdAmountCents) {
      throw new Error('Not enough cash available for that withdrawal.');
    }
    return {
      transactions: [
        createBaseTransaction(draft, {
          cashCentsDelta: -usdAmountCents,
        }),
      ],
    };
  }

  if (draft.assetType === 'bitcoin' && draft.transactionType === 'buy') {
    const trade = inferBitcoinTrade(draft, bitcoinPriceUsdCents);
    if (childSnapshot.cashBalanceCents < trade.usdAmountCents) {
      throw new Error('Not enough cash available to buy that much bitcoin.');
    }
    return {
      transactions: [
        createBaseTransaction(draft, {
          cashCentsDelta: -trade.usdAmountCents,
          bitcoinSatsDelta: trade.satsAmount,
          bitcoinPriceUsdCents,
          metadata: {
            priced_from_midpoint: true,
          },
        }),
      ],
    };
  }

  if (draft.assetType === 'bitcoin' && draft.transactionType === 'sell') {
    const trade = inferBitcoinTrade(draft, bitcoinPriceUsdCents);
    if (childSnapshot.bitcoinSats < trade.satsAmount) {
      throw new Error('Not enough bitcoin satoshis available to sell.');
    }
    return {
      transactions: [
        createBaseTransaction(draft, {
          cashCentsDelta: trade.usdAmountCents,
          bitcoinSatsDelta: -trade.satsAmount,
          bitcoinPriceUsdCents,
          metadata: {
            priced_from_midpoint: true,
          },
        }),
      ],
    };
  }

  if (draft.assetType === 'cd' && draft.transactionType === 'buy') {
    requirePositive(usdAmountCents, 'Moving money into the CD needs a positive cash amount.');
    if (childSnapshot.cashBalanceCents < usdAmountCents) {
      throw new Error('Not enough cash available to open that CD lot.');
    }
    const newLot: CdLotRecord = {
      id: crypto.randomUUID(),
      childId: draft.childId,
      openedOn: draft.effectiveAt,
      principalCents: usdAmountCents,
      annualRateBps: 300,
      lockupMonths: 3,
      withdrawnPrincipalCents: 0,
      withdrawnInterestCents: 0,
      note: draft.note.trim(),
    };
    return {
      transactions: [
        createBaseTransaction(draft, {
          cashCentsDelta: -usdAmountCents,
          cdLotId: newLot.id,
        }),
      ],
      newLot,
    };
  }

  if (draft.assetType === 'cd' && (draft.transactionType === 'sell' || draft.transactionType === 'withdraw')) {
    requirePositive(usdAmountCents, 'CD withdrawals need a positive cash amount.');
    const lot = bundle.cdLots.find((entry) => entry.id === draft.selectedCdLotId && entry.childId === draft.childId);
    if (!lot) {
      throw new Error('Pick a valid CD lot before withdrawing from the CD.');
    }
    const breakdown = buildCdWithdrawalBreakdown(lot, usdAmountCents, options.asOf);
    const updatedLot: CdLotRecord = {
      ...lot,
      withdrawnPrincipalCents: lot.withdrawnPrincipalCents + breakdown.principalPortionCents,
      withdrawnInterestCents: lot.withdrawnInterestCents + breakdown.interestPortionCents,
    };

    return {
      transactions: [
        createBaseTransaction(draft, {
          cashCentsDelta: usdAmountCents,
          cdLotId: lot.id,
          metadata: {
            principal_portion_cents: breakdown.principalPortionCents,
            interest_portion_cents: breakdown.interestPortionCents,
          },
        }),
      ],
      updatedLots: [updatedLot],
    };
  }

  if (draft.transactionType === 'manual_adjustment' && draft.assetType === 'cash') {
    if (!draft.usdAmount.trim()) {
      throw new Error('Enter a signed USD amount for the cash adjustment.');
    }
    const signedAmount = Math.round(Number(draft.usdAmount.replace(/[$,\s]/g, '')) * 100);
    if (!Number.isFinite(signedAmount) || signedAmount === 0) {
      throw new Error('Cash adjustments need a non-zero signed amount.');
    }
    if (signedAmount < 0 && childSnapshot.cashBalanceCents < Math.abs(signedAmount)) {
      throw new Error('That adjustment would take the cash balance below zero.');
    }
    return {
      transactions: [
        createBaseTransaction(draft, {
          cashCentsDelta: signedAmount,
        }),
      ],
    };
  }

  if (draft.transactionType === 'manual_adjustment' && draft.assetType === 'bitcoin') {
    if (!draft.bitcoinSats.trim()) {
      throw new Error('Enter a signed satoshi amount for the bitcoin adjustment.');
    }
    const signedSats = Number.parseInt(draft.bitcoinSats.replace(/[,\s]/g, ''), 10);
    if (!Number.isFinite(signedSats) || signedSats === 0) {
      throw new Error('Bitcoin adjustments need a non-zero signed satoshi amount.');
    }
    if (signedSats < 0 && childSnapshot.bitcoinSats < Math.abs(signedSats)) {
      throw new Error('That adjustment would take the bitcoin balance below zero.');
    }
    return {
      transactions: [
        createBaseTransaction(draft, {
          bitcoinSatsDelta: signedSats,
          bitcoinPriceUsdCents,
        }),
      ],
    };
  }

  throw new Error('That transaction type is not supported for the selected asset.');
}

export function createDefaultDraft(childId: string, effectiveAt: string): TransactionDraft {
  return {
    childId,
    transactionType: 'deposit',
    assetType: 'cash',
    effectiveAt,
    usdAmount: '',
    bitcoinSats: '',
    note: '',
    selectedCdLotId: '',
  };
}
