/**
 * Jest setup: write console.log directly to stdout so Jest's console interceptor
 * does not annotate every log line with "at Object.<anonymous> (...)" source info.
 */
const write = process.stdout.write.bind(process.stdout);
global.console.log = (...args: unknown[]): void => {
  write(args.map((a) => String(a)).join(' ') + '\n');
};
