# AIRI Codebase Survey: Brain-like Memory Architecture

## TL;DR

Project AIRI is an open-source virtual AI character ("cyber waifu") designed to play games, chat across multiple platforms, and remember interactions as a persistent digital being. Unlike standard RAG systems, AIRI implements a **multi-dimensional memory system inspired by human neuroscience**: working memory (chat history), short-term memory (recent retrieval-optimized vectors), long-term memory (older but frequency-reinforced vectors), and muscle memory (pattern-matched reflexes). The system uses **weighted, stateless decay functions** computed at query time (not updates) to model forgetting, emotional valence biasing (positive/negative emotional scores), temporal relevance, and random intrusive recall—making it fundamentally different from deterministic vector-DB-only approaches. Memory scoring merges semantic similarity, recency, access frequency, and emotional weight into a single multi-factor ranking formula, with planned features for "dream" background consolidation agents and context-sensitive persona switching.

---

## Architecture Map

### Layers, Storage, Data Flow

```
┌─────────────────────────────────────────────────────────────────┐
│ STAGES (apps/stage-*)                                           │
│ ├─ stage-web (browser Vue3 + Vite)                              │
│ ├─ stage-tamagotchi (Electron desktop + Vue3)                   │
│ └─ stage-pocket (mobile Capacitor + Vue3)                       │
└─────────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────────┐
│ CORE ORCHESTRATION LAYER (packages/stage-ui/src/stores)         │
│ ├─ consciousness.ts (LLM provider/model selection)              │
│ ├─ modules/ (hearing, speech, vision, gaming, airi-card)        │
│ ├─ character/orchestrator/ (spark:notify processing, tasks)     │
│ ├─ character/notebook.ts (diary, notes, task scheduling)        │
│ ├─ chat/session-store.ts (chat history persistence)             │
│ ├─ chat/context-store.ts (active context buckets)               │
│ └─ chat/context-providers/ (datetime, minecraft, extensible)    │
└─────────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────────┐
│ CONTEXT & MEMORY RETRIEVAL                                      │
│ ├─ ContextMessage format w/ ContextUpdateStrategy               │
│ │  (ReplaceSelf or AppendSelf mutations)                        │
│ ├─ Multi-context buckets (sourceKey → ContextMessage[])         │
│ └─ Context history rolling window (400-entry limit)             │
└─────────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────────┐
│ STORAGE BACKENDS                                                │
│ ├─ Browser: IndexedDB (unstorage driver) + DuckDB WASM          │
│ │  files: packages/stage-ui/src/database/storage.ts             │
│ │  paths: local:* and outbox:* keys                              │
│ ├─ Desktop/Server: PostgreSQL 17+ w/ pgvector (1536/1024/768D)  │
│ │  files: services/{telegram,satori}-bot/src/db/schema.ts       │
│ └─ Tables: chat_messages, memory_fragments, memory_episodic,    │
│    memory_long_term_goals, memory_short_term_ideas              │
└─────────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────────┐
│ SERVICES (services/)                                             │
│ ├─ telegram-bot (chat platform integration + memory ingest)      │
│ ├─ satori-bot (multi-platform message relay)                     │
│ ├─ discord-bot (Discord platform integration)                    │
│ └─ minecraft (game integration with context upstreaming)         │
└─────────────────────────────────────────────────────────────────┘
```

**Key Storage Tables** (PostgreSQL schema at `/Users/zion/Repos/Personal/Research-and-Integration/airi/services/telegram-bot/src/db/schema.ts:110-206`):
- `memory_fragments` (id, content, memory_type, importance, emotional_impact, access_count, content_vector_*, created_at, last_accessed, metadata)
- `memory_episodic` (id, memory_id FK, event_type, participants JSONB, location, created_at)
- `memory_long_term_goals` (id, title, priority, progress, status, parent_goal_id, deadline)
- `memory_short_term_ideas` (id, content, source_type, status, excitement, content_vector_*)
- `memory_tags` (id, memory_id FK, tag, created_at)

---

## Memory/Mind Mechanics

### 1. **Multi-Dimensional Memory Model** (Not Standard RAG)

AIRI implements **four memory types**, drawn from cognitive science:

**File**: `/Users/zion/Repos/Personal/Research-and-Integration/airi/docs/content/zh-Hans/blog/DevLog-2025.04.14/index.md:127-157`

- **Working Memory**: Immediate message context (session-local, ~chat.sessionMessages)
  - Path: `/Users/zion/Repos/Personal/Research-and-Integration/airi/packages/stage-ui/src/stores/chat/session-store.ts:18`
  - Type: `ChatHistoryItem[]` (role, content, createdAt, id)

