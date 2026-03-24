import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Coins, Landmark, LogIn, LogOut, PiggyBank, RefreshCw, ShieldCheck, TrendingUp, UserPlus } from 'lucide-react';
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
  approveUserAccess,
  buildTransactionListForDisplay,
  ensureCurrentUserAccess,
  loadPendingUserAccess,
  loadPortfolioBundle,
  persistImportedPriceHistory,
  persistPriceSnapshot,
  persistTransactionResult,
  requestWriterAccess,
} from './lib/portfolioRepository';
import { fetchBitcoinMidpointPrice, fetchBitcoinPriceHistory } from './lib/pricing';
import { supabase } from './lib/supabase';
import { createDefaultDraft, createTransactionResult } from './lib/transactionEngine';
import type { ChildMetrics, PortfolioDataBundle, PriceSnapshot, TransactionDraft, UserAccessRecord } from './types';

const today = new Date().toISOString().slice(0, 10);
const PRICE_REFRESH_COOLDOWN_MS = 5 * 60 * 1000;
const PRICE_REFRESH_SOURCE = 'coinbase_midpoint';

function mergePriceSnapshots(current: PriceSnapshot[], incoming: PriceSnapshot[]): PriceSnapshot[] {
  const deduped = new Map(current.map((snapshot) => [snapshot.id, snapshot]));
  incoming.forEach((snapshot) => deduped.set(snapshot.id, snapshot));
  return [...deduped.values()].sort((a, b) => a.pricedAt.localeCompare(b.pricedAt));
}

function hasWriteAccess(access: UserAccessRecord | null): boolean {
  return Boolean(access && access.status === 'approved' && (access.role === 'admin' || access.role === 'writer'));
}

function hasAdminAccess(access: UserAccessRecord | null): boolean {
  return Boolean(access && access.status === 'approved' && access.role === 'admin');
}

function getPriceRefreshCooldownRemaining(priceSnapshots: PriceSnapshot[], nowMs: number): number {
  const latestRefresh = [...priceSnapshots]
    .filter((snapshot) => snapshot.source === PRICE_REFRESH_SOURCE)
    .sort((a, b) => a.pricedAt.localeCompare(b.pricedAt))
    .at(-1);

  if (!latestRefresh) {
    return 0;
  }

  const remaining = new Date(latestRefresh.pricedAt).getTime() + PRICE_REFRESH_COOLDOWN_MS - nowMs;
  return Math.max(0, remaining);
}

function formatCooldown(ms: number): string {
  const totalSeconds = Math.max(1, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes <= 0) {
    return `${seconds}s`;
  }

  if (seconds === 0) {
    return `${minutes}m`;
  }

  return `${minutes}m ${seconds}s`;
}

