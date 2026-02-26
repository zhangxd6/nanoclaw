import fs from 'fs';
import path from 'path';
import { logger } from './logger.js';

/**
 * Parse the .env file and return values for the requested keys.
 * Does NOT load anything into process.env — callers decide what to
 * do with the values. This keeps secrets out of the process environment
 * so they don't leak to child processes.
 */
export function readEnvFile(keys: string[]): Record<string, string> {
  const envFile = path.join(process.cwd(), '.env');
  let content: string;
  try {
    content = fs.readFileSync(envFile, 'utf-8');
  } catch (err) {
    logger.debug({ err }, '.env file not found, using defaults');
    return {};
  }

  const result: Record<string, string> = {};
  const wanted = new Set(keys);

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    if (!wanted.has(key)) continue;
    let value = trimmed.slice(eqIdx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (value) result[key] = value;
  }

  return result;
}

/**
 * Get the base URL for Anthropic-compatible API (for LM Studio or other providers).
 * Uses host.docker.internal for Docker, /host_socket for Apple Container.
 */
export function getAnthropicBaseUrl(): string | undefined {
  // Check for explicit ANTHROPIC_BASE_URL first
  if (process.env.ANTHROPIC_BASE_URL) {
    return process.env.ANTHROPIC_BASE_URL;
  }

  // Check for LM Studio on Docker (host.docker.internal)
  const lmStudioPort = process.env.LM_STUDIO_PORT || '1234';
  return `http://host.docker.internal:${lmStudioPort}`;
}

/**
 * Get the model name to use.
 * For LM Studio with Qwen models, set CLAUDE_MODEL env var.
 */
export function getModelName(): string | undefined {
  if (process.env.CLAUDE_MODEL) {
    return process.env.CLAUDE_MODEL;
  }
  // Default to Claude Sonnet for Anthropic API
  return 'claude-sonnet-4-6';
}
