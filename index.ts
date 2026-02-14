/**
 * OpenClaw Memory (PostgreSQL + pgvector) Plugin
 *
 * Long-term memory with semantic search for AI conversations.
 * Uses PostgreSQL with pgvector for storage and supports multiple
 * embedding providers (OpenAI, E5-local, Z.AI).
 *
 * Based on: memory/plans/vector-memory-schema.md
 */

import { Type } from "@sinclair/typebox";
import pg from "pg";
import OpenAI from "openai";
import { randomUUID } from "node:crypto";
import {
  MEMORY_CATEGORIES,
  type MemoryCategory,
  memoryConfigSchema,
  type MemoryConfig,
  vectorDimsForModel,
} from "./config.js";

const { Pool } = pg;

// ============================================================================
// Types - minimal interface for OpenClaw plugin API
// ============================================================================

interface ToolContext {
  sender?: { id: string };
  sessionId?: string;
}

interface BeforeAgentStartEvent {
  prompt?: string;
  sender?: { id: string };
  sessionId?: string;
}

interface AgentEndEvent {
  success?: boolean;
  messages?: unknown[];
  sender?: { id: string };
  sessionId?: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CommandAction = (...args: any[]) => Promise<void>;

interface CommandProgram {
  command: (name: string) => CommandProgram;
  description: (desc: string) => CommandProgram;
  option: (flags: string, description?: string, defaultValue?: string) => CommandProgram;
  argument: (flags: string, description?: string) => CommandProgram;
  action: (fn: CommandAction) => CommandProgram;
}

interface OpenClawPluginApi {
  pluginConfig: unknown;
  logger: {
    info: (msg: string) => void;
    warn: (msg: string) => void;
    error: (msg: string) => void;
  };
  resolvePath: (path: string) => string;
  registerTool: (
    tool: {
      name: string;
      label: string;
      description: string;
      parameters: unknown;
      execute: (
        toolCallId: string,
        params: Record<string, unknown>,
        context?: ToolContext
      ) => Promise<{ content: { type: string; text: string }[]; details?: unknown }>;
    },
    options?: { name: string }
  ) => void;
  registerCli: (
    fn: (opts: { program: CommandProgram }) => void,
    options?: { commands: string[] }
  ) => void;
  registerService: (service: {
    id: string;
    start: () => void;
    stop: () => void | Promise<void>;
  }) => void;
  on: (
    event: "before_agent_start" | "agent_end",
    handler: (event: BeforeAgentStartEvent | AgentEndEvent) => Promise<{ prependContext?: string } | void>
  ) => void;
}

type MemoryEntry = {
  id: string;
  userId: string;
  sessionId?: string;
  content: string;
  memoryType: MemoryCategory;
  embedding?: number[];
  importance: number;
  confidence: number;
  metadata: Record<string, unknown>;
  createdAt: Date;
};

type MemorySearchResult = {
  entry: Omit<MemoryEntry, "embedding">;
  score: number;
};

type RequestContext = {
  userId: string;
  sessionId?: string;
  telegramMessageId?: string;
};

// ============================================================================
// PostgreSQL Memory DB
// ============================================================================

class MemoryDB {
  pool: pg.Pool;
  private initPromise: Promise<void> | null = null;

  constructor(
    private readonly config: MemoryConfig["database"],
    private readonly vectorDim: number,
    private readonly logger: OpenClawPluginApi["logger"],
  ) {
    this.pool = new Pool({
      host: config.host,
      port: config.port,
      database: config.database,
      user: config.user,
      password: config.password,
      ssl: config.ssl ? { rejectUnauthorized: false } : false,
    });
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initPromise) {
      return this.initPromise;
    }
    this.initPromise = this.runMigrations();
    return this.initPromise;
  }

