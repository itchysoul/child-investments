import type { ReactNode } from 'react';

interface MetricCardProps {
  label: string;
  value: string;
  tone?: 'indigo' | 'teal' | 'gold' | 'rose';
  detail?: string;
  icon?: ReactNode;
}

export function MetricCard({ label, value, tone = 'indigo', detail, icon }: MetricCardProps) {
  return (
    <div className={`metric-card metric-card--${tone}`}>
      <div className="metric-card__header">
        <span>{label}</span>
        {icon ? <span className="metric-card__icon">{icon}</span> : null}
      </div>
      <div className="metric-card__value">{value}</div>
      {detail ? <div className="metric-card__detail">{detail}</div> : null}
    </div>
  );
}
