import { ArrowRight, Coins, Landmark, Wallet } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { ChildMetrics } from '../types';
import { formatPercent, formatSats, formatUsdFromCents } from '../lib/format';

interface ChildCardProps {
  metrics: ChildMetrics;
}

export function ChildCard({ metrics }: ChildCardProps) {
  const { child } = metrics;

  return (
    <Link className="child-card" to={`/bank/child/${child.slug}`} style={{ ['--accent' as string]: child.accentColor }}>
      <div className="child-card__top">
        <div className="child-card__identity">
          <div className="child-card__avatar">{child.avatarEmoji}</div>
          <div>
            <h3>{child.name}</h3>
            <p>{formatUsdFromCents(metrics.totalValueCents)} treasure chest</p>
          </div>
        </div>
        <ArrowRight size={18} />
      </div>
      <div className="child-card__metrics">
        <div>
          <Wallet size={16} />
          <span>{formatUsdFromCents(metrics.cashBalanceCents)}</span>
          <small>Cash</small>
        </div>
        <div>
          <Landmark size={16} />
          <span>{formatUsdFromCents(metrics.cdPrincipalCents + metrics.cdAccruedInterestCents)}</span>
          <small>{formatPercent(metrics.allocation.cdPct)} CD</small>
        </div>
        <div>
          <Coins size={16} />
          <span>{formatSats(metrics.bitcoinSats)}</span>
          <small>{formatPercent(metrics.allocation.bitcoinPct)} BTC</small>
        </div>
      </div>
    </Link>
  );
}