  private async runMigrations(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("CREATE EXTENSION IF NOT EXISTS vector");
      await client.query(`
        CREATE TABLE IF NOT EXISTS memories (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id TEXT NOT NULL,
          session_id TEXT,
          content TEXT NOT NULL,
          memory_type TEXT NOT NULL DEFAULT 'fact',
          embedding vector(${this.vectorDim}),
          importance REAL DEFAULT 0.7,
          confidence REAL DEFAULT 1.0,
          metadata JSONB DEFAULT '{}',
          source_type TEXT,
          source_id TEXT,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW(),
          CONSTRAINT valid_memory_type CHECK (memory_type IN (
            'preference', 'decision', 'fact', 'entity',
            'experience', 'session_summary', 'file_chunk', 'other'
          ))
        )
      `);

      const indexExists = await client.query(`
        SELECT 1 FROM pg_indexes WHERE indexname = 'idx_memories_embedding'
      `);
      if (indexExists.rows.length === 0) {
        await client.query(`
          CREATE INDEX idx_memories_embedding ON memories
          USING hnsw (embedding vector_cosine_ops)
          WITH (m = 16, ef_construction = 64)
        `);
      }

      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_memories_user_id ON memories(user_id)
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(memory_type)
      `);

      this.logger.info("memory-pgvector: database initialized");
    } finally {
      client.release();
    }
  }

  async store(
    entry: Omit<MemoryEntry, "id" | "createdAt"> & { embedding?: number[] },
  ): Promise<MemoryEntry> {
    await this.ensureInitialized();

    const id = randomUUID();
    const embeddingStr = entry.embedding
      ? `[${entry.embedding.join(",")}]`
      : null;

    await this.pool.query(
      `INSERT INTO memories (id, user_id, session_id, content, memory_type, embedding, importance, confidence, metadata)
       VALUES ($1, $2, $3, $4, $5, $6::vector, $7, $8, $9)`,
      [
        id,
        entry.userId,
        entry.sessionId,
        entry.content,
        entry.memoryType,
        embeddingStr,
        entry.importance,
        entry.confidence,
        JSON.stringify(entry.metadata),
      ],
    );

    return {
      ...entry,
      id,
      createdAt: new Date(),
    };
  }

  async search(
    embedding: number[],
    userId: string,
    limit = 5,
    minScore = 0.3,
    memoryType?: MemoryCategory,
  ): Promise<MemorySearchResult[]> {
    await this.ensureInitialized();

    const embeddingStr = `[${embedding.join(",")}]`;
    let query = `
      SELECT id, user_id, session_id, content, memory_type, importance, confidence, metadata, created_at,
             (1 - (embedding <=> $1::vector))::REAL AS score
      FROM memories
      WHERE user_id = $2
        AND (1 - (embedding <=> $1::vector)) >= $3
    `;
    const params: (string | number | string[])[] = [embeddingStr, userId, minScore];

    if (memoryType) {
      query += ` AND memory_type = $${params.length + 1}`;
      params.push(memoryType);
    }

    query += ` ORDER BY score DESC LIMIT $${params.length + 1}`;
    params.push(limit);

    const result = await this.pool.query(query, params);

    return result.rows.map((row) => ({
      entry: {
        id: row.id,
        userId: row.user_id,
        sessionId: row.session_id,
        content: row.content,
        memoryType: row.memory_type,
        importance: row.importance,
        confidence: row.confidence,
        metadata: row.metadata || {},
        createdAt: row.created_at,
      },
      score: row.score,
    }));
  }

  async delete(id: string, userId: string): Promise<boolean> {
    await this.ensureInitialized();

    const result = await this.pool.query(
      "DELETE FROM memories WHERE id = $1 AND user_id = $2",
      [id, userId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async count(userId?: string): Promise<number> {
    await this.ensureInitialized();

    if (userId) {
      const result = await this.pool.query(
        "SELECT COUNT(*) FROM memories WHERE user_id = $1",
        [userId],
      );
      return parseInt(result.rows[0].count, 10);
    }

    const result = await this.pool.query("SELECT COUNT(*) FROM memories");
    return parseInt(result.rows[0].count, 10);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async saveRequest(params: {
    userId: string;
    sessionId?: string;
    messageText: string;
    embedding?: number[];
    telegramMessageId?: bigint;
    telegramChatId?: bigint;
    hasFiles?: boolean;
  }): Promise<string> {
    await this.ensureInitialized();
    const id = randomUUID();
    const embeddingStr = params.embedding ? `[${params.embedding.join(",")}]` : null;

    await this.pool.query(
      `INSERT INTO requests (id, user_id, session_id, message_text, embedding, telegram_message_id, telegram_chat_id, has_files)
       VALUES ($1, $2, $3, $4, $5::vector, $6, $7, $8)`,
      [id, params.userId, params.sessionId, params.messageText, embeddingStr, 
       params.telegramMessageId, params.telegramChatId, params.hasFiles || false],
    );
    return id;
  }

  async saveResponse(params: {
    requestId: string;
    responseText: string;
    embedding?: number[];
    summary?: string;
    summaryEmbedding?: number[];
    modelUsed?: string;
    inputTokens?: number;
    outputTokens?: number;
  }): Promise<string> {
    await this.ensureInitialized();
    const id = randomUUID();
    const embeddingStr = params.embedding ? `[${params.embedding.join(",")}]` : null;
    const summaryEmbeddingStr = params.summaryEmbedding ? `[${params.summaryEmbedding.join(",")}]` : null;

    await this.pool.query(
      `INSERT INTO responses (id, request_id, response_text, embedding, summary, summary_embedding, model_used, input_tokens, output_tokens)
       VALUES ($1, $2, $3, $4::vector, $5, $6::vector, $7, $8, $9)`,
      [id, params.requestId, params.responseText, embeddingStr,
       params.summary, summaryEmbeddingStr, params.modelUsed, 
       params.inputTokens, params.outputTokens],
    );
    return id;
  }

  async saveReasoning(params: {
    requestId: string;
    reasoningText: string;
    embedding?: number[];
    thinkingModel?: string;
    thinkingTokens?: number;
  }): Promise<string> {
    await this.ensureInitialized();
    const id = randomUUID();
    const embeddingStr = params.embedding ? `[${params.embedding.join(",")}]` : null;

    await this.pool.query(
      `INSERT INTO reasoning (id, request_id, reasoning_text, embedding, thinking_model, thinking_tokens)
       VALUES ($1, $2, $3, $4::vector, $5, $6)`,
      [id, params.requestId, params.reasoningText, embeddingStr,
       params.thinkingModel, params.thinkingTokens],
    );
    return id;
  }

  async searchContext(
    embedding: number[],
    userId: string,
    limit = 10,
    minScore = 0.25,
  ): Promise<Array<{ source: string; content: string; similarity: number }>> {
    await this.ensureInitialized();
    const embeddingStr = `[${embedding.join(",")}]`;

    const result = await this.pool.query(
      `SELECT * FROM search_context($1::vector, $2, $3, $4)`,
      [embeddingStr, userId, limit, minScore],
    );

    return result.rows.map((row) => ({
      source: row.source,
      content: row.content,
      similarity: row.similarity,
    }));
  }

  async getStats(): Promise<{
    totalMemories: number;
    totalRequests: number;
    totalResponses: number;
    totalReasoning: number;
    totalFiles: number;
    totalChunks: number;
    uniqueUsers: number;
  }> {
    await this.ensureInitialized();
    const result = await this.pool.query("SELECT * FROM conversation_stats");
    return {
      totalMemories: parseInt(result.rows[0]?.total_memories || "0"),
      totalRequests: parseInt(result.rows[0]?.total_requests || "0"),
      totalResponses: parseInt(result.rows[0]?.total_responses || "0"),
      totalReasoning: parseInt(result.rows[0]?.total_reasoning || "0"),
      totalFiles: parseInt(result.rows[0]?.total_files || "0"),
      totalChunks: parseInt(result.rows[0]?.total_chunks || "0"),
      uniqueUsers: parseInt(result.rows[0]?.unique_users || "0"),
    };
  }
}

// ============================================================================
// Embedding Providers
// ============================================================================

interface EmbeddingProviderInterface {
  embed(text: string, type: "query" | "passage"): Promise<number[]>;
}

class OpenAIEmbeddings implements EmbeddingProviderInterface {
  private client: OpenAI;

  constructor(
    apiKey: string,
    private model: string,
    private baseUrl?: string,
  ) {
    this.client = new OpenAI({
      apiKey,
      baseURL: baseUrl,
    });
  }

  async embed(text: string, _type: "query" | "passage"): Promise<number[]> {
    const response = await this.client.embeddings.create({
      model: this.model,
      input: text,
    });
    return response.data[0].embedding;
  }
}

class E5LocalEmbeddings implements EmbeddingProviderInterface {
  constructor(private endpoint: string) {}

  async embed(text: string, type: "query" | "passage"): Promise<number[]> {
    const prefix = type === "query" ? "query: " : "passage: ";
    const response = await fetch(`${this.endpoint}/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: prefix + text }),
    });

    if (!response.ok) {
      throw new Error(`E5 embedding failed: ${response.statusText}`);
    }

    const data = (await response.json()) as { embedding: number[] };
    return data.embedding;
  }
}

