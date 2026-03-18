import type { PriceSnapshot } from '../types';

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Request failed for ${url}`);
  }
  return (await response.json()) as T;
}

export async function fetchBitcoinMidpointPrice(): Promise<PriceSnapshot> {
  const payload = await fetchJson<{ bids: [string, string][]; asks: [string, string][] }>(
    'https://api.exchange.coinbase.com/products/BTC-USD/book?level=1',
  );
  const bestBid = Number(payload.bids?.[0]?.[0] ?? 0);
  const bestAsk = Number(payload.asks?.[0]?.[0] ?? 0);
  const midpoint = (bestBid + bestAsk) / 2;

  if (!Number.isFinite(midpoint) || midpoint <= 0) {
    throw new Error('Unable to determine bitcoin midpoint price.');
  }

  return {
    id: crypto.randomUUID(),
    assetType: 'bitcoin',
    pricedAt: new Date().toISOString(),
    priceUsdCents: Math.round(midpoint * 100),
    source: 'coinbase_midpoint',
  };
}

export async function fetchBitcoinPriceHistory(days: number): Promise<PriceSnapshot[]> {
  const normalizedDays = Math.max(7, Math.min(days, 365));
  const payload = await fetchJson<{ prices: [number, number][] }>(
    `https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=usd&days=${normalizedDays}&interval=daily`,
  );

  return payload.prices.map(([timestamp, price]) => ({
    id: `coingecko-${timestamp}`,
    assetType: 'bitcoin',
    pricedAt: new Date(timestamp).toISOString(),
    priceUsdCents: Math.round(price * 100),
    source: 'coingecko_history',
  }));
}
