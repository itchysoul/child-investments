import { useCallback, useEffect, useMemo, useState } from 'react';
import { Crown, Gamepad2, LogIn, LogOut, ShieldAlert, Sparkles, Swords, Trophy } from 'lucide-react';
import { Link } from 'react-router-dom';
import { logicFinalTerms, logicFinalTermCount, type LogicFinalTerm } from './lib/logicFinalData';
import {
  ensureLogicFinalProfile,
  loadLogicFinalLeaderboard,
  loadLogicFinalProgress,
  saveLogicFinalState,
  type LogicFinalProfile,
  type LogicFinalProgressRecord,
} from './lib/logicFinalRepository';
import { supabase } from './lib/supabase';

type LogicMode = 'match' | 'arcade' | 'reverse';
type FeedbackTone = 'correct' | 'wrong' | 'idle';

interface FeedbackState {
  tone: FeedbackTone;
  message: string;
}

interface ArcadeChallenge {
  term: LogicFinalTerm;
  options: LogicFinalTerm[];
}

function shuffle<T>(items: T[]): T[] {
  const next = [...items];
  for (let index = next.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
  }
  return next;
}

function deriveDisplayName(email: string): string {
  const [name] = email.split('@');
  return name.replace(/[._-]+/g, ' ').replace(/\b\w/g, (value) => value.toUpperCase()) || email;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function buildDefaultProgress(userId: string): LogicFinalProgressRecord[] {
  const now = new Date().toISOString();
  return logicFinalTerms.map((term) => ({
    userId,
    termId: term.id,
    intervalStep: 0,
    easeFactor: 2.3,
    nextDueAt: now,
    consecutiveCorrect: 0,
    consecutiveWrong: 0,
    totalCorrect: 0,
    totalWrong: 0,
    masteryLevel: 0,
    updatedAt: now,
  }));
}

function getDifficultyLabel(progress: LogicFinalProgressRecord[]): string {
  if (!progress.length) {
    return 'Warm-up';
  }

  const averageMastery = progress.reduce((sum, record) => sum + record.masteryLevel, 0) / progress.length;
  if (averageMastery < 1.5) {
    return 'Warm-up';
  }
  if (averageMastery < 3) {
    return 'Arcade';
  }
  if (averageMastery < 4.5) {
    return 'Boss Rush';
  }
  return 'Impossible Cabinet';
}

function buildProgressMap(progress: LogicFinalProgressRecord[]): Map<string, LogicFinalProgressRecord> {
  return new Map(progress.map((record) => [record.termId, record]));
}

function pickDueTerms(progress: LogicFinalProgressRecord[], count: number): LogicFinalTerm[] {
  const progressById = buildProgressMap(progress);
  const now = Date.now();
  const ranked = logicFinalTerms
    .map((term) => ({
      term,
      progress:
        progressById.get(term.id) ?? {
          userId: '',
          termId: term.id,
          intervalStep: 0,
          easeFactor: 2.3,
          nextDueAt: new Date(0).toISOString(),
          consecutiveCorrect: 0,
          consecutiveWrong: 0,
          totalCorrect: 0,
          totalWrong: 0,
          masteryLevel: 0,
          updatedAt: new Date(0).toISOString(),
        },
    }))
    .sort((left, right) => {
      const leftDueDelta = new Date(left.progress.nextDueAt).getTime() - now;
      const rightDueDelta = new Date(right.progress.nextDueAt).getTime() - now;
      if (leftDueDelta !== rightDueDelta) {
        return leftDueDelta - rightDueDelta;
      }
      if (left.progress.masteryLevel !== right.progress.masteryLevel) {
        return left.progress.masteryLevel - right.progress.masteryLevel;
      }
      return left.term.name.localeCompare(right.term.name);
    });

  return ranked.slice(0, Math.min(count, logicFinalTerms.length)).map((entry) => entry.term);
}

function buildArcadeChallenge(progress: LogicFinalProgressRecord[], reverse = false): ArcadeChallenge | null {
  const dueTerms = pickDueTerms(progress, logicFinalTerms.length);
  const target = dueTerms[0];
  if (!target) {
    return null;
  }

  const progressById = buildProgressMap(progress);
  const mastery = progressById.get(target.id)?.masteryLevel ?? 0;
  const choiceCount = clamp(2 + Math.floor(mastery / 2), 2, 5);
  const distractors = shuffle(logicFinalTerms.filter((term) => term.id !== target.id)).slice(0, choiceCount - 1);
  const options = shuffle([target, ...distractors]);

  if (reverse) {
    return { term: target, options };
  }

  return { term: target, options };
}

function scheduleProgress(record: LogicFinalProgressRecord, correct: boolean): LogicFinalProgressRecord {
  const now = Date.now();
  if (correct) {
    const nextIntervalStep = clamp(record.intervalStep + 1, 0, 6);
    const nextEase = clamp(record.easeFactor + 0.08, 1.4, 3.2);
    const reviewMinutes = [10, 45, 180, 720, 2880, 10080, 20160][nextIntervalStep];
    return {
      ...record,
      intervalStep: nextIntervalStep,
      easeFactor: nextEase,
      nextDueAt: new Date(now + reviewMinutes * 60 * 1000).toISOString(),
      consecutiveCorrect: record.consecutiveCorrect + 1,
      consecutiveWrong: 0,
      totalCorrect: record.totalCorrect + 1,
      masteryLevel: clamp(record.masteryLevel + 1, 0, 6),
      updatedAt: new Date(now).toISOString(),
    };
  }

  const reducedMastery = clamp(record.masteryLevel - 1, 0, 6);
  const nextIntervalStep = clamp(record.intervalStep - 2, 0, 6);
  const easingPenaltyMinutes = reducedMastery <= 1 ? 3 : 8;
  return {
    ...record,
    intervalStep: nextIntervalStep,
    easeFactor: clamp(record.easeFactor - 0.2, 1.4, 3.2),
    nextDueAt: new Date(now + easingPenaltyMinutes * 60 * 1000).toISOString(),
    consecutiveCorrect: 0,
    consecutiveWrong: record.consecutiveWrong + 1,
    totalWrong: record.totalWrong + 1,
    masteryLevel: reducedMastery,
    updatedAt: new Date(now).toISOString(),
  };
}

function updateProfile(
  profile: LogicFinalProfile,
  progress: LogicFinalProgressRecord[],
  correct: boolean,
  difficultyLevel: number,
): LogicFinalProfile {
  const points = correct ? 50 + difficultyLevel * 15 : -10;
  const nextScore = Math.max(0, profile.score + points);
  const nextCurrentStreak = correct ? profile.currentStreak + 1 : 0;
  const masteredTerms = progress.filter((entry) => entry.masteryLevel >= 4).length;

  return {
    ...profile,
    score: nextScore,
    currentStreak: nextCurrentStreak,
    bestStreak: Math.max(profile.bestStreak, nextCurrentStreak),
    totalCorrect: profile.totalCorrect + (correct ? 1 : 0),
    totalAttempts: profile.totalAttempts + 1,
    masteredTerms,
    updatedAt: new Date().toISOString(),
  };
}

export default function LogicFinalApp() {
  const [authEmail, setAuthEmail] = useState('');
  const [authBusy, setAuthBusy] = useState<'signin' | 'signout' | null>(null);
  const [authResolved, setAuthResolved] = useState(!supabase);
  const [sessionEmail, setSessionEmail] = useState<string | null>(null);
  const [profile, setProfile] = useState<LogicFinalProfile | null>(null);
  const [progress, setProgress] = useState<LogicFinalProgressRecord[]>([]);
  const [leaderboard, setLeaderboard] = useState<LogicFinalProfile[]>([]);
  const [mode, setMode] = useState<LogicMode>('match');
  const [matchRoundIds, setMatchRoundIds] = useState<string[]>([]);
  const [matchKeywordIds, setMatchKeywordIds] = useState<string[]>([]);
  const [matchedIds, setMatchedIds] = useState<string[]>([]);
  const [selectedFallacyId, setSelectedFallacyId] = useState<string | null>(null);
  const [selectedKeywordId, setSelectedKeywordId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<FeedbackState>({ tone: 'idle', message: 'Drop into the cabinet and start matching.' });
  const [errorMessage, setErrorMessage] = useState('');
  const [statusMessage, setStatusMessage] = useState('');

  const refreshLeaderboard = useCallback(async () => {
    try {
      const entries = await loadLogicFinalLeaderboard(10);
      setLeaderboard(entries);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Unable to load the leaderboard.');
    }
  }, []);

  useEffect(() => {
    if (!supabase) {
      return;
    }

    let cancelled = false;
    const authClient = supabase;

    async function syncSession() {
      try {
        const {
          data: { session },
        } = await authClient.auth.getSession();

        if (cancelled) {
          return;
        }

        const normalizedEmail = session?.user.email?.toLowerCase() ?? null;
        setSessionEmail(normalizedEmail);

        if (!session?.user.id || !normalizedEmail) {
          setProfile(null);
          setProgress([]);
          setAuthResolved(true);
          await refreshLeaderboard();
          return;
        }

        const ensuredProfile = await ensureLogicFinalProfile();
        const loadedProgress = await loadLogicFinalProgress();

        if (cancelled) {
          return;
        }

        const stableProfile =
          ensuredProfile ?? {
            userId: session.user.id,
            email: normalizedEmail,
            displayName: deriveDisplayName(normalizedEmail),
            score: 0,
            currentStreak: 0,
            bestStreak: 0,
            totalCorrect: 0,
            totalAttempts: 0,
            masteredTerms: 0,
            updatedAt: new Date().toISOString(),
          };

        setProfile(stableProfile);
        setProgress(loadedProgress.length ? loadedProgress : buildDefaultProgress(session.user.id));
        setStatusMessage('Signed in. Ready player one.');
        setErrorMessage('');
        setAuthResolved(true);
        await refreshLeaderboard();
      } catch (error) {
        if (!cancelled) {
          setErrorMessage(error instanceof Error ? error.message : 'Unable to sync Logic Final sign-in state.');
          setAuthResolved(true);
        }
      }
    }

    void syncSession();

    const {
      data: { subscription },
    } = authClient.auth.onAuthStateChange(() => {
      void syncSession();
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [refreshLeaderboard]);

  useEffect(() => {
    if (!progress.length || matchRoundIds.length) {
      return;
    }

    const nextRound = pickDueTerms(progress, 4).map((term) => term.id);
    setMatchRoundIds(nextRound);
    setMatchKeywordIds(shuffle(nextRound));
  }, [progress, matchRoundIds.length]);

  useEffect(() => {
    if (!matchRoundIds.length) {
      return;
    }

    const unresolvedIds = matchRoundIds.filter((id) => !matchedIds.includes(id));
    if (!unresolvedIds.length) {
      const nextRound = pickDueTerms(progress, 4).map((term) => term.id);
      setMatchRoundIds(nextRound);
      setMatchKeywordIds(shuffle(nextRound));
      setMatchedIds([]);
      setSelectedFallacyId(null);
      setSelectedKeywordId(null);
      setStatusMessage('Next board loaded. The cabinet is getting meaner.');
    }
  }, [matchedIds, matchRoundIds, progress]);

  const progressById = useMemo(() => buildProgressMap(progress), [progress]);
  const difficultyLabel = useMemo(() => getDifficultyLabel(progress), [progress]);

  const matchTerms = useMemo(
    () => matchRoundIds.map((termId) => logicFinalTerms.find((term) => term.id === termId)).filter(Boolean) as LogicFinalTerm[],
    [matchRoundIds],
  );

  const matchKeywords = useMemo(
    () => matchKeywordIds.map((termId) => logicFinalTerms.find((term) => term.id === termId)).filter(Boolean) as LogicFinalTerm[],
    [matchKeywordIds],
  );
  const arcadeChallenge = useMemo(() => buildArcadeChallenge(progress, false), [progress]);
  const reverseChallenge = useMemo(() => buildArcadeChallenge(progress, true), [progress]);

  const applyAnswer = useCallback(
    async (termId: string, correct: boolean, successMessage: string, failureMessage: string) => {
      if (!profile || !sessionEmail) {
        return;
      }

      const currentRecord =
        progressById.get(termId) ?? {
          userId: profile.userId,
          termId,
          intervalStep: 0,
          easeFactor: 2.3,
          nextDueAt: new Date().toISOString(),
          consecutiveCorrect: 0,
          consecutiveWrong: 0,
          totalCorrect: 0,
          totalWrong: 0,
          masteryLevel: 0,
          updatedAt: new Date().toISOString(),
        };

      const nextRecord = scheduleProgress(currentRecord, correct);
      const nextProgress = progress.map((entry) => (entry.termId === termId ? nextRecord : entry));
      const filledProgress = nextProgress.length ? nextProgress : [nextRecord];
      const nextProfile = updateProfile(profile, filledProgress, correct, nextRecord.masteryLevel);

      setProgress(filledProgress);
      setProfile(nextProfile);
      setFeedback({ tone: correct ? 'correct' : 'wrong', message: correct ? successMessage : failureMessage });
      setStatusMessage(correct ? successMessage : '');
      setErrorMessage('');

      try {
        await saveLogicFinalState(nextProfile, filledProgress);
        await refreshLeaderboard();
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : 'Unable to save Logic Final progress.');
      }
    },
    [profile, progress, progressById, refreshLeaderboard, sessionEmail],
  );

  const resolveMatchSelection = useCallback(
    async (fallacyId: string, keywordId: string) => {
      const correct = fallacyId === keywordId;
      await applyAnswer(
        fallacyId,
        correct,
        'Correct! Coin shower activated.',
        'Nope. The cabinet mocks your hubris and drops that card back into review.',
      );

      if (correct) {
        setMatchedIds((current) => [...current, keywordId]);
      }

      setSelectedFallacyId(null);
      setSelectedKeywordId(null);
    },
    [applyAnswer],
  );

  const handleSendMagicLink = useCallback(async () => {
    if (!supabase) {
      return;
    }

    const normalizedEmail = authEmail.trim().toLowerCase();
    if (!normalizedEmail) {
      setErrorMessage('Enter your email to enter the arcade.');
      return;
    }

    try {
      setAuthBusy('signin');
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
      setAuthBusy(null);
    }
  }, [authEmail]);

  const handleSignOut = useCallback(async () => {
    if (!supabase) {
      return;
    }

    try {
      setAuthBusy('signout');
      setErrorMessage('');
      const { error } = await supabase.auth.signOut();
      if (error) {
        throw error;
      }
      setProfile(null);
      setProgress([]);
      setSessionEmail(null);
      setMatchRoundIds([]);
      setMatchedIds([]);
      setFeedback({ tone: 'idle', message: 'Signed out. The cabinet powers down.' });
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Unable to sign out.');
    } finally {
      setAuthBusy(null);
    }
  }, []);

  const handleMatchSelect = useCallback(
    async (keywordTermId: string) => {
      if (!selectedFallacyId || matchedIds.includes(keywordTermId)) {
        setSelectedKeywordId(keywordTermId);
        return;
      }

      await resolveMatchSelection(selectedFallacyId, keywordTermId);
    },
    [matchedIds, resolveMatchSelection, selectedFallacyId],
  );

  const handleFallacySelect = useCallback(
    async (termId: string) => {
      if (!selectedKeywordId || matchedIds.includes(termId)) {
        setSelectedFallacyId(termId);
        return;
      }

      await resolveMatchSelection(termId, selectedKeywordId);
    },
    [matchedIds, resolveMatchSelection, selectedKeywordId],
  );

  const handleArcadeAnswer = useCallback(
    async (optionId: string) => {
      if (!arcadeChallenge) {
        return;
      }

      const correct = optionId === arcadeChallenge.term.id;
      await applyAnswer(
        arcadeChallenge.term.id,
        correct,
        'Perfect shot. The scoreboard flashes in neon glory.',
        'Missed it. The machine spits the card back out sooner next time.',
      );
    },
    [applyAnswer, arcadeChallenge],
  );

  const handleReverseAnswer = useCallback(
    async (optionId: string) => {
      if (!reverseChallenge) {
        return;
      }

      const correct = optionId === reverseChallenge.term.id;
      await applyAnswer(
        reverseChallenge.term.id,
        correct,
        'Reverse mode cleared. You just unlocked smug philosopher energy.',
        'Reverse mode got you. Good news: the next review just got easier.',
      );
    },
    [applyAnswer, reverseChallenge],
  );

  if (!supabase) {
    return <div className="app-state">Logic Final needs Supabase configured before the cabinet boots.</div>;
  }

  if (!authResolved) {
    return <div className="app-state">Powering up the Logic Final cabinet...</div>;
  }

  return (
    <div className="logic-shell">
      <header className="logic-header">
        <div>
          <p className="logic-header__eyebrow">Retro study arena</p>
          <h1>Logic Final</h1>
          <p>Match fallacies to their keyword tells, climb the leaderboard, and let spaced repetition grind you into shape.</p>
        </div>
        <div className="logic-header__actions">
          <Link className="button" to="/bank">
            <ShieldAlert size={16} />
            Bank portal
          </Link>
          {sessionEmail ? (
            <button className="button" onClick={() => void handleSignOut()} disabled={authBusy !== null}>
              <LogOut size={16} />
              {authBusy === 'signout' ? 'Signing out...' : 'Sign out'}
            </button>
          ) : null}
        </div>
      </header>

      {errorMessage ? <div className="banner banner--error">{errorMessage}</div> : null}
      {statusMessage ? <div className="banner banner--success">{statusMessage}</div> : null}

      <section className="logic-hero">
        <div className="logic-hero__scanlines" />
        <div className="logic-hero__content">
          <div>
            <p className="logic-header__eyebrow">Difficulty</p>
            <h2>{difficultyLabel}</h2>
            <p>Wrong answers surface cards sooner and simplify the board. Correct answers push them farther out and crank up the chaos.</p>
          </div>
          <div className="logic-hero__sprites" aria-hidden="true">
            <span>👾</span>
            <span>🪙</span>
            <span>⭐</span>
            <span>🕹️</span>
          </div>
        </div>
      </section>

      {!sessionEmail ? (
        <section className="logic-grid">
          <div className="chart-card logic-card">
            <div className="section-heading">
              <div>
                <h3>Sign in to play</h3>
                <p>Anyone with a login can play Logic Final. Bank access is separate and still requires your approval.</p>
              </div>
            </div>
            <label>
              <span>Email</span>
              <input
                type="email"
                value={authEmail}
                placeholder="you@example.com"
                onChange={(event) => setAuthEmail(event.target.value)}
                disabled={authBusy !== null}
              />
            </label>
            <button className="button button--primary" onClick={() => void handleSendMagicLink()} disabled={authBusy !== null}>
              <LogIn size={16} />
              {authBusy === 'signin' ? 'Sending magic link...' : 'Enter the cabinet'}
            </button>
          </div>
          <LeaderboardCard entries={leaderboard} sessionEmail={sessionEmail} />
        </section>
      ) : (
        <section className="logic-grid">
          <div className="logic-grid__main">
            <div className="chart-card logic-card logic-card--profile">
              <div className="logic-profile__header">
                <div>
                  <p className="logic-header__eyebrow">Player one</p>
                  <h3>{profile?.displayName ?? deriveDisplayName(sessionEmail)}</h3>
                  <p>{sessionEmail}</p>
                </div>
                <div className={`logic-feedback logic-feedback--${feedback.tone}`}>
                  <Sparkles size={16} />
                  <span>{feedback.message}</span>
                </div>
              </div>
              <div className="logic-profile__stats">
                <div>
                  <strong>{profile?.score ?? 0}</strong>
                  <span>score</span>
                </div>
                <div>
                  <strong>{profile?.currentStreak ?? 0}</strong>
                  <span>streak</span>
                </div>
                <div>
                  <strong>{profile?.masteredTerms ?? 0}/{logicFinalTermCount}</strong>
                  <span>mastered</span>
                </div>
                <div>
                  <strong>{profile?.totalAttempts ? Math.round(((profile.totalCorrect / profile.totalAttempts) * 100)) : 0}%</strong>
                  <span>accuracy</span>
                </div>
              </div>
              <div className="logic-mode-tabs">
                <button className={`button ${mode === 'match' ? 'button--primary' : ''}`} onClick={() => setMode('match')}>
                  <Swords size={16} />
                  Column Match
                </button>
                <button className={`button ${mode === 'arcade' ? 'button--primary' : ''}`} onClick={() => setMode('arcade')}>
                  <Gamepad2 size={16} />
                  Lightning Match
                </button>
                <button className={`button ${mode === 'reverse' ? 'button--primary' : ''}`} onClick={() => setMode('reverse')}>
                  <Crown size={16} />
                  Reverse Rush
                </button>
              </div>
            </div>

            {mode === 'match' ? (
              <div className="chart-card logic-card logic-card--board">
                <div className="section-heading">
                  <div>
                    <h3>Column Match</h3>
                    <p>Pick a fallacy on the left, then match it to its keyword tell on the right.</p>
                  </div>
                </div>
                <div className="logic-match-board">
                  <div className="logic-match-column">
                    {matchTerms.map((term) => {
                      const isResolved = matchedIds.includes(term.id);
                      const mastery = progressById.get(term.id)?.masteryLevel ?? 0;
                      return (
                        <button
                          key={term.id}
                          className={`logic-match-card ${selectedFallacyId === term.id ? 'logic-match-card--selected' : ''} ${
                            isResolved ? 'logic-match-card--resolved' : ''
                          }`}
                          disabled={isResolved}
                          onClick={() => void handleFallacySelect(term.id)}
                        >
                          <strong>{term.name}</strong>
                          <small>Difficulty {clamp(mastery + 1, 1, 6)}</small>
                        </button>
                      );
                    })}
                  </div>
                  <div className="logic-match-column">
                    {matchKeywords.map((term) => {
                      const isResolved = matchedIds.includes(term.id);
                      return (
                        <button
                          key={term.id}
                          className={`logic-match-card ${selectedKeywordId === term.id ? 'logic-match-card--selected' : ''} ${
                            isResolved ? 'logic-match-card--resolved' : ''
                          }`}
                          disabled={isResolved}
                          onClick={() => void handleMatchSelect(term.id)}
                        >
                          <strong>{term.keyword}</strong>
                          <small>{isResolved ? 'Cleared' : 'Match me'}</small>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            ) : null}

            {mode === 'arcade' && arcadeChallenge ? (
              <div className="chart-card logic-card logic-card--board">
                <div className="section-heading">
                  <div>
                    <h3>Lightning Match</h3>
                    <p>Tap the right keyword as the machine adds more distractors for terms you know well.</p>
                  </div>
                </div>
                <div className="logic-prompt">
                  <strong>{arcadeChallenge.term.name}</strong>
                  <p>Choose the strongest keyword tell.</p>
                </div>
                <div className="logic-answer-grid">
                  {arcadeChallenge.options.map((option) => (
                    <button key={option.id} className="logic-answer-card" onClick={() => void handleArcadeAnswer(option.id)}>
                      {option.keyword}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {mode === 'reverse' && reverseChallenge ? (
              <div className="chart-card logic-card logic-card--board">
                <div className="section-heading">
                  <div>
                    <h3>Reverse Rush</h3>
                    <p>Read the keyword tell first and identify the fallacy name before the cabinet laughs at you.</p>
                  </div>
                </div>
                <div className="logic-prompt">
                  <strong>{reverseChallenge.term.keyword}</strong>
                  <p>Which fallacy does this keyword cue?</p>
                </div>
                <div className="logic-answer-grid">
                  {reverseChallenge.options.map((option) => (
                    <button key={option.id} className="logic-answer-card" onClick={() => void handleReverseAnswer(option.id)}>
                      {option.name}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>

          <div className="logic-grid__side">
            <LeaderboardCard entries={leaderboard} sessionEmail={sessionEmail} />
            <div className="chart-card logic-card">
              <div className="section-heading">
                <div>
                  <h3>How the cabinet adapts</h3>
                  <p>Correct answers push cards farther out and increase choice complexity. Wrong answers bring them back quickly and soften the next round.</p>
                </div>
              </div>
              <div className="logic-rules">
                <div>
                  <strong>Get it right</strong>
                  <p>More points, longer review interval, tougher distractors.</p>
                </div>
                <div>
                  <strong>Get it wrong</strong>
                  <p>Shorter interval, lower mastery, easier resurfacing.</p>
                </div>
                <div>
                  <strong>Leaderboard</strong>
                  <p>Tracks score, streak, and total correct answers for every logged-in player.</p>
                </div>
              </div>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

interface LeaderboardCardProps {
  entries: LogicFinalProfile[];
  sessionEmail: string | null;
}

function LeaderboardCard({ entries, sessionEmail }: LeaderboardCardProps) {
  return (
    <div className="chart-card logic-card">
      <div className="section-heading">
        <div>
          <h3>Leaderboard</h3>
          <p>Only logged-in players can enter. Highest score wins, ties break on streaks and total correct.</p>
        </div>
      </div>
      {entries.length ? (
        <div className="logic-leaderboard">
          {entries.map((entry, index) => (
            <div key={entry.userId} className={`logic-leaderboard__row ${entry.email === sessionEmail ? 'logic-leaderboard__row--self' : ''}`}>
              <div>
                <strong>
                  #{index + 1} {entry.displayName}
                </strong>
                <p>{entry.email}</p>
              </div>
              <div>
                <strong>{entry.score}</strong>
                <p>{entry.bestStreak} best streak</p>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="empty-state">No high scores yet. Be the first pixel hero.</div>
      )}
    </div>
  );
}