class ZAIEmbeddings implements EmbeddingProviderInterface {
  private client: OpenAI;

  constructor(apiKey: string, private model: string) {
    this.client = new OpenAI({
      apiKey,
      baseURL: "https://api.z.ai/api/coding/paas/v4",
    });
  }

  async embed(text: string, _type: "query" | "passage"): Promise<number[]> {
    const response = await this.client.embeddings.create({
      model: this.model || "embedding-3",
      input: text,
    });
    return response.data[0].embedding;
  }
}

function createEmbeddingProvider(
  config: MemoryConfig["embedding"],
): EmbeddingProviderInterface {
  switch (config.provider) {
    case "openai":
      return new OpenAIEmbeddings(
        config.apiKey || process.env.OPENAI_API_KEY || "",
        config.model || "text-embedding-3-small",
      );
    case "e5-local":
      return new E5LocalEmbeddings(config.e5Endpoint || "http://127.0.0.1:8765");
    case "zai":
      return new ZAIEmbeddings(
        config.apiKey || process.env.ZAI_API_KEY || "",
        config.model || "embedding-3",
      );
    default:
      throw new Error(`Unknown embedding provider: ${config.provider}`);
  }
}

// ============================================================================
// Rule-based capture filter
// ============================================================================

const MEMORY_TRIGGERS = [
  /zapamatuj|запомни|remember/i,
  /предпочитаю|люблю|ненавижу|хочу|нужно|preferuji|radši|nechci|prefer/i,
  /решили|будем использовать|rozhodli jsme|budeme používat|decided|will use/i,
  /\+\d{10,}/,
  /[\w.-]+@[\w.-]+\.\w+/,
  /мой\s+\w+\s+это|это\s+мой|můj\s+\w+\s+je|je\s+můj|my\s+\w+\s+is|is\s+my/i,
  /я (люблю|предпочитаю|ненавижу|хочу|нуждаюсь)|i (like|prefer|hate|love|want|need)/i,
  /всегда|никогда|важно|always|never|important/i,
  /важная информация|important info/i,
];

