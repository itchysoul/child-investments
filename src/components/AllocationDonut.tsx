import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import type { ChildMetrics } from '../types';
import { formatPercent, formatUsdFromCents } from '../lib/format';

interface AllocationDonutProps {
  metrics: ChildMetrics;
}

const COLORS = ['#6366f1', '#14b8a6', '#f59e0b'];

export function AllocationDonut({ metrics }: AllocationDonutProps) {
  const data = [
    { name: 'Cash', value: metrics.cashBalanceCents },
    { name: 'CD', value: metrics.cdPrincipalCents + metrics.cdAccruedInterestCents },
    { name: 'Bitcoin', value: metrics.bitcoinValueCents },
  ];

  return (
    <div className="chart-card">
      <div className="section-heading">
        <div>
          <h3>Allocation mix</h3>
          <p>How this little portfolio is spread across the three asset buckets.</p>
        </div>
      </div>
      <div className="allocation-grid">
        <div className="allocation-chart">
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie data={data} dataKey="value" innerRadius={52} outerRadius={82} paddingAngle={4}>
                {data.map((entry, index) => (
                  <Cell key={entry.name} fill={COLORS[index]} />
                ))}
              </Pie>
              <Tooltip formatter={(value: number) => formatUsdFromCents(value)} />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className="allocation-legend">
          <div>
            <span className="swatch" style={{ background: COLORS[0] }} />
            <strong>Cash</strong>
            <span>{formatPercent(metrics.allocation.cashPct)}</span>
          </div>
          <div>
            <span className="swatch" style={{ background: COLORS[1] }} />
            <strong>CD</strong>
            <span>{formatPercent(metrics.allocation.cdPct)}</span>
          </div>
          <div>
            <span className="swatch" style={{ background: COLORS[2] }} />
            <strong>Bitcoin</strong>
            <span>{formatPercent(metrics.allocation.bitcoinPct)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
