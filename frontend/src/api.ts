const API_BASE = '/api';

export interface ApiDocument {
  id: string;
  title: string;
  topic: string | null;
  topic_id: string | null;
  status: string;
  chunk_count?: number;
  storage_path: string | null;
  user_id: string | null;
  created_at: string;
}

export interface ApiTopic {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
}

export interface ApiSearchResult {
  id: string;
  content: string;
  document_id: string;
  topic_id: string | null;
  similarity: number;
}

export interface ApiQuiz {
  id: string;
  title: string;
  document_id: string;
  topic_id: string | null;
  created_at: string;
  questions?: ApiQuizQuestion[];
}

export interface ApiQuizQuestion {
  id: string;
  quiz_id: string;
  question: string;
  options: string[];
  correct_answer: string;
  explanation: string | null;
  type: string;
}

export interface ApiQuizAttempt {
  quiz_id: string;
  score: number;
  results: { questionId: string; isCorrect: boolean; explanation: string }[];
}

export interface ApiAttemptRow {
  id: string;
  quiz_id: string;
  user_id: string;
  score: number;
  answers: unknown;
  created_at: string;
  quizzes?: {
    title: string;
    topic_id: string | null;
    topics?: { name: string } | null;
  } | null;
}

export interface ApiProgress {
  id: string;
  user_id: string;
  topic_id: string;
  mastery_score: number;
  last_updated: string;
  topics?: { name: string };
}

export interface ApiFlashcard {
  id: string;
  question: string;
  answer: string;
  ease_factor: number;
  interval_days: number;
  repetitions: number;
  next_review: string;
  topic_name: string | null;
  document_id?: string;
  topic_id?: string;
}

const DEMO_USER_ID = '00000000-0000-0000-0000-000000000001';

export function getDemoUserId(): string {
  return DEMO_USER_ID;
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, options);
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || `Request failed: ${res.status}`);
  }
  return res.json();
}

// Documents
export async function fetchDocuments(): Promise<ApiDocument[]> {
  return request<ApiDocument[]>('/documents');
}

export async function deleteDocument(id: string): Promise<{ success: boolean }> {
  return request<{ success: boolean }>(`/documents/${id}`, { method: 'DELETE' });
}

export async function uploadDocument(file: File, topicId?: string): Promise<{ success: boolean; chunksCount: number }> {
  const formData = new FormData();
  formData.append('file', file);
  if (topicId) formData.append('topicId', topicId);

  const res = await fetch(`${API_BASE}/ingest`, { method: 'POST', body: formData });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || `Upload failed: ${res.status}`);
  }
  return res.json();
}

// Topics
export async function fetchTopics(): Promise<ApiTopic[]> {
  return request<ApiTopic[]>('/topics');
}

export async function createTopic(name: string, description?: string): Promise<ApiTopic> {
  return request<ApiTopic>('/topics', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, description }),
  });
}

// Search (RAG)
export async function searchChunks(query: string, documentId?: string): Promise<{ chunks: ApiSearchResult[] }> {
  return request<{ chunks: ApiSearchResult[] }>('/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, documentId }),
  });
}

// Chat (RAG with Groq)
export interface ApiChatResponse {
  answer: string;
  citations: { snippet: string; similarity: number }[];
}

export async function chatWithAI(query: string, documentId?: string): Promise<ApiChatResponse> {
  return request<ApiChatResponse>('/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, documentId }),
  });
}

// Voice
export async function transcribeAudio(audioBlob: Blob): Promise<{ text: string }> {
  const formData = new FormData();
  formData.append('audio', audioBlob, 'recording.webm');
  const res = await fetch(`${API_BASE}/stt`, { method: 'POST', body: formData });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || `Transcription failed: ${res.status}`);
  }
  return res.json();
}

export async function generateSpeech(text: string): Promise<Blob> {
  const res = await fetch(`${API_BASE}/tts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || `TTS failed: ${res.status}`);
  }
  return res.blob();
}

// Quizzes
export async function fetchQuizzes(): Promise<ApiQuiz[]> {
  return request<ApiQuiz[]>('/quizzes');
}

export async function createQuiz(documentId: string, title: string, questions: { question: string; options: string[]; correct_answer: string; explanation: string }[], topicId?: string): Promise<{ id: string; title: string }> {
  return request<{ id: string; title: string }>('/quizzes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ documentId, topicId, title, questions }),
  });
}

export async function fetchQuiz(id: string): Promise<ApiQuiz> {
  return request<ApiQuiz>(`/quizzes/${id}`);
}

// Auto-generate quiz with Groq
export async function generateQuiz(documentId: string, title?: string, questionCount?: number, topicId?: string): Promise<ApiQuiz> {
  return request<ApiQuiz>('/quizzes/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ documentId, topicId, title: title || 'AI-Generated Quiz', questionCount: questionCount || 4 }),
  });
}

export async function submitQuiz(quizId: string, answers: { questionId: string; answer: string }[]): Promise<ApiQuizAttempt> {
  return request<ApiQuizAttempt>('/quiz/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ quizId, userId: DEMO_USER_ID, answers }),
  });
}

// Progress
export async function fetchProgress(): Promise<ApiProgress[]> {
  return request<ApiProgress[]>(`/progress/${DEMO_USER_ID}`);
}

// Attempts
export async function fetchAttempts(): Promise<ApiAttemptRow[]> {
  return request<ApiAttemptRow[]>(`/attempts/${DEMO_USER_ID}`);
}

// Flashcards
export async function fetchDueFlashcards(): Promise<ApiFlashcard[]> {
  return request<ApiFlashcard[]>(`/flashcards/due?userId=${DEMO_USER_ID}`);
}

export async function reviewFlashcard(cardId: string, quality: number): Promise<{ nextReviewDate: string; card: ApiFlashcard }> {
  return request<{ nextReviewDate: string; card: ApiFlashcard }>('/flashcards/review', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cardId, userId: DEMO_USER_ID, quality }),
  });
}

// Auto-generate flashcards with Groq
export async function generateFlashcards(documentId: string, count?: number, topicId?: string): Promise<{ flashcards: ApiFlashcard[]; count: number }> {
  return request<{ flashcards: ApiFlashcard[]; count: number }>('/flashcards/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ documentId, topicId, count: count || 6, userId: DEMO_USER_ID }),
  });
}

// Settings
export interface ApiSettings {
  apiKey: string;
  groqApiKey: string;
  groqKeySet: boolean;
  groqKeyMasked: string;
  groqModel: string;
  googleApiKey: string;
  googleKeySet: boolean;
  googleKeyMasked: string;
  embeddingsModel: string;
  chunkSize: number;
  chunkOverlap: number;
  supabaseUrl: string;
  supabaseConnected: boolean;
}

export async function fetchSettings(): Promise<ApiSettings> {
  return request<ApiSettings>('/settings');
}

export async function updateSettings(settings: Partial<ApiSettings>): Promise<{ success: boolean }> {
  return request<{ success: boolean }>('/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  });
}

// Demo
export interface DemoSeedStats {
  topicsCount: number;
  documentsCount: number;
  chunksCount: number;
  quizzesCount: number;
  flashcardsCount: number;
}

export async function seedDemoData(): Promise<{ success: boolean; stats: DemoSeedStats }> {
  return request<{ success: boolean; stats: DemoSeedStats }>('/demo/seed', { method: 'POST' });
}

export async function clearDemoData(): Promise<{ success: boolean }> {
  return request<{ success: boolean }>('/demo/clear', { method: 'POST' });
}
