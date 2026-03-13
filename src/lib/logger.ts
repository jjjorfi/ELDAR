import { env } from "@/lib/env";

export type LogLevel = "info" | "warn" | "error" | "debug";

export type LogEntry = {
  level: LogLevel;
  message: string;
  service?: string;
  traceId?: string;
  durationMs?: number;
  [key: string]: unknown;
};

/**
 * Emits a structured log line suitable for both local debugging and production aggregation.
 */
export function log(entry: LogEntry): void {
  if (entry.level === "debug" && env.NODE_ENV === "production") {
    return;
  }

  const output = JSON.stringify({
    ts: new Date().toISOString(),
    ...entry
  });

  if (entry.level === "error") {
    console.error(output);
    return;
  }

  if (entry.level === "warn") {
    console.warn(output);
    return;
  }

  console.log(output);
}
