import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Coins, Landmark, PiggyBank, RefreshCw, TrendingUp } from 'lucide-react';
import { Link, Navigate, Route, Routes, useParams } from 'react-router-dom';
import { ActivityList } from './components/ActivityList';
import { AllocationDonut } from './components/AllocationDonut';
import { ChildCard } from './components/ChildCard';
import { MetricCard } from './components/MetricCard';
import { PortfolioValueChart } from './components/PortfolioValueChart';
import { PriceHistoryChart } from './components/PriceHistoryChart';
import { TransactionComposer } from './components/TransactionComposer';
import { buildChildTimeline, buildPortfolioSnapshot, getLatestBitcoinPrice } from './lib/accounting';
import { formatBitcoinPrice, formatDateLabel, formatPercent, formatSats, formatUsdFromCents } from './lib/format';
import {
  buildTransactionListForDisplay,
  loadPortfolioBundle,
  persistImportedPriceHistory,
  persistPriceSnapshot,
  persistTransactionResult,
} from './lib/portfolioRepository';
import { fetchBitcoinMidpointPrice, fetchBitcoinPriceHistory } from './lib/pricing';
import { createDefaultDraft, createTransactionResult } from './lib/transactionEngine';
import type { ChildMetrics, PortfolioDataBundle, PriceSnapshot, TransactionDraft } from './types';

const today = new Date().toISOString().slice(0, 10);

function mergePriceSnapshots(current: PriceSnapshot[], incoming: PriceSnapshot[]): PriceSnapshot[] {
  const deduped = new Map(current.map((snapshot) => [snapshot.id, snapshot]));
  incoming.forEach((snapshot) => deduped.set(snapshot.id, snapshot));
  return [...deduped.values()].sort((a, b) => a.pricedAt.localeCompare(b.pricedAt));
}

