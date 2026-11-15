// `docker stop` sends SIGTERM, then SIGKILL 10 s later; leave room to exit before that.
const GRACE_MS = 8000;

type Options = {
  /** How long in-flight requests get to finish before the process exits anyway. */
  graceMs?: number;
  exit?: (code: number) => void;
  /** Where the signals come from (a test passes an EventEmitter). */
  signals?: Pick<NodeJS.EventEmitter, "once">;
};

/**
 * On SIGTERM or SIGINT, stops taking connections, lets in-flight requests (an upload,
 * say) finish and closes the database through the app's onClose hooks, then exits 0.
 * If closing outlasts `graceMs`, or fails, it exits 1 rather than wait for SIGKILL.
 */
export function closeOnSignals(app: { close(): Promise<unknown> }, o: Options = {}): void {
  const graceMs = o.graceMs ?? GRACE_MS;
  const exit = o.exit ?? ((code: number) => process.exit(code));
  const signals = o.signals ?? process;
  let closing = false;

  const onSignal = (signal: string) => {
    if (closing) return;
    closing = true;
    console.log(`${signal}: closing`);
    const timer = setTimeout(() => {
      console.error(`Still closing after ${graceMs} ms; exiting anyway.`);
      exit(1);
    }, graceMs);
    app.close().then(
      () => {
        clearTimeout(timer);
        exit(0);
      },
      (err: unknown) => {
        clearTimeout(timer);
        console.error(err);
        exit(1);
      },
    );
  };
  for (const signal of ["SIGTERM", "SIGINT"]) signals.once(signal, onSignal);
}
