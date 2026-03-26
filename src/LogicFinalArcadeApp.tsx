import { useCallback, useEffect, useMemo, useState } from 'react';
import { LogIn, LogOut, Sparkles, Trophy } from 'lucide-react';
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
import './logicFinalArcade.css';

type ChallengeKind = 'keyword' | 'name';
type FeedbackTone = 'correct' | 'wrong' | 'idle';
type StagePhase = 'playing' | 'victory' | 'chomp' | 'level-clear';

interface FeedbackState {
  tone: FeedbackTone;
  message: string;
}

interface GorillaOption {
  id: string;
  label: string;
  secondary?: string;
  isCorrect: boolean;
}

interface GorillaChallenge {
  id: string;
  kind: ChallengeKind;
  prompt: string;
  promptDetail: string;
  answerTermId: string;
  target: LogicFinalTerm;
  options: GorillaOption[];
}

const MAX_LIVES = 3;
const LEVEL_CLEAR_DELAY_MS = 1400;
const OUTCOME_DELAY_MS = 1000;
const INITIAL_BRAIN_PROGRESS = 3;
const STAGE_OPTION_POSITIONS = [
  { left: '7%', top: '58%' },
  { left: '39%', top: '50%' },
  { left: '69%', top: '42%' },
  { left: '14%', top: '80%' },
  { left: '47%', top: '72%' },
  { left: '73%', top: '64%' },
];

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