function App() {
  const [bundle, setBundle] = useState<PortfolioDataBundle | null>(null);
  const [draft, setDraft] = useState<TransactionDraft>(() => createDefaultDraft('', today));
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const [busyAction, setBusyAction] = useState<'save' | 'price' | 'history' | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      try {
        const loadedBundle = await loadPortfolioBundle();
        if (cancelled) {
          return;
        }
        setBundle(loadedBundle);
        setDraft(createDefaultDraft(loadedBundle.children[0]?.id ?? '', today));
      } catch (error) {
        if (!cancelled) {
          setErrorMessage(error instanceof Error ? error.message : 'Unable to load the portfolio.');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void bootstrap();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!bundle?.children.length) {
      return;
    }

    const childStillExists = bundle.children.some((child) => child.id === draft.childId);
    if (!childStillExists) {
      setDraft(createDefaultDraft(bundle.children[0].id, today));
    }
  }, [bundle, draft.childId]);

  const snapshot = useMemo(() => {
    if (!bundle) {
      return null;
    }

    return buildPortfolioSnapshot(bundle.children, bundle.transactions, bundle.cdLots, bundle.priceSnapshots, today);
  }, [bundle]);

  const latestBitcoinPrice = useMemo(() => (bundle ? getLatestBitcoinPrice(bundle.priceSnapshots) : 0), [bundle]);

  const childNameById = useMemo(
    () => new Map(bundle?.children.map((child) => [child.id, child.name]) ?? []),
    [bundle],
  );

  const displayTransactions = useMemo(
    () => (bundle ? buildTransactionListForDisplay(bundle.transactions, bundle.cdLots) : []),
    [bundle],
  );

  const bitcoinPriceLabel = latestBitcoinPrice
    ? `Live reference: ${formatBitcoinPrice(latestBitcoinPrice)}`
    : 'Refresh bitcoin price before entering BTC trades.';

  const applyTransactionResult = useCallback((result: ReturnType<typeof createTransactionResult>) => {
    setBundle((current) => {
      if (!current) {
        return current;
      }

      let nextLots = current.cdLots;
      if (result.newLot) {
        nextLots = [...nextLots, result.newLot];
      }
      if (result.updatedLots?.length) {
        const updates = new Map(result.updatedLots.map((lot) => [lot.id, lot]));
        nextLots = nextLots.map((lot) => updates.get(lot.id) ?? lot);
      }

      return {
        ...current,
        cdLots: nextLots,
        transactions: [...current.transactions, ...result.transactions],
      };
    });
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!bundle || !draft.childId) {
      return;
    }

    try {
      setBusyAction('save');
      setErrorMessage('');
      setStatusMessage('');

      if (draft.assetType === 'bitcoin' && latestBitcoinPrice <= 0) {
        throw new Error('Refresh the bitcoin price before recording a bitcoin trade.');
      }

      const result = createTransactionResult(bundle, draft, {
        asOf: draft.effectiveAt,
        bitcoinPriceUsdCents: latestBitcoinPrice,
      });

      await persistTransactionResult(result);
      applyTransactionResult(result);
      setDraft(createDefaultDraft(draft.childId, draft.effectiveAt));
      setStatusMessage('Transaction saved.');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Unable to save the transaction.');
    } finally {
      setBusyAction(null);
    }
  }, [applyTransactionResult, bundle, draft, latestBitcoinPrice]);

  const handleRefreshPrice = useCallback(async () => {
    if (!bundle) {
      return;
    }

    try {
      setBusyAction('price');
      setErrorMessage('');
      setStatusMessage('');
      const snapshotResult = await fetchBitcoinMidpointPrice();
      await persistPriceSnapshot(snapshotResult);
      setBundle((current) =>
        current
          ? {
              ...current,
              priceSnapshots: mergePriceSnapshots(current.priceSnapshots, [snapshotResult]),
            }
          : current,
      );
      setStatusMessage('Bitcoin midpoint price refreshed.');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Unable to refresh bitcoin price.');
    } finally {
      setBusyAction(null);
    }
  }, [bundle]);

  const handleImportHistory = useCallback(async () => {
    if (!bundle) {
      return;
    }

    try {
      setBusyAction('history');
      setErrorMessage('');
      setStatusMessage('');
      const history = await fetchBitcoinPriceHistory(90);
      await persistImportedPriceHistory(history);
      setBundle((current) =>
        current
          ? {
              ...current,
              priceSnapshots: mergePriceSnapshots(current.priceSnapshots, history),
            }
          : current,
      );
      setStatusMessage('Imported 90 days of bitcoin price history.');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Unable to import bitcoin history.');
    } finally {
      setBusyAction(null);
    }
  }, [bundle]);

  if (loading) {
    return <div className="app-state">Loading the family ledger...</div>;
  }

  if (!bundle || !snapshot) {
    return <div className="app-state">Unable to open the portfolio.</div>;
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <Link className="brand" to="/">
          <span className="brand__mark">◎</span>
          <div>
            <strong>Child Investments</strong>
            <small>Cash, CD, and bitcoin in one tidy family ledger</small>
          </div>
        </Link>
        <div className="header-actions">
          <button className="button" onClick={() => void handleRefreshPrice()} disabled={busyAction !== null}>
            <RefreshCw size={16} />
            {busyAction === 'price' ? 'Refreshing price...' : 'Refresh BTC price'}
          </button>
          <button className="button" onClick={() => void handleImportHistory()} disabled={busyAction !== null}>
            <TrendingUp size={16} />
            {busyAction === 'history' ? 'Importing history...' : 'Import 90d history'}
          </button>
        </div>
      </header>

      {errorMessage ? <div className="banner banner--error">{errorMessage}</div> : null}
      {statusMessage ? <div className="banner banner--success">{statusMessage}</div> : null}

      <Routes>
        <Route
          path="/"
          element={
            <DashboardPage
              snapshot={snapshot}
              draft={draft}
              onDraftChange={setDraft}
              onSubmit={handleSubmit}
              saving={busyAction === 'save'}
              transactions={displayTransactions}
              childNameById={childNameById}
              priceSnapshots={bundle.priceSnapshots}
              bitcoinPriceLabel={bitcoinPriceLabel}
            />
          }
        />
        <Route
          path="/child/:slug"
          element={
            <ChildDetailPage
              bundle={bundle}
              snapshot={snapshot}
              draft={draft}
              onDraftChange={setDraft}
              onSubmit={handleSubmit}
              saving={busyAction === 'save'}
              transactions={displayTransactions}
              childNameById={childNameById}
              bitcoinPriceLabel={bitcoinPriceLabel}
            />
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  );
}

