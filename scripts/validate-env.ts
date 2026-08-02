/**
 * Valide la configuration d'environnement (Zod) sans démarrer Next.
 * Usage:
 *   NODE_ENV=production ... npx tsx scripts/validate-env.ts
 *   npm run env:validate
 */
import "dotenv/config";
import { getEnv, resetEnvCache } from "../src/lib/config/env";
import { maskSmtpHost, resolveMailConnectorConfig } from "../src/lib/mail/providers";

resetEnvCache();

try {
  const env = getEnv();
  const connector = resolveMailConnectorConfig();
  console.log(
    JSON.stringify(
      {
        ok: true,
        nodeEnv: env.NODE_ENV,
        dryRun: env.DRY_RUN,
        productionSendingEnabled: env.PRODUCTION_SENDING_ENABLED,
        appUrl: env.APP_URL,
        authSecretLength: env.AUTH_SECRET.length,
        webhookSecretLength: env.WEBHOOK_SECRET.length,
        hasPreviousAuthSecret: Boolean(env.AUTH_SECRET_PREVIOUS),
        cspEnabled: env.CSP_ENABLED,
        mailConnector: {
          id: connector.connectorId,
          hostMasked: maskSmtpHost(connector.host),
          port: connector.port,
          encryption: connector.encryption,
          requireTls: connector.requireTls,
          hostSource: connector.hostSource,
          credentialsConfigured: connector.credentialsConfigured,
        },
        loginRateLimit: {
          max: env.LOGIN_RATE_LIMIT_MAX,
          windowMs: env.LOGIN_RATE_LIMIT_WINDOW_MS,
        },
      },
      null,
      2,
    ),
  );
  process.exit(0);
} catch (error) {
  console.error(
    JSON.stringify(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      null,
      2,
    ),
  );
  process.exit(1);
}