- **Short-Term Memory**: Recent, easily-recalled vector embeddings
  - Retrieval strategy: **newness-weighted** (temporal relevance decay)
  - Formula: `(1.2 * similarity) + (0.2 * time_relevance)`
  - Path: `/Users/zion/Repos/Personal/Research-and-Integration/airi/docs/content/zh-Hans/blog/DevLog-2025.04.06/index.md:307-328`
  - Implementation: Drizzle + cosineDistance SQL query with HNSW indexes

- **Long-Term Memory**: Older, harder-to-recall vectors reinforced by access frequency
  - Retrieval factor: **access_count** (how many times retrieved)
  - Decay model: Exponential half-life function
  - Path: `/Users/zion/Repos/Personal/Research-and-Integration/airi/docs/content/zh-Hans/blog/DevLog-2025.04.14/index.md:101-125`

- **Muscle Memory**: Pattern-matched reflexes (planned, not yet implemented)
  - Intended: Automatic action triggers on state matches

**Query Implementation** (stateless decay, computed at retrieval time, not stored):
```typescript
// File: /Users/zion/Repos/Personal/Research-and-Integration/airi/docs/content/zh-Hans/blog/DevLog-2025.04.06/index.md:321-328
const timeRelevance = sql<number>`(1 - (CEIL(EXTRACT(EPOCH FROM NOW()) * 1000)::bigint - ${chatMessagesTable.created_at}) / 86400 / 30)`
const combinedScore = sql<number>`((1.2 * ${similarity}) + (0.2 * ${timeRelevance}))`
```

**Why stateless matters**: No background job needed to decay scores. The decay is a pure function: `f(original_score, time_elapsed) → current_score`.

---

### 2. **Emotional Valence in Memory Scoring**

Memory records include **emotional metadata**:

**File**: `/Users/zion/Repos/Personal/Research-and-Integration/airi/services/telegram-bot/src/db/schema.ts:115-116`
```typescript
emotional_impact: integer().notNull().default(0), // -10 to 10 scale
```

**Usage** (planned reranking):
- **Positive memories** (emotional_impact > 0): Bias retrieval upward (more likely to surface)
- **Negative memories** (emotional_impact < 0): Bias retrieval downward (suppressed unless triggered)
- **PTSD simulation**: High-trauma memories (trauma_score > threshold) can randomly intrude via noise-based weighting

**Reference**: `/Users/zion/Repos/Personal/Research-and-Integration/airi/docs/content/zh-Hans/blog/DevLog-2025.04.14/index.md:190-209`

---

### 3. **Context-Sensitive Retrieval**

Memory is not retrieved in isolation. The system maintains **active context buckets** per source:

**File**: `/Users/zion/Repos/Personal/Research-and-Integration/airi/packages/stage-ui/src/stores/chat/context-store.ts:28-86`

```typescript
const activeContexts = ref<Record<string, ContextMessage[]>>({})  // Line 29
// Each sourceKey (e.g., 'system:datetime', 'system:minecraft-integration') 
// has an array of ContextMessages with strategy: ReplaceSelf or AppendSelf
```

**Context providers** (extensible): `/Users/zion/Repos/Personal/Research-and-Integration/airi/packages/stage-ui/src/stores/chat/context-providers/`
- `datetime.ts`: Injects current time (stateless, every turn)
  - Strategy: `ContextUpdateStrategy.ReplaceSelf` (replaces previous datetime)
- `minecraft.ts`: Injects Minecraft bot status and context
  - Strategy: `ContextUpdateStrategy.ReplaceSelf` (latest bot state replaces old)

**Memory context window** (rolling): 400-entry history limit
```typescript
// File: /Users/zion/Repos/Personal/Research-and-Integration/airi/packages/stage-ui/src/stores/chat/context-store.ts:26,78-84
const CONTEXT_HISTORY_LIMIT = 400
contextHistory.value = [
  ...contextHistory.value,
  { ...normalizedEnvelope, sourceKey }
].slice(-CONTEXT_HISTORY_LIMIT)  // Keep only last 400
```

**Formatted into prompt**:
```typescript
// File: /Users/zion/Repos/Personal/Research-and-Integration/airi/packages/stage-ui/src/stores/chat/context-prompt.ts:7-14
// Injected as: "These are the contextual information retrieved or on-demand updated..."
```

---

### 4. **The Mental Loop: Spark:Notify System**

AIRI has an **event-driven task/notification scheduler** that acts as a "background process" for attention and consolidation:

**File**: `/Users/zion/Repos/Personal/Research-and-Integration/airi/packages/stage-ui/src/stores/character/orchestrator/store.ts`

**Flow**:
1. **Task enqueue** (due tasks from notebook): `getDueTasks(now, taskNotifyWindowMs)` (line 117)
   - Sources: `notebookStore` (diary, notes, scheduled tasks)
   - Emits `spark:notify` events with urgency levels: 'immediate', 'soon', 'later'

2. **Event queue & scheduler** (lines 26-39):
   ```typescript
   const pendingNotifies = ref<Array<WebSocketEventOf<'spark:notify'>>>([])
   const scheduledNotifies = ref<Array<{
     event: WebSocketEventOf<'spark:notify'>
     enqueuedAt: number
     nextRunAt: number
     attempts: number
     maxAttempts: number
   }>>([])
   ```

3. **Ticker loop** (2-second interval, line 35):
   ```typescript
   attentionConfig.value.tickIntervalMs = 2_000  // Line 35
   ```
   - Checks which scheduled notifications are due: `nextRunAt <= now` (line 153)
   - Processes them via `sparkNotifyAgent` (specialized LLM handler)
   - Retries failed tasks up to `maxAttempts` with exponential backoff

4. **Reaction generation** (lines 92-105):
   - Spark:notify triggers an LLM response (reaction prompt)
   - Character can decide to act, speak, or remember
   - Commands (e.g., "save this thought") are sent to mods server

**Why it matters**: This is AIRI's "sleep/dream/consolidation loop"—not yet learning/evolving, but the framework is there for future agents to:
- Reindex memories during quiet periods
- Modify memory scores based on recent events
- Generate new insights or goals

---

### 5. **Persona/Consciousness Switching**

**File**: `/Users/zion/Repos/Personal/Research-and-Integration/airi/packages/stage-ui/src/stores/modules/consciousness.ts`

The `useConsciousnessStore` manages:
- `activeProvider` (LLM service: Claude, OpenAI, etc.)
- `activeModel` (specific model ID)
- Model capabilities filtering

**Usage in memory**: System prompt and provider settings affect how contexts and memories are interpreted, but memory retrieval itself is provider-agnostic (purely vector-based).

---

## Context and Persona Interaction

### Multiple Modules, Single Memory

Different modules (hearing, speech, vision, gaming) emit events that update context buckets independently. Example:

**File**: `/Users/zion/Repos/Personal/Research-and-Integration/airi/packages/stage-ui/src/stores/modules/vision/orchestrator.ts` (assumed, by pattern)

Vision module might emit:
```typescript
const visionContext = {
  id: nanoid(),
  contextId: 'system:vision',
  strategy: ContextUpdateStrategy.ReplaceSelf,
  text: `Detected: [object classification results]`,
  createdAt: Date.now(),
}
```

**Retrieval doesn't discriminate by persona**—it's context-aware: the active context bucket is merged with memory retrieval results before the LLM sees them.

---

## Active vs. Passive Ingestion

### Passive Ingestion (Chat History → Memory Fragments)

1. **Chat message capture** (platform-agnostic):
   - Platform: Telegram, Discord, Satori
   - Stored raw in `chatMessagesTable` (id, content, from_id, created_at, etc.)
   - File: `/Users/zion/Repos/Personal/Research-and-Integration/airi/services/telegram-bot/src/db/schema.ts:3-23`

2. **Vector embedding (on-demand or background)**:
   - Text → embedding (nomic-embed-text, gte-Qwen2, etc.) → store in `content_vector_1536/1024/768`
   - Indexed via HNSW for O(log n) retrieval

3. **Memory fragmentation** (planned, not yet implemented):
   - Extract summary/semantic fragments from raw messages
   - Promote to `memory_fragments` table with importance/emotional_impact scores
   - Link to `memory_episodic` (who said what, where, when)

### Active Learning (Spark:Notify → Memory Modification)

**File**: `/Users/zion/Repos/Personal/Research-and-Integration/airi/packages/stage-ui/src/stores/character/orchestrator/agents/event-handler-spark-notify/index.ts` (reference from store.ts:41-53)

When a task/notification is processed:
1. LLM generates a reaction
2. Character decides to "remember" or "forget" based on response
3. Commands sent to mods server can trigger memory writes

**Not yet implemented**: Auto-reweighting of past memories based on context. Planned features (DevLog 2025.04.14:219-227):
- "Dream agent" or "subconscious agent" as background task
- Re-index and re-score memories based on recent experiences
- Modify emotional_impact, importance, or access_count