function buildBlankRecord(userId: string, termId: string): LogicFinalProgressRecord {
  return {
    userId,
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
}

function buildProgressMap(progress: LogicFinalProgressRecord[]): Map<string, LogicFinalProgressRecord> {
  return new Map(progress.map((record) => [record.termId, record]));
}

function getAverageMastery(progress: LogicFinalProgressRecord[]): number {
  if (!progress.length) {
    return 0;
  }

  return progress.reduce((sum, record) => sum + record.masteryLevel, 0) / progress.length;
}

function getDifficultyLabel(progress: LogicFinalProgressRecord[], level: number): string {
  const averageMastery = getAverageMastery(progress);
  if (level <= 2 && averageMastery < 1.5) {
    return 'Training Girders';
  }
  if (level <= 4) {
    return 'Primary Panic';
  }
  if (level <= 6) {
    return 'Ladder Scramble';
  }
  if (averageMastery >= 4) {
    return 'Princess Sprint';
  }
  return 'Gorilla Gauntlet';
}

function getChallengeLabel(kind: ChallengeKind): string {
  if (kind === 'keyword') {
    return 'Match the keyword';
  }
  return 'Match the fallacy';
}

function getLevelGoal(level: number): number {
  return clamp(7 + Math.floor((level - 1) / 2), 7, 10);
}

function pickDueTerms(progress: LogicFinalProgressRecord[], count: number): LogicFinalTerm[] {
  const progressById = buildProgressMap(progress);
  const now = Date.now();
  const ranked = logicFinalTerms
    .map((term) => ({
      term,
      progress: progressById.get(term.id) ?? buildBlankRecord('', term.id),
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

function buildChallenge(progress: LogicFinalProgressRecord[], level: number, serial: number): GorillaChallenge | null {
  const progressById = buildProgressMap(progress);
  const dueTerms = pickDueTerms(progress, clamp(6 + level, 6, 12));
  const pool = dueTerms.length ? dueTerms : logicFinalTerms;
  const target = pool[serial % pool.length];

  if (!target) {
    return null;
  }

  const mastery = progressById.get(target.id)?.masteryLevel ?? 0;
  const choiceCount = clamp(3 + Math.floor(level / 2) + Math.floor(mastery / 3), 3, 6);
  const distractors = shuffle(logicFinalTerms.filter((term) => term.id !== target.id)).slice(0, choiceCount - 1);
  const kind: ChallengeKind = (serial + level) % 2 === 0 ? 'keyword' : 'name';

  if (kind === 'keyword') {
    const options = shuffle([
      {
        id: `${target.id}-keyword`,
        label: target.keyword,
        isCorrect: true,
      },
      ...distractors.map((term) => ({
        id: `${term.id}-keyword`,
        label: term.keyword,
        isCorrect: false,
      })),
    ]);

    return {
      id: `${target.id}-${kind}-${serial}`,
      kind,
      prompt: target.name,
      promptDetail: 'Tap the matching keyword floating on the girders.',
      answerTermId: target.id,
      target,
      options,
    };
  }

  if (kind === 'name') {
    const options = shuffle([
      {
        id: `${target.id}-name`,
        label: target.name,
        isCorrect: true,
      },
      ...distractors.map((term) => ({
        id: `${term.id}-name`,
        label: term.name,
        isCorrect: false,
      })),
    ]);

    return {
      id: `${target.id}-${kind}-${serial}`,
      kind,
      prompt: target.keyword,
      promptDetail: 'Tap the matching fallacy before the gorilla catches up.',
      answerTermId: target.id,
      target,
      options,
    };
  }

  return null;
}

function getTimeLimit(level: number, progress: LogicFinalProgressRecord[], challenge: GorillaChallenge | null): number {
  const averageMastery = getAverageMastery(progress);
  const typePenalty = challenge?.kind === 'name' ? 2 : 0;
  const base = 40 - Math.floor((level - 1) * 2.4) - Math.floor(averageMastery / 1.5) - typePenalty;
  return clamp(base, 12, 40);
}

function getBrainStagePosition(progressValue: number, goal: number) {
  const ratio = clamp(progressValue / Math.max(goal, 1), 0, 1);
  return {
    left: `${14 + ratio * 70}%`,
    top: `${76 - ratio * 60}%`,
  };
}

function getGorillaStagePosition(progressValue: number, goal: number) {
  const ratio = clamp(progressValue / Math.max(goal, 1), 0, 1);
  return {
    left: `${10 + ratio * 48}%`,
    top: `${16 + ratio * 36}%`,
  };
}

function getStageOptionPosition(index: number) {
  return STAGE_OPTION_POSITIONS[index % STAGE_OPTION_POSITIONS.length];
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

function upsertProgress(progress: LogicFinalProgressRecord[], nextRecord: LogicFinalProgressRecord): LogicFinalProgressRecord[] {
  const exists = progress.some((entry) => entry.termId === nextRecord.termId);
  const nextProgress = exists
    ? progress.map((entry) => (entry.termId === nextRecord.termId ? nextRecord : entry))
    : [...progress, nextRecord];
  return [...nextProgress].sort((left, right) => left.termId.localeCompare(right.termId));
}

function updateProfile(
  profile: LogicFinalProfile,
  progress: LogicFinalProgressRecord[],
  correct: boolean,
  difficultyLevel: number,
  level: number,
  timeRemaining: number,
): LogicFinalProfile {
  const points = correct ? 70 + difficultyLevel * 14 + level * 18 + timeRemaining * 2 : -18;
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

function getLogicFinalRedirectUrl(): string {
  return `${window.location.origin}${window.location.pathname}`;
}

function clearAuthCallbackUrl(): void {
  const sanitizedUrl = new URL(window.location.href);
  sanitizedUrl.hash = '';
  sanitizedUrl.searchParams.delete('code');
  sanitizedUrl.searchParams.delete('token_hash');
  sanitizedUrl.searchParams.delete('type');
  sanitizedUrl.searchParams.delete('next');
  sanitizedUrl.searchParams.delete('error');
  sanitizedUrl.searchParams.delete('error_code');
  sanitizedUrl.searchParams.delete('error_description');
  window.history.replaceState(window.history.state, '', sanitizedUrl.toString());
}

async function hydrateLogicFinalAuthCallback() {
  if (!supabase) {
    return null;
  }

  const currentUrl = new URL(window.location.href);
  const hashParams = new URLSearchParams(currentUrl.hash.startsWith('#') ? currentUrl.hash.slice(1) : currentUrl.hash);
  const searchCode = currentUrl.searchParams.get('code');
  const tokenHash = currentUrl.searchParams.get('token_hash') ?? hashParams.get('token_hash');
  const authType = currentUrl.searchParams.get('type') ?? hashParams.get('type');
  const implicitAccessToken = hashParams.get('access_token');
  const implicitRefreshToken = hashParams.get('refresh_token');
  const authError = currentUrl.searchParams.get('error_description') ?? hashParams.get('error_description');

  if (authError) {
    clearAuthCallbackUrl();
    throw new Error(decodeURIComponent(authError.replace(/\+/g, ' ')));
  }

  if (searchCode) {
    const { error } = await supabase.auth.exchangeCodeForSession(searchCode);
    if (error) {
      clearAuthCallbackUrl();
      throw error;
    }
    clearAuthCallbackUrl();
    return 'pkce';
  }

  if (tokenHash && authType) {
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: authType as 'signup' | 'email' | 'recovery' | 'invite' | 'email_change' | 'magiclink',
    });
    if (error) {
      clearAuthCallbackUrl();
      throw error;
    }
    clearAuthCallbackUrl();
    return 'otp';
  }

  if (implicitAccessToken && implicitRefreshToken) {
    const { error } = await supabase.auth.setSession({
      access_token: implicitAccessToken,
      refresh_token: implicitRefreshToken,
    });
    if (error) {
      clearAuthCallbackUrl();
      throw error;
    }
    clearAuthCallbackUrl();
    return 'implicit';
  }

  return null;
}

export default function LogicFinalArcadeApp() {
  const [authEmail, setAuthEmail] = useState('');
  const [authBusy, setAuthBusy] = useState<'signin' | 'signout' | null>(null);
  const [authResolved, setAuthResolved] = useState(!supabase);
  const [sessionEmail, setSessionEmail] = useState<string | null>(null);
  const [profile, setProfile] = useState<LogicFinalProfile | null>(null);
  const [progress, setProgress] = useState<LogicFinalProgressRecord[]>([]);
  const [leaderboard, setLeaderboard] = useState<LogicFinalProfile[]>([]);
  const [feedback, setFeedback] = useState<FeedbackState>({ tone: 'idle', message: 'The princess is waiting. Try not to get eaten immediately.' });
  const [errorMessage, setErrorMessage] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const [level, setLevel] = useState(1);
  const [lives, setLives] = useState(MAX_LIVES);
  const [brainProgress, setBrainProgress] = useState(INITIAL_BRAIN_PROGRESS);
  const [gorillaProgress, setGorillaProgress] = useState(0);
  const [challengeSerial, setChallengeSerial] = useState(0);
  const [activeChallenge, setActiveChallenge] = useState<GorillaChallenge | null>(null);
  const [timeRemaining, setTimeRemaining] = useState(0);
  const [phase, setPhase] = useState<StagePhase>('playing');
  const [sceneCaption, setSceneCaption] = useState('Climb the girders, smack the gorilla, rescue the princess.');
  const [selectedOptionId, setSelectedOptionId] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);

  const refreshLeaderboard = useCallback(async () => {
    try {
      const entries = await loadLogicFinalLeaderboard(10);
      setLeaderboard(entries);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Unable to load the leaderboard.');
    }
  }, []);

  const resetRunState = useCallback((caption: string, message: string) => {
    setLevel(1);
    setLives(MAX_LIVES);
    setBrainProgress(INITIAL_BRAIN_PROGRESS);
    setGorillaProgress(0);
    setChallengeSerial(0);
    setActiveChallenge(null);
    setTimeRemaining(0);
    setPhase('playing');
    setResolving(false);
    setSelectedOptionId(null);
    setSceneCaption(caption);
    setFeedback({ tone: 'idle', message });
  }, []);

  useEffect(() => {
    if (!supabase) {
      return;
    }

    let cancelled = false;
    const authClient = supabase;

    async function syncSession() {
      try {
        await hydrateLogicFinalAuthCallback();

        if (cancelled) {
          return;
        }

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
          resetRunState('The cabinet is idling until a hero logs in.', 'Log in or register from this page to save your score and enter the leaderboard.');
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
        resetRunState('The gorilla sees you. The gorilla disapproves. Start climbing.', 'Signed in. Rescue the princess before the gorilla makes a snack of you.');
        setStatusMessage('Signed in. Ready for gorilla trouble.');
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
  }, [refreshLeaderboard, resetRunState]);

  const progressById = useMemo(() => buildProgressMap(progress), [progress]);
  const accuracy = useMemo(
    () => (profile?.totalAttempts ? Math.round((profile.totalCorrect / profile.totalAttempts) * 100) : 0),
    [profile],
  );
  const difficultyLabel = useMemo(() => getDifficultyLabel(progress, level), [level, progress]);
  const stageGoal = useMemo(() => getLevelGoal(level), [level]);
  const levelProgressPercent = useMemo(() => (stageGoal ? Math.round((brainProgress / stageGoal) * 100) : 0), [brainProgress, stageGoal]);
  const gorillaPercent = useMemo(() => (stageGoal ? Math.round((gorillaProgress / stageGoal) * 100) : 0), [gorillaProgress, stageGoal]);
  const currentTimeLimit = useMemo(() => getTimeLimit(level, progress, activeChallenge), [activeChallenge, level, progress]);
  const timerPercent = useMemo(() => (currentTimeLimit ? Math.round((timeRemaining / currentTimeLimit) * 100) : 0), [currentTimeLimit, timeRemaining]);
  const brainStageStyle = useMemo(() => getBrainStagePosition(brainProgress, stageGoal), [brainProgress, stageGoal]);
  const gorillaStageStyle = useMemo(() => getGorillaStagePosition(gorillaProgress, stageGoal), [gorillaProgress, stageGoal]);

  const queueNextChallenge = useCallback(
    (nextLevel: number, nextProgress: LogicFinalProgressRecord[], serial: number) => {
      const challenge = buildChallenge(nextProgress, nextLevel, serial);
      setActiveChallenge(challenge);
      setTimeRemaining(getTimeLimit(nextLevel, nextProgress, challenge));
      setSelectedOptionId(null);
    },
    [],
  );

  useEffect(() => {
    if (!sessionEmail || !profile || !progress.length || activeChallenge || phase !== 'playing' || resolving) {
      return;
    }

    queueNextChallenge(level, progress, challengeSerial);
  }, [activeChallenge, challengeSerial, level, phase, profile, progress, queueNextChallenge, resolving, sessionEmail]);

  const applyAnswer = useCallback(
    async (termId: string, correct: boolean, successMessage: string, failureMessage: string) => {
      if (!profile || !sessionEmail) {
        return null;
      }

      const currentRecord = progressById.get(termId) ?? buildBlankRecord(profile.userId, termId);
      const nextRecord = scheduleProgress(currentRecord, correct);
      const nextProgress = upsertProgress(progress, nextRecord);
      const nextProfile = updateProfile(profile, nextProgress, correct, nextRecord.masteryLevel, level, timeRemaining);

      setProgress(nextProgress);
      setProfile(nextProfile);
      setFeedback({ tone: correct ? 'correct' : 'wrong', message: correct ? successMessage : failureMessage });
      setStatusMessage(correct ? successMessage : '');
      setErrorMessage('');

      try {
        await saveLogicFinalState(nextProfile, nextProgress);
        await refreshLeaderboard();
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : 'Unable to save Logic Final progress.');
      }

      return { nextProfile, nextProgress };
    },
    [level, profile, progress, progressById, refreshLeaderboard, sessionEmail, timeRemaining],
  );

  const resolveOutcome = useCallback(
    async (correct: boolean, optionId: string | null, reason: 'wrong' | 'timeout' | 'correct') => {
      if (!activeChallenge || resolving) {
        return;
      }

      setResolving(true);
      setSelectedOptionId(optionId);

      const successMessage =
        brainProgress + 1 >= stageGoal
          ? 'Correct. The brain reaches the princess and the next level gets harder.'
          : 'Correct. The brain scrambles one step closer to the princess.';
      const failureMessage =
        reason === 'timeout'
          ? 'Too slow. The gorilla stomps closer while the brain hesitates.'
          : 'Wrong answer. The brain slips back and the gorilla lurches forward.';

      await applyAnswer(activeChallenge.answerTermId, correct, successMessage, failureMessage);

      if (correct) {
        const nextBrainProgress = brainProgress + 1;
        setBrainProgress(nextBrainProgress);

        if (nextBrainProgress >= stageGoal) {
          const nextLevel = level + 1;
          setPhase('level-clear');
          setSceneCaption('The brain reaches the princess. New level, tougher answers, meaner gorilla.');
          window.setTimeout(() => {
            setLevel(nextLevel);
            setLives((current) => clamp(current + 1, 1, MAX_LIVES));
            setBrainProgress(INITIAL_BRAIN_PROGRESS);
            setGorillaProgress(0);
            setChallengeSerial((current) => current + 1);
            setActiveChallenge(null);
            setSelectedOptionId(null);
            setTimeRemaining(0);
            setPhase('playing');
            setResolving(false);
            setSceneCaption('Fresh stage. The brain races upward while the gorilla plots revenge.');
          }, LEVEL_CLEAR_DELAY_MS);
          return;
        }

        setPhase('victory');
        setSceneCaption('Correct. The brain hops closer to the princess while the gorilla growls below.');
        window.setTimeout(() => {
          setChallengeSerial((current) => current + 1);
          setActiveChallenge(null);
          setSelectedOptionId(null);
          setTimeRemaining(0);
          setPhase('playing');
          setResolving(false);
          setSceneCaption('Keep matching. The princess is still just out of reach.');
        }, OUTCOME_DELAY_MS);
        return;
      }

      const nextBrainProgress = Math.max(1, brainProgress - 1);
      const nextGorillaProgress = gorillaProgress + 1;
      const gorillaCaughtBrain = nextGorillaProgress >= nextBrainProgress;

      setBrainProgress(nextBrainProgress);
      setGorillaProgress(nextGorillaProgress);
      setPhase('chomp');
      setSceneCaption(
        gorillaCaughtBrain
          ? 'The gorilla reaches the brain. You lose the chase and reset the stage.'
          : reason === 'timeout'
            ? 'Too slow. The brain freezes and the gorilla charges closer.'
            : 'Wrong answer. The brain slides back and the gorilla closes the gap.',
      );

      window.setTimeout(() => {
        if (gorillaCaughtBrain) {
          const nextLives = lives - 1;
          setLives(Math.max(0, nextLives));

          if (nextLives <= 0) {
            setLevel(1);
            setLives(MAX_LIVES);
            setBrainProgress(INITIAL_BRAIN_PROGRESS);
            setGorillaProgress(0);
            setChallengeSerial((current) => current + 1);
            setActiveChallenge(null);
            setSelectedOptionId(null);
            setTimeRemaining(0);
            setPhase('playing');
            setResolving(false);
            setStatusMessage('Game over. New run started with a longer timer and a less cocky brain.');
            setSceneCaption('Fresh run. Same princess. Same gorilla. Clearer answers.');
            return;
          }

          setBrainProgress(INITIAL_BRAIN_PROGRESS);
          setGorillaProgress(0);
          setChallengeSerial((current) => current + 1);
          setActiveChallenge(null);
          setSelectedOptionId(null);
          setTimeRemaining(0);
          setPhase('playing');
          setResolving(false);
          setStatusMessage('The gorilla caught the brain. One life lost. Resetting the chase.');
          setSceneCaption('The brain gets another shot. Stay ahead of the gorilla.');
          return;
        }

        setChallengeSerial((current) => current + 1);
        setActiveChallenge(null);
        setSelectedOptionId(null);
        setTimeRemaining(0);
        setPhase('playing');
        setResolving(false);
        setSceneCaption('Still alive. Pick the next match before the gorilla gains more ground.');
      }, OUTCOME_DELAY_MS + 250);
    },
    [activeChallenge, applyAnswer, brainProgress, gorillaProgress, level, lives, resolving, stageGoal],
  );

  useEffect(() => {
    if (!sessionEmail || !activeChallenge || phase !== 'playing' || resolving) {
      return;
    }

    if (timeRemaining <= 0) {
      void resolveOutcome(false, null, 'timeout');
      return;
    }

    const timer = window.setTimeout(() => {
      setTimeRemaining((current) => current - 1);
    }, 1000);

    return () => {
      window.clearTimeout(timer);
    };
  }, [activeChallenge, phase, resolveOutcome, resolving, sessionEmail, timeRemaining]);

  const handleSendMagicLink = useCallback(async () => {
    if (!supabase) {
      return;
    }

    const normalizedEmail = authEmail.trim().toLowerCase();
    if (!normalizedEmail) {
      setErrorMessage('Enter your email to log in or register from this page.');
      return;
    }

    try {
      setAuthBusy('signin');
      setErrorMessage('');
      setStatusMessage('');
      const { error } = await supabase.auth.signInWithOtp({
        email: normalizedEmail,
        options: {
          emailRedirectTo: getLogicFinalRedirectUrl(),
        },
      });

      if (error) {
        throw error;
      }

      setStatusMessage(`Magic link sent to ${normalizedEmail}. Open it to log in or finish registering.`);
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
      resetRunState('The cabinet powers down with a rude little buzz.', 'Signed out. The gorilla takes the rest of the shift off.');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Unable to sign out.');
    } finally {
      setAuthBusy(null);
    }
  }, [resetRunState]);

  const handleAnswer = useCallback(
    async (option: GorillaOption) => {
      if (!activeChallenge || resolving || phase !== 'playing') {
        return;
      }

      await resolveOutcome(option.isCorrect, option.id, option.isCorrect ? 'correct' : 'wrong');
    },
    [activeChallenge, phase, resolveOutcome, resolving],
  );

  const handleRestartRun = useCallback(() => {
    if (!sessionEmail) {
      return;
    }

    resetRunState('Fresh girders. Deep breath. The gorilla still looks disrespectful.', 'Run restarted. Match names to keywords and keep the brain moving.');
  }, [resetRunState, sessionEmail]);

  if (!supabase) {
    return <div className="app-state">Logic Final needs Supabase configured before the cabinet boots.</div>;
  }

  if (!authResolved) {
    return <div className="app-state">Loading the gorilla rescue cabinet...</div>;
  }

  return (
    <div className="logic-kong-shell">
      <header className="logic-kong-header">
        <div>
          <p className="logic-kong-header__eyebrow">Gorilla rescue cabinet</p>
          <h1>Logic Final</h1>
          <p>Old-school arcade panic: answer fast, avoid becoming gorilla brunch, rescue the princess, and survive increasingly cruel timers.</p>
        </div>
        <div className="logic-kong-header__actions">
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

      <section className="chart-card logic-kong-hero">
        <div className="logic-kong-hero__copy">
          <p className="logic-kong-header__eyebrow">Current cabinet mood</p>
          <h2>{difficultyLabel}</h2>
          <p>Match one clue at a time, keep the brain ahead of the gorilla, and reach the princess before the chase collapses.</p>
        </div>
        <div className="logic-kong-hero__marquee" aria-hidden="true">
          <span>🦍</span>
          <span>🧠</span>
          <span>👸</span>
          <span>🔨</span>
          <span>🛢️</span>
        </div>
      </section>

      {!sessionEmail ? (
        <section className="logic-kong-grid">
          <div className="chart-card logic-kong-card logic-kong-card--auth">
            <div className="section-heading">
              <div>
                <h3>Log in or register to play</h3>
                <p>Enter your email on this page to log in or create your account. The magic link drops you straight back into the gorilla rescue run.</p>
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
              {authBusy === 'signin' ? 'Sending magic link...' : 'Log in or register'}
            </button>
            <div className="logic-kong-auth__hint">
              <Sparkles size={16} />
              <span>Save your score, keep your streak, and show up on the leaderboard.</span>
            </div>
          </div>
          <LeaderboardCard entries={leaderboard} sessionEmail={sessionEmail} />
        </section>
      ) : (
        <section className="logic-kong-grid">
          <div className="logic-kong-main">
            <div className="chart-card logic-kong-card logic-kong-card--status">
              <div className="logic-kong-player">
                <div>
                  <p className="logic-kong-header__eyebrow">Player one</p>
                  <h3>{profile?.displayName ?? deriveDisplayName(sessionEmail)}</h3>
                  <p>{sessionEmail}</p>
                </div>
                <div className={`logic-kong-feedback logic-kong-feedback--${feedback.tone}`}>
                  <Sparkles size={16} />
                  <span>{feedback.message}</span>
                </div>
              </div>
              <div className="logic-kong-stats">
                <StatTile label="score" value={profile?.score ?? 0} />
                <StatTile label="streak" value={profile?.currentStreak ?? 0} />
                <StatTile label="mastered" value={`${profile?.masteredTerms ?? 0}/${logicFinalTermCount}`} />
                <StatTile label="accuracy" value={`${accuracy}%`} />
                <StatTile label="level" value={level} />
                <StatTile label="lives" value={Array.from({ length: Math.max(lives, 0) }).map(() => '♥').join(' ') || '0'} />
              </div>
              <div className="logic-kong-meter-grid">
                <MeterCard label="Brain progress" value={`${brainProgress}/${stageGoal}`} percent={levelProgressPercent} accent="gold" />
                <MeterCard label="Gorilla chase" value={`${gorillaProgress}/${stageGoal}`} percent={gorillaPercent} accent={gorillaPercent >= 70 ? 'danger' : 'cyan'} />
                <MeterCard label="Timer" value={`${timeRemaining}s`} percent={timerPercent} accent={timerPercent <= 35 ? 'danger' : 'cyan'} />
              </div>
              <div className="logic-kong-actions">
                <button className="button" onClick={handleRestartRun} disabled={resolving}>
                  Restart run
                </button>
              </div>
            </div>

            <div className={`chart-card logic-kong-card logic-kong-card--stage logic-kong-card--${phase}`}>
              <div className="logic-kong-stage__hud">
                <span>Stage {level}</span>
                <span>{getChallengeLabel(activeChallenge?.kind ?? 'keyword')}</span>
                <span>Reach {stageGoal} to save the princess</span>
              </div>
              <div className={`logic-kong-stage logic-kong-stage--${phase}`}>
                <div className="logic-kong-stage__girder logic-kong-stage__girder--top" />
                <div className="logic-kong-stage__girder logic-kong-stage__girder--mid" />
                <div className="logic-kong-stage__girder logic-kong-stage__girder--bottom" />
                <div className="logic-kong-stage__ladder logic-kong-stage__ladder--left" />
                <div className="logic-kong-stage__ladder logic-kong-stage__ladder--right" />
                <div className="logic-kong-stage__sprite logic-kong-stage__sprite--princess">👸</div>
                <div className="logic-kong-stage__sprite logic-kong-stage__sprite--gorilla" style={gorillaStageStyle}>🦍</div>
                <div className="logic-kong-stage__sprite logic-kong-stage__sprite--player" style={brainStageStyle}>🧠</div>
                <div className="logic-kong-stage__barrels">
                  <span>🛢️</span>
                  <span>🛢️</span>
                  <span>🛢️</span>
                </div>
                <div className="logic-kong-stage__sparkles">
                  <span>✦</span>
                  <span>✦</span>
                  <span>✦</span>
                </div>
                {activeChallenge ? (
                  <>
                    <div className="logic-kong-stage__prompt">
                      <span className="logic-kong-stage__prompt-eyebrow">{getChallengeLabel(activeChallenge.kind)}</span>
                      <strong>{activeChallenge.prompt}</strong>
                      <p>{activeChallenge.promptDetail}</p>
                    </div>
                    {activeChallenge.options.map((option, index) => {
                      const stateClass = option.id === selectedOptionId ? 'logic-kong-stage__answer--selected' : '';
                      return (
                        <button
                          key={option.id}
                          className={`logic-kong-stage__answer ${stateClass}`}
                          style={getStageOptionPosition(index)}
                          onClick={() => void handleAnswer(option)}
                          disabled={resolving || phase !== 'playing'}
                        >
                          {option.label}
                        </button>
                      );
                    })}
                  </>
                ) : (
                  <div className="logic-kong-stage__prompt logic-kong-stage__prompt--loading">
                    <strong>Loading the next clue...</strong>
                    <p>The gorilla is rummaging through the fallacies.</p>
                  </div>
                )}
              </div>
              <p className="logic-kong-stage__caption">{sceneCaption}</p>
            </div>
          </div>

          <div className="logic-kong-side">
            <LeaderboardCard entries={leaderboard} sessionEmail={sessionEmail} />
            <div className="chart-card logic-kong-card logic-kong-card--rules">
              <div className="section-heading">
                <div>
                  <h3>How this cabinet works</h3>
                  <p>One clue appears at a time inside the stage. You should never need to look away from the chase to answer.</p>
                </div>
              </div>
              <div className="logic-kong-rules">
                <RuleCard title="Read one clue" body="The floating label shows either a fallacy name or a keyword. Tap the single matching answer inside the stage." />
                <RuleCard title="Correct answer" body="The brain moves closer to the princess. Reach the goal line to clear the level and make the next stage harder." />
                <RuleCard title="Wrong answer" body="The brain slips back and the gorilla moves closer. If the gorilla reaches the brain, you lose a life and the chase resets." />
                <RuleCard title="Longer opening timer" body="Early levels now start much slower so new players can learn the matches before the pace ramps up." />
              </div>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

interface StatTileProps {
  label: string;
  value: number | string;
}

function StatTile({ label, value }: StatTileProps) {
  return (
    <div className="logic-kong-stat">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

interface MeterCardProps {
  label: string;
  value: string;
  percent: number;
  accent: 'gold' | 'cyan' | 'danger';
}

function MeterCard({ label, value, percent, accent }: MeterCardProps) {
  return (
    <div className="logic-kong-meter-card">
      <div className="logic-kong-meter-card__top">
        <strong>{label}</strong>
        <span>{value}</span>
      </div>
      <div className="logic-kong-meter">
        <div className={`logic-kong-meter__fill logic-kong-meter__fill--${accent}`} style={{ width: `${clamp(percent, 0, 100)}%` }} />
      </div>
    </div>
  );
}

interface RuleCardProps {
  title: string;
  body: string;
}

function RuleCard({ title, body }: RuleCardProps) {
  return (
    <div className="logic-kong-rule">
      <strong>{title}</strong>
      <p>{body}</p>
    </div>
  );
}

interface LeaderboardCardProps {
  entries: LogicFinalProfile[];
  sessionEmail: string | null;
}

function LeaderboardCard({ entries, sessionEmail }: LeaderboardCardProps) {
  return (
    <div className="chart-card logic-kong-card logic-kong-card--leaderboard">
      <div className="section-heading">
        <div>
          <h3>Leaderboard</h3>
          <p>Logged-in players keep their score, streaks, and princess-saving bragging rights.</p>
        </div>
        <Trophy size={18} />
      </div>
      {entries.length ? (
        <div className="logic-kong-leaderboard">
          {entries.map((entry, index) => (
            <div key={entry.userId} className={`logic-kong-leaderboard__row ${entry.email === sessionEmail ? 'logic-kong-leaderboard__row--self' : ''}`}>
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
        <div className="empty-state">No high scores yet. Be the first gorilla-whacking scholar.</div>
      )}
    </div>
  );
}
