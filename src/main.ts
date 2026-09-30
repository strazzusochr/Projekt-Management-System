import { App } from './core/App';

const root = document.getElementById('app')!;
const captured: string[] = [];
const origError = console.error.bind(console);
console.error = (...args: unknown[]) => {
  captured.push(args.map((a) => (a instanceof Error ? a.message : String(a))).join(' '));
  origError(...args);
};
window.addEventListener('error', (e) => captured.push(`window.onerror: ${e.message}`));
window.addEventListener('unhandledrejection', (e) => captured.push(`unhandledrejection: ${String((e.reason as Error)?.message ?? e.reason)}`));

const app = new App(root);
Object.defineProperty(app, 'errors', { get: () => captured });
app.start().catch((err) => {
  console.error('[Riverbound] Start fehlgeschlagen', err);
  App.renderFatal(root, err);
});
