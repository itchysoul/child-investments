import { useEffect } from 'react';
import type { CdLotMetrics, ChildProfile, TransactionDraft } from '../types';
import { createDefaultDraft } from '../lib/transactionEngine';

interface TransactionComposerProps {
  children: ChildProfile[];
  draft: TransactionDraft;
  cdLots: CdLotMetrics[];
  onDraftChange: (draft: TransactionDraft) => void;
  onSubmit: () => void;
  disabled?: boolean;
  bitcoinPriceLabel: string;
  fixedChildId?: string;
}

const actionsByAsset: Record<TransactionDraft['assetType'], readonly TransactionDraft['transactionType'][]> = {
  cash: ['deposit', 'withdraw', 'manual_adjustment'],
  bitcoin: ['buy', 'sell', 'manual_adjustment'],
  cd: ['buy', 'withdraw', 'sell'],
} as const;

export function TransactionComposer({
  children,
  draft,
  cdLots,
  onDraftChange,
  onSubmit,
  disabled,
  bitcoinPriceLabel,
  fixedChildId,
}: TransactionComposerProps) {
  useEffect(() => {
    const validActions = actionsByAsset[draft.assetType];
    if (!validActions.includes(draft.transactionType)) {
      onDraftChange({
        ...draft,
        transactionType: validActions[0],
      });
    }
  }, [draft, onDraftChange]);

  const lotChoices = cdLots.filter((lot) => lot.withdrawableValueCents > 0);

  return (
    <div className="chart-card transaction-card">
      <div className="section-heading">
        <div>
          <h3>Add a transaction</h3>
          <p>Fast buttons for the everyday money moves.</p>
        </div>
      </div>
      <div className="transaction-grid">
        <label>
          <span>Child</span>
          <select
            value={draft.childId}
            onChange={(event) => onDraftChange({ ...draft, childId: event.target.value })}
            disabled={Boolean(fixedChildId) || disabled}
          >
            {children.map((child) => (
              <option key={child.id} value={child.id}>
                {child.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Asset</span>
          <select
            value={draft.assetType}
            onChange={(event) => {
              const assetType = event.target.value as TransactionDraft['assetType'];
              const nextDraft = createDefaultDraft(fixedChildId ?? draft.childId, draft.effectiveAt);
              onDraftChange({
                ...nextDraft,
                childId: fixedChildId ?? draft.childId,
                effectiveAt: draft.effectiveAt,
                assetType,
                transactionType: actionsByAsset[assetType][0],
              });
            }}
            disabled={disabled}
          >
            <option value="cash">Cash</option>
            <option value="cd">CD</option>
            <option value="bitcoin">Bitcoin</option>
          </select>
        </label>
        <label>
          <span>Action</span>
          <select
            value={draft.transactionType}
            onChange={(event) => onDraftChange({ ...draft, transactionType: event.target.value as TransactionDraft['transactionType'] })}
            disabled={disabled}
          >
            {actionsByAsset[draft.assetType].map((action) => (
              <option key={action} value={action}>
                {action.replace('_', ' ')}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Date</span>
          <input
            type="date"
            value={draft.effectiveAt}
            onChange={(event) => onDraftChange({ ...draft, effectiveAt: event.target.value })}
            disabled={disabled}
          />
        </label>
        {draft.assetType !== 'bitcoin' ? (
          <label>
            <span>{draft.transactionType === 'manual_adjustment' ? 'USD amount (signed if adjusting)' : 'USD amount'}</span>
            <input
              type="text"
              value={draft.usdAmount}
              placeholder={draft.transactionType === 'manual_adjustment' ? '-12.50 or 12.50' : '25.00'}
              onChange={(event) => onDraftChange({ ...draft, usdAmount: event.target.value })}
              disabled={disabled}
            />
          </label>
        ) : null}
        {draft.assetType === 'bitcoin' ? (
          <>
            <label>
              <span>Satoshis {draft.transactionType === 'manual_adjustment' ? '(signed if adjusting)' : ''}</span>
              <input
                type="text"
                value={draft.bitcoinSats}
                placeholder={draft.transactionType === 'manual_adjustment' ? '-1000 or 1000' : '25000'}
                onChange={(event) => onDraftChange({ ...draft, bitcoinSats: event.target.value })}
                disabled={disabled}
              />
            </label>
            <label>
              <span>USD amount</span>
              <input
                type="text"
                value={draft.usdAmount}
                placeholder="18.25"
                onChange={(event) => onDraftChange({ ...draft, usdAmount: event.target.value })}
                disabled={disabled}
              />
              <small>{bitcoinPriceLabel}</small>
            </label>
          </>
        ) : null}
        {draft.assetType === 'cd' && (draft.transactionType === 'withdraw' || draft.transactionType === 'sell') ? (
          <label>
            <span>CD lot</span>
            <select
              value={draft.selectedCdLotId}
              onChange={(event) => onDraftChange({ ...draft, selectedCdLotId: event.target.value })}
              disabled={disabled}
            >
              <option value="">Choose a lot</option>
              {lotChoices.map((lot) => (
                <option key={lot.lotId} value={lot.lotId}>
                  {lot.openedOn} · withdrawable {Math.round(lot.withdrawableValueCents / 100)} USD
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label className="transaction-grid__note">
          <span>Note</span>
          <input
            type="text"
            value={draft.note}
            placeholder="Allowance, birthday gift, BTC scoop..."
            onChange={(event) => onDraftChange({ ...draft, note: event.target.value })}
            disabled={disabled}
          />
        </label>
      </div>
      <button className="button button--primary" onClick={onSubmit} disabled={disabled}>
        Save transaction
      </button>
    </div>
  );
}
