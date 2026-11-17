/**
 * What the hub needs to know to start, watch and close a local app.
 *
 * Every app the hub starts follows the same contract (MyLibrary, ADR-0001): it takes the port as a
 * `--server.port` argument and the session token as an environment variable, answers a readiness
 * URL with `{ "status": "UP" }` once it can be used, and closes gracefully when the shutdown URL
 * receives the token in a header.
 */
export interface AppDefinition {
  /** Key of the app in the hub, also used in the saved sessions. */
  readonly id: string;
  readonly name: string;
  /** Path of the executable, such as `C:\Apps\MinhaLivraria\MinhaLivraria.exe`. */
  readonly executable: string;
  /** The port the app uses when it is free; another free port is chosen otherwise. */
  readonly defaultPort: number;
  /** Address the browser opens once the app is ready, relative to the app. */
  readonly homePath: string;
  readonly readinessPath: string;
  readonly shutdownPath: string;
  /** Environment variable that carries the token of the session. */
  readonly tokenVariable: string;
  /** Header that carries the token to the shutdown URL. */
  readonly tokenHeader: string;
  /** How long the app may take to be ready. */
  readonly startupTimeoutMs: number;
  /** How long the app may take to stop after the shutdown before it is killed. */
  readonly shutdownTimeoutMs: number;
}

/** Minha Livraria, the personal library (github.com/BrunaSanguini/MyLibrary). */
export function minhaLivraria(executable: string): AppDefinition {
  return {
    id: 'minha-livraria',
    name: 'Minha Livraria',
    executable,
    defaultPort: 8471,
    homePath: '/',
    readinessPath: '/actuator/health/readiness',
    shutdownPath: '/actuator/shutdown',
    tokenVariable: 'MINHA_LIVRARIA_SHUTDOWN_TOKEN',
    tokenHeader: 'X-MyCollection-Token',
    startupTimeoutMs: 120_000,
    shutdownTimeoutMs: 30_000,
  };
}
