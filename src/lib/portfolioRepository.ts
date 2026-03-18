import type { CdLotRecord, NewTransactionResult, PortfolioDataBundle, PriceSnapshot, TransactionRecord } from '../types';
import { seededBundle } from './seedData';
import { supabase } from './supabase';

const STORAGE_KEY = 'child-investments-fallback-data';

interface ChildRow {
  id: string;
  name: string;
  slug: string;
  accent_color: string;
  avatar_emoji: string;
}

interface TransactionRow {
  id: string;
  child_id: string;
  effective_at: string;
  transaction_type: TransactionRecord['transactionType'];
  asset_type: TransactionRecord['assetType'];
  cash_cents_delta: number;
  bitcoin_sats_delta: number | string;
  bitcoin_price_usd_cents: number | null;
  note: string;
  cd_lot_id: string | null;
  metadata: TransactionRecord['metadata'] | null;
}

interface CdLotRow {
  id: string;
  child_id: string;
  opened_on: string;
  principal_cents: number;
  annual_rate_bps: number;
  lockup_months: number;
  withdrawn_principal_cents: number;
  withdrawn_interest_cents: number;
  note: string;
}

interface PriceSnapshotRow {
  id: string;
  asset_type: PriceSnapshot['assetType'];
  priced_at: string;
  price_usd_cents: number;
  source: string;
}

function cloneBundle(bundle: PortfolioDataBundle): PortfolioDataBundle {
  return JSON.parse(JSON.stringify(bundle)) as PortfolioDataBundle;
}

function canUseLocalStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function loadFallbackBundle(): PortfolioDataBundle {
  if (!canUseLocalStorage()) {
    return cloneBundle(seededBundle);
  }

  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    const fresh = cloneBundle(seededBundle);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fresh));
    return fresh;
  }

  return JSON.parse(raw) as PortfolioDataBundle;
}

function saveFallbackBundle(bundle: PortfolioDataBundle): void {
  if (!canUseLocalStorage()) {
    return;
  }

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(bundle));
}

export async function loadPortfolioBundle(): Promise<PortfolioDataBundle> {
  if (!supabase) {
    return loadFallbackBundle();
  }

  const [childrenResult, transactionsResult, lotsResult, pricesResult] = await Promise.all([
    supabase.from('children').select('*').order('name'),
    supabase.from('transactions').select('*').order('effective_at'),
    supabase.from('cd_lots').select('*').order('opened_on'),
    supabase.from('price_snapshots').select('*').order('priced_at'),
  ]);

  if (childrenResult.error || transactionsResult.error || lotsResult.error || pricesResult.error) {
    return loadFallbackBundle();
  }

  return {
    children: ((childrenResult.data ?? []) as ChildRow[]).map((row) => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      accentColor: row.accent_color,
      avatarEmoji: row.avatar_emoji,
    })),
    transactions: ((transactionsResult.data ?? []) as TransactionRow[]).map((row) => ({
      id: row.id,
      childId: row.child_id,
      effectiveAt: row.effective_at,
      transactionType: row.transaction_type,
      assetType: row.asset_type,
      cashCentsDelta: row.cash_cents_delta,
      bitcoinSatsDelta: Number(row.bitcoin_sats_delta),
      bitcoinPriceUsdCents: row.bitcoin_price_usd_cents,
      note: row.note,
      cdLotId: row.cd_lot_id,
      metadata: row.metadata ?? {},
    })),
    cdLots: ((lotsResult.data ?? []) as CdLotRow[]).map((row) => ({
      id: row.id,
      childId: row.child_id,
      openedOn: row.opened_on,
      principalCents: row.principal_cents,
      annualRateBps: row.annual_rate_bps,
      lockupMonths: row.lockup_months,
      withdrawnPrincipalCents: row.withdrawn_principal_cents,
      withdrawnInterestCents: row.withdrawn_interest_cents,
      note: row.note,
    })),
    priceSnapshots: ((pricesResult.data ?? []) as PriceSnapshotRow[]).map((row) => ({
      id: row.id,
      assetType: row.asset_type,
      pricedAt: row.priced_at,
      priceUsdCents: row.price_usd_cents,
      source: row.source,
    })),
  };
}

