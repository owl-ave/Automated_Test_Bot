const TOKEN_PATTERNS: RegExp[] = [
  /sk-ant-[A-Za-z0-9_-]+/g,
  /Bearer\s+[A-Za-z0-9._-]+/gi,
  /gh[pousr]_[A-Za-z0-9]{20,}/g,
];
const SENSITIVE_KEY = /authori[sz]ation|api[_-]?key|access[_-]?key|secret|password|token/i;

function redactString(s: string): string {
  let out = s;
  for (const re of TOKEN_PATTERNS) out = out.replace(re, '[REDACTED]');
  return out;
}

function redact(value: unknown, depth = 0): unknown {
  if (depth > 6 || value === undefined || value === null) return value;
  if (typeof value === 'string') return redactString(value);
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SENSITIVE_KEY.test(k) ? '[REDACTED]' : redact(v, depth + 1);
  }
  return out;
}

function serializeSafe(value: unknown): unknown {
  if (value === undefined || value === null) return value;
  if (value instanceof Error) {
    return {
      message: redactString(value.message),
      stack: value.stack?.split('\n').slice(0, 3).map(redactString).join('\n'),
    };
  }
  if (typeof value === 'object') {
    try { JSON.stringify(value); return redact(value); } catch { return redactString(String(value)); }
  }
  if (typeof value === 'string') return redactString(value);
  return value;
}

export class Logger {
  private context: string;

  constructor(context: string) {
    this.context = context;
  }

  log(msg: string, data?: unknown): void {
    console.log(
      JSON.stringify({ timestamp: new Date().toISOString(), level: 'INFO', context: this.context, msg, data: serializeSafe(data) }),
    );
  }

  error(msg: string, error?: unknown): void {
    console.error(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: 'ERROR',
        context: this.context,
        msg,
        error: serializeSafe(error),
      }),
    );
  }

  warn(msg: string, data?: unknown): void {
    console.warn(
      JSON.stringify({ timestamp: new Date().toISOString(), level: 'WARN', context: this.context, msg, data: serializeSafe(data) }),
    );
  }

  debug(msg: string, data?: unknown): void {
    if (process.env.DEBUG) {
      console.log(
        JSON.stringify({ timestamp: new Date().toISOString(), level: 'DEBUG', context: this.context, msg, data: serializeSafe(data) }),
      );
    }
  }
}
