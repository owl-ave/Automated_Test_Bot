export class Logger {
  private context: string;

  constructor(context: string) {
    this.context = context;
  }

  log(msg: string, data?: unknown): void {
    console.log(
      JSON.stringify({ timestamp: new Date().toISOString(), level: 'INFO', context: this.context, msg, data }),
    );
  }

  error(msg: string, error?: unknown): void {
    console.error(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: 'ERROR',
        context: this.context,
        msg,
        error: String(error),
      }),
    );
  }

  warn(msg: string, data?: unknown): void {
    console.warn(
      JSON.stringify({ timestamp: new Date().toISOString(), level: 'WARN', context: this.context, msg, data }),
    );
  }

  debug(msg: string, data?: unknown): void {
    if (process.env.DEBUG) {
      console.log(
        JSON.stringify({ timestamp: new Date().toISOString(), level: 'DEBUG', context: this.context, msg, data }),
      );
    }
  }
}