export async function persistTransactionResult(result: NewTransactionResult): Promise<void> {
  if (!supabase) {
    const bundle = loadFallbackBundle();
    if (result.newLot) {
      bundle.cdLots.push(result.newLot);
    }
    if (result.updatedLots) {
      const updates = new Map(result.updatedLots.map((lot) => [lot.id, lot]));
      bundle.cdLots = bundle.cdLots.map((lot) => updates.get(lot.id) ?? lot);
    }
    bundle.transactions.push(...result.transactions);
    saveFallbackBundle(bundle);
    return;
  }

  if (result.newLot) {
    const lot = result.newLot;
    const { error } = await supabase.from('cd_lots').insert({
      id: lot.id,
      child_id: lot.childId,
      opened_on: lot.openedOn,
      principal_cents: lot.principalCents,
      annual_rate_bps: lot.annualRateBps,
      lockup_months: lot.lockupMonths,
      withdrawn_principal_cents: lot.withdrawnPrincipalCents,
      withdrawn_interest_cents: lot.withdrawnInterestCents,
      note: lot.note,
    });
    if (error) {
      throw error;
    }
  }

  if (result.updatedLots?.length) {
    for (const lot of result.updatedLots) {
      const { error } = await supabase
        .from('cd_lots')
        .update({
          withdrawn_principal_cents: lot.withdrawnPrincipalCents,
          withdrawn_interest_cents: lot.withdrawnInterestCents,
          note: lot.note,
        })
        .eq('id', lot.id);
      if (error) {
        throw error;
      }
    }
  }

  if (result.transactions.length) {
    const rows = result.transactions.map((transaction) => ({
      id: transaction.id,
      child_id: transaction.childId,
      effective_at: transaction.effectiveAt,
      transaction_type: transaction.transactionType,
      asset_type: transaction.assetType,
      cash_cents_delta: transaction.cashCentsDelta,
      bitcoin_sats_delta: transaction.bitcoinSatsDelta,
      bitcoin_price_usd_cents: transaction.bitcoinPriceUsdCents,
      note: transaction.note,
      cd_lot_id: transaction.cdLotId,
      metadata: transaction.metadata,
    }));
    const { error } = await supabase.from('transactions').insert(rows);
    if (error) {
      throw error;
    }
  }
}

export async function persistPriceSnapshot(snapshot: PriceSnapshot): Promise<void> {
  if (!supabase) {
    const bundle = loadFallbackBundle();
    const deduped = new Map(bundle.priceSnapshots.map((item) => [item.id, item]));
    deduped.set(snapshot.id, snapshot);
    bundle.priceSnapshots = [...deduped.values()].sort((a, b) => a.pricedAt.localeCompare(b.pricedAt));
    saveFallbackBundle(bundle);
    return;
  }

  const { error } = await supabase.from('price_snapshots').upsert({
    id: snapshot.id,
    asset_type: snapshot.assetType,
    priced_at: snapshot.pricedAt,
    price_usd_cents: snapshot.priceUsdCents,
    source: snapshot.source,
  });

  if (error) {
    throw error;
  }
}

export async function persistImportedPriceHistory(snapshots: PriceSnapshot[]): Promise<void> {
  if (!snapshots.length) {
    return;
  }

  if (!supabase) {
    const bundle = loadFallbackBundle();
    const deduped = new Map(bundle.priceSnapshots.map((item) => [item.id, item]));
    snapshots.forEach((snapshot) => deduped.set(snapshot.id, snapshot));
    bundle.priceSnapshots = [...deduped.values()].sort((a, b) => a.pricedAt.localeCompare(b.pricedAt));
    saveFallbackBundle(bundle);
    return;
  }

  const { error } = await supabase.from('price_snapshots').upsert(
    snapshots.map((snapshot) => ({
      id: snapshot.id,
      asset_type: snapshot.assetType,
      priced_at: snapshot.pricedAt,
      price_usd_cents: snapshot.priceUsdCents,
      source: snapshot.source,
    })),
  );

  if (error) {
    throw error;
  }
}

export function buildTransactionListForDisplay(transactions: TransactionRecord[], cdLots: CdLotRecord[]) {
  const lotsById = new Map(cdLots.map((lot) => [lot.id, lot]));
  return [...transactions]
    .sort((a, b) => b.effectiveAt.localeCompare(a.effectiveAt))
    .map((transaction) => ({
      ...transaction,
      linkedLot: transaction.cdLotId ? lotsById.get(transaction.cdLotId) ?? null : null,
    }));
}