function shouldCapture(text: string): boolean {
  if (text.length < 10 || text.length > 500) {
    return false;
  }
  if (text.includes("<relevant-memories>")) {
    return false;
  }
  if (text.startsWith("<") && text.includes("</")) {
    return false;
  }
  if (text.includes("**") && text.includes("\n-")) {
    return false;
  }
  const lower = text.toLowerCase();
  if (lower.includes("запомнил") || lower.includes("сохраняю") || lower.includes("saved")) {
    return false;
  }
  if (lower.includes("conversation info") || lower.includes("untrusted metadata")) {
    return false;
  }
  const emojiCount = (text.match(/[\u{1F300}-\u{1F9FF}]/gu) || []).length;
  if (emojiCount > 3) {
    return false;
  }
  return MEMORY_TRIGGERS.some((r) => r.test(text));
}

function detectCategory(text: string): MemoryCategory {
  const lower = text.toLowerCase();
  if (/prefer|radši|like|love|hate|want/i.test(lower)) {
    return "preference";
  }
  if (/rozhodli|decided|will use|budeme/i.test(lower)) {
    return "decision";
  }
  if (/\+\d{10,}|@[\w.-]+\.\w+|is called|jmenuje se/i.test(lower)) {
    return "entity";
  }
  if (/is|are|has|have|je|má|jsou/i.test(lower)) {
    return "fact";
  }
  return "other";
}

// ============================================================================
// Plugin Definition
// ============================================================================