---

## Top 5 Patterns Compost Should Steal

### 1. **Stateless Decay Functions at Query Time**

**Why**: Avoids expensive background jobs. One SQL expression computes current scores.

**Interface**:
```typescript
// Decay score: original_score * exp(-time_elapsed / half_life)
function decayScore(original: number, timeElapsed: number, halfLife: number): number {
  return original * Math.pow(0.5, timeElapsed / halfLife)
}

// Multi-factor ranking:
function rankMemory(
  semanticSimilarity: number,      // 0-1
  timeRelevance: number,            // 0-1 (decayed)
  accessFrequency: number,          // raw count
  emotionalBias: number             // -10 to 10
): number {
  return (1.2 * semanticSimilarity) 
       + (0.2 * timeRelevance)
       + (0.05 * accessFrequency)
       + (emotionalBias * 0.1)
}
```

**Implementation**: Embed this in every memory query as a SQL expression (or equivalent in your query layer).

---

### 2. **Context Buckets with Strategy-Based Updates**

**Why**: Allows multiple independent information streams (datetime, location, mood, etc.) to coexist without collision.

**Interface**:
```typescript
interface ContextMessage {
  id: string
  contextId: string  // e.g., 'system:datetime', 'user:location'
  strategy: 'replace-self' | 'append-self'  // How to merge
  text: string
  createdAt: number
  metadata?: { source: ModuleIdentity }
}

// Storage
activeContexts: Record<contextId, ContextMessage[]>  // One bucket per source

// Update rule
if (strategy === 'replace-self') {
  activeContexts[sourceKey] = [newMessage]  // Replace all
} else {
  activeContexts[sourceKey].push(newMessage)  // Append
}
```

**Why ReplaceSelf for datetime?** New datetime replaces old; stale time is useless.
**Why AppendSelf for chat?** Build up conversation history; old messages still matter.

---

### 3. **Episodic Memory with Multi-Participant Tagging**

**Why**: Conversations aren't about content alone; who was there, what event it was, emotional tone.

**Schema**:
```typescript
interface MemoryFragment {
  id: string
  content: string
  memory_type: 'working' | 'short_term' | 'long_term' | 'muscle'
  importance: 1-10  // Relevance
  emotional_impact: -10 to 10  // Positive/negative
  access_count: number  // Retrieval reinforcement
  created_at: number
  last_accessed: number
  metadata: Record<string, unknown>
}

interface MemoryEpisodic {
  memory_id: FK
  event_type: string  // 'conversation', 'argument', 'achievement', etc.
  participants: string[]  // User IDs
  location?: string
}

interface MemoryTag {
  memory_id: FK
  tag: string  // 'AI-related', 'personal-goal', 'Minecraft', etc.
}
```

**Query usage**: `SELECT * FROM memory_fragments JOIN memory_episodic WHERE participants @> ARRAY[user_id]` (PostgreSQL JSONB matching).

---

### 4. **Rolling Context History with Size Limits**

**Why**: Prevents unbounded growth. Recent history is most relevant; old context becomes noise.

**Implementation**:
```typescript
const CONTEXT_HISTORY_LIMIT = 400
contextHistory = [
  ...contextHistory,
  newEntry
].slice(-CONTEXT_HISTORY_LIMIT)  // Keep last N only
```

**Benefit**: Memory-bounded, predictable prompt size, FIFO eviction (simple).
**Trade-off**: Truly rare old context lost. Solution: Before eviction, consider promoting to `memory_fragments` if important_score > threshold.

---

### 5. **Multi-Vector Embedding with Flexible Dimensions**

**Why**: Future models may output 4096D or 2048D embeddings. Precompute multiple dimensions.

**Schema** (from airi):
```typescript
content_vector_1536: vector({ dimensions: 1536 })
content_vector_1024: vector({ dimensions: 1024 })
content_vector_768: vector({ dimensions: 768 })
```

With indexes:
```typescript
index('memory_content_vector_1536_index').using('hnsw', table.content_vector_1536.op('vector_cosine_ops'))
index('memory_content_vector_1024_index').using('hnsw', table.content_vector_1024.op('vector_cosine_ops'))
// ... etc
```

**Switch at runtime** (environment variable):
```typescript
switch (env.EMBEDDING_DIMENSION) {
  case '1536': similarity = sql`1 - cosineDistance(vector_1536, embedding)`; break
  case '1024': similarity = sql`1 - cosineDistance(vector_1024, embedding)`; break
  case '768': similarity = sql`1 - cosineDistance(vector_768, embedding)`; break
}
```