function App() {
  const [bundle, setBundle] = useState<PortfolioDataBundle | null>(null);
  const [draft, setDraft] = useState<TransactionDraft>(() => createDefaultDraft('', today));
  const [authResolved, setAuthResolved] = useState(!supabase);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const [busyAction, setBusyAction] = useState<'save' | 'price' | 'history' | null>(null);
  const [authBusyAction, setAuthBusyAction] = useState<'signin' | 'signout' | 'request' | 'approve' | null>(null);
  const [authEmail, setAuthEmail] = useState('');
  const [sessionEmail, setSessionEmail] = useState<string | null>(null);
  const [currentAccess, setCurrentAccess] = useState<UserAccessRecord | null>(null);
  const [pendingApprovals, setPendingApprovals] = useState<UserAccessRecord[]>([]);
  const [clockMs, setClockMs] = useState(() => Date.now());

  useEffect(() => {
    if (supabase && !authResolved) {
      return;
    }

    if (supabase && !currentAccess) {
      setBundle(null);
      setLoading(false);
      return;
    }

    let cancelled = false;

    setLoading(true);

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
  }, [authResolved, currentAccess]);

  useEffect(() => {
    if (!bundle?.children.length) {
      return;
    }

    const childStillExists = bundle.children.some((child) => child.id === draft.childId);
    if (!childStillExists) {
      setDraft(createDefaultDraft(bundle.children[0].id, today));
    }
  }, [bundle, draft.childId]);

  useEffect(() => {
    const interval = window.setInterval(() => setClockMs(Date.now()), 30000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!supabase) {
      return;
    }

    const authClient = supabase;

    let cancelled = false;

    async function syncAccessState() {
      try {
        const {
          data: { session },
        } = await authClient.auth.getSession();

        if (cancelled) {
          return;
        }

        const normalizedEmail = session?.user.email?.toLowerCase() ?? null;
        setSessionEmail(normalizedEmail);

        if (!session) {
          setCurrentAccess(null);
          setPendingApprovals([]);
          setAuthResolved(true);
          return;
        }

        const access = await ensureCurrentUserAccess();

        if (cancelled) {
          return;
        }

        setCurrentAccess(access);
        setAuthResolved(true);

        if (hasAdminAccess(access)) {
          const pending = await loadPendingUserAccess();
          if (!cancelled) {
            setPendingApprovals(pending);
          }
          return;
        }

        setPendingApprovals([]);
      } catch (error) {
        if (!cancelled) {
          setErrorMessage(error instanceof Error ? error.message : 'Unable to sync your sign-in state.');
          setAuthResolved(true);
        }
      }
    }

    void syncAccessState();

    const {
      data: { subscription },
    } = authClient.auth.onAuthStateChange(() => {
      void syncAccessState();
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

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

  const canReadBank = useMemo(() => !supabase || Boolean(currentAccess && currentAccess.status === 'approved'), [currentAccess]);
  const canWrite = useMemo(() => !supabase || hasWriteAccess(currentAccess), [currentAccess]);
  const isAdmin = useMemo(() => hasAdminAccess(currentAccess), [currentAccess]);

  const priceRefreshCooldownMs = useMemo(
    () => getPriceRefreshCooldownRemaining(bundle?.priceSnapshots ?? [], clockMs),
    [bundle, clockMs],
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

      if (!canWrite) {
        throw new Error('Only approved writers can save transactions.');
      }

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
  }, [applyTransactionResult, bundle, canWrite, draft, latestBitcoinPrice]);

  const handleRefreshPrice = useCallback(async () => {
    if (!bundle) {
      return;
    }

    try {
      setBusyAction('price');
      setErrorMessage('');
      setStatusMessage('');

      if (!canWrite) {
        throw new Error('Only approved writers can refresh the bitcoin price.');
      }

      if (priceRefreshCooldownMs > 0) {
        throw new Error(`Bitcoin price refresh is rate limited. Try again in ${formatCooldown(priceRefreshCooldownMs)}.`);
      }

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
  }, [bundle, canWrite, priceRefreshCooldownMs]);

  const handleImportHistory = useCallback(async () => {
    if (!bundle) {
      return;
    }

    try {
      setBusyAction('history');
      setErrorMessage('');
      setStatusMessage('');

      if (!canWrite) {
        throw new Error('Only approved writers can import bitcoin history.');
      }

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
  }, [bundle, canWrite]);

  const handleSendMagicLink = useCallback(async () => {
    if (!supabase) {
      return;
    }

    const normalizedEmail = authEmail.trim().toLowerCase();

    if (!normalizedEmail) {
      setErrorMessage('Enter your email address to request a magic link.');
      return;
    }

    try {
      setAuthBusyAction('signin');
      setErrorMessage('');
      setStatusMessage('');
      const { error } = await supabase.auth.signInWithOtp({
        email: normalizedEmail,
        options: {
          emailRedirectTo: window.location.href,
        },
      });

      if (error) {
        throw error;
      }

      setStatusMessage(`Magic link sent to ${normalizedEmail}.`);
      setAuthEmail(normalizedEmail);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Unable to send a magic link.');
    } finally {
      setAuthBusyAction(null);
    }
  }, [authEmail]);

  const handleSignOut = useCallback(async () => {
    if (!supabase) {
      return;
    }

    try {
      setAuthBusyAction('signout');
      setErrorMessage('');
      setStatusMessage('');
      const { error } = await supabase.auth.signOut();

      if (error) {
        throw error;
      }

      setCurrentAccess(null);
      setPendingApprovals([]);
      setSessionEmail(null);
      setStatusMessage('Signed out.');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Unable to sign out.');
    } finally {
      setAuthBusyAction(null);
    }
  }, []);

  const handleRequestWriterAccess = useCallback(async () => {
    try {
      setAuthBusyAction('request');
      setErrorMessage('');
      setStatusMessage('');
      const access = await requestWriterAccess();
      setCurrentAccess(access);
      setStatusMessage('Writer access requested. An admin must approve you before you can save transactions.');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Unable to request writer access.');
    } finally {
      setAuthBusyAction(null);
    }
  }, []);

  const handleApproveUser = useCallback(async (email: string) => {
    try {
      setAuthBusyAction('approve');
      setErrorMessage('');
      setStatusMessage('');
      await approveUserAccess(email);
      const pending = await loadPendingUserAccess();
      setPendingApprovals(pending);
      setStatusMessage(`Approved ${email} for write access.`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Unable to approve this writer request.');
    } finally {
      setAuthBusyAction(null);
    }
  }, []);

  const accessPanel = supabase ? (
    <>
      <AccessStatusCard
        authEmail={authEmail}
        currentAccess={currentAccess}
        busyAction={authBusyAction}
        onAuthEmailChange={setAuthEmail}
        onRequestWriterAccess={() => void handleRequestWriterAccess()}
        onSendMagicLink={() => void handleSendMagicLink()}
        onSignOut={() => void handleSignOut()}
        sessionEmail={sessionEmail}
      />
      {isAdmin ? (
        <PendingApprovalsCard
          entries={pendingApprovals}
          busy={authBusyAction === 'approve'}
          onApprove={(email) => void handleApproveUser(email)}
        />
      ) : null}
    </>
  ) : null;

  const refreshPriceLabel = busyAction === 'price'
    ? 'Refreshing price...'
    : priceRefreshCooldownMs > 0
      ? `Refresh BTC price (${formatCooldown(priceRefreshCooldownMs)})`
      : 'Refresh BTC price';

  if (supabase && !authResolved) {
    return <div className="app-state">Checking bank access...</div>;
  }

  if (supabase && !canReadBank) {
    return <BankGate accessPanel={accessPanel} sessionEmail={sessionEmail} />;
  }

  if (loading) {
    return <div className="app-state">Loading the family ledger...</div>;
  }

  if (!bundle || !snapshot) {
    return <div className="app-state">Unable to open the portfolio.</div>;
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <Link className="brand" to="/bank">
          <span className="brand__mark">◎</span>
          <div>
            <strong>Child Investments</strong>
            <small>Cash, CD, and bitcoin in one tidy family ledger</small>
          </div>
        </Link>
        <div className="header-actions">
          <Link className="button" to="/logic-final">
            <PiggyBank size={16} />
            Logic Final
          </Link>
          <button
            className="button"
            onClick={() => void handleRefreshPrice()}
            disabled={busyAction !== null || !canWrite || priceRefreshCooldownMs > 0}
          >
            <RefreshCw size={16} />
            {refreshPriceLabel}
          </button>
          <button className="button" onClick={() => void handleImportHistory()} disabled={busyAction !== null || !canWrite}>
            <TrendingUp size={16} />
            {busyAction === 'history' ? 'Importing history...' : 'Import 90d history'}
          </button>
          {sessionEmail ? (
            <button className="button" onClick={() => void handleSignOut()} disabled={authBusyAction !== null}>
              <LogOut size={16} />
              {authBusyAction === 'signout' ? 'Signing out...' : 'Sign out'}
            </button>
          ) : null}
        </div>
      </header>

      {errorMessage ? <div className="banner banner--error">{errorMessage}</div> : null}
      {statusMessage ? <div className="banner banner--success">{statusMessage}</div> : null}

      <Routes>
        <Route
          index
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
              accessPanel={accessPanel}
              canWrite={canWrite}
            />
          }
        />
        <Route
          path="child/:slug"
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
              accessPanel={accessPanel}
              canWrite={canWrite}
            />
          }
        />
        <Route path="*" element={<Navigate to="/bank" replace />} />
      </Routes>
    </div>
  );
}

function BankGate({ accessPanel, sessionEmail }: { accessPanel: ReactNode; sessionEmail: string | null }) {
  return (
    <div className="app-shell">
      <header className="app-header">
        <Link className="brand" to="/bank">
          <span className="brand__mark">◎</span>
          <div>
            <strong>Child Investments</strong>
            <small>Private family ledger</small>
          </div>
        </Link>
        <div className="header-actions">
          <Link className="button" to="/logic-final">
            <PiggyBank size={16} />
            Logic Final
          </Link>
        </div>
      </header>

      <main className="page-shell">
        <section className="hero-card">
          <div>
            <p className="eyebrow">Bank access required</p>
            <h1>This ledger stays hidden until you are approved.</h1>
            <p>
              {sessionEmail
                ? 'You are signed in, but the bank remains private until your account is approved.'
                : 'Sign in first, then request access if you should be allowed into the bank.'}
            </p>
          </div>
          <div className="hero-card__stats">
            <div>
              <strong>Private</strong>
              <span>approval required</span>
            </div>
            <div>
              <strong>Logic Final</strong>
              <span>open to any login</span>
            </div>
          </div>
        </section>

        <section className="dashboard-grid">
          <div className="dashboard-grid__main">
            <div className="chart-card">
              <div className="section-heading">
                <div>
                  <h3>Separate permissions</h3>
                  <p>The logic game is available to any signed-in user, but bank balances, transactions, and price history stay locked down.</p>
                </div>
              </div>
              <Link className="button button--primary" to="/logic-final">
                <PiggyBank size={16} />
                Go to Logic Final
              </Link>
            </div>
          </div>
          <div className="dashboard-grid__side">{accessPanel}</div>
        </section>
      </main>
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
  accessPanel: ReactNode;
  canWrite: boolean;
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
  accessPanel,
  canWrite,
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
          {accessPanel}
          {canWrite ? (
            <TransactionComposer
              children={snapshot.children.map((entry) => entry.child)}
              draft={draft}
              cdLots={snapshot.children.flatMap((entry) => entry.lots)}
              onDraftChange={onDraftChange}
              onSubmit={onSubmit}
              disabled={saving}
              bitcoinPriceLabel={bitcoinPriceLabel}
            />
          ) : null}
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
  accessPanel: ReactNode;
  canWrite: boolean;
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
  accessPanel,
  canWrite,
}: ChildDetailPageProps) {
  const { slug } = useParams();
  const metrics = snapshot.children.find((entry) => entry.child.slug === slug);

  if (!metrics) {
    return <Navigate to="/bank" replace />;
  }

  const timeline = buildChildTimeline(metrics.child.id, bundle.transactions, bundle.cdLots, bundle.priceSnapshots, today);
  const childTransactions = transactions.filter((transaction) => transaction.childId === metrics.child.id);
  const scopedDraft = draft.childId === metrics.child.id ? draft : { ...draft, childId: metrics.child.id };

  return (
    <main className="page-shell">
      <div className="detail-header">
        <Link className="back-link" to="/bank">
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
          {accessPanel}
          <AllocationDonut metrics={metrics} />
          {canWrite ? (
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
          ) : null}
          <CdLotsCard metrics={metrics} />
        </div>
      </section>
    </main>
  );
}

interface AccessStatusCardProps {
  authEmail: string;
  currentAccess: UserAccessRecord | null;
  busyAction: 'signin' | 'signout' | 'request' | 'approve' | null;
  onAuthEmailChange: (email: string) => void;
  onRequestWriterAccess: () => void;
  onSendMagicLink: () => void;
  onSignOut: () => void;
  sessionEmail: string | null;
}

function AccessStatusCard({
  authEmail,
  currentAccess,
  busyAction,
  onAuthEmailChange,
  onRequestWriterAccess,
  onSendMagicLink,
  onSignOut,
  sessionEmail,
}: AccessStatusCardProps) {
  const approvedWriter = hasWriteAccess(currentAccess);
  const admin = hasAdminAccess(currentAccess);

  return (
    <div className="chart-card access-card">
      <div className="section-heading">
        <div>
          <h3>Bank access</h3>
          <p>The bank is private. Signed-in users must be approved before they can view or change anything here.</p>
        </div>
      </div>

      {sessionEmail ? (
        <>
          <div className="access-card__identity">
            <strong>{sessionEmail}</strong>
            <span className="access-chip">{admin ? 'Admin' : approvedWriter ? 'Approved writer' : currentAccess?.status === 'pending' ? 'Pending approval' : 'Read only'}</span>
          </div>
          {approvedWriter ? (
            <div className="access-card__message">
              <ShieldCheck size={16} />
              <span>{admin ? 'You can approve users and write transactions.' : 'You can write transactions and refresh pricing data.'}</span>
            </div>
          ) : currentAccess?.status === 'pending' ? (
            <div className="access-card__message">
              <UserPlus size={16} />
              <span>Your bank access request is pending admin approval.</span>
            </div>
          ) : (
            <button className="button button--primary" onClick={onRequestWriterAccess} disabled={busyAction !== null}>
              <UserPlus size={16} />
              {busyAction === 'request' ? 'Requesting bank access...' : 'Request bank access'}
            </button>
          )}
          <button className="button access-card__secondary" onClick={onSignOut} disabled={busyAction !== null}>
            <LogOut size={16} />
            {busyAction === 'signout' ? 'Signing out...' : 'Sign out'}
          </button>
        </>
      ) : (
        <>
          <label>
            <span>Email</span>
            <input
              type="email"
              value={authEmail}
              placeholder="you@example.com"
              onChange={(event) => onAuthEmailChange(event.target.value)}
              disabled={busyAction !== null}
            />
          </label>
          <button className="button button--primary" onClick={onSendMagicLink} disabled={busyAction !== null}>
            <LogIn size={16} />
            {busyAction === 'signin' ? 'Sending magic link...' : 'Sign in to request bank access'}
          </button>
        </>
      )}
    </div>
  );
}

function PendingApprovalsCard({
  entries,
  busy,
  onApprove,
}: {
  entries: UserAccessRecord[];
  busy: boolean;
  onApprove: (email: string) => void;
}) {
  return (
    <div className="chart-card access-card">
      <div className="section-heading">
        <div>
          <h3>Pending approvals</h3>
          <p>Approve new writers before they can add transactions or refresh pricing data.</p>
        </div>
      </div>

      {entries.length ? (
        <div className="approval-list">
          {entries.map((entry) => (
            <div key={entry.email} className="approval-row">
              <div>
                <strong>{entry.email}</strong>
                <p>Requested {formatDateLabel(entry.requestedAt)}</p>
              </div>
              <button className="button" onClick={() => onApprove(entry.email)} disabled={busy}>
                <ShieldCheck size={16} />
                Approve
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="empty-state">No pending writer requests right now.</div>
      )}
    </div>
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
