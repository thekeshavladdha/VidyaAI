const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
const multer = require('multer');
const { OpenAI } = require('openai');
const googleTTS = require('google-tts-api');
const fs = require('fs').promises;
const path = require('path');
const pdf = require('pdf-parse');
const PDFDocument = require('pdfkit');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

const upload = multer({ dest: 'uploads/' });

app.use(cors());
app.use(express.json());

// ─── Clients ──────────────────────────────────────────────────────────────────

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

let groq = null;

function getGroqClient() {
  const key = getSettings().groqApiKey || process.env.GROQ_API_KEY;
  if (!key) return null;
  if (groq && groq.apiKey === key) return groq;
  groq = new OpenAI({ apiKey: key, baseURL: 'https://api.groq.com/openai/v1' });
  return groq;
}

// ─── Settings helpers ─────────────────────────────────────────────────────────

const SETTINGS_FILE = path.join(__dirname, 'settings.json');

async function loadSettings() {
  try {
    return JSON.parse(await fs.readFile(SETTINGS_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function getSettings() {
  return _cachedSettings || {};
}

let _cachedSettings = null;
async function refreshSettings() {
  _cachedSettings = await loadSettings();
}
refreshSettings();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sanitizeForPostgres(text) {
  // Postgres text columns reject \u0000 (22P05). Strip null bytes and lone surrogates.
  return text.replace(/\u0000/g, '').replace(/[\uD800-\uDFFF]/g, '');
}

async function extractText(filePath) {
  const buffer = await fs.readFile(filePath);
  const lower = filePath.toLowerCase();
  // Handle plain text fallback (frontend allows .txt/.md)
  if (lower.endsWith('.txt') || lower.endsWith('.md')) {
    return sanitizeForPostgres(buffer.toString('utf8'));
  }
  try {
    const pdfResult = await pdf(buffer);
    return sanitizeForPostgres(pdfResult.text || '');
  } catch (e) {
    // If pdf-parse fails (e.g. txt file uploaded as pdf), fall back to raw text
    console.warn('pdf-parse failed, falling back to raw text:', e.message);
    return sanitizeForPostgres(buffer.toString('utf8'));
  }
}

const EMBEDDING_MODEL = 'gemini-embedding-001';
const EMBEDDING_DIMS = 768;

async function googleEmbed(text) {
  const apiKey = getSettings().googleApiKey || process.env.GOOGLE_API_KEY;
  if (!apiKey) return null;
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${EMBEDDING_MODEL}:embedContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: `models/${EMBEDDING_MODEL}`,
        content: { parts: [{ text }] },
        taskType: 'RETRIEVAL_DOCUMENT',
        outputDimensionality: EMBEDDING_DIMS,
      }),
    }
  );
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Google embedding failed (${res.status}): ${err}`);
  }
  const data = await res.json();
  let values = data.embedding.values;
  // Fallback: if API ignores outputDimensionality and returns 3072, truncate/pad to 768
  if (values.length !== EMBEDDING_DIMS) {
    console.warn(`Embedding dim mismatch: got ${values.length}, expected ${EMBEDDING_DIMS} — truncating`);
    if (values.length > EMBEDDING_DIMS) values = values.slice(0, EMBEDDING_DIMS);
    else while (values.length < EMBEDDING_DIMS) values.push(0);
  }
  return values;
}

function placeholderEmbedding(seedText) {
  const vec = new Array(EMBEDDING_DIMS);
  let h = 2166136261;
  for (let i = 0; i < seedText.length; i++) {
    h ^= seedText.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  for (let i = 0; i < EMBEDDING_DIMS; i++) {
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    vec[i] = ((h >>> 0) / 4294967295) * 2 - 1;
  }
  return vec;
}

async function generateEmbeddings(textChunks) {
  const hasKey = !!(getSettings().googleApiKey || process.env.GOOGLE_API_KEY);
  if (!hasKey) {
    console.warn('GOOGLE_API_KEY not set — using placeholder embeddings.');
    return textChunks.map(placeholderEmbedding);
  }
  const embeddings = [];
  for (const chunk of textChunks) {
    embeddings.push(await googleEmbed(chunk));
  }
  return embeddings;
}

async function embedQuery(text) {
  const hasKey = !!(getSettings().googleApiKey || process.env.GOOGLE_API_KEY);
  if (!hasKey) return placeholderEmbedding(text);
  return googleEmbed(text);
}

function chunkText(text, chunkSize = 700, overlapPct = 15) {
  const chunks = [];
  const overlap = Math.floor(chunkSize * (overlapPct / 100));
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + chunkSize, text.length);
    chunks.push(text.slice(start, end));
    if (end >= text.length) break;
    start = end - overlap;
    if (start <= chunks[chunks.length - 1].length) start = end;
  }
  return chunks;
}

function autoChunkParams(textLen, baseSize = 700, baseOverlap = 15) {
  // Adaptive chunking: keep ~60-120 chunks per document for good recall/latency.
  // Short docs need smaller chunks to preserve context; long docs need larger chunks to limit vector count.
  if (textLen < 3000) return { chunkSize: Math.min(500, Math.max(300, baseSize - 200)), chunkOverlap: 10 };
  if (textLen < 12000) return { chunkSize: baseSize, chunkOverlap: baseOverlap };
  if (textLen < 40000) return { chunkSize: Math.max(baseSize, 900), chunkOverlap: Math.max(baseOverlap, 15) };
  if (textLen < 100000) return { chunkSize: 1100, chunkOverlap: 18 };
  return { chunkSize: 1300, chunkOverlap: 20 };
}

async function callGroq(systemPrompt, userPrompt) {
  const client = getGroqClient();
  if (!client) throw new Error('GROQ_API_KEY not configured. Add it in Settings.');
  const settings = getSettings();
  const model = settings.groqModel || process.env.GROQ_MODEL || 'openai/gpt-oss-120b';
  const response = await client.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0.3,
    max_tokens: 2048,
  });
  return response.choices[0].message.content;
}

// ─── Routes ───────────────────────────────────────────────────────────────────

// ── Auth Endpoints ──

// POST /api/auth/register
app.post('/api/auth/register', async (req, res) => {
  const { email, password, fullName } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  try {
    if (process.env.SUPABASE_URL && process.env.SUPABASE_KEY && process.env.SUPABASE_URL !== 'https://your-project.supabase.co') {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { full_name: fullName || email.split('@')[0] } },
      });
      if (error) throw error;
      const user = data.user ? {
        id: data.user.id,
        email: data.user.email,
        fullName: data.user.user_metadata?.full_name || fullName || email.split('@')[0],
      } : null;
      return res.json({ user, token: data.session?.access_token || 'demo_token' });
    }

    // Demo Mode Auth fallback
    const user = {
      id: 'usr_' + Date.now(),
      email,
      fullName: fullName || email.split('@')[0],
    };
    return res.json({ user, token: 'demo_token_' + Date.now(), isDemo: true });
  } catch (err) {
    console.error('Registration error:', err);
    return res.status(400).json({ error: err.message || 'Registration failed' });
  }
});

// POST /api/auth/login
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  try {
    if (process.env.SUPABASE_URL && process.env.SUPABASE_KEY && process.env.SUPABASE_URL !== 'https://your-project.supabase.co') {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (error) throw error;
      const user = data.user ? {
        id: data.user.id,
        email: data.user.email,
        fullName: data.user.user_metadata?.full_name || email.split('@')[0],
      } : null;
      return res.json({ user, token: data.session?.access_token });
    }

    // Demo Mode Auth fallback
    const user = {
      id: 'usr_' + Date.now(),
      email,
      fullName: email.split('@')[0],
    };
    return res.json({ user, token: 'demo_token_' + Date.now(), isDemo: true });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(401).json({ error: err.message || 'Invalid email or password' });
  }
});

// GET /api/auth/me
app.get('/api/auth/me', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const token = authHeader.split(' ')[1];

  try {
    if (process.env.SUPABASE_URL && process.env.SUPABASE_KEY && process.env.SUPABASE_URL !== 'https://your-project.supabase.co') {
      const { data: { user }, error } = await supabase.auth.getUser(token);
      if (error || !user) throw new Error('Invalid session');
      return res.json({
        user: {
          id: user.id,
          email: user.email,
          fullName: user.user_metadata?.full_name || user.email.split('@')[0],
        }
      });
    }

    return res.json({
      user: { id: 'demo_user', email: 'guest@vidyaai.app', fullName: 'Guest Explorer' }
    });
  } catch (err) {
    return res.status(401).json({ error: 'Session expired' });
  }
});

// POST /api/auth/logout
app.post('/api/auth/logout', async (req, res) => {
  try {
    if (process.env.SUPABASE_URL && process.env.SUPABASE_KEY) {
      await supabase.auth.signOut().catch(() => {});
    }
  } catch (_) {}
  return res.json({ message: 'Signed out successfully' });
});

// POST /api/ingest
app.post('/api/ingest', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  try {
    const { documentId, topicId } = req.body;
    const settings = getSettings();
    const chunkSize = settings.chunkSize || 700;
    const chunkOverlap = settings.chunkOverlap || 15;

    let resolvedTopicId = topicId || null;
    if (!resolvedTopicId) {
      let { data: defaultTopic } = await supabase
        .from('topics')
        .select('id')
        .eq('name', 'General')
        .single();
      if (!defaultTopic) {
        const { data: created } = await supabase
          .from('topics')
          .insert([{ name: 'General' }])
          .select()
          .single();
        defaultTopic = created;
      }
      if (defaultTopic) resolvedTopicId = defaultTopic.id;
    }

    let docId = documentId;
    if (!docId) {
      let topicName = 'General';
      if (resolvedTopicId) {
        const { data: t } = await supabase.from('topics').select('name').eq('id', resolvedTopicId).single();
        if (t) topicName = t.name;
      }
      const { data: doc, error: docErr } = await supabase
        .from('documents')
        .insert({
          title: req.file.originalname || 'Untitled',
          topic: topicName,
          topic_id: resolvedTopicId,
          status: 'processed',
        })
        .select()
        .single();
      if (docErr) throw docErr;
      docId = doc.id;
    }

    const rawText = await extractText(req.file.path);
    const text = sanitizeForPostgres(rawText);
    const adaptive = autoChunkParams(text.length, chunkSize, chunkOverlap);
    const chunks = chunkText(text, adaptive.chunkSize, adaptive.chunkOverlap).map(c => sanitizeForPostgres(c));
    console.log(`Ingest: ${text.length} chars -> chunkSize=${adaptive.chunkSize} overlap=${adaptive.chunkOverlap}% -> ${chunks.length} chunks`);
    const embeddings = await generateEmbeddings(chunks);

    const sanitizedTitle = sanitizeForPostgres(req.file.originalname || 'Untitled');
    // Update title if it contained null bytes (rare)
    if (sanitizedTitle !== req.file.originalname) {
      await supabase.from('documents').update({ title: sanitizedTitle }).eq('id', docId);
    }

    const { error } = await supabase.from('chunks').insert(
      chunks.map((chunk, i) => ({
        content: chunk,
        embedding: embeddings[i],
        document_id: docId,
        topic_id: resolvedTopicId,
      }))
    );
    if (error) throw error;

    await fs.unlink(req.file.path);
    res.json({ success: true, documentId: docId, chunksCount: chunks.length });
  } catch (err) {
    console.error('Ingestion error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/documents
app.get('/api/documents', async (req, res) => {
  try {
    const { data, error } = await supabase.from('documents').select('*');
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/documents/:id — cascades to chunks, flashcards, quizzes
app.delete('/api/documents/:id', async (req, res) => {
  const { id } = req.params;
  try {
    // Explicit deletes for tables without ON DELETE CASCADE
    await supabase.from('flashcards').delete().eq('document_id', id);
    await supabase.from('chunks').delete().eq('document_id', id);
    // quizzes -> quiz_questions cascades via FK, but delete quizzes explicitly
    const { data: qs } = await supabase.from('quizzes').select('id').eq('document_id', id);
    if (qs && qs.length) {
      const qIds = qs.map(q => q.id);
      await supabase.from('quiz_questions').delete().in('quiz_id', qIds);
      await supabase.from('quiz_attempts').delete().in('quiz_id', qIds);
      await supabase.from('quizzes').delete().eq('document_id', id);
    }
    const { error: docError } = await supabase.from('documents').delete().eq('id', id);
    if (docError) throw docError;
    res.json({ success: true });
  } catch (err) {
    console.error('Delete error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/topics
app.get('/api/topics', async (req, res) => {
  try {
    const { data, error } = await supabase.from('topics').select('*').order('name');
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/topics
app.post('/api/topics', async (req, res) => {
  const { name, description } = req.body;
  if (!name) return res.status(400).json({ error: 'Name is required' });
  try {
    const { data, error } = await supabase.from('topics').insert([{ name, description }]).select();
    if (error) throw error;
    res.status(201).json(data[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/search
app.post('/api/search', async (req, res) => {
  const { query, documentId } = req.body;
  if (!query) return res.status(400).json({ error: 'Query is required' });

  try {
    const queryEmbedding = await embedQuery(query);
    const { data: chunks, error } = await supabase.rpc('match_chunks', {
      query_embedding: queryEmbedding,
      match_threshold: 0.5,
      match_count: 5,
      filter_document_id: documentId,
    });
    if (error) throw error;
    res.json({ chunks });
  } catch (err) {
    console.error('Search error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/chat: RAG chat with Groq ──────────────────────────────────────

app.post('/api/chat', async (req, res) => {
  const { query, documentId } = req.body;
  if (!query) return res.status(400).json({ error: 'Query is required' });

  try {
    let chunks = [];
    let searchError = null;

    try {
      const queryEmbedding = await embedQuery(query);
      // Lower match threshold to 0.0 so top relevant chunks are retrieved reliably
      const threshold = 0.0;
      const result = await supabase.rpc('match_chunks', {
        query_embedding: queryEmbedding,
        match_threshold: threshold,
        match_count: 5,
        filter_document_id: documentId || null,
      });
      if (result.error) searchError = result.error;
      else chunks = result.data || [];
    } catch (e) {
      searchError = e;
    }

    if (searchError) {
      console.warn('Vector search failed (schema may need migration):', searchError.message);
    }

    // If still no chunks, grab the first few chunks from the DB as fallback
    if (!chunks || chunks.length === 0) {
      let queryBuilder = supabase.from('chunks').select('content').limit(3);
      if (documentId) queryBuilder = queryBuilder.eq('document_id', documentId);
      const { data: fallbackChunks } = await queryBuilder;
      if (fallbackChunks && fallbackChunks.length > 0) {
        chunks = fallbackChunks.map(c => ({ content: c.content, similarity: 1.0 }));
      }
    }

    if (!chunks || chunks.length === 0) {
      const systemPrompt = `You are VidyaAI, a helpful CS study teacher. Answer the student's question clearly and concisely. Use standard markdown formatting. When presenting structured data, comparisons, or components, ALWAYS format them using proper GFM markdown tables (| Col 1 | Col 2 |\n| --- | --- |). If you're unsure, say so.`;
      const userPrompt = query;
      const answer = await callGroq(systemPrompt, userPrompt);
      return res.json({ answer, citations: [] });
    }

    const context = chunks
      .map((c, i) => `[Source ${i + 1}]\n${c.content}`)
      .join('\n\n---\n\n');

    const systemPrompt = `You are VidyaAI, a helpful CS study teacher. Answer the student's question using ONLY the provided course material context. Be clear, concise, and educational. When presenting structured data, complexity comparisons, or components, ALWAYS format them using proper GFM markdown tables (| Col 1 | Col 2 |\n| --- | --- |). If the context doesn't fully answer the question, say so honestly. Use markdown formatting for clarity.`;

    const userPrompt = `Course Material Context:\n\n${context}\n\n---\n\nStudent Question: ${query}`;

    const answer = await callGroq(systemPrompt, userPrompt);

    // Return the source citations used to generate the answer
    const citations = chunks
      .slice(0, 3)
      .map((c) => ({
        snippet: c.content.slice(0, 250) + (c.content.length > 250 ? '...' : ''),
        similarity: c.similarity,
      }));

    res.json({ answer, citations });
  } catch (err) {
    console.error('Chat error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/stt: Speech to Text (Whisper) ─────────────────────────────────

app.post('/api/stt', upload.single('audio'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No audio file uploaded' });
  try {
    const client = getGroqClient();
    if (!client) throw new Error('GROQ_API_KEY not configured.');

    const fsSync = require('fs');
    
    // Whisper requires the file to have a valid audio extension so it knows the format.
    // Multer saves files without extensions, so we temporarily rename it.
    const tempFilePath = req.file.path + '.webm';
    fsSync.renameSync(req.file.path, tempFilePath);

    const fileStream = fsSync.createReadStream(tempFilePath);
    
    const transcription = await client.audio.transcriptions.create({
      file: fileStream,
      model: 'whisper-large-v3',
    });

    await fs.unlink(tempFilePath).catch(() => {});
    res.json({ text: transcription.text });
  } catch (err) {
    console.error('STT error:', err);
    if (req.file) {
      await fs.unlink(req.file.path).catch(() => {});
      await fs.unlink(req.file.path + '.webm').catch(() => {});
    }
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/tts: Text to Speech (google-tts-api) ──────────────────────────

app.post('/api/tts', async (req, res) => {
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: 'Text is required' });

  try {
    // google-tts-api splits text > 200 chars into multiple audio chunks
    const urls = googleTTS.getAllAudioUrls(text, {
      lang: 'en',
      slow: false,
      host: 'https://translate.google.com',
    });

    // Download and concatenate all MP3 chunks
    const buffers = [];
    for (const item of urls) {
      const response = await fetch(item.url);
      const arrayBuffer = await response.arrayBuffer();
      buffers.push(Buffer.from(arrayBuffer));
    }
    
    const finalBuffer = Buffer.concat(buffers);
    res.set({
      'Content-Type': 'audio/mpeg',
      'Content-Length': finalBuffer.length,
    });
    res.send(finalBuffer);
  } catch (err) {
    console.error('TTS error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/quizzes: Create quiz (manual) ─────────────────────────────────

app.post('/api/quizzes', async (req, res) => {
  const { documentId, topicId, title, questions } = req.body;
  if (!documentId || !title || !questions || !Array.isArray(questions)) {
    return res.status(400).json({ error: 'Missing required fields: documentId, title, or questions (array)' });
  }

  try {
    const { data: quiz, error: qErr } = await supabase
      .from('quizzes')
      .insert([{ document_id: documentId, topic_id: topicId, title }])
      .select()
      .single();
    if (qErr) throw qErr;

    const questionData = questions.map((q) => ({
      quiz_id: quiz.id,
      question: q.question,
      options: q.options,
      correct_answer: q.correct_answer,
      explanation: q.explanation,
      type: q.type || 'mcq',
    }));

    const { error: qQuestionsErr } = await supabase.from('quiz_questions').insert(questionData);
    if (qQuestionsErr) throw qQuestionsErr;

    res.status(201).json({ id: quiz.id, title: quiz.title });
  } catch (err) {
    console.error('Quiz creation error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/quizzes/generate: Auto-generate quiz with Groq ────────────────

app.post('/api/quizzes/generate', async (req, res) => {
  const { documentId, topicId, title, questionCount } = req.body;
  if (!documentId) return res.status(400).json({ error: 'documentId is required' });

  try {
    const { data: chunks, error: chunkErr } = await supabase
      .from('chunks')
      .select('content')
      .eq('document_id', documentId)
      .limit(20);
    if (chunkErr) throw chunkErr;
    if (!chunks || chunks.length === 0) {
      return res.status(400).json({ error: 'No chunks found for this document. Upload and process a document first.' });
    }

    const context = chunks.map((c) => c.content).join('\n\n---\n\n');
    const count = Math.min(questionCount || 4, 10);

    const systemPrompt = `You are an expert CS quiz generator. Create exactly ${count} multiple-choice quiz questions based on the provided course material. Each question must have exactly 4 options (A, B, C, D), one correct answer, and a brief explanation. Return ONLY valid JSON — no markdown, no code fences.`;

    const userPrompt = `Course Material:\n\n${context}\n\n---\n\nGenerate ${count} multiple-choice questions. Return a JSON array with this exact structure:\n[\n  {\n    "question": "...",\n    "options": ["A) ...", "B) ...", "C) ...", "D) ..."],\n    "correct_answer": "A) ...",\n    "explanation": "..."\n  }\n]`;

    const raw = await callGroq(systemPrompt, userPrompt);

    let questions;
    try {
      const jsonMatch = raw.match(/\[[\s\S]*\]/);
      questions = JSON.parse(jsonMatch ? jsonMatch[0] : raw);
    } catch {
      return res.status(500).json({ error: 'Failed to parse AI-generated quiz. Please try again.' });
    }

    const { data: quiz, error: qErr } = await supabase
      .from('quizzes')
      .insert([{ document_id: documentId, topic_id: topicId || null, title: title || 'AI-Generated Quiz' }])
      .select()
      .single();
    if (qErr) throw qErr;

    const questionData = questions.map((q) => ({
      quiz_id: quiz.id,
      question: q.question,
      options: q.options,
      correct_answer: q.correct_answer,
      explanation: q.explanation || '',
      type: 'mcq',
    }));

    const { error: insertErr } = await supabase.from('quiz_questions').insert(questionData);
    if (insertErr) throw insertErr;

    const { data: createdQuestions } = await supabase
      .from('quiz_questions')
      .select('*')
      .eq('quiz_id', quiz.id);

    res.status(201).json({ ...quiz, questions: createdQuestions });
  } catch (err) {
    console.error('Quiz generation error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/quizzes
app.get('/api/quizzes', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('quizzes')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/quizzes/:id
app.get('/api/quizzes/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const { data: quiz, error: qErr } = await supabase
      .from('quizzes')
      .select('*')
      .eq('id', id)
      .single();
    if (qErr) throw qErr;

    const { data: questions, error: quesErr } = await supabase
      .from('quiz_questions')
      .select('*')
      .eq('quiz_id', id);
    if (quesErr) throw quesErr;

    res.json({ ...quiz, questions });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/quiz/submit
app.post('/api/quiz/submit', async (req, res) => {
  const { quizId, userId, answers } = req.body;
  if (!quizId || !userId || !answers) return res.status(400).json({ error: 'Missing required fields' });

  try {
    const { data: quiz, error: qErr } = await supabase.from('quizzes').select('*').eq('id', quizId).single();
    if (qErr) throw qErr;

    const { data: questions, error: quesErr } = await supabase.from('quiz_questions').select('*').eq('quiz_id', quizId);
    if (quesErr) throw quesErr;

    let correctCount = 0;
    const results = questions.map((q) => {
      const userAnswer = answers.find((a) => a.questionId === q.id)?.answer;
      const isCorrect = userAnswer === q.correct_answer;
      if (isCorrect) correctCount++;
      return { questionId: q.id, isCorrect, explanation: q.explanation };
    });

    const score = (correctCount / questions.length) * 100;

    const { error: attErr } = await supabase.from('quiz_attempts').insert({
      quiz_id: quizId,
      user_id: userId,
      score,
      answers: JSON.stringify(answers),
    });
    if (attErr) throw attErr;

    if (quiz.topic_id) {
      await supabase.rpc('update_topic_mastery', {
        p_user_id: userId,
        p_topic_id: quiz.topic_id,
      });
    }

    res.json({ score, results });
  } catch (err) {
    console.error('Quiz submission error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/attempts/:userId
app.get('/api/attempts/:userId', async (req, res) => {
  const { userId } = req.params;
  try {
    const { data, error } = await supabase
      .from('quiz_attempts')
      .select('*, quizzes(title, topic_id, topics(name))')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(10);
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/progress/:userId
app.get('/api/progress/:userId', async (req, res) => {
  const { userId } = req.params;
  try {
    const { data, error } = await supabase
      .from('progress')
      .select('*, topics(name)')
      .eq('user_id', userId);
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/flashcards/due
app.get('/api/flashcards/due', async (req, res) => {
  const { userId } = req.query;
  if (!userId) return res.status(400).json({ error: 'userId query parameter is required' });

  try {
    const { data, error } = await supabase.rpc('get_due_flashcards', {
      p_user_id: userId,
      p_limit: 50,
    });
    if (error) throw error;
    
    if (data && data.length > 0) {
      const cardIds = data.map(c => c.id);
      const { data: rawCards } = await supabase.from('flashcards').select('id, document_id, topic_id').in('id', cardIds);
      if (rawCards) {
        data.forEach(c => {
          const raw = rawCards.find(r => r.id === c.id);
          if (raw) {
            c.document_id = raw.document_id;
            c.topic_id = raw.topic_id;
          }
        });
      }
    }
    
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/flashcards/review
app.post('/api/flashcards/review', async (req, res) => {
  const { cardId, userId, quality } = req.body;
  if (!cardId || !userId || quality === undefined) {
    return res.status(400).json({ error: 'Missing required fields: cardId, userId, quality (0-5)' });
  }

  try {
    const { error } = await supabase.rpc('sm2_update_flashcard', {
      p_flashcard_id: cardId,
      p_user_id: userId,
      p_quality: quality,
    });
    if (error) throw error;

    const { data: card, error: cardErr } = await supabase
      .from('flashcards')
      .select('id, ease_factor, interval_days, repetitions, next_review')
      .eq('id', cardId)
      .single();
    if (cardErr) throw cardErr;

    res.json({ nextReviewDate: card.next_review, card });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/flashcards/generate: Auto-generate flashcards with Groq ────────

app.post('/api/flashcards/generate', async (req, res) => {
  const { documentId, topicId, count } = req.body;
  const userId = req.body.userId || '00000000-0000-0000-0000-000000000001';
  if (!documentId) return res.status(400).json({ error: 'documentId is required' });

  try {
    const { data: chunks, error: chunkErr } = await supabase
      .from('chunks')
      .select('id, content, topic_id, document_id')
      .eq('document_id', documentId)
      .limit(15);
    if (chunkErr) throw chunkErr;
    if (!chunks || chunks.length === 0) {
      return res.status(400).json({ error: 'No chunks found for this document.' });
    }

    const context = chunks.map((c, i) => `[Chunk ${i + 1}]: ${c.content}`).join('\n\n---\n\n');
    const numCards = Math.min(count || 6, 15);

    const systemPrompt = `You are an expert CS study aid creator. Create exactly ${numCards} flashcard pairs (question + answer) from the provided course material. Each flashcard should test a specific concept or fact. Return ONLY valid JSON — no markdown, no code fences.`;

    const userPrompt = `Course Material:\n\n${context}\n\n---\n\nCreate ${numCards} flashcards. Return a JSON array with this exact structure:\n[\n  {\n    "question": "...",\n    "answer": "..."\n  }\n]`;

    const raw = await callGroq(systemPrompt, userPrompt);

    let cards;
    try {
      const jsonMatch = raw.match(/\[[\s\S]*\]/);
      cards = JSON.parse(jsonMatch ? jsonMatch[0] : raw);
    } catch {
      return res.status(500).json({ error: 'Failed to parse AI-generated flashcards. Please try again.' });
    }

    const targetChunk = chunks[0];
    const flashcardData = cards.map((card) => ({
      user_id: userId,
      topic_id: topicId || targetChunk.topic_id,
      document_id: documentId,
      chunk_id: targetChunk.id,
      question: card.question,
      answer: card.answer,
    }));

    const { data: inserted, error: insertErr } = await supabase
      .from('flashcards')
      .insert(flashcardData)
      .select('id, question, answer, ease_factor, interval_days, repetitions, next_review');
    if (insertErr) throw insertErr;

    res.status(201).json({ flashcards: inserted, count: inserted.length });
  } catch (err) {
    console.error('Flashcard generation error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Settings ─────────────────────────────────────────────────────────────────

const SETTINGS_FILE_PATH = path.join(__dirname, 'settings.json');

function maskKey(key) {
  if (!key || key.length < 10) return '';
  return key.slice(0, 4) + '••••••••' + key.slice(-4);
}

app.get('/api/settings', async (req, res) => {
  try {
    const fileSettings = await loadSettings();
    const groqKey = fileSettings.groqApiKey || process.env.GROQ_API_KEY || '';
    const googleKey = fileSettings.googleApiKey || process.env.GOOGLE_API_KEY || '';
    res.json({
      apiKey: fileSettings.apiKey || '',
      groqApiKey: groqKey,
      groqKeySet: !!groqKey,
      groqKeyMasked: maskKey(groqKey),
      groqModel: fileSettings.groqModel || process.env.GROQ_MODEL || 'openai/gpt-oss-120b',
      googleApiKey: googleKey,
      googleKeySet: !!googleKey,
      googleKeyMasked: maskKey(googleKey),
      embeddingsModel: EMBEDDING_MODEL,
      chunkSize: fileSettings.chunkSize || 700,
      chunkOverlap: fileSettings.chunkOverlap || 15,
      supabaseUrl: process.env.SUPABASE_URL || '',
      supabaseConnected: !!(process.env.SUPABASE_URL && process.env.SUPABASE_KEY),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/settings', async (req, res) => {
  try {
    const current = await loadSettings();
    const updated = { ...current, ...req.body };
    await fs.writeFile(SETTINGS_FILE_PATH, JSON.stringify(updated, null, 2));
    _cachedSettings = updated;

    if (updated.googleApiKey && updated.googleApiKey !== process.env.GOOGLE_API_KEY) {
      process.env.GOOGLE_API_KEY = updated.googleApiKey;
    }
    if (updated.groqApiKey && updated.groqApiKey !== process.env.GROQ_API_KEY) {
      process.env.GROQ_API_KEY = updated.groqApiKey;
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/demo/clear ─────────────────────────────────────────────────────

app.post('/api/demo/clear', async (req, res) => {
  try {
    const DEMO_USER = '00000000-0000-0000-0000-000000000001';

    // Delete in dependency order
    await supabase.from('flashcard_reviews').delete().eq('user_id', DEMO_USER);
    await supabase.from('flashcards').delete().eq('user_id', DEMO_USER);
    await supabase.from('quiz_attempts').delete().eq('user_id', DEMO_USER);
    await supabase.from('progress').delete().eq('user_id', DEMO_USER);

    // Get all demo quizzes (attached to demo docs)
    const { data: demoDocs } = await supabase.from('documents').select('id').eq('user_id', DEMO_USER);
    if (demoDocs && demoDocs.length > 0) {
      const demoDocIds = demoDocs.map(d => d.id);
      const { data: demoQuizzes } = await supabase.from('quizzes').select('id').in('document_id', demoDocIds);
      if (demoQuizzes && demoQuizzes.length > 0) {
        const demoQuizIds = demoQuizzes.map(q => q.id);
        await supabase.from('quiz_questions').delete().in('quiz_id', demoQuizIds);
        await supabase.from('quizzes').delete().in('id', demoQuizIds);
      }
      await supabase.from('chunks').delete().in('document_id', demoDocIds);
      await supabase.from('documents').delete().in('id', demoDocIds);
    }

    // Remove demo topics
    await supabase.from('topics').delete().like('description', '%[demo]%');

    // Clean up demo PDF files
    try {
      const demoDir = path.join(__dirname, 'uploads', 'demo_pdfs');
      const files = await fs.readdir(demoDir).catch(() => []);
      await Promise.all(files.map(f => fs.unlink(path.join(demoDir, f)).catch(() => {})));
    } catch { /* ignore */ }

    res.json({ success: true });
  } catch (err) {
    console.error('Demo clear error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/demo/seed ──────────────────────────────────────────────────────

const DEMO_USER = '00000000-0000-0000-0000-000000000001';

// Pre-crafted CS demo content (topic, title, body text for PDF, MCQs)
const DEMO_TOPICS = [
  {
    name: 'Data Structures',
    docs: [
      {
        title: 'Binary Search Trees & AVL Trees',
        body: `Binary Search Trees (BST)

A Binary Search Tree is a node-based binary tree data structure where:
- The left subtree of a node contains only nodes with keys less than the node's key.
- The right subtree of a node contains only nodes with keys greater than the node's key.
- Both left and right subtrees must also be BSTs.

Time Complexities:
- Search: O(log n) average, O(n) worst case (degenerate/skewed tree)
- Insert: O(log n) average, O(n) worst case
- Delete: O(log n) average, O(n) worst case

BST Deletion Cases:
1. Node has no children (leaf): Simply remove it.
2. Node has one child: Replace node with its child.
3. Node has two children: Replace with in-order successor (smallest in right subtree) or in-order predecessor (largest in left subtree), then delete that successor.

AVL Trees (Adelson-Velsky and Landis)

An AVL tree is a self-balancing BST where the height difference (balance factor) between left and right subtrees of any node is at most 1. Balance factor = height(left) - height(right).

Rotations for rebalancing:
1. Left Rotation (LL Case): Applied when a node is inserted into the right subtree of the right child.
2. Right Rotation (RR Case): Applied when a node is inserted into the left subtree of the left child.
3. Left-Right Rotation (LR Case): First left rotation on left child, then right rotation on current node.
4. Right-Left Rotation (RL Case): First right rotation on right child, then left rotation on current node.

AVL vs Red-Black Trees:
- AVL trees maintain stricter balance (|BF| <= 1) — faster lookups, more rotations on insert/delete.
- Red-Black trees allow longer paths (at most 2x shortest) — fewer rotations on insert/delete, preferred in libraries (Java TreeMap, C++ std::map).

Height of AVL Tree: O(log n) guaranteed.
All operations (search, insert, delete) are O(log n) worst-case in an AVL tree.`,
        quizzes: [
          {
            title: 'BST & AVL Trees Quiz',
            questions: [
              {
                question: 'Which traversal of a BST produces nodes in sorted (ascending) order?',
                options: ['A) Pre-order', 'B) In-order', 'C) Post-order', 'D) Level-order'],
                correct_answer: 'B) In-order',
                explanation: 'In-order traversal visits left → root → right, which follows the BST property to yield ascending order.',
              },
              {
                question: 'What is the balance factor of a node in an AVL tree?',
                options: ['A) height(right) - height(left)', 'B) height(left) + height(right)', 'C) height(left) - height(right)', 'D) depth(left) - depth(right)'],
                correct_answer: 'C) height(left) - height(right)',
                explanation: 'AVL balance factor = height(left subtree) - height(right subtree). Valid values are -1, 0, or +1.',
              },
              {
                question: 'When deleting a node with two children from a BST, what is the standard replacement?',
                options: ['A) Replace with root', 'B) Replace with in-order successor or predecessor', 'C) Replace with leftmost leaf', 'D) Restructure entire tree'],
                correct_answer: 'B) Replace with in-order successor or predecessor',
                explanation: 'Replace value with in-order successor (smallest in right subtree) or predecessor (largest in left subtree), then delete that node.',
              },
              {
                question: 'Which rotation handles the Left-Right (LR) imbalance case in an AVL tree?',
                options: ['A) Single left rotation', 'B) Single right rotation', 'C) Left rotation then right rotation', 'D) Right rotation then left rotation'],
                correct_answer: 'C) Left rotation then right rotation',
                explanation: 'LR case: first perform left rotation on the left child, then right rotation on the unbalanced node.',
              },
            ],
          },
        ],
      },
      {
        title: 'Heaps & Priority Queues',
        body: `Heaps and Priority Queues

A Heap is a complete binary tree satisfying the heap property:
- Max-Heap: Parent >= children. Root is the maximum element.
- Min-Heap: Parent <= children. Root is the minimum element.

Heaps are typically implemented using arrays:
- For node at index i: left child = 2i+1, right child = 2i+2, parent = (i-1)/2.

Key Operations:
- Insert: Add at end, then heapify-up (bubble up). O(log n).
- Extract-Max/Min: Remove root, replace with last element, heapify-down. O(log n).
- Peek: O(1) — root is always the max/min.
- Build-Heap: O(n) using Floyd's algorithm (heapify down from n/2 to 0).

Heap Sort:
1. Build a max-heap from the array. O(n).
2. Repeatedly extract the max (swap root with last, reduce heap size, heapify-down). O(n log n).
Total: O(n log n) time, O(1) extra space (in-place).

Priority Queue:
A priority queue is an abstract data type where each element has a priority. Elements are served in priority order, not FIFO. Usually implemented with a heap.
- enqueue(item, priority): Insert. O(log n).
- dequeue(): Remove highest priority. O(log n).
- peek(): O(1).

Applications: Dijkstra's shortest path, A* search, Huffman coding, OS task scheduling, event-driven simulation.

Binomial and Fibonacci Heaps:
- Binomial Heap: Merge in O(log n), useful for priority queue merging.
- Fibonacci Heap: Decrease-key in O(1) amortized, used for fast Dijkstra.`,
        quizzes: [
          {
            title: 'Heaps Quiz',
            questions: [
              {
                question: 'In a max-heap stored as an array, what is the index of the left child of node at index i?',
                options: ['A) 2i', 'B) 2i+1', 'C) 2i+2', 'D) (i-1)/2'],
                correct_answer: 'B) 2i+1',
                explanation: 'For 0-indexed arrays: left child = 2i+1, right child = 2i+2, parent = (i-1)/2.',
              },
              {
                question: 'What is the time complexity of building a heap from n unsorted elements?',
                options: ['A) O(n log n)', 'B) O(n)', 'C) O(log n)', 'D) O(n²)'],
                correct_answer: 'B) O(n)',
                explanation: "Floyd's build-heap algorithm runs in O(n) by calling heapify-down from n/2 down to 0. Most nodes are near leaves and need little work.",
              },
              {
                question: 'Which data structure best implements a priority queue for Dijkstra\'s shortest path algorithm?',
                options: ['A) Stack', 'B) Queue', 'C) Min-Heap', 'D) Max-Heap'],
                correct_answer: 'C) Min-Heap',
                explanation: 'Dijkstra always expands the unvisited vertex with minimum distance. A min-heap makes extract-min O(log n) vs O(n) for a naive array.',
              },
            ],
          },
        ],
      },
    ],
  },
  {
    name: 'Algorithms',
    docs: [
      {
        title: 'Dynamic Programming & Memoization',
        body: `Dynamic Programming (DP)

Dynamic Programming is an algorithmic technique for solving optimization problems by breaking them into overlapping subproblems and storing results to avoid redundant computation.

Two approaches:
1. Top-Down (Memoization): Recursive solution + cache. Natural to write, starts from original problem.
2. Bottom-Up (Tabulation): Iterative, fills a table from smallest subproblems up.

Prerequisites for DP:
1. Optimal Substructure: Optimal solution contains optimal solutions to subproblems.
2. Overlapping Subproblems: Same subproblems are solved multiple times in naive recursion.

Classic DP Problems:
- Fibonacci: fib(n) = fib(n-1) + fib(n-2). Naive: O(2^n), DP: O(n).
- 0/1 Knapsack: dp[i][w] = max value using first i items with capacity w. O(nW).
- Longest Common Subsequence (LCS): dp[i][j] = LCS length of first i chars of X and j chars of Y. O(mn).
- Longest Increasing Subsequence (LIS): O(n log n) with binary search.
- Coin Change: Minimum coins to make amount A. dp[a] = min coins for amount a.
- Matrix Chain Multiplication: Optimal parenthesization for matrix product. O(n³).
- Edit Distance (Levenshtein): Minimum edit operations (insert, delete, replace) between strings. O(mn).

Memoization Pattern (Python-style pseudocode):
  cache = {}
  def dp(state):
    if state in cache: return cache[state]
    result = ... (base case or recurrence)
    cache[state] = result
    return result

Space Optimization:
Many 2D DP tables can be reduced to 1D when only the previous row is needed (e.g., Knapsack, LCS).`,
        quizzes: [
          {
            title: 'Dynamic Programming Quiz',
            questions: [
              {
                question: 'What are the two key properties a problem must have for dynamic programming to apply?',
                options: ['A) Greedy choice + optimal substructure', 'B) Optimal substructure + overlapping subproblems', 'C) Divide and conquer + memoization', 'D) Recursion + backtracking'],
                correct_answer: 'B) Optimal substructure + overlapping subproblems',
                explanation: 'DP requires optimal substructure (optimal solution uses optimal sub-solutions) and overlapping subproblems (same subproblems recur, making caching worthwhile).',
              },
              {
                question: 'What is the time complexity of the naive recursive Fibonacci vs DP Fibonacci?',
                options: ['A) O(n) vs O(log n)', 'B) O(2^n) vs O(n)', 'C) O(n²) vs O(n)', 'D) O(n!) vs O(n)'],
                correct_answer: 'B) O(2^n) vs O(n)',
                explanation: 'Naive recursion recomputes fib(k) exponentially many times. Memoization stores each result once, reducing to O(n) time and O(n) space.',
              },
              {
                question: 'In the 0/1 Knapsack problem, what does dp[i][w] represent?',
                options: ['A) Number of items with weight w', 'B) Maximum value using first i items with capacity at most w', 'C) Minimum weight using i items', 'D) Boolean: can we exactly fill weight w with i items'],
                correct_answer: 'B) Maximum value using first i items with capacity at most w',
                explanation: 'dp[i][w] = max value achievable using items 1..i with knapsack capacity w. Recurrence: dp[i][w] = max(dp[i-1][w], dp[i-1][w-wt[i]] + val[i]).',
              },
            ],
          },
        ],
      },
      {
        title: 'Graph Traversals & Shortest Paths',
        body: `Graph Algorithms

Graph Representations:
- Adjacency Matrix: O(V²) space, O(1) edge lookup. Best for dense graphs.
- Adjacency List: O(V+E) space, O(degree) edge lookup. Best for sparse graphs.

BFS (Breadth-First Search):
- Explores vertices level by level using a queue.
- Time: O(V+E). Space: O(V).
- Finds shortest path (by edge count) in unweighted graphs.
- Used for: level-order traversal, shortest unweighted path, bipartite check, connected components.

DFS (Depth-First Search):
- Explores as far as possible before backtracking, using a stack (or recursion).
- Time: O(V+E). Space: O(V).
- Used for: topological sort, cycle detection, strongly connected components, maze solving.

Topological Sort:
- Linear ordering of DAG vertices such that for every edge u→v, u comes before v.
- DFS-based: Process vertices in reverse finish time order. O(V+E).
- Kahn's Algorithm: BFS-based using in-degree array. O(V+E).

Dijkstra's Algorithm (Single-Source Shortest Path):
- Works on graphs with non-negative edge weights.
- Uses a min-heap priority queue.
- Time: O((V+E) log V) with binary heap, O(V log V + E) with Fibonacci heap.
- Does NOT work with negative edges.

Bellman-Ford Algorithm:
- Handles negative edge weights.
- Detects negative weight cycles.
- Time: O(VE) — relaxes all edges V-1 times.

Floyd-Warshall Algorithm (All-Pairs Shortest Paths):
- Time: O(V³). Space: O(V²).
- Works with negative edges (but not negative cycles).
- dp[i][j][k] = shortest path from i to j using only vertices 1..k as intermediaries.

Minimum Spanning Tree:
- Prim's: Greedy, grows tree from starting vertex. O(E log V) with heap.
- Kruskal's: Sort edges by weight, add edges that don't create cycles using Union-Find. O(E log E).`,
        quizzes: [],
      },
    ],
  },
  {
    name: 'Operating Systems',
    docs: [
      {
        title: 'Virtual Memory & Page Replacement',
        body: `Virtual Memory

Virtual memory is a memory management technique that provides an abstraction of the storage resources that are actually available on a given machine, allowing programs to use more memory than is physically available.

Key Concepts:
- Virtual Address Space: Each process has its own address space, divided into pages.
- Physical Memory: Divided into frames of the same size as pages.
- Page Table: Maps virtual pages to physical frames.
- TLB (Translation Lookaside Buffer): Hardware cache for recent page table entries. Speeds up address translation.
- Page Fault: Occurs when a virtual page is not in physical memory. OS must load it from disk.

Page Replacement Algorithms:
When physical memory is full and a new page must be loaded, a page must be evicted (replaced).

1. FIFO (First-In, First-Out):
   - Evict the oldest page in memory.
   - Simple but suffers from Belady's Anomaly: more frames can cause MORE page faults.

2. Optimal (OPT):
   - Evict the page that won't be used for the longest time in the future.
   - Theoretically optimal but requires future knowledge — not practical, used as benchmark.

3. LRU (Least Recently Used):
   - Evict the page that has not been used for the longest time.
   - Good approximation of OPT. Expensive to implement exactly (needs counter or stack per page).
   - Approximate LRU: Clock algorithm (second-chance), NFU (Not Frequently Used).

4. Clock Algorithm (Second Chance):
   - Circular list of pages with a reference bit.
   - On replacement: if reference bit = 1, clear it and skip (give a second chance). If = 0, evict.
   - O(1) per replacement.

Working Set Model:
- Working set W(t, Δ): set of pages referenced in the last Δ time units.
- If a process's working set fits in memory, few page faults occur. Thrashing happens when total working sets exceed physical memory.

Thrashing: CPU spends more time on paging than actual execution. Solution: reduce degree of multiprogramming or increase RAM.`,
        quizzes: [
          {
            title: 'Virtual Memory Quiz',
            questions: [
              {
                question: 'What is Belady\'s Anomaly?',
                options: ['A) More frames always reduce page faults', 'B) Increasing frames can increase page faults with FIFO', 'C) LRU causes more page faults than FIFO', 'D) TLB misses increase with larger page tables'],
                correct_answer: 'B) Increasing frames can increase page faults with FIFO',
                explanation: "Belady's Anomaly: with FIFO replacement, allocating more physical frames can sometimes result in more page faults — counterintuitive and unique to FIFO.",
              },
              {
                question: 'Which page replacement algorithm is theoretically optimal but impractical?',
                options: ['A) LRU', 'B) FIFO', 'C) Clock', 'D) OPT (Optimal)'],
                correct_answer: 'D) OPT (Optimal)',
                explanation: 'OPT evicts the page not needed for the longest future time. It minimizes page faults but requires future knowledge, making it only usable as a theoretical benchmark.',
              },
              {
                question: 'What is thrashing in the context of virtual memory?',
                options: ['A) Excessive CPU cache misses', 'B) CPU spending more time paging than executing', 'C) Disk fragmentation causing slow I/O', 'D) TLB invalidation on context switch'],
                correct_answer: 'B) CPU spending more time paging than executing',
                explanation: 'Thrashing occurs when processes collectively need more memory than available, causing constant page faults. The CPU spends most time swapping pages rather than doing useful work.',
              },
            ],
          },
        ],
      },
    ],
  },
  {
    name: 'Computer Networks',
    docs: [
      {
        title: 'TCP/IP & Three-Way Handshake',
        body: `TCP/IP Protocol Suite

The TCP/IP model has 4 layers:
1. Application Layer: HTTP, HTTPS, FTP, SMTP, DNS, SSH.
2. Transport Layer: TCP (reliable, connection-oriented), UDP (unreliable, connectionless).
3. Internet Layer: IP (routing), ICMP, ARP.
4. Network Access Layer: Ethernet, Wi-Fi.

TCP (Transmission Control Protocol):
- Connection-oriented: requires handshake before data transfer.
- Reliable: guarantees delivery, ordering, and error checking.
- Flow control: sliding window prevents sender from overwhelming receiver.
- Congestion control: Slow Start, Congestion Avoidance, Fast Retransmit, Fast Recovery.
- Full-duplex: simultaneous bidirectional communication.

TCP Three-Way Handshake (Connection Establishment):
1. SYN: Client sends SYN (synchronize) with Initial Sequence Number (ISN_c). Client: SYN_SENT.
2. SYN-ACK: Server replies with SYN+ACK (acknowledges client ISN, sends server ISN_s). Server: SYN_RECEIVED.
3. ACK: Client sends ACK acknowledging server ISN. Connection: ESTABLISHED on both sides.

TCP Four-Way Termination:
1. FIN from initiator.
2. ACK from responder.
3. FIN from responder (when ready to close its side).
4. ACK from initiator. Initiator waits in TIME_WAIT (2*MSL) before closing.

UDP (User Datagram Protocol):
- No connection, no reliability, no ordering guarantee.
- Header: only 8 bytes (src port, dst port, length, checksum).
- Use cases: DNS, VoIP, video streaming, online gaming (where speed > reliability).

IP Addressing:
- IPv4: 32-bit address (4 octets). ~4.3 billion addresses.
- IPv6: 128-bit address. Solves address exhaustion.
- Subnetting: CIDR notation (e.g., 192.168.1.0/24 — 24 bits network, 8 bits host = 256 addresses).
- Private ranges: 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16.

NAT (Network Address Translation): Multiple devices share one public IP. Router maps (private IP, port) ↔ (public IP, port).`,
        quizzes: [
          {
            title: 'TCP/IP Networks Quiz',
            questions: [
              {
                question: 'How many messages are exchanged during TCP connection establishment (three-way handshake)?',
                options: ['A) 2', 'B) 3', 'C) 4', 'D) 1'],
                correct_answer: 'B) 3',
                explanation: 'TCP handshake: SYN (client→server), SYN-ACK (server→client), ACK (client→server). Three messages total before data transfer begins.',
              },
              {
                question: 'Which protocol does NOT guarantee delivery or ordering?',
                options: ['A) TCP', 'B) UDP', 'C) HTTP', 'D) FTP'],
                correct_answer: 'B) UDP',
                explanation: 'UDP (User Datagram Protocol) is connectionless and provides no delivery guarantees, ordering, or error recovery. It trades reliability for speed and low overhead.',
              },
              {
                question: 'What does CIDR notation /24 mean for an IPv4 network?',
                options: ['A) 24 host addresses', 'B) 24-bit network prefix (256 addresses)', 'C) 24 subnets', 'D) Maximum 24 hops'],
                correct_answer: 'B) 24-bit network prefix (256 addresses)',
                explanation: '/24 means 24 bits are the network portion, leaving 8 bits for hosts = 2^8 = 256 total addresses (254 usable, minus network and broadcast).',
              },
            ],
          },
        ],
      },
      {
        title: 'DNS Resolution & HTTP/HTTPS',
        body: `DNS (Domain Name System)

DNS translates human-readable domain names (e.g., google.com) into IP addresses (e.g., 142.250.80.46).

DNS Resolution Steps:
1. Browser checks local DNS cache. If found, return IP.
2. OS checks /etc/hosts file.
3. Query sent to Recursive Resolver (provided by ISP or 8.8.8.8).
4. Resolver checks its cache. If miss:
5. Resolver queries Root Name Server → returns TLD nameserver address.
6. Resolver queries TLD Nameserver (e.g., .com) → returns authoritative nameserver.
7. Resolver queries Authoritative Nameserver → returns final IP.
8. Resolver caches result (respecting TTL) and returns to client.

DNS Record Types:
- A: Maps domain to IPv4 address.
- AAAA: Maps domain to IPv6 address.
- CNAME: Canonical name (alias) — maps one domain to another.
- MX: Mail server for the domain.
- NS: Name servers for the domain.
- TXT: Arbitrary text (used for SPF, DKIM verification).

HTTP (HyperText Transfer Protocol):
- Stateless, application-layer protocol over TCP.
- HTTP/1.1: Persistent connections, pipelining, chunked transfer.
- HTTP/2: Multiplexing (multiple requests on one TCP connection), header compression (HPACK), server push.
- HTTP/3: Based on QUIC (over UDP), eliminates TCP head-of-line blocking.

HTTPS (HTTP Secure):
- HTTP + TLS (Transport Layer Security).
- TLS Handshake (TLS 1.3 — 1-RTT):
  1. Client Hello: cipher suites, key share.
  2. Server Hello: chosen cipher, certificate, server key share.
  3. Client verifies certificate, sends Finished.
  4. Encrypted data exchange begins.
- Certificate Authority (CA): Trusted third-party that signs server certificates.
- Perfect Forward Secrecy (PFS): Session keys derived from ephemeral Diffie-Hellman — compromising server's private key doesn't expose past sessions.

HTTP Methods:
- GET: Retrieve resource. Idempotent, cacheable.
- POST: Create resource. Not idempotent.
- PUT: Replace resource. Idempotent.
- PATCH: Partial update. Not necessarily idempotent.
- DELETE: Remove resource. Idempotent.
- HEAD: Like GET but response body omitted. Used to check resource existence.`,
        quizzes: [],
      },
    ],
  },
  {
    name: 'Databases',
    docs: [
      {
        title: 'Relational Normalization & B-Tree Indexing',
        body: `Database Normalization

Normalization reduces data redundancy and improves data integrity by organizing relations into well-defined normal forms.

First Normal Form (1NF):
- Each column must have atomic (indivisible) values.
- No repeating groups or arrays in columns.

Second Normal Form (2NF):
- Must be in 1NF.
- No partial dependencies: every non-prime attribute must depend on the entire primary key (relevant for composite keys).

Third Normal Form (3NF):
- Must be in 2NF.
- No transitive dependencies: non-prime attributes must not depend on other non-prime attributes.
- Rule: for every functional dependency X → Y, either X is a superkey, or Y is a prime attribute.

Boyce-Codd Normal Form (BCNF):
- Stronger version of 3NF: for every FD X → Y, X must be a superkey.
- Every relation in BCNF is in 3NF, but not vice versa.

Denormalization: Intentionally introducing redundancy for performance (e.g., cached aggregate columns in data warehouses).

B-Tree Indexing

A B-Tree (Balanced Tree) is a self-balancing search tree used in databases and file systems for fast data retrieval.

Properties:
- All leaves are at the same depth.
- Each node has between t-1 and 2t-1 keys (where t is the minimum degree).
- All operations: O(log n).

B+ Tree (most databases use this):
- All data is in leaf nodes. Internal nodes only store keys (routing).
- Leaf nodes are linked in a sorted linked list — efficient range queries.
- MySQL InnoDB, PostgreSQL use B+ trees for indexes.

Index Types:
- Clustered Index: Data rows physically ordered by index key. One per table (primary key).
- Non-Clustered Index: Separate structure with pointers to data rows. Multiple per table.
- Composite Index: Index on multiple columns. Column order matters — leftmost prefix rule.
- Covering Index: Index contains all columns needed by a query (no need to access table rows).

Index Selection Guidelines:
- Index frequently queried columns (WHERE, JOIN, ORDER BY).
- Avoid over-indexing: each index slows INSERT/UPDATE/DELETE.
- Use EXPLAIN/ANALYZE to verify index usage.`,
        quizzes: [
          {
            title: 'Databases Quiz',
            questions: [
              {
                question: 'What does Third Normal Form (3NF) eliminate beyond 2NF?',
                options: ['A) Partial dependencies', 'B) Transitive dependencies', 'C) Multi-valued dependencies', 'D) Repeating groups'],
                correct_answer: 'B) Transitive dependencies',
                explanation: '3NF eliminates transitive dependencies: non-prime attributes should not depend on other non-prime attributes. 2NF already eliminated partial dependencies.',
              },
              {
                question: 'Why do most relational databases use B+ trees instead of B-trees for indexes?',
                options: ['A) B+ trees use less memory', 'B) B+ trees support faster range queries via linked leaf nodes', 'C) B+ trees have lower insertion overhead', 'D) B+ trees support variable-length keys'],
                correct_answer: 'B) B+ trees support faster range queries via linked leaf nodes',
                explanation: 'B+ trees store all data in leaf nodes, which are linked together in sorted order. This allows efficient range scans without traversing the entire tree.',
              },
              {
                question: 'What is a clustered index?',
                options: ['A) An index that clusters multiple tables', 'B) An index where data rows are physically ordered by the index key', 'C) An index with no duplicate keys', 'D) An index stored in a separate file from the table'],
                correct_answer: 'B) An index where data rows are physically ordered by the index key',
                explanation: 'A clustered index determines the physical storage order of data rows. A table can have only one clustered index (typically the primary key in InnoDB).',
              },
            ],
          },
        ],
      },
    ],
  },
];

async function makeDemoPdf(title, body) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 60, size: 'A4' });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Cover page
    doc
      .font('Helvetica-Bold').fontSize(22).fillColor('#3b3fd4')
      .text('VidyaAI — Course Notes', { align: 'center' })
      .moveDown(0.5)
      .font('Helvetica').fontSize(14).fillColor('#111111')
      .text(title, { align: 'center' })
      .moveDown(0.3)
      .fontSize(10).fillColor('#555555')
      .text('Demo Study Material', { align: 'center' })
      .moveDown(2)
      .moveTo(60, doc.y).lineTo(535, doc.y).strokeColor('#cccccc').stroke()
      .moveDown(1.5);

    // Body content
    const lines = body.split('\n');
    lines.forEach(line => {
      const trimmed = line.trim();
      if (!trimmed) {
        doc.moveDown(0.4);
      } else if (/^[A-Z][^a-z]{3,}/.test(trimmed) && trimmed.length < 70 && !trimmed.endsWith(':')) {
        // Section heading
        doc.font('Helvetica-Bold').fontSize(12).fillColor('#3b3fd4').text(trimmed).moveDown(0.2)
           .font('Helvetica').fontSize(10).fillColor('#111111');
      } else if (trimmed.startsWith('-')) {
        doc.font('Helvetica').fontSize(10).fillColor('#111111')
           .text('  • ' + trimmed.slice(1).trim(), { indent: 10 });
      } else if (/^\d+\./.test(trimmed)) {
        doc.font('Helvetica').fontSize(10).fillColor('#111111')
           .text('  ' + trimmed, { indent: 10 });
      } else {
        doc.font('Helvetica').fontSize(10).fillColor('#111111').text(trimmed);
      }
    });

    doc.end();
  });
}

app.post('/api/demo/seed', async (req, res) => {
  try {
    // Ensure demo_pdfs directory exists
    const demoDir = path.join(__dirname, 'uploads', 'demo_pdfs');
    await fs.mkdir(demoDir, { recursive: true });

    let totalDocs = 0, totalChunks = 0, totalQuizzes = 0, totalFlashcards = 0;
    const CHUNK_SIZE = 900;
    const CHUNK_OVERLAP = 15;

    for (const topicDef of DEMO_TOPICS) {
      // Upsert topic
      let topicId;
      const { data: existingTopic } = await supabase
        .from('topics').select('id').eq('name', topicDef.name).single();
      if (existingTopic) {
        topicId = existingTopic.id;
        await supabase.from('topics').update({ description: `${topicDef.name} course material [demo]` }).eq('id', topicId);
      } else {
        const { data: newTopic, error: tErr } = await supabase
          .from('topics')
          .insert([{ name: topicDef.name, description: `${topicDef.name} course material [demo]` }])
          .select().single();
        if (tErr) throw tErr;
        topicId = newTopic.id;
      }

      for (const docDef of topicDef.docs) {
        // Generate PDF buffer
        const pdfBuffer = await makeDemoPdf(docDef.title, docDef.body);
        const safeName = docDef.title.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
        const pdfPath = path.join(demoDir, `${safeName}.pdf`);
        await fs.writeFile(pdfPath, pdfBuffer);

        // Insert document
        const { data: doc, error: docErr } = await supabase
          .from('documents')
          .insert({
            user_id: DEMO_USER,
            title: docDef.title,
            topic: topicDef.name,
            topic_id: topicId,
            status: 'processed',
          })
          .select().single();
        if (docErr) throw docErr;
        totalDocs++;

        // Chunk and embed the body text
        const cleanText = sanitizeForPostgres(docDef.body);
        const textChunks = chunkText(cleanText, CHUNK_SIZE, CHUNK_OVERLAP).map(c => sanitizeForPostgres(c));
        const embeddings = await generateEmbeddings(textChunks);

        const { error: chunkErr } = await supabase.from('chunks').insert(
          textChunks.map((chunk, i) => ({
            content: chunk,
            embedding: embeddings[i],
            document_id: doc.id,
            topic_id: topicId,
          }))
        );
        if (chunkErr) throw chunkErr;
        totalChunks += textChunks.length;

        // Insert quizzes + questions
        for (const quizDef of docDef.quizzes) {
          const { data: quiz, error: qErr } = await supabase
            .from('quizzes')
            .insert([{ document_id: doc.id, topic_id: topicId, title: quizDef.title }])
            .select().single();
          if (qErr) throw qErr;
          totalQuizzes++;

          const questionData = quizDef.questions.map(q => ({
            quiz_id: quiz.id,
            question: q.question,
            options: q.options,
            correct_answer: q.correct_answer,
            explanation: q.explanation,
            type: 'mcq',
          }));
          await supabase.from('quiz_questions').insert(questionData);

          // Seed a sample quiz attempt for the demo user
          const sampleScore = 60 + Math.floor(Math.random() * 35); // 60-95%
          await supabase.from('quiz_attempts').insert({
            quiz_id: quiz.id,
            user_id: DEMO_USER,
            score: sampleScore,
            answers: JSON.stringify([]),
          });

          // Update mastery for this topic (non-fatal)
          try {
            await supabase.rpc('update_topic_mastery', {
              p_user_id: DEMO_USER,
              p_topic_id: topicId,
            });
          } catch { /* non-fatal */ }
        }

        // Seed 2 flashcards per document from body chunks
        if (textChunks.length >= 2) {
          const { data: chunkRows } = await supabase.from('chunks').select('id').eq('document_id', doc.id).limit(2);
          if (chunkRows && chunkRows.length >= 1) {
            const fcData = chunkRows.slice(0, 2).map((cr, idx) => ({
              user_id: DEMO_USER,
              topic_id: topicId,
              document_id: doc.id,
              chunk_id: cr.id,
              question: `What are the key concepts in "${docDef.title}" (Part ${idx + 1})?`,
              answer: textChunks[idx].slice(0, 300) + '...',
            }));
            const { data: fc } = await supabase.from('flashcards').insert(fcData).select();
            if (fc) totalFlashcards += fc.length;
          }
        }
      }
    }

    res.json({
      success: true,
      stats: {
        topicsCount: DEMO_TOPICS.length,
        documentsCount: totalDocs,
        chunksCount: totalChunks,
        quizzesCount: totalQuizzes,
        flashcardsCount: totalFlashcards,
      },
    });
  } catch (err) {
    console.error('Demo seed error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {

  console.log(`VidyaAI server running on http://localhost:${PORT}`);
  console.log(`Groq: ${(getSettings().groqApiKey || process.env.GROQ_API_KEY) ? 'configured' : 'not configured (add GROQ_API_KEY)'}`);
  console.log(`Google Embeddings: ${(getSettings().googleApiKey || process.env.GOOGLE_API_KEY) ? 'configured' : 'not configured (add GOOGLE_API_KEY)'}`);
});
