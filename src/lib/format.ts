export const SATOSHIS_PER_BTC = 100_000_000;

export function formatUsdFromCents(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  }).format(value / 100);
}

export function formatNumber(value: number, maximumFractionDigits = 0): string {
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits,
  }).format(value);
}

export function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}

export function formatSats(value: number): string {
  return `${formatNumber(value)} sats`;
}

export function formatBitcoinPrice(value: number): string {
  return `${formatUsdFromCents(value)} / BTC`;
}

export function satsToBitcoin(value: number): number {
  return value / SATOSHIS_PER_BTC;
}

export function bitcoinToSats(value: number): number {
  return Math.round(value * SATOSHIS_PER_BTC);
}

export function parseUsdToCents(raw: string): number {
  const normalized = raw.replace(/[$,\s]/g, '');
  const value = Number(normalized);
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.round(value * 100);
}

export function parseInteger(raw: string): number {
  const normalized = raw.replace(/[,\s]/g, '');
  const value = Number.parseInt(normalized, 10);
  return Number.isFinite(value) ? value : 0;
}

export function formatDateLabel(value: string): string {
  const date = new Date(value);
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
}
