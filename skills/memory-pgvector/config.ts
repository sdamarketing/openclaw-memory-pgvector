import { homedir } from "node:os";
import { join } from "node:path";

export type MemoryConfig = {
  database: {
    host: string;
    port: number;
    database: string;
    user: string;
    password?: string;
    ssl?: boolean;
  };
  embedding: {
    provider: "openai" | "e5-local" | "zai";
    model?: string;
    apiKey?: string;
    e5Endpoint?: string;
  };
  autoCapture?: boolean;
  autoRecall?: boolean;
  sessionSummaries?: boolean;
  zaiApiKey?: string;
};

export const MEMORY_CATEGORIES = [
  "preference",
  "decision",
  "fact",
  "entity",
  "experience",
  "session_summary",
  "file_chunk",
  "other",
] as const;

export type MemoryCategory = (typeof MEMORY_CATEGORIES)[number];

const EMBEDDING_DIMENSIONS: Record<string, number> = {
  "text-embedding-3-small": 1536,
  "text-embedding-3-large": 3072,
  "e5-large-v2": 1024,
  "embedding-3": 1024,
};

function assertAllowedKeys(value: Record<string, unknown>, allowed: string[], label: string) {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length === 0) return;
  throw new Error(`${label} has unknown keys: ${unknown.join(", ")}`);
}

export function vectorDimsForModel(model: string | undefined, provider?: string): number {
  if (provider === "e5-local") return 1024;
  if (!model) return 1536;
  const dims = EMBEDDING_DIMENSIONS[model];
  return dims ?? 1536;
}

function resolveEnvVars(value: string): string {
  return value.replace(/\$\{([^}]+)\}/g, (_, envVar) => {
    const envValue = process.env[envVar];
    if (!envValue) throw new Error(`Environment variable ${envVar} is not set`);
    return envValue;
  });
}

const DEFAULT_DB_CONFIG = {
  host: "localhost",
  port: 5432,
  database: "openclaw_memory",
  user: "postgres",
  ssl: false,
};

export const memoryConfigSchema = {
  parse(value: unknown): MemoryConfig {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("memory-pgvector config required");
    }
    const cfg = value as Record<string, unknown>;
    assertAllowedKeys(cfg, ["database", "embedding", "autoCapture", "autoRecall", "sessionSummaries", "zaiApiKey"], "memory-pgvector config");

    const database = cfg.database as Record<string, unknown> | undefined;
    if (!database) throw new Error("database config is required");
    assertAllowedKeys(database, ["host", "port", "database", "user", "password", "ssl"], "database config");

    const embedding = cfg.embedding as Record<string, unknown> | undefined;
    if (!embedding) throw new Error("embedding config is required");
    assertAllowedKeys(embedding, ["provider", "model", "apiKey", "e5Endpoint"], "embedding config");

    const provider = embedding.provider as string || "openai";
    if (!["openai", "e5-local", "zai"].includes(provider)) {
      throw new Error(`Unknown embedding provider: ${provider}`);
    }

    return {
      database: {
        host: (database.host as string) || DEFAULT_DB_CONFIG.host,
        port: (database.port as number) || DEFAULT_DB_CONFIG.port,
        database: (database.database as string) || DEFAULT_DB_CONFIG.database,
        user: (database.user as string) || DEFAULT_DB_CONFIG.user,
        password: database.password ? resolveEnvVars(database.password as string) : undefined,
        ssl: database.ssl as boolean | undefined,
      },
      embedding: {
        provider: provider as "openai" | "e5-local" | "zai",
        model: embedding.model as string | undefined,
        apiKey: embedding.apiKey ? resolveEnvVars(embedding.apiKey as string) : undefined,
        e5Endpoint: embedding.e5Endpoint as string | undefined,
      },
      autoCapture: cfg.autoCapture !== false,
      autoRecall: cfg.autoRecall !== false,
      sessionSummaries: cfg.sessionSummaries === true,
      zaiApiKey: cfg.zaiApiKey ? resolveEnvVars(cfg.zaiApiKey as string) : undefined,
    };
  },
  uiHints: {
    "database.host": { label: "PostgreSQL Host", placeholder: "localhost" },
    "database.port": { label: "Port", placeholder: "5432" },
    "database.database": { label: "Database Name", placeholder: "openclaw_memory" },
    "database.user": { label: "Username", placeholder: "postgres" },
    "database.password": { label: "Password", sensitive: true },
    "embedding.provider": { label: "Embedding Provider" },
    "embedding.apiKey": { label: "API Key", sensitive: true },
    "embedding.model": { label: "Embedding Model", placeholder: "text-embedding-3-small" },
    "embedding.e5Endpoint": { label: "E5 Endpoint", placeholder: "http://127.0.0.1:8765" },
    autoCapture: { label: "Auto-Capture" },
    autoRecall: { label: "Auto-Recall" },
  },
};
