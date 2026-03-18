import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { TimelinePoint } from '../types';
import { formatDateLabel, formatUsdFromCents } from '../lib/format';

interface PortfolioValueChartProps {
  data: TimelinePoint[];
}

export function PortfolioValueChart({ data }: PortfolioValueChartProps) {
  return (
    <div className="chart-card">
      <div className="section-heading">
        <div>
          <h3>Value over time</h3>
          <p>Daily balances with CD accrual included.</p>
        </div>
      </div>
      <div className="chart-shell">
        <ResponsiveContainer width="100%" height={280}>
          <AreaChart data={data}>
            <defs>
              <linearGradient id="totalValueFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#7c3aed" stopOpacity={0.8} />
                <stop offset="100%" stopColor="#7c3aed" stopOpacity={0.05} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="rgba(255,255,255,0.08)" vertical={false} />
            <XAxis dataKey="date" tickFormatter={formatDateLabel} minTickGap={24} />
            <YAxis tickFormatter={(value) => `$${Math.round(value / 100)}`} width={70} />
            <Tooltip
              formatter={(value: number) => formatUsdFromCents(value)}
              labelFormatter={(label: string) => formatDateLabel(label)}
            />
            <Area type="monotone" dataKey="totalValueCents" stroke="#7c3aed" fill="url(#totalValueFill)" strokeWidth={3} />
            <Area type="monotone" dataKey="bitcoinValueCents" stroke="#f59e0b" fill="transparent" strokeWidth={2} />
            <Area type="monotone" dataKey="cdValueCents" stroke="#14b8a6" fill="transparent" strokeWidth={2} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
