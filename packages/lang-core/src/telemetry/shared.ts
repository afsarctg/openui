// Browser-safe primitives shared by runtime and installation telemetry.
export const POSTHOG_KEY = "phc_3OLW53x09ZTVZSV6BEpj5uycj3ooqR6KOemOjx04e3D";
export const POSTHOG_HOST = "https://dgoeivjus9jfp.cloudfront.net";
export const TELEMETRY_REQUEST_TIMEOUT_MS = 2_000;
export const TELEMETRY_SCHEMA_VERSION = 1;

export type TelemetryEnvironment = Readonly<Record<string, string | undefined>>;

export function getPostHogConfig(env?: TelemetryEnvironment): {
  apiKey: string;
  captureUrl: string;
} {
  const host = env?.["OPENUI_POSTHOG_HOST"] ?? POSTHOG_HOST;
  return {
    apiKey: env?.["OPENUI_POSTHOG_KEY"] ?? POSTHOG_KEY,
    captureUrl: new URL("/capture/", host).toString(),
  };
}

export function isTruthyEnv(value?: string): boolean {
  return value === "1" || value?.toLowerCase() === "true";
}

export function isTelemetryDisabled(env?: TelemetryEnvironment): boolean {
  return isTruthyEnv(env?.["OPENUI_TELEMETRY_DISABLED"]) || isTruthyEnv(env?.["DO_NOT_TRACK"]);
}

/** Runtime telemetry is opt-in: it requires explicit consent and honors the disable flags. */
export function isRuntimeTelemetryEnabled(env?: TelemetryEnvironment): boolean {
  return isTruthyEnv(env?.["OPENUI_RUNTIME_TELEMETRY_ENABLED"]) && !isTelemetryDisabled(env);
}

export { normalizeProjectIdentity } from "../../../../shared/telemetry/project-identity.cjs";
