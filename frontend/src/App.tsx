import { useState, useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { TopicGraph, TOPIC_NODES } from "./TopicGraph";
import { AuthPage } from "./AuthPage";
import {
  fetchDocuments,
  uploadDocument,
  deleteDocument,
  fetchTopics,
  searchChunks,
  chatWithAI,
  fetchQuizzes,
  fetchQuiz,
  generateQuiz,
  submitQuiz,
  fetchProgress,
  fetchAttempts,
  fetchDueFlashcards,
  generateFlashcards,
  reviewFlashcard,
  fetchSettings,
  updateSettings,
  seedDemoData,
  clearDemoData,
  transcribeAudio,
  generateSpeech,
  getStoredAuthUser,
  getCurrentUser,
  logoutUser,
  type ApiUser,
  type ApiDocument,
  type ApiTopic,
  type ApiQuiz,
  type ApiProgress,
  type ApiAttemptRow,
  type ApiFlashcard,
  type ApiSettings,
} from "./api";

// ─── Types ────────────────────────────────────────────────────────────────────

type View = "dashboard" | "documents" | "chat" | "quiz" | "flashcards" | "progress" | "settings";
type QuizPhase = "list" | "taking" | "results";

interface ChatMessage {
  id: string;
  role: "user" | "ai";
  content: string;
  citations?: { snippet: string; page?: number | null }[];
  timestamp: string;
}

interface SelectedAnswers {
  [questionIndex: number]: string;
}

// ─── Dummy Data ─────────────────────────────────────────────────────────────

const ACTIVITY_FEED = [
  { type: "quiz", text: "Scored 80/100 on Data Structures quiz", time: "2h ago", color: "text-green-400", dot: "bg-green-400" },
  { type: "upload", text: "Uploaded os_memory_management.pdf", time: "4h ago", color: "text-indigo-400", dot: "bg-indigo-400" },
  { type: "chat", text: "Asked 6 questions in AI Teacher", time: "5h ago", color: "text-[#818cf8]", dot: "bg-[#818cf8]" },
  { type: "quiz", text: "Scored 60/100 on Algorithms quiz", time: "Yesterday", color: "text-yellow-400", dot: "bg-yellow-400" },
  { type: "upload", text: "Uploaded dynamic_programming_notes.pdf", time: "Yesterday", color: "text-indigo-400", dot: "bg-indigo-400" },
  { type: "chat", text: "Started session on Binary Trees", time: "2 days ago", color: "text-[#818cf8]", dot: "bg-[#818cf8]" },
];

const SUGGESTED_TOPICS = [
  { topic: "AVL Tree Rotations", reason: "Low mastery — 3 questions unanswered" },
  { topic: "Memoization Patterns", reason: "Not practiced yet" },
  { topic: "Page Replacement Algorithms", reason: "New upload — ready to explore" },
];

const WEEKLY_SESSIONS = [
  { day: "Mon", sessions: 3, questions: 12 },
  { day: "Tue", sessions: 1, questions: 4 },
  { day: "Wed", sessions: 4, questions: 18 },
  { day: "Thu", sessions: 2, questions: 9 },
  { day: "Fri", sessions: 5, questions: 22 },
  { day: "Sat", sessions: 0, questions: 0 },
  { day: "Sun", sessions: 2, questions: 7 },
];

const RECENT_ATTEMPTS = [
  { date: "Aug 19", topic: "Data Structures", score: 8, total: 10, time: "4m 32s" },
  { date: "Aug 18", topic: "Algorithms", score: 6, total: 10, time: "6m 18s" },
  { date: "Aug 17", topic: "Data Structures", score: 7, total: 10, time: "5m 01s" },
  { date: "Aug 16", topic: "Operating Systems", score: 3, total: 10, time: "8m 44s" },
  { date: "Aug 15", topic: "Networks", score: 5, total: 8, time: "3m 55s" },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function now() {
  return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function statusForDoc(d: ApiDocument): "ready" | "processing" | "error" {
  if (d.status === "processed") return "ready";
  if (d.status === "error") return "error";
  return "processing";
}

function dateStr(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// ─── Icons (inline SVG) ───────────────────────────────────────────────────────

const Icon = {
  folder: (
    <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v8.25" />
    </svg>
  ),
  chat: (
    <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z" />
    </svg>
  ),
  quiz: (
    <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25z" />
    </svg>
  ),
  chart: (
    <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
    </svg>
  ),
  settings: (
    <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  ),
  upload: (
    <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
    </svg>
  ),
  send: (
    <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
    </svg>
  ),
  chevronDown: (
    <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
    </svg>
  ),
  check: (
    <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
    </svg>
  ),
  x: (
    <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  ),
  sparkle: (
    <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456z" />
    </svg>
  ),
  arrowUp: (
    <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 10.5L12 3m0 0l7.5 7.5M12 3v18" />
    </svg>
  ),
  arrowDown: (
    <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 13.5L12 21m0 0l-7.5-7.5M12 21V3" />
    </svg>
  ),
  minus: (
    <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M18 12H6" />
    </svg>
  ),
};

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: "ready" | "processing" | "error" }) {
  const styles = {
    ready: "bg-green-500/15 text-green-400 border-green-500/20",
    processing: "bg-yellow-500/15 text-yellow-400 border-yellow-500/20",
    error: "bg-red-500/15 text-red-400 border-red-500/20",
  };
  const labels = { ready: "Ready", processing: "Processing", error: "Error" };
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-mono border ${styles[status]}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${status === "ready" ? "bg-green-400" : status === "processing" ? "bg-yellow-400 animate-pulse" : "bg-red-400"}`} />
      {labels[status]}
    </span>
  );
}

function MasteryRing({ mastery, topic }: { mastery: number; topic: string }) {
  const r = 36;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - mastery / 100);
  const color = mastery >= 75 ? "#22c55e" : mastery >= 50 ? "#6366f1" : mastery >= 30 ? "#f59e0b" : "#ef4444";

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative w-20 h-20">
        <svg width="80" height="80" viewBox="0 0 80 80" className="-rotate-90">
          <circle cx="40" cy="40" r={r} fill="none" stroke="#3f3f46" strokeWidth="6" />
          <circle
            cx="40" cy="40" r={r} fill="none"
            stroke={color} strokeWidth="6"
            strokeDasharray={circ}
            strokeDashoffset={offset}
            strokeLinecap="round"
            style={{ transition: "stroke-dashoffset 0.6s ease" }}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="font-mono font-bold text-lg" style={{ color }}>{mastery}</span>
        </div>
      </div>
      <span className="text-xs text-[#a1a1aa] font-mono text-center leading-tight">{topic}</span>
    </div>
  );
}

// ─── Views ────────────────────────────────────────────────────────────────────

function DashboardView({ navigate, quickPrompt, setQuickPrompt }: { navigate: (v: View) => void; quickPrompt: string; setQuickPrompt: (q: string) => void }) {
  const [docs, setDocs] = useState<ApiDocument[]>([]);
  const [progress, setProgress] = useState<ApiProgress[]>([]);
  const [dueCards, setDueCards] = useState<ApiFlashcard[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([fetchDocuments(), fetchProgress(), fetchDueFlashcards()])
      .then(([d, p, fc]) => { setDocs(d); setProgress(p); setDueCards(fc); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const [selectedTopicId, setSelectedTopicId] = useState<string | null>(null);
  const readyDocs = docs.filter(d => statusForDoc(d) === "ready").length;
  const avgMastery = progress.length ? Math.round(progress.reduce((a, p) => a + p.mastery_score, 0) / progress.length) : 0;
  const selectedTopic = TOPIC_NODES.find(n => n.id === selectedTopicId) || null;

  if (loading) {
    return <div className="p-6 text-sm font-mono text-[#52525b]">Loading dashboard...</div>;
  }

  return (
    <div className="p-6 space-y-6">
      {/* Command Header & Integrated Analytics Strip */}
      <div className="bg-[#121215] border border-[#27272a] rounded-2xl p-6 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-[#27272a]">
          <div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-[11px] text-indigo-400 uppercase tracking-widest">// WORKSPACE DASHBOARD</span>
              <span className="text-[10px] font-mono text-[#71717a]">•</span>
              <span className="text-[11px] font-mono text-[#71717a]">{new Date().toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}</span>
            </div>
            <h2 className="font-mono font-bold text-2xl text-[#f4f4f5] mt-1 tracking-tight">Study Command Center</h2>
          </div>
          <div className="flex items-center gap-3">
            <button 
              onClick={() => navigate("chat")} 
              className="px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-mono font-semibold transition-all duration-150 shadow-sm flex items-center gap-2"
            >
              {Icon.chat} Ask AI Teacher
            </button>
            <button 
              onClick={() => navigate("quiz")} 
              className="px-4 py-2.5 rounded-xl border border-[#3f3f46] hover:border-[#52525b] hover:bg-[#1c1c20] text-[#d4d4d8] text-xs font-mono transition-all duration-150 flex items-center gap-2"
            >
              {Icon.quiz} Practice Quiz
            </button>
          </div>
        </div>

        {/* Integrated Metrics Ribbon */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-6">
          <button onClick={() => navigate("documents")} className="text-left group p-2 rounded-xl hover:bg-[#18181c] transition-colors">
            <span className="font-mono text-[10px] text-[#71717a] uppercase tracking-wider block mb-1">Active Documents</span>
            <div className="flex items-baseline gap-2">
              <span className="font-mono font-bold text-2xl text-[#f4f4f5] group-hover:text-indigo-400 transition-colors">{readyDocs}</span>
              <span className="font-mono text-xs text-[#71717a]">/ {docs.length} total</span>
            </div>
          </button>
          <button onClick={() => navigate("progress")} className="text-left group p-2 rounded-xl hover:bg-[#18181c] transition-colors">
            <span className="font-mono text-[10px] text-[#71717a] uppercase tracking-wider block mb-1">Avg Topic Mastery</span>
            <div className="flex items-baseline gap-2">
              <span className="font-mono font-bold text-2xl text-emerald-400">{avgMastery}%</span>
              <span className="font-mono text-xs text-[#71717a]">across topics</span>
            </div>
          </button>
          <button onClick={() => navigate("quiz")} className="text-left group p-2 rounded-xl hover:bg-[#18181c] transition-colors">
            <span className="font-mono text-[10px] text-[#71717a] uppercase tracking-wider block mb-1">Quizzes Taken</span>
            <div className="flex items-baseline gap-2">
              <span className="font-mono font-bold text-2xl text-violet-400">{RECENT_ATTEMPTS.length}</span>
              <span className="font-mono text-xs text-[#71717a]">completed</span>
            </div>
          </button>
          <button onClick={() => navigate("progress")} className="text-left group p-2 rounded-xl hover:bg-[#18181c] transition-colors">
            <span className="font-mono text-[10px] text-[#71717a] uppercase tracking-wider block mb-1">Weekly Questions</span>
            <div className="flex items-baseline gap-2">
              <span className="font-mono font-bold text-2xl text-amber-400">{WEEKLY_SESSIONS.reduce((a, d) => a + d.questions, 0)}</span>
              <span className="font-mono text-xs text-[#71717a]">answered</span>
            </div>
          </button>
        </div>
      </div>

      {/* Weekly Sessions Chart (Precision Scientific Style) */}
      <div className="bg-[#121215] border border-[#27272a] rounded-2xl p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <span className="font-mono text-[10px] text-indigo-400 uppercase tracking-widest block mb-0.5">// 01. ACTIVITY LOG</span>
            <h3 className="font-mono text-sm font-semibold text-[#f4f4f5]">Weekly Session Velocity</h3>
          </div>
          <span className="text-xs font-mono text-[#71717a] bg-[#1a1a1e] border border-[#27272a] px-3 py-1 rounded-md">Aug 14 – Aug 20</span>
        </div>

        <div className="flex items-end gap-3 md:gap-6 h-48 pt-4">
          {WEEKLY_SESSIONS.map(d => {
            const maxSessions = Math.max(...WEEKLY_SESSIONS.map(x => x.sessions));
            const heightPct = maxSessions > 0 ? (d.sessions / maxSessions) * 100 : 0;
            const isToday = d.day === "Sun";
            
            return (
              <div key={d.day} className="flex-1 flex flex-col items-center gap-2 group relative">
                {/* Session count label above bar */}
                <span className={`font-mono text-xs font-semibold ${isToday ? "text-blue-400" : d.sessions > 0 ? "text-[#a1a1aa]" : "text-[#3f3f46]"}`}>
                  {d.sessions}
                </span>

                {/* Outer Track & Inner Bar */}
                <div className="relative w-full max-w-[56px] flex items-end justify-center bg-[#1a1a1e] rounded-t-lg border border-[#27272a] p-1" style={{ height: "140px" }}>
                  <div
                    className={`w-full rounded-t transition-all duration-300 ${
                      isToday 
                        ? "bg-blue-600" 
                        : d.sessions > 0 
                        ? "bg-slate-700 group-hover:bg-slate-600" 
                        : "bg-[#27272a]/50"
                    }`}
                    style={{ height: `${Math.max(heightPct, d.sessions > 0 ? 10 : 4)}%` }}
                  />
                </div>

                {/* Day label */}
                <span className={`font-mono text-xs ${isToday ? "text-blue-400 font-bold" : "text-[#71717a]"}`}>
                  {d.day}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Knowledge Map + right-column side-by-side */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 items-stretch">

        {/* Knowledge Map — takes up the left 2 columns */}
        <div className="lg:col-span-2 flex flex-col rounded-2xl border border-[#27272a] bg-[#121215] overflow-hidden min-w-0">
          <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-[#27272a]">
            <div>
              <span className="font-mono text-[10px] text-indigo-400 uppercase tracking-widest block mb-0.5">// 02. KNOWLEDGE GRAPH ENGINE</span>
              <h3 className="font-mono font-semibold text-sm text-[#f4f4f5]">Interactive Topic Map</h3>
            </div>
            <button onClick={() => navigate("progress")} className="text-xs font-mono text-indigo-400 hover:text-indigo-300 transition-colors shrink-0 bg-[#1a1a1e] border border-[#27272a] px-3 py-1 rounded-md">Full tracker →</button>
          </div>
          <div className="flex-1 px-4 pb-4 flex flex-col min-h-[400px]">
            <TopicGraph onSelect={id => setSelectedTopicId(prev => prev === id ? null : id)} />
          </div>
        </div>

        {/* Right cards — stacked, 1 column */}
        <div className="lg:col-span-1 flex flex-col gap-4 min-w-0">

          {/* Suggested next */}
          <div className="bg-[#121215] rounded-2xl border border-[#27272a] p-5 flex-1">
            <span className="font-mono text-[10px] text-indigo-400 uppercase tracking-widest block mb-0.5">// RECOMMENDED FOCUS</span>
            <h3 className="font-mono text-xs font-semibold text-[#f4f4f5] mb-3">Suggested Next Steps</h3>
            <div className="space-y-2.5">
              {SUGGESTED_TOPICS.map((s, i) => (
                <button
                  key={i}
                  onClick={() => navigate("chat")}
                  className="w-full text-left p-3 rounded-xl border border-[#27272a] bg-[#1a1a1e]/60 hover:border-indigo-500/40 hover:bg-[#1a1a24] transition-all duration-150 group"
                >
                  <div className="flex items-start gap-2.5">
                    <span className="w-5 h-5 rounded bg-indigo-500/10 text-indigo-400 flex items-center justify-center shrink-0 mt-0.5 text-[10px] font-mono font-bold border border-indigo-500/20">{i + 1}</span>
                    <div className="min-w-0">
                      <p className="font-mono text-xs text-[#f4f4f5] font-semibold group-hover:text-indigo-300 transition-colors truncate">{s.topic}</p>
                      <p className="text-[10px] font-mono text-[#71717a] mt-0.5 truncate">{s.reason}</p>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Recent docs */}
          <div className="bg-[#121215] rounded-2xl border border-[#27272a] p-5 flex-1">
            <div className="flex items-center justify-between mb-3">
              <div>
                <span className="font-mono text-[10px] text-indigo-400 uppercase tracking-widest block mb-0.5">// RECENT MATERIALS</span>
                <h3 className="font-mono text-xs font-semibold text-[#f4f4f5]">Study Documents</h3>
              </div>
              <button onClick={() => navigate("documents")} className="text-xs font-mono text-indigo-400 hover:text-indigo-300 transition-colors">All →</button>
            </div>
            <div className="space-y-2">
              {docs.length === 0 ? (
                <p className="text-xs font-mono text-[#71717a]">No documents uploaded yet.</p>
              ) : (
                docs.slice(0, 3).map(d => (
                  <div key={d.id} className="flex items-center justify-between p-2.5 rounded-xl border border-[#27272a] bg-[#1a1a1e]/60 hover:border-indigo-500/40 transition-all duration-150">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-7 h-7 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 shrink-0">
                        {Icon.folder}
                      </div>
                      <div className="min-w-0">
                        <p className="font-mono text-xs text-[#f4f4f5] font-medium truncate">{d.title}</p>
                        <p className="text-[10px] font-mono text-[#71717a] truncate">{d.topic ?? "General"}</p>
                      </div>
                    </div>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 shrink-0">
                      Ready
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>

        </div>
      </div>

      {/* Bottom Row — Topic Mastery + Quick Ask + Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

        {/* Left col: mastery + quick ask */}
        <div className="lg:col-span-2 space-y-5">

          {/* Topic mastery bars */}
          <div className="bg-[#121215] rounded-2xl border border-[#27272a] p-6">
            <div className="flex items-center justify-between mb-5">
              <div>
                <span className="font-mono text-[10px] text-indigo-400 uppercase tracking-widest block mb-0.5">// 03. TOPIC PROFICIENCY</span>
                <h3 className="font-mono text-sm font-semibold text-[#f4f4f5]">Subject Mastery Scores</h3>
              </div>
              <button onClick={() => navigate("progress")} className="text-xs font-mono text-indigo-400 hover:text-indigo-300 transition-colors bg-[#1a1a1e] border border-[#27272a] px-3 py-1 rounded-md">View all →</button>
            </div>
            <div className="space-y-4">
              {(progress.length > 0 ? progress : [
                { id: "1", mastery_score: 82, topics: { name: "Data Structures" } },
                { id: "2", mastery_score: 64, topics: { name: "Algorithms" } },
                { id: "3", mastery_score: 31, topics: { name: "Operating Systems" } },
                { id: "4", mastery_score: 55, topics: { name: "Networks" } },
              ]).map((p, idx) => {
                const isHigh = p.mastery_score >= 75;
                const isMid = p.mastery_score >= 50;
                const isLow = p.mastery_score >= 30;

                const barColor = isHigh ? "bg-emerald-500" : isMid ? "bg-indigo-500" : isLow ? "bg-amber-500" : "bg-rose-500";
                const colorText = isHigh ? "text-emerald-400" : isMid ? "text-indigo-400" : isLow ? "text-amber-400" : "text-rose-400";
                const trends = ["up", "up", "flat", "down"];
                const trend = trends[idx % trends.length];

                return (
                  <div key={p.id} className="space-y-1.5 group">
                    <div className="flex items-center justify-between text-xs font-mono">
                      <span className="text-[#f4f4f5] font-medium group-hover:text-indigo-300 transition-colors">{p.topics?.name ?? "Unknown"}</span>
                      <div className="flex items-center gap-2">
                        <span className={`font-bold ${colorText}`}>{Math.round(p.mastery_score)}/100</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${
                          trend === "up" 
                            ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" 
                            : trend === "down" 
                            ? "bg-rose-500/10 text-rose-400 border border-rose-500/20" 
                            : "bg-[#1a1a1e] text-[#71717a] border border-[#27272a]"
                        }`}>
                          {trend === "up" ? "↑ +4%" : trend === "down" ? "↓ -2%" : "–"}
                        </span>
                      </div>
                    </div>
                    <div className="h-2 bg-[#1a1a1e] rounded-full overflow-hidden border border-[#27272a]">
                      <div 
                        className={`h-full rounded-full ${barColor} transition-all duration-700 ease-out`} 
                        style={{ width: `${p.mastery_score}%` }} 
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Quick ask */}
          <div className="bg-[#121215] rounded-2xl border border-[#27272a] p-6">
            <span className="font-mono text-[10px] text-indigo-400 uppercase tracking-widest block mb-0.5">// AI ASSISTANT INTERFACE</span>
            <h3 className="font-mono text-sm font-semibold text-[#f4f4f5] mb-3">Quick Question Trigger</h3>
            <div className="flex gap-3">
              <input
                value={quickPrompt}
                onChange={e => setQuickPrompt(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && quickPrompt.trim()) { navigate("chat"); } }}
                placeholder="Ask your AI teacher a question about your topics..."
                className="flex-1 bg-[#1a1a1e] border border-[#27272a] rounded-xl px-4 py-3 text-sm text-[#f4f4f5] placeholder:text-[#52525b] focus:outline-none focus:border-indigo-500 font-sans transition-colors duration-150"
              />
              <button
                onClick={() => { if (quickPrompt.trim()) navigate("chat"); }}
                className="px-5 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold transition-all duration-150 flex items-center gap-2 shrink-0"
              >
                {Icon.send}
              </button>
            </div>
            <div className="flex flex-wrap gap-2 mt-3">
              {["Explain BST rotations", "What is memoization?", "Difference between TCP and UDP"].map(q => (
                <button
                  key={q}
                  onClick={() => { setQuickPrompt(q); navigate("chat"); }}
                  className="px-3 py-1.5 rounded-lg bg-[#1a1a1e] border border-[#27272a] text-xs font-mono text-[#a1a1aa] hover:text-[#f4f4f5] hover:border-[#3f3f46] transition-colors duration-150"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Right col: activity feed */}
        <div className="space-y-5">
          {/* Activity feed */}
          <div className="bg-[#121215] rounded-2xl border border-[#27272a] p-6">
            <span className="font-mono text-[10px] text-indigo-400 uppercase tracking-widest block mb-0.5">// 04. EVENT LOG</span>
            <h3 className="font-mono text-sm font-semibold text-[#f4f4f5] mb-4">Recent Activity</h3>
            <div className="relative">
              <div className="absolute left-[5px] top-1 bottom-1 w-px bg-[#27272a]" />
              <div className="space-y-4 pl-5">
                {ACTIVITY_FEED.map((a, i) => (
                  <div key={i} className="relative group">
                    <div className={`absolute -left-5 top-1.5 w-2.5 h-2.5 rounded-full ${a.dot} ring-4 ring-[#121215]`} />
                    <p className={`text-xs font-mono ${a.color} leading-snug`}>{a.text}</p>
                    <p className="text-[10px] font-mono text-[#52525b] mt-0.5">{a.time}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

type DocFilter = "all" | "ready" | "processing" | "error";
type DocSort = "topic" | "date" | "name";

function DocumentsView({ uploadTrigger, onUploadComplete }: { uploadTrigger?: number; onUploadComplete?: () => void }) {
  const [dragging, setDragging] = useState(false);
  const [docs, setDocs] = useState<ApiDocument[]>([]);
  const [topics, setTopics] = useState<ApiTopic[]>([]);
  const [selectedTopic, setSelectedTopic] = useState("");
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<DocFilter>("all");
  const [sortBy, setSortBy] = useState<DocSort>("date");
  const [topicFilter, setTopicFilter] = useState<string>("all");
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (uploadTrigger && uploadTrigger > 0) fileInputRef.current?.click();
  }, [uploadTrigger]);

  function loadDocs() {
    fetchDocuments().then(setDocs).catch(e => setError(e.message)).finally(() => setLoading(false));
  }

  useEffect(() => {
    loadDocs();
    fetchTopics().then(setTopics).catch(() => {});
  }, []);

  // Derive unique topics from docs for the filter dropdown
  const docTopics = Array.from(new Set(docs.map(d => d.topic).filter(Boolean))) as string[];

  const filteredDocs = docs
    .filter(d => filter === "all" || statusForDoc(d) === filter)
    .filter(d => topicFilter === "all" || d.topic === topicFilter)
    .sort((a, b) => {
      if (sortBy === "topic") return (a.topic ?? "").localeCompare(b.topic ?? "");
      if (sortBy === "name") return a.title.localeCompare(b.title);
      // date (default): newest first
      return new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime();
    });

  const stats = {
    total: docs.length,
    ready: docs.filter(d => statusForDoc(d) === "ready").length,
    processing: docs.filter(d => statusForDoc(d) === "processing").length,
    error: docs.filter(d => statusForDoc(d) === "error").length,
  };

  async function handleFile(file: File) {
    setUploading(true);
    setError("");
    try {
      await uploadDocument(file, selectedTopic || undefined);
      await loadDocs();
      onUploadComplete?.();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this document?")) return;
    try {
      await deleteDocument(id);
      setDocs(prev => prev.filter(d => d.id !== id));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Delete failed");
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    e.target.value = "";
  }

  if (loading) {
    return <div className="p-8 text-sm font-mono text-[#52525b]">Loading documents...</div>;
  }

  return (
    <div className="p-8 space-y-6">
      {error && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm font-mono text-rose-400 flex items-center gap-2">
          <span>⚠️</span> {error}
        </div>
      )}

      {/* Upload zone */}
      <div
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`relative border-2 border-dashed rounded-2xl p-10 text-center cursor-pointer transition-all duration-200 select-none bg-[#121215]
          ${dragging ? "border-indigo-400 bg-indigo-500/10 shadow-[0_0_25px_rgba(99,102,241,0.2)]" : "border-[#27272a] hover:border-indigo-500/40 hover:bg-[#16161a]"}`}
      >
        <input ref={fileInputRef} type="file" accept=".pdf,.txt,.md" className="hidden" onChange={handleFileInput} />
        <div className="flex flex-col items-center gap-3">
          <div className={`w-14 h-14 rounded-2xl flex items-center justify-center transition-all duration-200 border ${dragging ? "bg-indigo-500/20 text-indigo-400 border-indigo-500/40" : "bg-[#1a1a1e] text-[#a1a1aa] border-[#27272a]"}`}>
            <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
            </svg>
          </div>
          <div>
            <p className="font-mono font-bold text-sm text-[#f4f4f5]">
              {uploading ? "Uploading & vector indexing..." : "Drop PDF / Text file or click to upload"}
            </p>
            <p className="text-xs font-mono text-[#71717a] mt-1">Supports PDF, TXT, MD — automated chunk extraction</p>
          </div>
        </div>
        {topics.length > 0 && (
          <div className="mt-4 flex items-center justify-center gap-3" onClick={e => e.stopPropagation()}>
            <span className="text-xs font-mono text-[#71717a]">Target Topic:</span>
            <select
              value={selectedTopic}
              onChange={e => setSelectedTopic(e.target.value)}
              className="bg-[#1a1a1e] border border-[#27272a] rounded-lg px-3 py-1.5 text-xs font-mono text-indigo-300 focus:outline-none focus:border-indigo-500"
            >
              <option value="">None (Auto-classify)</option>
              {topics.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
        )}
      </div>

      {/* Stats + filter/sort bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 bg-[#121215] border border-[#27272a] p-4 rounded-2xl">
        {/* Stat counters */}
        <div className="flex items-center gap-6">
          {[
            { label: "Total Files", value: stats.total, color: "text-[#f4f4f5]" },
            { label: "Indexed", value: stats.ready, color: "text-emerald-400" },
            { label: "Processing", value: stats.processing, color: "text-amber-400" },
          ].map(s => (
            <div key={s.label} className="flex items-baseline gap-2">
              <span className={`font-mono font-bold text-lg ${s.color}`}>{s.value}</span>
              <span className="font-mono text-[10px] text-[#71717a] uppercase tracking-wider">{s.label}</span>
            </div>
          ))}
        </div>

        {/* Filters + sort */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Topic filter */}
          <select
            value={topicFilter}
            onChange={e => setTopicFilter(e.target.value)}
            className="bg-[#1a1a1e] border border-[#27272a] rounded-xl px-3 py-1.5 text-xs font-mono text-[#a1a1aa] focus:outline-none focus:border-indigo-500 cursor-pointer"
          >
            <option value="all">All Topics</option>
            {docTopics.map(t => <option key={t} value={t}>{t}</option>)}
          </select>

          {/* Status filter pills */}
          <div className="flex gap-1 bg-[#1a1a1e] p-1 rounded-xl border border-[#27272a]">
            {(["all", "ready", "processing", "error"] as DocFilter[]).map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1 rounded-lg text-xs font-mono capitalize transition-all duration-150 ${
                  filter === f
                    ? "bg-indigo-600/20 text-indigo-300 font-semibold border border-indigo-500/30"
                    : "text-[#71717a] hover:text-[#d4d4d8]"
                }`}
              >
                {f}
              </button>
            ))}
          </div>

          {/* Sort buttons */}
          <div className="flex gap-1 border-l border-[#27272a] pl-3">
            {(["date", "topic", "name"] as DocSort[]).map(s => (
              <button
                key={s}
                onClick={() => setSortBy(s)}
                className={`px-2.5 py-1 rounded-lg text-xs font-mono capitalize transition-all duration-150 ${
                  sortBy === s
                    ? "bg-[#27272a] text-[#f4f4f5]"
                    : "text-[#71717a] hover:text-[#a1a1aa]"
                }`}
              >
                {s === "date" ? "↓ Date" : s === "topic" ? "Topic" : "A–Z"}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Documents table */}
      <div className="rounded-2xl overflow-hidden border border-[#27272a] bg-[#121215]">
        <div className="px-5 py-3.5 bg-[#121215] border-b border-[#27272a] flex items-center justify-between">
          <span className="font-mono text-xs text-[#a1a1aa] uppercase tracking-widest">
            // INDEXED REPOSITORY ({filteredDocs.length} {filteredDocs.length === 1 ? "FILE" : "FILES"})
          </span>
        </div>
        {filteredDocs.length === 0 ? (
          <div className="p-12 text-center text-xs font-mono text-[#71717a]">
            {docs.length === 0 ? "No documents uploaded yet. Drop a PDF to begin indexing." : `No ${filter} documents match filter.`}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#27272a] bg-[#1a1a1e]/40">
                {["File", "Topic Tag", "Added Date", "Vector Status", ""].map(h => (
                  <th key={h} className="px-5 py-3 text-left font-mono text-[10px] text-[#71717a] uppercase tracking-widest">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredDocs.map((doc, i) => (
                <tr
                  key={doc.id}
                  className={`border-b border-[#27272a]/60 hover:bg-[#1a1a24]/50 transition-colors duration-150 cursor-pointer ${i === filteredDocs.length - 1 ? "border-b-0" : ""}`}
                >
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-3">
                      <div className="w-7 h-7 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 shrink-0">
                        {Icon.folder}
                      </div>
                      <span className="font-mono text-xs text-[#f4f4f5] font-medium">{doc.title}</span>
                    </div>
                  </td>
                  <td className="px-5 py-3.5">
                    <span className="px-2.5 py-1 rounded-md bg-indigo-500/10 border border-indigo-500/20 text-indigo-300 text-xs font-mono">{doc.topic || "Untagged"}</span>
                  </td>
                  <td className="px-5 py-3.5 font-mono text-xs text-[#71717a]">{dateStr(doc.created_at)}</td>
                  <td className="px-5 py-3.5"><StatusBadge status={statusForDoc(doc)} /></td>
                  <td className="px-5 py-3.5 text-right">
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDelete(doc.id); }}
                      className="text-[#71717a] hover:text-rose-400 p-1 rounded hover:bg-rose-500/10 transition-colors"
                      title="Delete document"
                    >
                      <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                      </svg>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function ChatView({ quickPrompt, clearQuickPrompt, docVersion }: { quickPrompt: string; clearQuickPrompt: () => void; docVersion: number }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [docs, setDocs] = useState<ApiDocument[]>([]);
  const [selectedDoc, setSelectedDoc] = useState("");
  const [expandedCitations, setExpandedCitations] = useState<Set<string>>(new Set());
  const [typing, setTyping] = useState(false);
  const [isVoiceMode, setIsVoiceMode] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const didAutoSend = useRef(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<BlobPart[]>([]);
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    fetchDocuments().then(d => {
      const ready = d.filter(x => statusForDoc(x) === "ready");
      setDocs(ready);
      if (ready.length > 0 && !selectedDoc) setSelectedDoc(ready[0].id);
    }).catch(() => {});
  }, [docVersion]);

  useEffect(() => {
    if (quickPrompt && !didAutoSend.current) {
      didAutoSend.current = true;
      setInput(quickPrompt);
      setTimeout(() => {
        sendMessageDirect(quickPrompt);
        clearQuickPrompt();
      }, 0);
    }
  }, [quickPrompt]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, typing]);

  function toggleCitation(id: string) {
    setExpandedCitations(prev => {
      const s = new Set(prev);
      s.has(id) ? s.delete(id) : s.add(id);
      return s;
    });
  }

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorderRef.current = new MediaRecorder(stream);
      audioChunksRef.current = [];
      
      mediaRecorderRef.current.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };
      
      mediaRecorderRef.current.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        stream.getTracks().forEach(t => t.stop());
        
        setTyping(true);
        try {
          const { text } = await transcribeAudio(audioBlob);
          if (text.trim()) {
            await sendMessageDirect(text, true);
          }
        } catch (e) {
          console.error("STT failed", e);
          setMessages(prev => [...prev, { id: `e${Date.now()}`, role: "ai", content: "Sorry, I couldn't hear that properly.", timestamp: now() }]);
        } finally {
          setTyping(false);
        }
      };
      
      mediaRecorderRef.current.start();
      setIsRecording(true);
    } catch (e) {
      console.error("Microphone error", e);
      alert("Microphone access is required for voice chat.");
    }
  }

  function stopRecording() {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  }

  async function sendMessageDirect(q: string, playVoice = false) {
    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
      currentAudioRef.current = null;
    }
    
    if (!q) return;
    const userMsg: ChatMessage = { id: `u${Date.now()}`, role: "user", content: q, timestamp: now() };
    setMessages(prev => [...prev, userMsg]);
    setInput("");
    setTyping(true);

    try {
      const { answer, citations } = await chatWithAI(q, selectedDoc || undefined);
      const mappedCitations = citations.map(c => ({
        snippet: c.snippet,
        page: null,
      }));

      const aiMsg: ChatMessage = {
        id: `a${Date.now()}`, role: "ai", content: answer,
        citations: mappedCitations.length > 0 ? mappedCitations : undefined,
        timestamp: now(),
      };
      setMessages(prev => [...prev, aiMsg]);

      if (playVoice) {
        try {
          const audioBlob = await generateSpeech(answer);
          const url = URL.createObjectURL(audioBlob);
          const audio = new Audio(url);
          const existingAudio = currentAudioRef.current as HTMLAudioElement | null;
          if (existingAudio) {
            existingAudio.pause();
          }
          currentAudioRef.current = audio;
          
          audio.play();
        } catch (e) {
          console.error("TTS failed", e);
        }
      }
    } catch {
      setMessages(prev => [...prev, {
        id: `e${Date.now()}`, role: "ai",
        content: "Sorry, something went wrong. Please check your Groq API key in Settings and try again.",
        timestamp: now(),
      }]);
    } finally {
      setTyping(false);
    }
  }

  async function sendMessage() {
    const q = input.trim();
    if (!q) return;
    setInput("");
    await sendMessageDirect(q);
  }

  function renderContent(content: string) {
    return (
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          table: ({ children }) => (
            <div className="my-3 overflow-x-auto rounded-xl border border-[#27272a] bg-[#121215] shadow-sm">
              <table className="w-full text-xs text-left font-mono border-collapse">
                {children}
              </table>
            </div>
          ),
          thead: ({ children }) => (
            <thead className="bg-[#1a1a1e] border-b border-[#27272a]">
              {children}
            </thead>
          ),
          tbody: ({ children }) => (
            <tbody className="divide-y divide-[#27272a]/60">
              {children}
            </tbody>
          ),
          tr: ({ children }) => (
            <tr className="hover:bg-[#1a1a24]/50 transition-colors">
              {children}
            </tr>
          ),
          th: ({ children }) => (
            <th className="px-4 py-2.5 font-mono text-[11px] text-indigo-300 font-bold uppercase tracking-wider">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="px-4 py-2.5 text-[#e4e4e7] leading-relaxed font-mono">
              {children}
            </td>
          ),
          p: ({ children }) => <p className="mb-2.5 last:mb-0 leading-relaxed">{children}</p>,
          ul: ({ children }) => <ul className="list-disc list-inside my-2 space-y-1 text-[#e4e4e7]">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal list-inside my-2 space-y-1 text-[#e4e4e7]">{children}</ol>,
          li: ({ children }) => <li className="leading-relaxed">{children}</li>,
          h1: ({ children }) => <h1 className="text-base font-bold font-mono text-[#f4f4f5] mt-4 mb-2">{children}</h1>,
          h2: ({ children }) => <h2 className="text-sm font-bold font-mono text-[#f4f4f5] mt-3 mb-1.5">{children}</h2>,
          h3: ({ children }) => <h3 className="text-xs font-bold font-mono text-indigo-300 mt-2 mb-1">{children}</h3>,
          strong: ({ children }) => <strong className="font-semibold text-[#f4f4f5]">{children}</strong>,
          em: ({ children }) => <em className="italic text-indigo-200">{children}</em>,
          code: ({ inline, className, children, ...props }: any) => {
            if (inline) {
              return <code className="px-1.5 py-0.5 rounded bg-[#1a1a1e] border border-[#27272a] font-mono text-xs text-indigo-300" {...props}>{children}</code>;
            }
            return (
              <pre className="my-3 p-4 rounded-xl bg-[#121215] border border-[#27272a] overflow-x-auto font-mono text-xs text-[#e4e4e7]">
                <code {...props}>{children}</code>
              </pre>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    );
  }

  return (
    <div className="flex flex-col h-full bg-[#09090b]">
      {/* Context Toolbar */}
      <div className="px-6 py-3.5 border-b border-[#27272a] flex items-center gap-3 bg-[#121215]">
        <span className="text-[10px] font-mono text-indigo-400 uppercase tracking-widest">// CONTEXT SOURCE:</span>
        <select
          value={selectedDoc}
          onChange={e => setSelectedDoc(e.target.value)}
          className="flex-1 max-w-sm bg-[#1a1a1e] border border-[#27272a] rounded-xl px-3 py-1.5 text-xs font-mono text-indigo-300 focus:outline-none focus:border-indigo-500 cursor-pointer"
        >
          <option value="">All indexed documents (Global RAG)</option>
          {docs.map(d => <option key={d.id} value={d.id}>{d.title}</option>)}
        </select>
        <div className="flex items-center gap-2 ml-auto bg-emerald-500/10 border border-emerald-500/20 px-3 py-1 rounded-full">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-[10px] font-mono text-emerald-400 uppercase tracking-wider font-semibold">RAG ACTIVE</span>
        </div>
      </div>

      {/* Messages Canvas */}
      <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6">
        {messages.length === 0 && (
          <div className="text-center py-20">
            <div className="w-16 h-16 rounded-2xl bg-indigo-600/10 border border-indigo-500/30 flex items-center justify-center mx-auto mb-4 text-indigo-400 shadow-[0_0_20px_rgba(99,102,241,0.2)]">
              {Icon.sparkle}
            </div>
            <h3 className="font-mono font-bold text-[#f4f4f5] text-base mb-1">AI Study Assistant</h3>
            <p className="text-xs font-mono text-[#71717a] max-w-sm mx-auto">Ask any question grounded in your course materials. Supports Voice Chat & instant citations.</p>
          </div>
        )}
        {messages.map(msg => (
          <div key={msg.id} className={`flex gap-3.5 ${msg.role === "user" ? "flex-row-reverse" : "flex-row"}`}>
            <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 text-xs font-mono font-bold border shadow-sm ${
              msg.role === "user" ? "bg-indigo-600 text-white border-indigo-400/40" : "bg-[#1a1a1e] text-indigo-400 border-[#27272a]"
            }`}>
              {msg.role === "user" ? "U" : "AI"}
            </div>
            <div className={`max-w-[75%] space-y-2.5 ${msg.role === "user" ? "items-end" : "items-start"} flex flex-col`}>
              <div className={`px-5 py-3.5 rounded-2xl text-sm leading-relaxed ${
                msg.role === "user" 
                  ? "bg-indigo-600 text-white rounded-tr-xs shadow-md" 
                  : "bg-[#121215] border border-[#27272a] text-[#e4e4e7] rounded-tl-xs shadow-sm"
              }`}>
                {renderContent(msg.content)}
              </div>
              {msg.citations && msg.citations.length > 0 && (
                <div className="space-y-1.5 w-full">
                  {msg.citations.map((c, ci) => (
                    <div key={ci} className="rounded-xl overflow-hidden border border-[#27272a] bg-[#121215]">
                      <button
                        onClick={() => toggleCitation(`${msg.id}-${ci}`)}
                        className="w-full flex items-center gap-2 px-3.5 py-2 bg-[#1a1a1e] hover:bg-[#222228] transition-colors duration-150 text-left"
                      >
                        <span className="text-indigo-400">{Icon.sparkle}</span>
                        <span className="text-xs font-mono text-indigo-300 font-medium">Source Citation #{ci + 1}</span>
                        <span className={`ml-auto text-[#71717a] transition-transform duration-200 ${expandedCitations.has(`${msg.id}-${ci}`) ? "rotate-180" : ""}`}>{Icon.chevronDown}</span>
                      </button>
                      {expandedCitations.has(`${msg.id}-${ci}`) && (
                        <div className="px-3.5 py-2.5 bg-[#0e0e11] border-t border-[#27272a]">
                          <p className="text-xs font-mono text-[#a1a1aa] italic leading-relaxed">"{c.snippet}"</p>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
              <span className="text-[10px] font-mono text-[#71717a] px-1">{msg.timestamp}</span>
            </div>
          </div>
        ))}
        {typing && (
          <div className="flex gap-3.5">
            <div className="w-8 h-8 rounded-xl flex items-center justify-center bg-[#1a1a1e] text-indigo-400 border border-[#27272a] text-xs font-mono font-bold">AI</div>
            <div className="px-5 py-3.5 rounded-2xl bg-[#121215] border border-[#27272a] flex gap-1.5 items-center">
              {[0, 1, 2].map(i => (
                <span key={i} className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
              ))}
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input Area */}
      <div className="px-6 py-4 border-t border-[#27272a] bg-[#121215]">
        <div className="flex gap-3 items-center">
          <button
            onClick={() => setIsVoiceMode(!isVoiceMode)}
            className={`w-11 h-11 rounded-xl flex items-center justify-center transition-all duration-150 shrink-0 border ${
              isVoiceMode 
                ? 'bg-indigo-600 text-white border-indigo-400 shadow-[0_0_15px_rgba(99,102,241,0.4)]' 
                : 'bg-[#1a1a1e] text-[#a1a1aa] border-[#27272a] hover:text-[#f4f4f5] hover:border-[#3f3f46]'
            }`}
            title="Toggle Voice Mode"
          >
            🎙️
          </button>
          
          {isVoiceMode ? (
            <div className="flex-1 flex items-center justify-center bg-[#1a1a1e] border border-[#27272a] rounded-xl px-4 h-11">
              <button
                onMouseDown={startRecording}
                onMouseUp={stopRecording}
                onMouseLeave={stopRecording}
                onTouchStart={startRecording}
                onTouchEnd={stopRecording}
                className={`px-6 py-1.5 rounded-lg flex items-center justify-center gap-2 font-mono text-xs font-semibold transition-all duration-200 select-none ${
                  isRecording 
                    ? 'bg-rose-600 text-white shadow-[0_0_15px_rgba(244,63,94,0.5)] animate-pulse' 
                    : 'bg-indigo-600 text-white hover:bg-indigo-500'
                }`}
              >
                {isRecording ? "Listening... (Release to Send)" : "Hold Space / Click to Speak"}
              </button>
            </div>
          ) : (
            <>
              <textarea
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
                placeholder="Ask a question about your study documents..."
                rows={1}
                className="flex-1 bg-[#1a1a1e] border border-[#27272a] rounded-xl px-4 py-3 text-sm text-[#f4f4f5] placeholder:text-[#52525b] focus:outline-none focus:border-indigo-500 resize-none font-sans transition-all duration-150"
              />
              <button
                onClick={sendMessage}
                disabled={!input.trim()}
                className="w-11 h-11 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center text-white transition-all duration-150 shrink-0 shadow-sm"
              >
                {Icon.send}
              </button>
            </>
          )}
        </div>
        <p className="mt-2 text-[10px] font-mono text-[#71717a]">Press Enter to send • Answers grounded in vector database embeddings</p>
      </div>
    </div>
  );
}

function QuizView({ docVersion }: { docVersion: number }) {
  const [phase, setPhase] = useState<QuizPhase>("list");
  const [quizzes, setQuizzes] = useState<ApiQuiz[]>([]);
  const [selectedQuiz, setSelectedQuiz] = useState<ApiQuiz | null>(null);
  const [currentQ, setCurrentQ] = useState(0);
  const [selected, setSelected] = useState<SelectedAnswers>({});
  const [submitted, setSubmitted] = useState(false);
  const [quizResults, setQuizResults] = useState<{ score: number; results: { questionId: string; isCorrect: boolean; explanation: string }[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [docs, setDocs] = useState<ApiDocument[]>([]);
  const [selectedDocId, setSelectedDocId] = useState("");
  const [questionCount, setQuestionCount] = useState(4);
  const [generating, setGenerating] = useState(false);
  const [timeLeft, setTimeLeft] = useState(0);

  useEffect(() => {
    Promise.all([
      fetchQuizzes().then(setQuizzes),
      fetchDocuments().then(d => {
        const ready = d.filter(x => statusForDoc(x) === "ready");
        setDocs(ready);
        if (ready.length > 0) setSelectedDocId(ready[0].id);
      }),
    ]).catch(() => {}).finally(() => setLoading(false));
  }, [docVersion]);

  function selectOption(qi: number, answer: string) {
    if (!submitted) setSelected(prev => ({ ...prev, [qi]: answer }));
  }

  async function startQuiz(quiz: ApiQuiz) {
    setLoading(true);
    try {
      const full = await fetchQuiz(quiz.id);
      setSelectedQuiz(full);
      setCurrentQ(0);
      setSelected({});
      setSubmitted(false);
      setQuizResults(null);
      setTimeLeft((full.questions?.length || 0) * 60);
      setPhase("taking");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load quiz");
    } finally {
      setLoading(false);
    }
  }

  async function handleGenerateQuiz() {
    if (!selectedDocId) return;
    setGenerating(true);
    setError("");
    try {
      const quiz = await generateQuiz(selectedDocId, undefined, questionCount);
      setQuizzes(prev => [quiz, ...prev]);
      await startQuiz(quiz);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to generate quiz. Check your Groq API key in Settings.");
    } finally {
      setGenerating(false);
    }
  }

  async function handleSubmit() {
    if (!selectedQuiz?.questions || submitted) return;
    setSubmitted(true);
    try {
      const answers = selectedQuiz.questions.map((q, i) => ({
        questionId: q.id,
        answer: selected[i] || "",
      }));
      const result = await submitQuiz(selectedQuiz.id, answers);
      setQuizResults(result);
      setPhase("results");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to submit quiz");
      setSubmitted(false);
    }
  }

  const questions = selectedQuiz?.questions || [];
  const count = questions.length;

  // Timer hook
  useEffect(() => {
    if (phase === "taking" && !submitted && timeLeft > 0) {
      const timer = setInterval(() => {
        setTimeLeft(prev => prev > 0 ? prev - 1 : 0);
      }, 1000);
      return () => clearInterval(timer);
    }
  }, [phase, submitted, timeLeft]);

  // Auto-submit when time is up
  useEffect(() => {
    if (phase === "taking" && !submitted && timeLeft === 0 && selectedQuiz) {
      handleSubmit();
    }
  }, [phase, submitted, timeLeft, selectedQuiz]);

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  if (loading && phase === "list") {
    return <div className="p-8 text-sm font-mono text-[#71717a]">Loading quizzes...</div>;
  }

  // Phase: List quizzes
  if (phase === "list") {
    return (
      <div className="p-8 space-y-6 bg-[#09090b]">
        {error && (
          <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm font-mono text-rose-400">⚠️ {error}</div>
        )}

        {/* Generate Quiz card */}
        <div className="bg-[#121215] rounded-2xl border border-[#27272a] p-6 shadow-sm">
          <span className="font-mono text-[10px] text-indigo-400 uppercase tracking-widest block mb-0.5">// 01. QUIZ GENERATION ENGINE</span>
          <h2 className="font-mono font-bold text-xl text-[#f4f4f5] mb-1">Generate Practice Quiz</h2>
          <p className="text-xs font-mono text-[#71717a] mb-6">AI creates multiple-choice questions grounded in your vector-indexed documents.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            <div>
              <label className="block text-xs font-mono text-[#71717a] uppercase tracking-wider mb-2">Source Document</label>
              {docs.length === 0 ? (
                <p className="text-xs font-mono text-[#71717a]">No documents ready. Upload a PDF first.</p>
              ) : (
                <select
                  value={selectedDocId}
                  onChange={e => setSelectedDocId(e.target.value)}
                  className="w-full bg-[#1a1a1e] border border-[#27272a] rounded-xl px-3.5 py-2.5 text-xs font-mono text-indigo-300 focus:outline-none focus:border-indigo-500 cursor-pointer"
                >
                  {docs.map(d => (
                    <option key={d.id} value={d.id}>{d.title}</option>
                  ))}
                </select>
              )}
            </div>
            <div>
              <label className="block text-xs font-mono text-[#71717a] uppercase tracking-wider mb-3">Questions — <span className="text-indigo-400 font-bold">{questionCount}</span></label>
              <input
                type="range"
                min={2}
                max={10}
                value={questionCount}
                onChange={e => setQuestionCount(+e.target.value)}
                className="w-full accent-indigo-500 cursor-pointer"
              />
              <div className="flex justify-between text-[10px] font-mono text-[#71717a] mt-1"><span>2 Qs</span><span>10 Qs</span></div>
            </div>
            <div className="flex items-end">
              <button
                onClick={handleGenerateQuiz}
                disabled={!selectedDocId || generating}
                className="w-full py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-mono font-semibold text-xs flex items-center justify-center gap-2 transition-all duration-150 shadow-sm"
              >
                {generating ? (
                  <><span className="animate-spin">⏳</span> Generating Quiz...</>
                ) : (
                  <>{Icon.sparkle} Generate {questionCount} Questions</>
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Existing quizzes */}
        <div>
          <span className="font-mono text-[10px] text-indigo-400 uppercase tracking-widest block mb-2">// SAVED QUIZZES</span>
          {quizzes.length === 0 ? (
            <div className="bg-[#121215] rounded-2xl border border-[#27272a] p-10 text-center">
              <p className="text-xs font-mono text-[#71717a]">No quizzes generated yet. Choose a document above to generate one.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {quizzes.map(q => (
                <button
                  key={q.id}
                  onClick={() => startQuiz(q)}
                  className="text-left p-4 rounded-xl border border-[#27272a] bg-[#121215] hover:border-indigo-500/40 hover:bg-[#1a1a24] transition-all duration-150 group"
                >
                  <div className="flex items-center justify-between">
                    <p className="font-mono text-sm text-[#f4f4f5] font-semibold group-hover:text-indigo-300 transition-colors">{q.title}</p>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                      {q.questions?.length ?? "?"} Qs
                    </span>
                  </div>
                  <p className="text-[10px] font-mono text-[#71717a] mt-2">Created {dateStr(q.created_at)}</p>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // Phase: Taking quiz
  if (phase === "taking" && questions.length > 0) {
    const q = questions[currentQ];
    const allAnswered = Object.keys(selected).length === count;

    return (
      <div className="p-8 w-full max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between bg-[#121215] border border-[#27272a] p-4 rounded-2xl">
          <div className="flex items-center gap-3">
            <span className="font-mono text-xs text-indigo-400 font-semibold">{selectedQuiz?.title}</span>
            <span className="text-[#27272a]">•</span>
            <span className="font-mono text-xs text-[#71717a]">Question {currentQ + 1} of {count}</span>
          </div>
          <div className="flex items-center gap-4">
            <div className={`text-xs font-mono font-bold flex items-center gap-1.5 px-3 py-1.5 rounded-lg border ${timeLeft < 30 ? "bg-rose-500/10 border-rose-500/30 text-rose-400 animate-pulse" : "bg-indigo-500/10 border-indigo-500/20 text-indigo-400"}`}>
              <span>⏱</span>
              <span>{formatTime(timeLeft)}</span>
            </div>
            <button onClick={() => { setPhase("list"); setSelectedQuiz(null); }} className="text-xs font-mono text-[#71717a] hover:text-[#f4f4f5] transition-colors">Exit</button>
          </div>
        </div>

        {/* Progress bar */}
        <div className="h-2 bg-[#121215] rounded-full overflow-hidden border border-[#27272a]">
          <div className="h-full bg-indigo-500 rounded-full transition-all duration-500" style={{ width: `${((currentQ + 1) / count) * 100}%` }} />
        </div>

        {/* Question breadcrumb chips */}
        <div className="flex gap-2 flex-wrap">
          {questions.map((_, qi) => (
            <button
              key={qi}
              onClick={() => setCurrentQ(qi)}
              className={`w-8 h-8 rounded-xl text-xs font-mono font-bold transition-all duration-150 ${
                qi === currentQ
                  ? "bg-indigo-600 text-white shadow-sm"
                  : selected[qi] !== undefined
                  ? "bg-indigo-500/20 text-indigo-300 border border-indigo-500/30"
                  : "bg-[#121215] text-[#71717a] border border-[#27272a] hover:border-[#3f3f46]"
              }`}
            >
              {qi + 1}
            </button>
          ))}
        </div>

        {/* Question Card */}
        <div className="bg-[#121215] border border-[#27272a] p-8 rounded-2xl shadow-sm space-y-6">
          <h3 className="font-mono font-semibold text-lg text-[#f4f4f5] leading-relaxed">{q.question}</h3>

          {/* Options */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5">
            {q.options.map((opt, oi) => {
              const isSelected = selected[currentQ] === opt;
              return (
                <button
                  key={oi}
                  onClick={() => selectOption(currentQ, opt)}
                  className={`w-full text-left p-4 rounded-xl border text-xs font-mono transition-all duration-150 flex items-center gap-3.5
                    ${isSelected
                      ? "border-indigo-500 bg-indigo-500/15 text-indigo-200 shadow-sm"
                      : "border-[#27272a] bg-[#1a1a1e] text-[#a1a1aa] hover:border-indigo-500/40 hover:text-[#f4f4f5]"}`}
                >
                  <span className={`w-7 h-7 rounded-lg text-xs flex items-center justify-center font-bold shrink-0 ${
                    isSelected ? "bg-indigo-600 text-white" : "bg-[#27272a] text-[#71717a]"
                  }`}>
                    {String.fromCharCode(65 + oi)}
                  </span>
                  <span className="flex-1 leading-snug">{opt}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Navigation */}
        <div className="flex gap-3">
          {currentQ > 0 && (
            <button onClick={() => setCurrentQ(q => q - 1)} className="px-6 py-2.5 rounded-xl border border-[#27272a] bg-[#121215] text-xs font-mono text-[#a1a1aa] hover:text-[#f4f4f5] hover:border-[#3f3f46] transition-colors">
              Back
            </button>
          )}
          {currentQ < count - 1 ? (
            <button
              onClick={() => setCurrentQ(q => q + 1)}
              disabled={selected[currentQ] === undefined}
              className="flex-1 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-mono font-semibold transition-colors"
            >
              Next Question →
            </button>
          ) : (
            <button
              onClick={handleSubmit}
              disabled={!allAnswered || submitted}
              className="flex-1 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-mono font-semibold transition-colors"
            >
              {submitted ? "Submitting..." : "Submit Practice Quiz"}
            </button>
          )}
        </div>
      </div>
    );
  }

  // Phase: Results
  if (phase === "results" && quizResults) {
    const score = quizResults.score;
    const pct = Math.round(score);
    return (
      <div className="p-8 w-full max-w-4xl mx-auto space-y-8 bg-[#09090b]">
        <div className="flex items-start justify-between">
          <div>
            <span className="font-mono text-[10px] text-indigo-400 uppercase tracking-widest block mb-0.5">// EVALUATION COMPLETE</span>
            <h2 className="font-mono font-bold text-xl text-[#f4f4f5]">Quiz Performance Summary</h2>
            <p className="text-xs font-mono text-[#71717a] mt-1">{selectedQuiz?.title}</p>
          </div>
          <button onClick={() => { setPhase("list"); setSelectedQuiz(null); }} className="px-4 py-2 rounded-xl border border-[#27272a] bg-[#121215] text-xs font-mono text-[#a1a1aa] hover:text-[#f4f4f5] transition-colors">
            Back to Quizzes →
          </button>
        </div>

        <div className="bg-[#121215] rounded-2xl p-6 border border-[#27272a] flex items-center gap-8 shadow-sm">
          <div className="text-center shrink-0">
            <div className="font-mono font-extrabold text-5xl" style={{ color: pct >= 80 ? "#10b981" : pct >= 60 ? "#6366f1" : "#f59e0b" }}>{pct}%</div>
            <div className="text-[10px] font-mono text-[#71717a] uppercase tracking-wider mt-1">Accuracy Score</div>
          </div>
          <div className="flex-1">
            <div className="h-2 bg-[#1a1a1e] rounded-full overflow-hidden mb-3 border border-[#27272a]">
              <div className="h-full rounded-full transition-all duration-700" style={{ width: `${pct}%`, backgroundColor: pct >= 80 ? "#10b981" : pct >= 60 ? "#6366f1" : "#f59e0b" }} />
            </div>
            <p className="text-xs font-mono text-[#f4f4f5] font-semibold">{pct >= 80 ? "Mastery Demonstrated — Excellent performance." : pct >= 60 ? "Solid Progress — Review highlighted gaps." : "Further Practice Recommended."}</p>
            <p className="text-xs font-mono text-[#71717a] mt-1">{questions.filter((_, i) => quizResults.results[i]?.isCorrect).length} of {count} questions answered correctly</p>
          </div>
        </div>

        <div>
          <span className="font-mono text-[10px] text-indigo-400 uppercase tracking-widest block mb-3">// QUESTION BREAKDOWN</span>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {questions.map((q, i) => {
              const result = quizResults.results.find(r => r.questionId === q.id);
              const correct = result?.isCorrect ?? false;
              return (
                <div key={q.id} className={`rounded-2xl border p-5 space-y-3 bg-[#121215] ${correct ? "border-emerald-500/30" : "border-rose-500/30"}`}>
                  <div className="flex items-start gap-3">
                    <div className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 mt-0.5 text-xs text-white ${correct ? "bg-emerald-500" : "bg-rose-500"}`}>
                      {correct ? "✓" : "✕"}
                    </div>
                    <p className="text-xs font-mono text-[#f4f4f5] font-medium leading-relaxed">{q.question}</p>
                  </div>
                  <div className="pl-8 space-y-1 text-xs font-mono">
                    {!correct && selected[i] && (
                      <div className="text-rose-400">
                        <span>Your selection: </span>
                        <span className="font-semibold">{selected[i]}</span>
                      </div>
                    )}
                    <div className="text-emerald-400">
                      <span>Correct answer: </span>
                      <span className="font-semibold">{q.correct_answer}</span>
                    </div>
                    {q.explanation && <p className="text-[11px] text-[#71717a] mt-2 leading-relaxed italic">{q.explanation}</p>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  return null;
}

function ProgressView() {
  const [progress, setProgress] = useState<ApiProgress[]>([]);
  const [attempts, setAttempts] = useState<ApiAttemptRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([fetchProgress(), fetchAttempts()])
      .then(([p, a]) => { setProgress(p); setAttempts(a); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className="p-8 text-sm font-mono text-[#71717a]">Loading progress tracker...</div>;
  }

  const displayProgress = progress.length > 0 ? progress : [
    { id: "1", mastery_score: 82, topics: { name: "Data Structures" } as { name: string } | undefined, last_updated: "2026-08-19" },
    { id: "2", mastery_score: 64, topics: { name: "Algorithms" } as { name: string } | undefined, last_updated: "2026-08-18" },
    { id: "3", mastery_score: 31, topics: { name: "Operating Systems" } as { name: string } | undefined, last_updated: "2026-08-16" },
    { id: "4", mastery_score: 55, topics: { name: "Networks" } as { name: string } | undefined, last_updated: "2026-08-15" },
  ] as ApiProgress[];

  const displayAttempts = attempts.length > 0 ? attempts : RECENT_ATTEMPTS.map((a, i) => ({
    id: `a${i}`, quiz_id: `q${i}`, user_id: "demo", score: (a.score / a.total) * 100,
    answers: [], created_at: a.date, quizzes: { title: a.topic, topic_id: null, topics: { name: a.topic } },
  }));

  return (
    <div className="p-8 space-y-8 bg-[#09090b]">
      {/* Mastery rings */}
      <div>
        <span className="font-mono text-[10px] text-indigo-400 uppercase tracking-widest block mb-1">// 01. PROFICIENCY METRICS</span>
        <h2 className="font-mono text-sm font-semibold text-[#f4f4f5] mb-5">Topic Mastery Ratings</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {displayProgress.map(p => {
            const trends = ["up", "up", "flat", "down"];
            const trend = trends[displayProgress.indexOf(p) % trends.length];
            const attemptsArr = [7, 5, 2, 4];
            const attemptCount = attemptsArr[displayProgress.indexOf(p) % attemptsArr.length];
            return (
              <div key={p.id} className="bg-[#121215] rounded-2xl p-5 border border-[#27272a] flex flex-col items-center gap-3 shadow-sm">
                <MasteryRing mastery={Math.round(p.mastery_score)} topic={p.topics?.name ?? "Unknown"} />
                <div className="text-center space-y-1">
                  <div className="flex items-center gap-1.5 justify-center">
                    <span className={`text-xs font-mono font-bold ${trend === "up" ? "text-emerald-400" : trend === "down" ? "text-rose-400" : "text-[#71717a]"}`}>
                      {trend === "up" ? "↑ +4%" : trend === "down" ? "↓ -2%" : "–"}
                    </span>
                    <span className="text-[10px] font-mono text-[#71717a]">• {attemptCount} quizzes</span>
                  </div>
                  <div className="text-[10px] font-mono text-[#71717a]">{dateStr(p.last_updated)}</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Weak areas */}
      {displayProgress.filter(p => p.mastery_score < 60).length > 0 && (
        <div>
          <span className="font-mono text-[10px] text-amber-400 uppercase tracking-widest block mb-1">// 02. TARGETED REVISION</span>
          <h2 className="font-mono text-sm font-semibold text-[#f4f4f5] mb-3">Topics Requiring Attention</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {displayProgress.filter(p => p.mastery_score < 60).map(p => (
              <div key={p.id} className="bg-[#121215] rounded-xl border border-amber-500/30 p-4 flex items-center gap-4">
                <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400 font-mono font-bold text-sm shrink-0">{Math.round(p.mastery_score)}</div>
                <div className="flex-1 min-w-0">
                  <p className="font-mono text-xs text-[#f4f4f5] font-semibold truncate">{p.topics?.name ?? "Unknown"}</p>
                  <div className="mt-2 h-1.5 bg-[#1a1a1e] rounded-full overflow-hidden border border-[#27272a]">
                    <div className="h-full bg-amber-500 rounded-full" style={{ width: `${p.mastery_score}%` }} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent attempts table */}
      <div>
        <span className="font-mono text-[10px] text-indigo-400 uppercase tracking-widest block mb-1">// 03. ATTEMPT LOG</span>
        <h2 className="font-mono text-sm font-semibold text-[#f4f4f5] mb-3">Quiz Session History</h2>
        <div className="rounded-2xl overflow-hidden border border-[#27272a] bg-[#121215]">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#27272a] bg-[#1a1a1e]/40">
                {["Date", "Topic", "Score", "Time", "Accuracy"].map(h => (
                  <th key={h} className="px-5 py-3 text-left font-mono text-[10px] text-[#71717a] uppercase tracking-widest">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {displayAttempts.map((a, i) => {
                const pct = Math.round(a.score);
                const times = ["4m 32s", "6m 18s", "5m 01s", "8m 44s", "3m 55s"];
                return (
                  <tr key={a.id} className={`border-b border-[#27272a]/60 hover:bg-[#1a1a24]/50 transition-colors duration-150 ${i === displayAttempts.length - 1 ? "border-b-0" : ""}`}>
                    <td className="px-5 py-3.5 font-mono text-xs text-[#71717a]">{dateStr(a.created_at)}</td>
                    <td className="px-5 py-3.5">
                      <span className="px-2.5 py-1 rounded bg-indigo-500/10 border border-indigo-500/20 text-indigo-300 text-xs font-mono">{a.quizzes?.topics?.name ?? a.quizzes?.title ?? "Quiz"}</span>
                    </td>
                    <td className="px-5 py-3.5">
                      <span className={`font-mono font-bold text-xs ${pct >= 80 ? "text-emerald-400" : pct >= 60 ? "text-indigo-400" : "text-amber-400"}`}>
                        {Math.round(a.score * 10) / 10}/100
                      </span>
                    </td>
                    <td className="px-5 py-3.5 font-mono text-xs text-[#71717a]">{times[i % times.length]}</td>
                    <td className="px-5 py-3.5">
                      <div className="w-20 h-1.5 bg-[#1a1a1e] rounded-full overflow-hidden border border-[#27272a]">
                        <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: pct >= 80 ? "#10b981" : pct >= 60 ? "#6366f1" : "#f59e0b" }} />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function SettingsView({ onClearData }: { onClearData?: () => void }) {
  const [settings, setSettings] = useState<ApiSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [clearMsg, setClearMsg] = useState("");
  const [groqApiKey, setGroqApiKey] = useState("");
  const [groqKeySet, setGroqKeySet] = useState(false);
  const [groqKeyMasked, setGroqKeyMasked] = useState("");
  const [groqModel, setGroqModel] = useState("");
  const [googleApiKey, setGoogleApiKey] = useState("");
  const [googleKeySet, setGoogleKeySet] = useState(false);
  const [googleKeyMasked, setGoogleKeyMasked] = useState("");
  const [chunkSize, setChunkSize] = useState(700);
  const [chunkOverlap, setChunkOverlap] = useState(15);

  useEffect(() => {
    fetchSettings()
      .then(s => {
        setSettings(s);
        setGroqKeySet(s.groqKeySet);
        setGroqKeyMasked(s.groqKeyMasked);
        setGroqModel(s.groqModel || "");
        setGoogleKeySet(s.googleKeySet);
        setGoogleKeyMasked(s.googleKeyMasked);
        setChunkSize(s.chunkSize || 700);
        setChunkOverlap(s.chunkOverlap || 15);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    try {
      const payload: Record<string, unknown> = { chunkSize, chunkOverlap };
      if (groqModel) payload.groqModel = groqModel;
      if (groqApiKey) payload.groqApiKey = groqApiKey;
      if (googleApiKey) payload.googleApiKey = googleApiKey;
      await updateSettings(payload as Partial<ApiSettings>);
      if (groqApiKey) {
        setGroqKeySet(true);
        setGroqKeyMasked(groqApiKey.slice(0, 4) + "••••••••" + groqApiKey.slice(-4));
        setGroqApiKey("");
      }
      if (googleApiKey) {
        setGoogleKeySet(true);
        setGoogleKeyMasked(googleApiKey.slice(0, 4) + "••••••••" + googleApiKey.slice(-4));
        setGoogleApiKey("");
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
    } finally {
      setSaving(false);
    }
  }

  async function handleClearData() {
    if (!confirm("Delete ALL documents, chunks, quizzes, progress, and flashcards? This cannot be undone.")) return;
    setClearing(true);
    setClearMsg("");
    try {
      await clearDemoData();
      setClearMsg("All data cleared.");
      onClearData?.();
      setTimeout(() => setClearMsg(""), 3000);
    } catch (e: unknown) {
      setClearMsg(e instanceof Error ? e.message : "Clear failed");
    } finally {
      setClearing(false);
    }
  }

  if (loading) {
    return <div className="p-8 text-sm font-mono text-[#71717a]">Loading environment configuration...</div>;
  }

  return (
    <div className="p-8 w-full max-w-4xl mx-auto space-y-8 bg-[#09090b]">
      <div className="flex items-center justify-between bg-[#121215] border border-[#27272a] p-6 rounded-2xl shadow-sm">
        <div>
          <span className="font-mono text-[10px] text-indigo-400 uppercase tracking-widest block mb-0.5">// ENVIRONMENT CONFIG</span>
          <h2 className="font-mono font-bold text-xl text-[#f4f4f5]">VidyaAI Settings</h2>
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white text-xs font-mono font-semibold transition-all shadow-sm"
        >
          {saving ? "Saving..." : saved ? "✓ Saved" : "Save Changes"}
        </button>
      </div>

      {/* Google (Embeddings) */}
      <div className="p-6 bg-[#121215] border border-[#27272a] rounded-2xl space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className={`w-2.5 h-2.5 rounded-full ${googleKeySet ? "bg-emerald-400" : "bg-rose-400"}`} />
            <label className="font-mono text-xs font-bold text-[#f4f4f5]">Google AI Studio (Embeddings)</label>
          </div>
          <span className={`text-[10px] font-mono px-2 py-0.5 rounded ${googleKeySet ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" : "bg-rose-500/10 text-rose-400 border border-rose-500/20"}`}>
            {googleKeySet ? "● Configured" : "● Missing"}
          </span>
        </div>
        <p className="font-mono text-xs text-[#71717a]">Powers semantic search embeddings — text-embedding-004 (768 dimensions)</p>
        {googleKeySet ? (
          <div className="w-full max-w-md flex items-center gap-2">
            <input
              type="text"
              value={googleKeyMasked}
              disabled
              className="flex-1 bg-[#1a1a1e] border border-[#27272a] rounded-xl px-3.5 py-2 text-xs font-mono text-[#71717a] cursor-not-allowed"
            />
            <button
              onClick={() => { setGoogleKeySet(false); setGoogleKeyMasked(""); setGoogleApiKey(""); }}
              className="px-3 py-2 rounded-xl border border-[#27272a] bg-[#1a1a1e] text-xs font-mono text-[#71717a] hover:text-rose-400 hover:border-rose-500/30 transition-colors"
            >
              Change
            </button>
          </div>
        ) : (
          <input
            type="password"
            value={googleApiKey}
            onChange={e => setGoogleApiKey(e.target.value)}
            placeholder="AIza..."
            className="w-full max-w-md bg-[#1a1a1e] border border-[#27272a] rounded-xl px-3.5 py-2 text-xs font-mono text-[#f4f4f5] placeholder:text-[#52525b] focus:outline-none focus:border-indigo-500 transition-colors"
          />
        )}
      </div>

      {/* Groq (LLM) */}
      <div className="p-6 bg-[#121215] border border-[#27272a] rounded-2xl space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className={`w-2.5 h-2.5 rounded-full ${groqKeySet ? "bg-emerald-400" : "bg-rose-400"}`} />
            <label className="font-mono text-xs font-bold text-[#f4f4f5]">Groq Cloud (LLM Engine)</label>
          </div>
          <span className={`text-[10px] font-mono px-2 py-0.5 rounded ${groqKeySet ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" : "bg-rose-500/10 text-rose-400 border border-rose-500/20"}`}>
            {groqKeySet ? "● Configured" : "● Missing"}
          </span>
        </div>
        <p className="font-mono text-xs text-[#71717a]">Powers AI Teacher chat, quiz generation, and SRS flashcard creation</p>
        {groqKeySet ? (
          <div className="w-full max-w-md flex items-center gap-2">
            <input
              type="text"
              value={groqKeyMasked}
              disabled
              className="flex-1 bg-[#1a1a1e] border border-[#27272a] rounded-xl px-3.5 py-2 text-xs font-mono text-[#71717a] cursor-not-allowed"
            />
            <button
              onClick={() => { setGroqKeySet(false); setGroqKeyMasked(""); setGroqApiKey(""); }}
              className="px-3 py-2 rounded-xl border border-[#27272a] bg-[#1a1a1e] text-xs font-mono text-[#71717a] hover:text-rose-400 hover:border-rose-500/30 transition-colors"
            >
              Change
            </button>
          </div>
        ) : (
          <input
            type="password"
            value={groqApiKey}
            onChange={e => setGroqApiKey(e.target.value)}
            placeholder="gsk_..."
            className="w-full max-w-md bg-[#1a1a1e] border border-[#27272a] rounded-xl px-3.5 py-2 text-xs font-mono text-[#f4f4f5] placeholder:text-[#52525b] focus:outline-none focus:border-indigo-500 transition-colors"
          />
        )}
      </div>

      {/* Danger Zone */}
      <div className="p-6 bg-[#121215] border border-rose-500/20 rounded-2xl flex items-center justify-between gap-4">
        <div>
          <span className="font-mono text-[10px] text-rose-400 uppercase tracking-widest block mb-0.5">// DANGER ZONE</span>
          <p className="font-mono text-xs text-[#f4f4f5] font-semibold">Clear Application Database</p>
          <p className="font-mono text-[11px] text-[#71717a] mt-0.5">Purges all documents, vector chunks, quiz logs, and flashcard SRS data.</p>
          {clearMsg && <p className="font-mono text-xs mt-1 text-rose-400">{clearMsg}</p>}
        </div>
        <button
          onClick={handleClearData}
          disabled={clearing}
          className="px-4 py-2.5 rounded-xl border border-rose-500/40 bg-rose-500/10 text-xs font-mono text-rose-400 hover:bg-rose-500/20 transition-all shrink-0"
        >
          {clearing ? "Clearing..." : "Clear All Data"}
        </button>
      </div>
    </div>
  );
}

function FlashcardsView({ navigate }: { navigate: (v: View) => void }) {
  const [cards, setCards] = useState<ApiFlashcard[]>([]);
  const [topics, setTopics] = useState<ApiTopic[]>([]);
  const [documents, setDocuments] = useState<ApiDocument[]>([]);
  const [loading, setLoading] = useState(true);
  
  const [topicFilter, setTopicFilter] = useState<string>("all");
  const [docFilter, setDocFilter] = useState<string>("all");

  const [currentIndex, setCurrentIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    Promise.all([
      fetchDueFlashcards(),
      fetchTopics(),
      fetchDocuments()
    ]).then(([f, t, d]) => {
      setCards(f);
      setTopics(t);
      setDocuments(d);
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    setCurrentIndex(0);
    setIsFlipped(false);
  }, [topicFilter, docFilter]);

  const filteredCards = cards.filter(c => {
    const matchTopic = topicFilter === "all" || c.topic_id === topicFilter;
    const matchDoc = docFilter === "all" || c.document_id === docFilter;
    return matchTopic && matchDoc;
  });

  const handleReview = async (quality: number) => {
    if (submitting || currentIndex >= filteredCards.length) return;
    setSubmitting(true);
    const card = filteredCards[currentIndex];
    try {
      await reviewFlashcard(card.id, quality);
      setIsFlipped(false);
      setCurrentIndex(c => c + 1);
    } catch (e) {
      console.error(e);
      alert("Failed to submit review");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <div className="p-8 text-sm font-mono text-[#71717a]">Loading SRS flashcards...</div>;

  const progress = currentIndex >= filteredCards.length 
    ? `${filteredCards.length} / ${filteredCards.length}` 
    : `${currentIndex + 1} / ${filteredCards.length}`;

  return (
    <div className="p-8 max-w-2xl mx-auto h-full flex flex-col pt-6 bg-[#09090b]">
      <div className="flex items-center justify-between mb-6 bg-[#121215] border border-[#27272a] p-4 rounded-2xl">
        <div>
          <span className="font-mono text-[10px] text-indigo-400 uppercase tracking-widest block mb-0.5">// SRS REVIEW ENGINE</span>
          <h2 className="font-mono font-bold text-sm text-[#f4f4f5]">Flashcard Spaced Repetition</h2>
        </div>
        <span className="px-3 py-1 bg-indigo-500/10 border border-indigo-500/30 rounded-full text-xs font-mono text-indigo-300 font-bold">{progress}</span>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <select
          value={topicFilter}
          onChange={(e) => setTopicFilter(e.target.value)}
          className="flex-1 bg-[#121215] border border-[#27272a] rounded-xl px-4 py-2.5 text-xs text-[#f4f4f5] font-mono focus:outline-none focus:border-indigo-500"
        >
          <option value="all">All Topics</option>
          {topics.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <select
          value={docFilter}
          onChange={(e) => setDocFilter(e.target.value)}
          className="flex-1 bg-[#121215] border border-[#27272a] rounded-xl px-4 py-2.5 text-xs text-[#f4f4f5] font-mono focus:outline-none focus:border-indigo-500"
        >
          <option value="all">All Documents</option>
          {documents.map(d => <option key={d.id} value={d.id}>{d.title}</option>)}
        </select>
      </div>

      {currentIndex >= filteredCards.length ? (
        <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-[#121215] border border-[#27272a] rounded-2xl my-4">
          <div className="w-14 h-14 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 mb-4">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
          </div>
          <h2 className="font-mono font-bold text-xl text-[#f4f4f5] mb-2">Review Session Complete</h2>
          <p className="text-xs font-mono text-[#71717a] max-w-sm mb-6">You've completed all due cards for your selected filters.</p>
          
          <div className="flex gap-3">
            <button onClick={() => { setTopicFilter("all"); setDocFilter("all"); }} className="px-4 py-2.5 rounded-xl border border-[#27272a] bg-[#1a1a1e] text-[#a1a1aa] hover:text-[#f4f4f5] text-xs font-mono transition-colors">
              Reset Filters
            </button>
            <button onClick={() => navigate("documents")} className="px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-mono font-semibold transition-colors">
              Go to Documents →
            </button>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex flex-col relative" style={{ perspective: "1500px" }}>
          <div 
            onClick={() => !isFlipped && setIsFlipped(true)}
            className={`w-full h-80 relative transition-transform duration-500 cursor-pointer`}
            style={{ 
              transformStyle: "preserve-3d", 
              transform: isFlipped ? "rotateY(180deg)" : "rotateY(0deg)",
              transitionTimingFunction: "cubic-bezier(0.645, 0.045, 0.355, 1)",
              willChange: "transform"
            }}
          >
            {/* Front Face */}
            <div 
              className="absolute inset-0 w-full h-full flex flex-col rounded-2xl border border-[#27272a] bg-[#121215] hover:border-indigo-500/40 transition-colors shadow-sm p-8 overflow-hidden"
              style={{ backfaceVisibility: "hidden", WebkitBackfaceVisibility: "hidden" }}
            >
              <div className="mb-4 flex">
                <span className="px-2.5 py-1 bg-indigo-500/10 text-indigo-300 text-[10px] font-mono rounded-lg border border-indigo-500/20">{filteredCards[currentIndex].topic_name || "Untagged"}</span>
              </div>
              
              <div className="flex-1 flex items-center justify-center text-center">
                <h3 className="text-lg md:text-xl text-[#f4f4f5] leading-relaxed font-mono font-semibold">
                  {filteredCards[currentIndex].question}
                </h3>
              </div>
              
              <div className="pt-4 flex justify-center border-t border-[#27272a]">
                <span className="text-xs font-mono text-indigo-400 flex items-center gap-2">
                  Click card to reveal answer →
                </span>
              </div>
            </div>

            {/* Back Face */}
            <div 
              className="absolute inset-0 w-full h-full flex flex-col rounded-2xl border border-indigo-500/40 bg-[#121215] shadow-lg p-8 overflow-y-auto"
              style={{ backfaceVisibility: "hidden", WebkitBackfaceVisibility: "hidden", transform: "rotateY(180deg)" }}
            >
              <div className="mb-4 flex">
                <span className="px-2.5 py-1 bg-indigo-500/10 text-indigo-300 text-[10px] font-mono rounded-lg border border-indigo-500/20">{filteredCards[currentIndex].topic_name || "Untagged"}</span>
              </div>
              
              <div className="flex-1 flex flex-col items-center justify-center text-center">
                <p className="text-xs font-mono text-[#71717a] mb-2">{filteredCards[currentIndex].question}</p>
                <div className="text-sm font-mono text-[#f4f4f5] leading-relaxed">
                  {filteredCards[currentIndex].answer}
                </div>
              </div>
            </div>
          </div>

          {/* Rating buttons */}
          <div className={`mt-6 transition-all duration-300 ${isFlipped ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4 pointer-events-none'}`}>
            <p className="text-center text-[10px] font-mono text-[#71717a] uppercase tracking-wider mb-3">Rate Recall Difficulty</p>
            <div className="grid grid-cols-5 gap-2">
              {[
                { score: 1, label: "Again", color: "hover:bg-rose-500/20 hover:text-rose-300 hover:border-rose-500/40" },
                { score: 2, label: "Hard", color: "hover:bg-amber-500/20 hover:text-amber-300 hover:border-amber-500/40" },
                { score: 3, label: "Good", color: "hover:bg-indigo-500/20 hover:text-indigo-300 hover:border-indigo-500/40" },
                { score: 4, label: "Easy", color: "hover:bg-emerald-500/20 hover:text-emerald-300 hover:border-emerald-500/40" },
                { score: 5, label: "Perfect", color: "hover:bg-cyan-500/20 hover:text-cyan-300 hover:border-cyan-500/40" }
              ].map(b => (
                <button
                  key={b.score}
                  disabled={submitting}
                  onClick={(e) => { e.stopPropagation(); handleReview(b.score); }}
                  className={`flex flex-col items-center justify-center p-3 rounded-xl border border-[#3f3f46] bg-[#27272a] text-[#a1a1aa] transition-colors duration-150 ${b.color} disabled:opacity-50`}
                >
                  <span className="font-bold text-lg mb-1">{b.score}</span>
                  <span className="text-[10px] font-mono uppercase tracking-wider">{b.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Shell Definitions ────────────────────────────────────────────────────────

const NAV_ITEMS: { id: View; label: string; icon: React.ReactNode }[] = [
  { id: "dashboard", label: "Dashboard", icon: (
    <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
    </svg>
  )},
  { id: "documents", label: "My Documents", icon: Icon.folder },
  { id: "chat", label: "AI Teacher", icon: Icon.chat },
  { id: "quiz", label: "Practice Quizzes", icon: Icon.quiz },
  { id: "flashcards", label: "Flashcards", icon: (
    <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
    </svg>
  )},
  { id: "progress", label: "Progress Tracker", icon: Icon.chart },
  { id: "settings", label: "Settings", icon: Icon.settings },
];

const VIEW_TITLES: Record<View, string> = {
  dashboard: "Dashboard",
  documents: "My Documents",
  chat: "AI Teacher",
  quiz: "Practice Quizzes",
  flashcards: "Flashcards",
  progress: "Progress Tracker",
  settings: "Settings",
};

export default function App() {
  const [view, setView] = useState<View>("dashboard");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [quickPrompt, setQuickPrompt] = useState("");
  const [uploadTrigger, setUploadTrigger] = useState(0);
  const [docVersion, setDocVersion] = useState(0);
  const [demoSeeding, setDemoSeeding] = useState(false);
  const [demoMsg, setDemoMsg] = useState("");

  // Auth State
  const [user, setUser] = useState<ApiUser | null>(getStoredAuthUser());
  const [isGuest, setIsGuest] = useState<boolean>(() => localStorage.getItem("vidya_is_guest") === "true");
  const [profileDropdownOpen, setProfileDropdownOpen] = useState(false);

  // Theme State (Dark / Light)
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    const saved = (localStorage.getItem('vidya_theme') as 'dark' | 'light') || 'dark';
    if (saved === 'light') {
      document.documentElement.classList.add('light');
      document.documentElement.classList.remove('dark');
    } else {
      document.documentElement.classList.add('dark');
      document.documentElement.classList.remove('light');
    }
    return saved;
  });

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    localStorage.setItem('vidya_theme', next);
    if (next === 'light') {
      document.documentElement.classList.add('light');
      document.documentElement.classList.remove('dark');
    } else {
      document.documentElement.classList.add('dark');
      document.documentElement.classList.remove('light');
    }
  };

  useEffect(() => {
    getCurrentUser().then(u => {
      if (u) {
        setUser(u);
        setIsGuest(false);
      }
    });
  }, []);

  const handleSignOut = async () => {
    await logoutUser();
    setUser(null);
    setIsGuest(false);
    localStorage.removeItem("vidya_is_guest");
    setProfileDropdownOpen(false);
  };

  async function handleLoadDemo() {
    if (demoSeeding) return;
    setDemoSeeding(true);
    setDemoMsg("");
    try {
      const result = await seedDemoData();
      const s = result.stats;
      setDemoMsg(`✓ ${s.documentsCount} docs, ${s.chunksCount} chunks, ${s.quizzesCount} quizzes`);
      setTimeout(() => setDemoMsg(""), 6000);
      setView(v => v === "dashboard" ? "dashboard" : v);
    } catch (e: unknown) {
      setDemoMsg(e instanceof Error ? e.message : "Seed failed — check API keys in Settings");
      setTimeout(() => setDemoMsg(""), 6000);
    } finally {
      setDemoSeeding(false);
    }
  }

  if (!user && !isGuest) {
    return (
      <AuthPage
        onSuccess={(u, isDemo) => {
          setUser(u);
          if (isDemo) setIsGuest(true);
        }}
        onContinueAsGuest={() => {
          setIsGuest(true);
          localStorage.setItem("vidya_is_guest", "true");
        }}
      />
    );
  }

  return (
    <div className={`w-full h-screen flex bg-[#09090b] text-[#f4f4f5] overflow-hidden ${theme}`} style={{ fontFamily: "'Inter', system-ui, sans-serif" }}>
      {/* Sidebar */}
      <aside
        className={`flex flex-col border-r border-[#27272a] bg-[#121215] transition-all duration-300 shrink-0 ${sidebarOpen ? "w-60" : "w-16"}`}
      >
        {/* Logo */}
        <div className="flex items-center gap-3 px-4 py-5 border-b border-[#27272a]">
          <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center shrink-0">
            <svg width="16" height="16" viewBox="0 0 32 32" fill="none">
              <path d="M16 6L8 11l8 5 8-5-8-5z" fill="#fff" opacity="0.9"/>
              <path d="M8 16l8 5 8-5" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
              <path d="M8 20l8 5 8-5" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" opacity="0.5"/>
            </svg>
          </div>
          {sidebarOpen && (
            <div className="overflow-hidden">
              <span className="font-mono font-bold text-sm text-[#f4f4f5] tracking-tight whitespace-nowrap block">VidyaAI</span>
              <span className="block text-[10px] font-mono text-slate-400 uppercase tracking-widest whitespace-nowrap">Study Studio</span>
            </div>
          )}
        </div>

        {/* Nav */}
        <nav className="flex-1 px-2.5 py-4 space-y-1">
          {NAV_ITEMS.map(item => {
            const active = view === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setView(item.id)}
                title={!sidebarOpen ? item.label : undefined}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all duration-150 text-left relative group
                  ${active 
                    ? "bg-slate-800 border-l-2 border-blue-500 text-white font-semibold" 
                    : "text-[#71717a] hover:bg-[#1a1a1e] hover:text-[#d4d4d8] border-l-2 border-transparent"}
                  ${!sidebarOpen ? "justify-center px-0" : ""}`}
              >
                <span className={`shrink-0 transition-colors ${active ? "text-blue-400" : "group-hover:text-[#f4f4f5]"}`}>{item.icon}</span>
                {sidebarOpen && <span className="font-mono text-xs truncate tracking-wide">{item.label}</span>}
                {active && sidebarOpen && <span className="ml-auto w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0" />}
              </button>
            );
          })}
        </nav>

        {/* LOAD DEMO button */}
        <div className="mx-2.5 mb-2">
          <button
            onClick={handleLoadDemo}
            disabled={demoSeeding}
            title={sidebarOpen ? undefined : "Load Demo Data"}
            className={`w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-xs font-mono transition-all duration-150 ${
              sidebarOpen ? "justify-start" : "justify-center"
            } ${
              demoSeeding
                ? "bg-indigo-500/10 text-indigo-400 cursor-not-allowed border border-indigo-500/20"
                : "bg-[#1a1a1e] border border-[#27272a] text-[#a1a1aa] hover:text-indigo-300 hover:border-indigo-500/30 hover:bg-[#1a1a24]"
            }`}
          >
            {demoSeeding ? (
              <>
                <span className="w-3.5 h-3.5 rounded-full border-2 border-indigo-400 border-t-transparent animate-spin shrink-0" />
                {sidebarOpen && <span className="truncate">Seeding...</span>}
              </>
            ) : (
              <>
                <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" className="shrink-0 text-indigo-400">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                </svg>
                {sidebarOpen && <span className="truncate">Load Demo</span>}
              </>
            )}
          </button>
          {sidebarOpen && demoMsg && (
            <p className={`text-[10px] font-mono mt-1 px-1 leading-tight ${
              demoMsg.startsWith("✓") ? "text-emerald-400" : "text-rose-400"
            }`}>{demoMsg}</p>
          )}
        </div>

        {/* Toggle Sidebar */}
        <button
          onClick={() => setSidebarOpen(o => !o)}
          className="mx-2.5 mb-4 flex items-center justify-center py-2 rounded-xl text-[#71717a] hover:text-[#f4f4f5] hover:bg-[#1a1a1e] border border-transparent hover:border-[#27272a] transition-all duration-150"
        >
          <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            {sidebarOpen
              ? <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
              : <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />}
          </svg>
        </button>
      </aside>

      {/* Main Container */}
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden bg-[#09090b]">
        {/* Topbar */}
        <header className="flex items-center gap-4 px-6 py-4 border-b border-[#27272a] bg-[#121215] shrink-0 min-w-0 shadow-sm">
          <div className="flex items-center gap-3 truncate">
            <span className="font-mono text-[10px] text-indigo-400 uppercase tracking-widest px-2 py-0.5 rounded bg-indigo-500/10 border border-indigo-500/20">MODULE</span>
            <h1 className="font-mono font-semibold text-sm text-[#f4f4f5] truncate tracking-tight">{VIEW_TITLES[view]}</h1>
          </div>

          <div className="ml-auto flex items-center gap-2.5 shrink-0">
            <button
              onClick={() => { if (view === "documents") setUploadTrigger(c => c + 1); else { setView("documents"); setTimeout(() => setUploadTrigger(c => c + 1), 150); } }}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-[#27272a] bg-[#1a1a1e] text-xs font-mono text-[#d4d4d8] hover:text-white hover:border-indigo-500/40 hover:bg-[#1a1a24] transition-all duration-150 cursor-pointer shadow-sm"
              title="Upload document"
            >
              {Icon.upload} Upload
            </button>
            <button
              onClick={() => { setQuickPrompt(""); setView("chat"); }}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-[#27272a] bg-[#1a1a1e] text-xs font-mono text-[#d4d4d8] hover:text-white hover:border-indigo-500/40 hover:bg-[#1a1a24] transition-all duration-150 cursor-pointer shadow-sm"
              title="Start new chat"
            >
              {Icon.chat} New Chat
            </button>
            <button
              onClick={() => setView("quiz")}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-indigo-500/30 bg-indigo-600/10 text-xs font-mono text-indigo-300 hover:bg-indigo-600/20 hover:border-indigo-500/50 transition-all duration-150 cursor-pointer shadow-sm"
              title="Generate quiz"
            >
              {Icon.quiz} Generate Quiz
            </button>

            {/* Dark / Light Theme Toggle Button */}
            <button
              onClick={toggleTheme}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-[#27272a] bg-[#1a1a1e] text-xs font-mono text-[#d4d4d8] hover:text-white transition-all cursor-pointer shadow-sm"
              title="Toggle Dark / Light Mode"
            >
              {theme === 'dark' ? '☀️ Light' : '🌙 Dark'}
            </button>
            
            {/* User Profile Menu */}
            <div className="relative ml-1">
              <button
                onClick={() => setProfileDropdownOpen(o => !o)}
                className="flex items-center gap-2 p-1.5 rounded-xl border border-[#27272a] bg-[#1a1a1e] hover:border-indigo-500/40 transition-all cursor-pointer shadow-sm"
                title="User Profile Menu"
              >
                <div className="w-7 h-7 rounded-lg bg-indigo-600/30 border border-indigo-500/40 flex items-center justify-center text-indigo-300 font-mono font-bold text-xs">
                  {user ? user.fullName.charAt(0).toUpperCase() : "G"}
                </div>
                <span className="font-mono text-xs text-[#f4f4f5] max-w-[100px] truncate hidden sm:inline-block">
                  {user ? user.fullName.split(" ")[0] : "Guest"}
                </span>
                <span className="text-[#71717a] text-[10px] pr-1">▼</span>
              </button>

              {profileDropdownOpen && (
                <div className="absolute right-0 top-full mt-2 w-60 bg-[#18181b] border border-[#27272a] rounded-xl shadow-2xl p-3 z-50 animate-in fade-in">
                  <div className="px-2 py-1.5 border-b border-[#27272a] mb-2">
                    <p className="font-mono text-xs font-bold text-white truncate">{user ? user.fullName : "Guest Explorer"}</p>
                    <p className="font-mono text-[10px] text-[#71717a] truncate">{user ? user.email : "guest@vidyaai.app"}</p>
                    <span className={`inline-block text-[9px] font-mono px-2 py-0.5 rounded-full mt-2 ${isGuest ? "bg-amber-500/15 text-amber-400 border border-amber-500/30" : "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"}`}>
                      {isGuest ? "⚡ Demo Mode" : "● Supabase Auth"}
                    </span>
                  </div>

                  <button
                    onClick={handleSignOut}
                    className="w-full text-left px-2.5 py-2 rounded-lg text-xs font-mono text-rose-400 hover:bg-rose-500/10 transition-colors flex items-center gap-2"
                  >
                    <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15M12 9l3 3m0 0l-3 3m3-3H2.25" /></svg>
                    Sign Out / Auth Page
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        {/* View Content Canvas */}
        <main className="flex-1 overflow-y-auto bg-[#09090b]">
          {view === "dashboard" && <DashboardView navigate={setView} quickPrompt={quickPrompt} setQuickPrompt={setQuickPrompt} />}
          {view === "documents" && <DocumentsView uploadTrigger={uploadTrigger} onUploadComplete={() => setDocVersion(v => v + 1)} />}
          {view === "chat" && <ChatView key={view === "chat" ? "chat" : "idle"} quickPrompt={quickPrompt} clearQuickPrompt={() => setQuickPrompt("")} docVersion={docVersion} />}
          {view === "quiz" && <QuizView docVersion={docVersion} />}
          {view === "flashcards" && <FlashcardsView navigate={setView} />}
          {view === "progress" && <ProgressView />}
          {view === "settings" && <SettingsView onClearData={() => setView("dashboard")} />}
        </main>
      </div>
    </div>
  );
}
