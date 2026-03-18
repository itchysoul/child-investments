import { Line, LineChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { PriceSnapshot } from '../types';
import { formatBitcoinPrice, formatDateLabel } from '../lib/format';

interface PriceHistoryChartProps {
  data: PriceSnapshot[];
}

export function PriceHistoryChart({ data }: PriceHistoryChartProps) {
  const filtered = [...data]
    .filter((snapshot) => snapshot.assetType === 'bitcoin')
    .sort((a, b) => a.pricedAt.localeCompare(b.pricedAt));

  return (
    <div className="chart-card">
      <div className="section-heading">
        <div>
          <h3>Bitcoin price history</h3>
          <p>Displayed as whole-BTC USD price, while holdings stay in sats.</p>
        </div>
      </div>
      <div className="chart-shell">
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={filtered}>
            <CartesianGrid stroke="rgba(255,255,255,0.08)" vertical={false} />
            <XAxis dataKey="pricedAt" tickFormatter={(value) => formatDateLabel(String(value).slice(0, 10))} minTickGap={26} />
            <YAxis tickFormatter={(value) => `$${Math.round(value / 100)}`} width={70} />
            <Tooltip
              formatter={(value: number) => formatBitcoinPrice(value)}
              labelFormatter={(label: string) => formatDateLabel(String(label).slice(0, 10))}
            />
            <Line type="monotone" dataKey="priceUsdCents" stroke="#f59e0b" strokeWidth={3} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
