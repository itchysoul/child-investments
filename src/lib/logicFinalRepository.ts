import { logicFinalTerms } from './logicFinalData';
import { supabase } from './supabase';

export interface LogicFinalProfile {
  userId: string;
  email: string;
  displayName: string;
  score: number;
  currentStreak: number;
  bestStreak: number;
  totalCorrect: number;
  totalAttempts: number;
  masteredTerms: number;
  updatedAt: string;
}

export interface LogicFinalProgressRecord {
  userId: string;
  termId: string;
  intervalStep: number;
  easeFactor: number;
  nextDueAt: string;
  consecutiveCorrect: number;
  consecutiveWrong: number;
  totalCorrect: number;
  totalWrong: number;
  masteryLevel: number;
  updatedAt: string;
}

interface LogicFinalProfileRow {
  user_id: string;
  email: string;
  display_name: string;
  score: number;
  current_streak: number;
  best_streak: number;
  total_correct: number;
  total_attempts: number;
  mastered_terms: number;
  updated_at: string;
}

interface LogicFinalProgressRow {
  user_id: string;
  term_id: string;
  interval_step: number;
  ease_factor: number;
  next_due_at: string;
  consecutive_correct: number;
  consecutive_wrong: number;
  total_correct: number;
  total_wrong: number;
  mastery_level: number;
  updated_at: string;
}

function mapProfile(row: LogicFinalProfileRow): LogicFinalProfile {
  return {
    userId: row.user_id,
    email: row.email,
    displayName: row.display_name,
    score: row.score,
    currentStreak: row.current_streak,
    bestStreak: row.best_streak,
    totalCorrect: row.total_correct,
    totalAttempts: row.total_attempts,
    masteredTerms: row.mastered_terms,
    updatedAt: row.updated_at,
  };
}

function mapProgress(row: LogicFinalProgressRow): LogicFinalProgressRecord {
  return {
    userId: row.user_id,
    termId: row.term_id,
    intervalStep: row.interval_step,
    easeFactor: row.ease_factor,
    nextDueAt: row.next_due_at,
    consecutiveCorrect: row.consecutive_correct,
    consecutiveWrong: row.consecutive_wrong,
    totalCorrect: row.total_correct,
    totalWrong: row.total_wrong,
    masteryLevel: row.mastery_level,
    updatedAt: row.updated_at,
  };
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

export async function ensureLogicFinalProfile(): Promise<LogicFinalProfile | null> {
  if (!supabase) {
    return null;
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.user.email) {
    return null;
  }

  const { error } = await supabase.rpc('ensure_logic_final_profile');

  if (error) {
    throw error;
  }

  return loadLogicFinalProfile();
}

export async function loadLogicFinalProfile(): Promise<LogicFinalProfile | null> {
  if (!supabase) {
    return null;
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.user.id) {
    return null;
  }

  const { data, error } = await supabase.from('logic_final_profiles').select('*').eq('user_id', session.user.id).maybeSingle();

  if (error) {
    throw error;
  }

  return data ? mapProfile(data as LogicFinalProfileRow) : null;
}

export async function loadLogicFinalLeaderboard(limit = 10): Promise<LogicFinalProfile[]> {
  if (!supabase) {
    return [];
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.user.id) {
    return [];
  }

  const { data, error } = await supabase
    .from('logic_final_profiles')
    .select('*')
    .order('score', { ascending: false })
    .order('best_streak', { ascending: false })
    .order('total_correct', { ascending: false })
    .limit(limit);

  if (error) {
    throw error;
  }

  return ((data ?? []) as LogicFinalProfileRow[]).map(mapProfile);
}

export async function loadLogicFinalProgress(): Promise<LogicFinalProgressRecord[]> {
  if (!supabase) {
    return [];
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.user.id) {
    return [];
  }

  const { data, error } = await supabase
    .from('logic_final_progress')
    .select('*')
    .eq('user_id', session.user.id)
    .order('term_id', { ascending: true });

  if (error) {
    throw error;
  }

  const rows = ((data ?? []) as LogicFinalProgressRow[]).map(mapProgress);
  return rows.length ? rows : buildDefaultProgress(session.user.id);
}

export async function saveLogicFinalState(profile: LogicFinalProfile, progress: LogicFinalProgressRecord[]): Promise<void> {
  if (!supabase) {
    return;
  }

  const profilePayload: LogicFinalProfileRow = {
    user_id: profile.userId,
    email: profile.email,
    display_name: profile.displayName,
    score: profile.score,
    current_streak: profile.currentStreak,
    best_streak: profile.bestStreak,
    total_correct: profile.totalCorrect,
    total_attempts: profile.totalAttempts,
    mastered_terms: profile.masteredTerms,
    updated_at: new Date().toISOString(),
  };

  const progressPayload: LogicFinalProgressRow[] = progress.map((entry) => ({
    user_id: entry.userId,
    term_id: entry.termId,
    interval_step: entry.intervalStep,
    ease_factor: entry.easeFactor,
    next_due_at: entry.nextDueAt,
    consecutive_correct: entry.consecutiveCorrect,
    consecutive_wrong: entry.consecutiveWrong,
    total_correct: entry.totalCorrect,
    total_wrong: entry.totalWrong,
    mastery_level: entry.masteryLevel,
    updated_at: new Date().toISOString(),
  }));

  const { error: profileError } = await supabase.from('logic_final_profiles').upsert(profilePayload, { onConflict: 'user_id' });

  if (profileError) {
    throw profileError;
  }

  const { error: progressError } = await supabase.from('logic_final_progress').upsert(progressPayload, { onConflict: 'user_id,term_id' });

  if (progressError) {
    throw progressError;
  }
}