interface DashboardPageProps {
  snapshot: ReturnType<typeof buildPortfolioSnapshot>;
  draft: TransactionDraft;
  onDraftChange: (draft: TransactionDraft) => void;
  onSubmit: () => void;
  saving: boolean;
  transactions: ReturnType<typeof buildTransactionListForDisplay>;
  childNameById: Map<string, string>;
  priceSnapshots: PriceSnapshot[];
  bitcoinPriceLabel: string;
}

function DashboardPage({
  snapshot,
  draft,
  onDraftChange,
  onSubmit,
  saving,
  transactions,
  childNameById,
  priceSnapshots,
  bitcoinPriceLabel,
}: DashboardPageProps) {
  const familyNetContributions = snapshot.children.reduce((sum, child) => sum + child.netContributionsCents, 0);
  const familyGainLoss = snapshot.familyTotalValueCents - familyNetContributions;

  return (
    <main className="page-shell">
      <section className="hero-card">
        <div>
          <p className="eyebrow">Family overview</p>
          <h1>Keep each kid&apos;s money story in one place.</h1>
          <p>
            Track contributions, CD accrual, and sats side by side. As of {formatDateLabel(snapshot.asOf)}, the family is
            sitting on {formatUsdFromCents(snapshot.familyTotalValueCents)}.
          </p>
        </div>
        <div className="hero-card__stats">
          <div>
            <strong>{snapshot.children.length}</strong>
            <span>kids tracked</span>
          </div>
          <div>
            <strong>{formatSats(snapshot.totalBitcoinSats)}</strong>
            <span>bitcoin stack</span>
          </div>
        </div>
      </section>

      <section className="metrics-grid">
        <MetricCard
          label="Family total"
          value={formatUsdFromCents(snapshot.familyTotalValueCents)}
          tone="indigo"
          detail={`Net contributions ${formatUsdFromCents(familyNetContributions)}`}
          icon={<PiggyBank size={18} />}
        />
        <MetricCard
          label="Cash balance"
          value={formatUsdFromCents(snapshot.totalCashCents)}
          tone="teal"
          detail="Available for new moves"
          icon={<Landmark size={18} />}
        />
        <MetricCard
          label="CD value"
          value={formatUsdFromCents(snapshot.totalCdValueCents)}
          tone="gold"
          detail="Principal plus accrued interest"
          icon={<Landmark size={18} />}
        />
        <MetricCard
          label="Unrealized gain/loss"
          value={formatUsdFromCents(familyGainLoss)}
          tone={familyGainLoss >= 0 ? 'rose' : 'indigo'}
          detail={bitcoinPriceLabel}
          icon={<Coins size={18} />}
        />
      </section>

      <section className="section-block">
        <div className="section-heading">
          <div>
            <h2>Kids</h2>
            <p>Each card rolls up cash, CD value, and bitcoin holdings.</p>
          </div>
        </div>
        <div className="child-grid">
          {snapshot.children.map((metrics) => (
            <ChildCard key={metrics.child.id} metrics={metrics} />
          ))}
        </div>
      </section>

      <section className="dashboard-grid">
        <div className="dashboard-grid__main">
          <PriceHistoryChart data={priceSnapshots} />
          <ActivityList transactions={transactions} childNameById={childNameById} />
        </div>
        <div className="dashboard-grid__side">
          <TransactionComposer
            children={snapshot.children.map((entry) => entry.child)}
            draft={draft}
            cdLots={snapshot.children.flatMap((entry) => entry.lots)}
            onDraftChange={onDraftChange}
            onSubmit={onSubmit}
            disabled={saving}
            bitcoinPriceLabel={bitcoinPriceLabel}
          />
        </div>
      </section>
    </main>
  );
}

interface ChildDetailPageProps {
  bundle: PortfolioDataBundle;
  snapshot: ReturnType<typeof buildPortfolioSnapshot>;
  draft: TransactionDraft;
  onDraftChange: (draft: TransactionDraft) => void;
  onSubmit: () => void;
  saving: boolean;
  transactions: ReturnType<typeof buildTransactionListForDisplay>;
  childNameById: Map<string, string>;
  bitcoinPriceLabel: string;
}