const memoryPlugin = {
  id: "memory-pgvector",
  name: "Memory (PostgreSQL + pgvector)",
  description:
    "PostgreSQL-backed long-term memory with pgvector semantic search",
  kind: "memory" as const,
  configSchema: memoryConfigSchema,

  register(api: OpenClawPluginApi) {
    const cfg = memoryConfigSchema.parse(api.pluginConfig);
    const vectorDim = vectorDimsForModel(cfg.embedding.model, cfg.embedding.provider);
    const db = new MemoryDB(cfg.database, vectorDim, api.logger);
    const embeddings = createEmbeddingProvider(cfg.embedding);

    api.logger.info(
      `memory-pgvector: plugin registered (db: ${cfg.database.host}:${cfg.database.port}/${cfg.database.database}, provider: ${cfg.embedding.provider})`,
    );

    // ========================================================================
    // Tools
    // ========================================================================

    api.registerTool(
      {
        name: "memory_recall",
        label: "Memory Recall",
        description:
          "Search through long-term memories. Use when you need context about user preferences, past decisions, or previously discussed topics.",
        parameters: Type.Object({
          query: Type.String({ description: "Search query" }),
          limit: Type.Optional(Type.Number({ description: "Max results (default: 5)" })),
          type: Type.Optional(
            Type.Unsafe<MemoryCategory>({
              type: "string",
              enum: [...MEMORY_CATEGORIES],
            }),
          ),
        }),
        async execute(_toolCallId, params, context) {
          const { query, limit = 5, type } = params as {
            query: string;
            limit?: number;
            type?: MemoryCategory;
          };

          const userId = context?.sender?.id || "default";
          const vector = await embeddings.embed(query, "query");
          const results = await db.search(vector, userId, limit, 0.2, type);

          if (results.length === 0) {
            return {
              content: [{ type: "text", text: "No relevant memories found." }],
              details: { count: 0 },
            };
          }

          const text = results
            .map(
              (r, i) =>
                `${i + 1}. [${r.entry.memoryType}] ${r.entry.content} (${(r.score * 100).toFixed(0)}%)`,
            )
            .join("\n");

          return {
            content: [
              { type: "text", text: `Found ${results.length} memories:\n\n${text}` },
            ],
            details: { count: results.length, memories: results.map((r) => r.entry) },
          };
        },
      },
      { name: "memory_recall" },
    );

    api.registerTool(
      {
        name: "memory_store",
        label: "Memory Store",
        description:
          "Save important information in long-term memory. Use for preferences, facts, decisions.",
        parameters: Type.Object({
          content: Type.String({ description: "Information to remember" }),
          importance: Type.Optional(Type.Number({ description: "Importance 0-1 (default: 0.7)" })),
          type: Type.Optional(
            Type.Unsafe<MemoryCategory>({
              type: "string",
              enum: [...MEMORY_CATEGORIES],
            }),
          ),
        }),
        async execute(_toolCallId, params, context) {
          const { content, importance = 0.7, type = "other" } = params as {
            content: string;
            importance?: number;
            type?: MemoryCategory;
          };

          const userId = context?.sender?.id || "default";
          const sessionId = context?.sessionId;
          const vector = await embeddings.embed(content, "passage");

          const existing = await db.search(vector, userId, 1, 0.95);
          if (existing.length > 0) {
            return {
              content: [
                {
                  type: "text",
                  text: `Similar memory already exists: "${existing[0].entry.content}"`,
                },
              ],
              details: {
                action: "duplicate",
                existingId: existing[0].entry.id,
              },
            };
          }

          const entry = await db.store({
            userId,
            sessionId,
            content,
            memoryType: type,
            embedding: vector,
            importance,
            confidence: 1.0,
            metadata: {},
          });

          return {
            content: [
              { type: "text", text: `Stored: "${content.slice(0, 100)}..."` },
            ],
            details: { action: "created", id: entry.id },
          };
        },
      },
      { name: "memory_store" },
    );

    api.registerTool(
      {
        name: "memory_forget",
        label: "Memory Forget",
        description: "Delete specific memories. GDPR-compliant.",
        parameters: Type.Object({
          query: Type.Optional(Type.String({ description: "Search to find memory" })),
          memoryId: Type.Optional(Type.String({ description: "Specific memory ID" })),
        }),
        async execute(_toolCallId, params, context) {
          const { query, memoryId } = params as {
            query?: string;
            memoryId?: string;
          };

          const userId = context?.sender?.id || "default";

          if (memoryId) {
            const deleted = await db.delete(memoryId, userId);
            return {
              content: [
                {
                  type: "text",
                  text: deleted ? `Memory ${memoryId} forgotten.` : "Memory not found.",
                },
              ],
              details: { action: deleted ? "deleted" : "not_found", id: memoryId },
            };
          }

          if (query) {
            const vector = await embeddings.embed(query, "query");
            const results = await db.search(vector, userId, 5, 0.6);

            if (results.length === 0) {
              return {
                content: [{ type: "text", text: "No matching memories found." }],
                details: { found: 0 },
              };
            }

            if (results.length === 1 && results[0].score > 0.9) {
              await db.delete(results[0].entry.id, userId);
              return {
                content: [
                  { type: "text", text: `Forgotten: "${results[0].entry.content}"` },
                ],
                details: { action: "deleted", id: results[0].entry.id },
              };
            }

            const list = results
              .map((r) => `- [${r.entry.id.slice(0, 8)}] ${r.entry.content.slice(0, 60)}...`)
              .join("\n");

            return {
              content: [
                {
                  type: "text",
                  text: `Found ${results.length} candidates. Specify memoryId:\n${list}`,
                },
              ],
              details: { action: "candidates", candidates: results.map((r) => r.entry) },
            };
          }

          return {
            content: [{ type: "text", text: "Provide query or memoryId." }],
            details: { error: "missing_param" },
          };
        },
      },
      { name: "memory_forget" },
    );

    api.registerTool(
      {
        name: "search_context",
        label: "Search Context",
        description:
          "Search across all stored context: memories, requests, responses, and files. Returns most relevant matches.",
        parameters: Type.Object({
          query: Type.String({ description: "Search query" }),
          limit: Type.Optional(Type.Number({ description: "Max results (default: 10)" })),
        }),
        async execute(_toolCallId, params, context) {
          const { query, limit = 10 } = params as {
            query: string;
            limit?: number;
          };

          const userId = context?.sender?.id || "default";
          const vector = await embeddings.embed(query, "query");
          const results = await db.searchContext(vector, userId, limit, 0.2);

          if (results.length === 0) {
            return {
              content: [{ type: "text", text: "No relevant context found." }],
              details: { count: 0 },
            };
          }

          const text = results
            .map((r, i) => `${i + 1}. [${r.source}] ${r.content.slice(0, 200)}... (${(r.similarity * 100).toFixed(0)}%)`)
            .join("\n\n");

          return {
            content: [
              { type: "text", text: `Found ${results.length} context items:\n\n${text}` },
            ],
            details: { count: results.length, results },
          };
        },
      },
      { name: "search_context" },
    );

    // ========================================================================
    // CLI Commands
    // ========================================================================

    api.registerCli(
      ({ program }) => {
        const memory = program
          .command("pgmem")
          .description("PostgreSQL memory plugin commands");

        memory
          .command("count")
          .description("Count memories")
          .option("--user <userId>", "Filter by user")
          .action(async (opts) => {
            const count = await db.count((opts as { user?: string }).user);
            console.log(`Total memories: ${count}`);
          });

        memory
          .command("search")
          .description("Search memories")
          .argument("<query>", "Search query")
          .option("--limit <n>", "Max results", "5")
          .option("--user <userId>", "User ID", "default")
          .action(async (query, opts) => {
            const o = opts as { limit: string; user: string };
            const vector = await embeddings.embed(query as string, "query");
            const results = await db.search(vector, o.user, parseInt(o.limit), 0.2);
            console.log(JSON.stringify(results, null, 2));
          });

        memory
          .command("stats")
          .description("Show conversation statistics")
          .action(async () => {
            const stats = await db.getStats();
            console.log(`\n📊 Conversation Statistics:`);
            console.log(`   Memories:  ${stats.totalMemories}`);
            console.log(`   Requests:  ${stats.totalRequests}`);
            console.log(`   Responses: ${stats.totalResponses}`);
            console.log(`   Reasoning: ${stats.totalReasoning}`);
            console.log(`   Files:     ${stats.totalFiles}`);
            console.log(`   Chunks:    ${stats.totalChunks}`);
            console.log(`   Users:     ${stats.uniqueUsers}\n`);
          });
      },
      { commands: ["pgmem"] },
    );

    // ========================================================================
    // Lifecycle Hooks
    // ========================================================================

    if (cfg.autoRecall) {
      api.on("before_agent_start", async (event: BeforeAgentStartEvent) => {
        const prompt = event.prompt;
        if (!prompt || prompt.length < 5) {
          return;
        }

        const userId = event.sender?.id || "default";
        const sessionId = event.sessionId;

        try {
          const vector = await embeddings.embed(prompt, "query");
          
          // Save request
          await db.saveRequest({
            userId,
            sessionId,
            messageText: prompt.slice(0, 4000),
            embedding: vector,
          });
          api.logger.info(`memory-pgvector: saved request from ${userId}`);

          // Search context across all sources
          const context = await db.searchContext(vector, userId, 5, 0.25);

          if (context.length === 0) {
            return;
          }

          const contextText = context
            .map((c) => `[${c.source}] ${c.content.slice(0, 300)}`)
            .join("\n");

          api.logger.info(`memory-pgvector: injecting ${context.length} context items`);

          return {
            prependContext: `<relevant-context>\nRelated information:\n${contextText}\n</relevant-context>`,
          };
        } catch (err) {
          api.logger.warn(`memory-pgvector: recall failed: ${String(err)}`);
        }
      });
    }

    if (cfg.autoCapture) {
      api.on("agent_end", async (event) => {
        const e = event as AgentEndEvent;
        if (!e.success || !e.messages || e.messages.length === 0) {
          return;
        }

        const userId = e.sender?.id || "default";
        const sessionId = e.sessionId;

        try {
          let userText = "";
          let assistantText = "";
          let reasoningText = "";

          for (const msg of e.messages!) {
            if (!msg || typeof msg !== "object") continue;
            const msgObj = msg as Record<string, unknown>;
            const role = msgObj.role;
            
            const content = msgObj.content;
            let text = "";
            
            if (typeof content === "string") {
              text = content;
            } else if (Array.isArray(content)) {
              for (const block of content) {
                if (block && typeof block === "object" && "type" in block) {
                  const blk = block as Record<string, unknown>;
                  if (blk.type === "text" && "text" in blk) {
                    text += (blk.text as string) + "\n";
                  }
                  if (blk.type === "thinking" && "thinking" in blk) {
                    reasoningText += (blk.thinking as string) + "\n";
                  }
                }
              }
            }

            if (role === "user") userText = text;
            if (role === "assistant") assistantText = text;
          }

          // Get latest request for this user
          const latestRequest = await db.pool.query(
            `SELECT id FROM requests WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`,
            [userId]
          );
          const requestId = latestRequest.rows[0]?.id;

          if (requestId && assistantText) {
            // Save response
            const responseEmbedding = await embeddings.embed(assistantText.slice(0, 2000), "passage");
            const summary = assistantText.length > 500 
              ? assistantText.slice(0, 500) + "..." 
              : assistantText;
            const summaryEmbedding = await embeddings.embed(summary, "passage");

            await db.saveResponse({
              requestId,
              responseText: assistantText,
              embedding: responseEmbedding,
              summary,
              summaryEmbedding,
              modelUsed: "glm-5",
            });
            api.logger.info(`memory-pgvector: saved response`);

            // Save reasoning if present
            if (reasoningText) {
              const reasoningEmbedding = await embeddings.embed(reasoningText.slice(0, 2000), "passage");
              await db.saveReasoning({
                requestId,
                reasoningText,
                embedding: reasoningEmbedding,
                thinkingModel: "glm-5",
              });
              api.logger.info(`memory-pgvector: saved reasoning`);
            }
          }

          // Capture important facts as memories
          const texts = [userText, assistantText].filter(Boolean);
          const toCapture = texts.filter((text) => text && shouldCapture(text));
          
          let stored = 0;
          for (const text of toCapture.slice(0, 2)) {
            const memoryType = detectCategory(text);
            const vector = await embeddings.embed(text, "passage");

            const existing = await db.search(vector, userId, 1, 0.95);
            if (existing.length > 0) continue;

            await db.store({
              userId,
              sessionId,
              content: text,
              memoryType,
              embedding: vector,
              importance: 0.7,
              confidence: 1.0,
              metadata: {},
            });
            stored++;
          }

          if (stored > 0) {
            api.logger.info(`memory-pgvector: auto-captured ${stored} memories`);
          }
        } catch (err) {
          api.logger.warn(`memory-pgvector: capture failed: ${String(err)}`);
        }
      });
    }

    // ========================================================================
    // Service
    // ========================================================================

    api.registerService({
      id: "memory-pgvector",
      start: () => {
        api.logger.info(
          `memory-pgvector: initialized (provider: ${cfg.embedding.provider}, model: ${cfg.embedding.model})`,
        );
      },
      stop: async () => {
        await db.close();
        api.logger.info("memory-pgvector: stopped");
      },
    });
  },
};

export default memoryPlugin;
