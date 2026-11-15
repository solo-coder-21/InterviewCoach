import { persistProgress } from './accountApi';

export interface ResumeScoreData {
  overallScore: number;
  matchLevel: string;
  summary: string;
  strengths: string[];
  gaps: string[];
  recommendations: string[];
}

export interface InterviewSession {
  id: string;
  ownerId: string;
  resumeText: string;
  company: string;
  role: string;
  experienceLevel?: string;
  candidateName?: string;
  interviewTrack?: string;
  questions: InterviewQuestion[];
  currentQuestionIndex: number;
  status: "setup" | "in_progress" | "completed";
  scores?: ScoreData;
  resumeScore?: ResumeScoreData;
  questionSource?: string;
  snippetsCount?: number;
  createdAt: string;
}

export type InterviewStage = "introduction" | "resume_deep_dive" | "core_technical_dsa" | "company_cultural_fit";

export interface InterviewQuestion {
  id: string;
  stage?: InterviewStage;
  stageName?: string;
  agentName?: string;
  text: string;
  answerTranscript?: string;
  followUpQuestion?: string;
  followUpAnswerTranscript?: string;
  isProbed?: boolean;
  score?: number;
  relevance?: number;
  clarity?: number;
  depth?: number;
  confidence?: number;
  feedback?: string;
  writtenCode?: string;
  timeToAnswerSeconds?: number;
  sourceType?: "web_grounded_scraped" | "ai_generated_resume_tailored";
  sourceName?: string;
  sourceUrl?: string;
  originExplanation?: string;
}

export interface ScoreData {
  relevance: number;
  clarity: number;
  depth: number;
  confidence: number;
  overall: number;
  summary: string;
  mistakes?: string[];
  improvements?: string[];
}

let ownerId: string | null = null;
let syncQueue: Promise<void> = Promise.resolve();
const storageKey = () => `ai-interview-coach-session:${ownerId}`;
export function setStorageOwner(id: string | null) {
  try {
    if (ownerId && ownerId !== id) localStorage.removeItem(storageKey());
    localStorage.removeItem('ai-interview-coach-session');
  } catch { /* The authenticated account still works when browser storage is blocked. */ }
  ownerId = id;
}

export function saveSession(session: InterviewSession, sync = true): Promise<void> {
  if (!ownerId || session.ownerId !== ownerId) return Promise.resolve();
  try {
    localStorage.setItem(storageKey(), JSON.stringify(session));
  } catch {
    console.warn("Failed to save session to localStorage");
  }
  if (!sync) return Promise.resolve();
  const snapshot = structuredClone(session);
  syncQueue = syncQueue.then(async () => {
    if (ownerId !== snapshot.ownerId) return;
    try {
      await persistProgress(snapshot);
      if (ownerId === snapshot.ownerId) window.dispatchEvent(new Event('interview-sync-success'));
    } catch {
      if (ownerId === snapshot.ownerId) window.dispatchEvent(new Event('interview-sync-error'));
    }
  });
  return syncQueue;
}

export function loadSession(): InterviewSession | null {
  try {
    if (!ownerId) return null;
    const raw = localStorage.getItem(storageKey());
    if (!raw) return null;
    const session = JSON.parse(raw) as InterviewSession;
    return session.ownerId === ownerId ? session : null;
  } catch {
    return null;
  }
}

export function clearSession(): void {
  try { localStorage.removeItem(storageKey()); } catch { /* Browser storage is optional. */ }
}