function ChildDetailPage({
  bundle,
  snapshot,
  draft,
  onDraftChange,
  onSubmit,
  saving,
  transactions,
  childNameById,
  bitcoinPriceLabel,
}: ChildDetailPageProps) {
  const { slug } = useParams();
  const metrics = snapshot.children.find((entry) => entry.child.slug === slug);

  if (!metrics) {
    return <Navigate to="/" replace />;
  }

  const timeline = buildChildTimeline(metrics.child.id, bundle.transactions, bundle.cdLots, bundle.priceSnapshots, today);
  const childTransactions = transactions.filter((transaction) => transaction.childId === metrics.child.id);
  const scopedDraft = draft.childId === metrics.child.id ? draft : { ...draft, childId: metrics.child.id };

  return (
    <main className="page-shell">
      <div className="detail-header">
        <Link className="back-link" to="/">
          <ArrowLeft size={16} />
          Back to dashboard
        </Link>
        <div>
          <p className="eyebrow">{metrics.child.avatarEmoji} Child account</p>
          <h1>{metrics.child.name}</h1>
          <p>
            {formatUsdFromCents(metrics.totalValueCents)} total value with {formatPercent(metrics.allocation.bitcoinPct)} in
            bitcoin.
          </p>
        </div>
      </div>

      <section className="metrics-grid">
        <MetricCard label="Cash" value={formatUsdFromCents(metrics.cashBalanceCents)} tone="indigo" />
        <MetricCard
          label="Bitcoin"
          value={formatSats(metrics.bitcoinSats)}
          tone="gold"
          detail={formatUsdFromCents(metrics.bitcoinValueCents)}
        />
        <MetricCard
          label="CD withdrawable"
          value={formatUsdFromCents(metrics.cdWithdrawableCents)}
          tone="teal"
          detail={`${metrics.lots.length} lot${metrics.lots.length === 1 ? '' : 's'}`}
        />
        <MetricCard
          label="BTC cost basis"
          value={formatUsdFromCents(metrics.bitcoinCostBasisCents)}
          tone="rose"
          detail={`Gain/loss ${formatUsdFromCents(metrics.unrealizedGainLossCents)}`}
        />
      </section>

      <section className="detail-grid">
        <div className="detail-grid__main">
          <PortfolioValueChart data={timeline} />
          <ActivityList transactions={childTransactions} childNameById={childNameById} />
        </div>
        <div className="detail-grid__side">
          <AllocationDonut metrics={metrics} />
          <TransactionComposer
            children={snapshot.children.map((entry) => entry.child)}
            draft={scopedDraft}
            cdLots={metrics.lots}
            onDraftChange={(nextDraft) => onDraftChange({ ...nextDraft, childId: metrics.child.id })}
            onSubmit={onSubmit}
            disabled={saving}
            bitcoinPriceLabel={bitcoinPriceLabel}
            fixedChildId={metrics.child.id}
          />
          <CdLotsCard metrics={metrics} />
        </div>
      </section>
    </main>
  );
}

function CdLotsCard({ metrics }: { metrics: ChildMetrics }) {
  return (
    <div className="chart-card">
      <div className="section-heading">
        <div>
          <h3>CD lots</h3>
          <p>Quarterly unlock cadence with daily accrual for valuation.</p>
        </div>
      </div>
      {metrics.lots.length ? (
        <div className="lot-list">
          {metrics.lots.map((lot) => (
            <div key={lot.lotId} className="lot-row">
              <div>
                <strong>{formatDateLabel(lot.openedOn)}</strong>
                <p>Next quarter unlock {formatDateLabel(lot.nextQuarterDate)}</p>
              </div>
              <div>
                <strong>{formatUsdFromCents(lot.totalValueCents)}</strong>
                <p>{formatUsdFromCents(lot.withdrawableValueCents)} withdrawable</p>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="empty-state">No CD lots yet for this child.</div>
      )}
    </div>
  );
}

export default App;
