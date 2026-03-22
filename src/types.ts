export type AssetType = 'cash' | 'cd' | 'bitcoin';

export type TransactionType =
  | 'deposit'
  | 'withdraw'
  | 'buy'
  | 'sell'
  | 'interest_adjustment'
  | 'manual_adjustment';

export interface ChildProfile {
  id: string;
  name: string;
  slug: string;
  accentColor: string;
  avatarEmoji: string;
}

export interface TransactionRecord {
  id: string;
  childId: string;
  effectiveAt: string;
  transactionType: TransactionType;
  assetType: AssetType;
  cashCentsDelta: number;
  bitcoinSatsDelta: number;
  bitcoinPriceUsdCents: number | null;
  note: string;
  cdLotId: string | null;
  metadata: Record<string, string | number | boolean | null>;
}

export interface CdLotRecord {
  id: string;
  childId: string;
  openedOn: string;
  principalCents: number;
  annualRateBps: number;
  lockupMonths: number;
  withdrawnPrincipalCents: number;
  withdrawnInterestCents: number;
  note: string;
}

export interface PriceSnapshot {
  id: string;
  assetType: 'bitcoin';
  pricedAt: string;
  priceUsdCents: number;
  source: string;
}

export interface CdLotMetrics {
  lotId: string;
  childId: string;
  openedOn: string;
  principalRemainingCents: number;
  accruedInterestCents: number;
  vestedInterestCents: number;
  withdrawablePrincipalCents: number;
  withdrawableInterestCents: number;
  totalValueCents: number;
  withdrawableValueCents: number;
  nextQuarterDate: string;
}

export interface ChildMetrics {
  child: ChildProfile;
  cashBalanceCents: number;
  bitcoinSats: number;
  bitcoinCostBasisCents: number;
  bitcoinValueCents: number;
  cdPrincipalCents: number;
  cdAccruedInterestCents: number;
  cdWithdrawableCents: number;
  totalValueCents: number;
  totalContributionsCents: number;
  totalWithdrawalsCents: number;
  netContributionsCents: number;
  unrealizedGainLossCents: number;
  allocation: {
    cashPct: number;
    cdPct: number;
    bitcoinPct: number;
  };
  lots: CdLotMetrics[];
}

export interface TimelinePoint {
  date: string;
  totalValueCents: number;
  cashValueCents: number;
  cdValueCents: number;
  bitcoinValueCents: number;
  bitcoinPriceUsdCents: number;
}

export interface PortfolioSnapshot {
  asOf: string;
  bitcoinPriceUsdCents: number;
  children: ChildMetrics[];
  familyTotalValueCents: number;
  totalBitcoinSats: number;
  totalCdValueCents: number;
  totalCashCents: number;
}

export interface TransactionDraft {
  childId: string;
  transactionType: TransactionType;
  assetType: AssetType;
  effectiveAt: string;
  usdAmount: string;
  bitcoinSats: string;
  note: string;
  selectedCdLotId: string;
}

export type UserAccessRole = 'admin' | 'writer';

export type UserAccessStatus = 'pending' | 'approved';

export interface UserAccessRecord {
  email: string;
  userId: string | null;
  role: UserAccessRole;
  status: UserAccessStatus;
  requestedAt: string;
  approvedAt: string | null;
  approvedBy: string | null;
}

export interface NewTransactionResult {
  transactions: TransactionRecord[];
  updatedLots?: CdLotRecord[];
  newLot?: CdLotRecord;
}

export interface PortfolioDataBundle {
  children: ChildProfile[];
  transactions: TransactionRecord[];
  cdLots: CdLotRecord[];
  priceSnapshots: PriceSnapshot[];
}