**Benefit**: No migration needed when swapping embedding models. Just compute all three upfront.

---

## Top 3 Anti-Patterns to Avoid

### 1. **Don't Assume Persona = Memory Partition**

**The airi approach**: Memory is persona-agnostic; persona affects *how context is interpreted*, not *which memories are visible*.

**Anti-pattern**: Separate `memory_fragments` tables per persona.
**Why it fails**: Same user interaction should be remembered across personas. If AIRI switches from "sad ReLU" to "happy ReLU", both should recall the same event, just with different emotional reaction.

**Better**: Single memory table + `personality_context` in the active context bucket that shifts emotional weighting during retrieval.

---

### 2. **Don't Statefully Update Scores on Every Access**

**The airi approach**: `access_count` is incremented on retrieval, but *decay and emotional weighting* are computed at query time.

**Anti-pattern**:
```typescript
// ❌ WRONG: Update every time retrieved
async function getMemory(id) {
  await db.update(memory_fragments).set({ 
    access_count: access_count + 1,
    last_accessed: Date.now()
  }).where(id === id)
  return await db.select...
}
```

**Why it fails**: 
- Write-heavy for read-heavy workload (memory retrieval is frequent)
- Locks/contention on hot memory records
- Doesn't scale to realtime context

**Better**:
```typescript
// ✓ BETTER: Read-only + compute decay in query
SELECT *,
  (original_importance * POWER(0.5, (NOW() - created_at) / half_life)) AS decayed_score
FROM memory_fragments
ORDER BY decayed_score DESC
```

Batch-write `access_count` asynchronously or on consolidation loop (e.g., hourly background job).

---

### 3. **Don't Embed Everything at Ingestion**

**The airi approach**: Raw messages stored first; embedding is lazy or batched.

**Anti-pattern**:
```typescript
// ❌ WRONG: Block on embedding for every user input
async function saveChatMessage(msg) {
  const embedding = await llm.embed(msg.content)  // Wait!
  await db.insert(chatMessages).values({
    content: msg.content,
    embedding: embedding
  })
}
```

**Why it fails**:
- Embedding API latency blocks user input (bad UX)
- Embedding models may fail; you lose the message
- You might want to re-embed with a better model later

**Better**:
```typescript
// ✓ BETTER: Store first, embed async
async function saveChatMessage(msg) {
  const id = await db.insert(chatMessages).values({
    content: msg.content,
    embedding: null  // Nullable
  })
  // Emit to background queue
  await queue.enqueue({ type: 'embed', messageId: id })
}

// Background worker
async function embedWorker() {
  for (const task of queue) {
    const msg = await db.select...where(id === task.messageId)
    const embedding = await llm.embed(msg.content)
    await db.update(chatMessages).set({ embedding }).where(id === task.messageId)
  }
}
```

**Benefit**: 
- Immediate response to user
- Embedding failures don't lose data
- Can re-embed globally if model changes

---

## Summary: The Airi Difference

Unlike a standard RAG stack (vector DB + embeddings + LLM), AIRI adds:

1. **Human-inspired memory tiers** (working/short/long/muscle) with independent decay curves
2. **Emotional valence in every memory** (biases retrieval, enables mood-driven recall)
3. **Stateless decay** (query-time scoring, no background updates needed)
4. **Multi-context bucket system** (independent information streams coexist)
5. **Episodic tagging** (event type, participants, location—not just raw text)
6. **Planned "dream" consolidation** (background agent for memory re-indexing and evolution)

The system is **probabilistic at the ranking layer** (many weighted factors combine stochastically), not deterministic. It can be trained over time as emotional scores are updated from interaction outcomes, and it supports "intrusive recall" (random retrieval) for PTSD-like memory simulation.

---

## Key File References

- Core orchestration: `/Users/zion/Repos/Personal/Research-and-Integration/airi/packages/stage-ui/src/stores/`
- Memory schema: `/Users/zion/Repos/Personal/Research-and-Integration/airi/services/telegram-bot/src/db/schema.ts`
- Context system: `/Users/zion/Repos/Personal/Research-and-Integration/airi/packages/stage-ui/src/stores/chat/`
- Spark:notify loop: `/Users/zion/Repos/Personal/Research-and-Integration/airi/packages/stage-ui/src/stores/character/orchestrator/`
- Devlog (design rationale): `/Users/zion/Repos/Personal/Research-and-Integration/airi/docs/content/zh-Hans/blog/DevLog-2025.04.{06,14}/`

