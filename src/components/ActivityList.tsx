import type { CdLotRecord, TransactionRecord } from '../types';
import { formatDateLabel, formatSats, formatUsdFromCents } from '../lib/format';

interface ActivityListProps {
  transactions: Array<TransactionRecord & { linkedLot: CdLotRecord | null }>;
  childNameById: Map<string, string>;
}

export function ActivityList({ transactions, childNameById }: ActivityListProps) {
  return (
    <div className="chart-card">
      <div className="section-heading">
        <div>
          <h3>Recent ledger activity</h3>
          <p>The family bookkeeping trail.</p>
        </div>
      </div>
      <div className="activity-list">
        {transactions.slice(0, 10).map((transaction) => (
          <div key={transaction.id} className="activity-row">
            <div>
              <strong>{childNameById.get(transaction.childId) ?? 'Unknown child'}</strong>
              <p>{formatDateLabel(transaction.effectiveAt)}</p>
            </div>
            <div>
              <strong>{transaction.transactionType.replace('_', ' ')}</strong>
              <p>{transaction.assetType}</p>
            </div>
            <div>
              {transaction.cashCentsDelta !== 0 ? <strong>{formatUsdFromCents(transaction.cashCentsDelta)}</strong> : null}
              {transaction.bitcoinSatsDelta !== 0 ? <p>{formatSats(transaction.bitcoinSatsDelta)}</p> : null}
            </div>
            <div>
              <p>{transaction.note || 'No note'}</p>
              {transaction.linkedLot ? <small>CD lot from {formatDateLabel(transaction.linkedLot.openedOn)}</small> : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
