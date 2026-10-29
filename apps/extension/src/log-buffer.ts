export type LogLevel = 'info' | 'success' | 'warn' | 'error';

export interface LogEntry {
  id: number;
  at: string;
  level: LogLevel;
  message: string;
  jobId: string | null;
}

export type LogFilter = { minLevel: 'all' | 'warn' | 'error'; jobId: string };

const RANK: Record<LogLevel, number> = { info: 0, success: 0, warn: 1, error: 2 };

/** Ring buffer with a fixed capacity: the oldest entries are dropped first. */
export class LogBuffer {
  private entries: LogEntry[] = [];
  private nextId = 1;
  private listeners = new Set<() => void>();

  constructor(private readonly capacity = 1000) {}

  add(level: LogLevel, message: string, jobId: string | null = null, at = new Date().toISOString()): LogEntry {
    const entry: LogEntry = { id: this.nextId++, at, level, message, jobId };
    this.entries.push(entry);
    if (this.entries.length > this.capacity) this.entries.splice(0, this.entries.length - this.capacity);
    for (const l of this.listeners) l();
    return entry;
  }

  clear(): void {
    this.entries = [];
    for (const l of this.listeners) l();
  }

  onChange(fn: () => void): void {
    this.listeners.add(fn);
  }

  all(): readonly LogEntry[] {
    return this.entries;
  }

  filtered(f: LogFilter): LogEntry[] {
    const min = f.minLevel === 'all' ? 0 : f.minLevel === 'warn' ? 1 : 2;
    return this.entries.filter((e) => RANK[e.level] >= min && (!f.jobId || e.jobId === f.jobId));
  }

  jobIds(): string[] {
    return [...new Set(this.entries.map((e) => e.jobId).filter((x): x is string => x !== null))];
  }
}

export function formatLogLine(e: LogEntry): string {
  const t = e.at.slice(11, 19);
  const job = e.jobId ? ` [#${e.jobId.slice(0, 8)}]` : '';
  return `${t} ${e.level.toUpperCase().padEnd(7)}${job} ${e.message}`;
}
