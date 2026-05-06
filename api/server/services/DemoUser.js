const { logger } = require('@librechat/data-schemas');
const { SystemRoles } = require('librechat-data-provider');
const { findUser, createUser } = require('~/models');

/**
 * Latence TRACE demo "no-auth" mode.
 *
 * When LATENCE_DEMO_DISABLE_AUTH=true the LibreChat backend skips the
 * passport-jwt flow and treats every request as the shared demo user
 * (configurable via LATENCE_DEMO_USER_EMAIL / LATENCE_DEMO_USER_NAME).
 * Frontend silent-refresh calls AuthController.refreshController which
 * also short-circuits here, so no login screen is ever shown.
 *
 * The user is created on first request (or reused if already in Mongo)
 * and cached in-memory so subsequent requests skip the DB round-trip.
 */
const DEFAULT_DEMO_EMAIL = 'demo+trace@latence.ai';
const DEFAULT_DEMO_NAME = 'Latence TRACE Demo';
const DEFAULT_DEMO_USERNAME = 'latence-trace-demo';

let cachedUser = null;
let warned = false;

/**
 * Returns true when the demo no-auth mode is enabled via env.
 */
function isDemoAuthDisabled() {
  const raw = process.env.LATENCE_DEMO_DISABLE_AUTH;
  if (!raw) {
    return false;
  }
  return ['1', 'true', 'yes', 'on'].includes(String(raw).toLowerCase());
}

function getDemoEmail() {
  return (process.env.LATENCE_DEMO_USER_EMAIL || DEFAULT_DEMO_EMAIL).trim().toLowerCase();
}

function getDemoName() {
  return process.env.LATENCE_DEMO_USER_NAME || DEFAULT_DEMO_NAME;
}

function logBootWarningOnce() {
  if (warned) return;
  warned = true;
  logger.warn(
    `[DemoUser] LATENCE_DEMO_DISABLE_AUTH=true — auth is disabled, every request is treated as ${getDemoEmail()}. ` +
      `Do NOT enable this in a non-demo environment.`,
  );
}

/**
 * Resolve (and lazily create) the shared demo user document.
 * Returns the full user document (lean) so downstream code can
 * use _id, role, tenantId, email, etc.
 */
/**
 * Mirror what `jwtStrategy.js` does to a freshly fetched lean user doc:
 * stringify `_id` into the virtual `id`, default the role, and stringify
 * `tenantId` so AsyncLocalStorage / Mongo filters can compare without
 * surprises. Downstream LibreChat code (BaseClient, controllers, prompts,
 * transactions) reads `req.user.id`, never `_id`.
 */
function normalizeDemoUser(user) {
  if (!user || !user._id) {
    throw new Error('[DemoUser] Failed to resolve demo user document');
  }
  user.id = user._id.toString();
  if (!user.role) {
    user.role = SystemRoles.USER;
  }
  if (user.tenantId && typeof user.tenantId !== 'string') {
    user.tenantId = String(user.tenantId);
  }
  return user;
}

async function getDemoUser() {
  logBootWarningOnce();

  if (cachedUser) {
    return cachedUser;
  }

  const email = getDemoEmail();
  let user = await findUser({ email }, '-password -__v -totpSecret -backupCodes');

  if (!user) {
    const name = getDemoName();
    logger.info(`[DemoUser] Creating demo user ${email}`);
    const created = await createUser(
      {
        email,
        name,
        username: DEFAULT_DEMO_USERNAME,
        provider: 'local',
        emailVerified: true,
        role: SystemRoles.USER,
      },
      undefined,
      true,
      true,
    );
    user = created && typeof created === 'object' && '_id' in created
      ? created
      : await findUser({ email }, '-password -__v -totpSecret -backupCodes');
  }

  cachedUser = normalizeDemoUser(user);
  logger.info(
    `[DemoUser] Resolved demo user id=${cachedUser.id} email=${cachedUser.email} role=${cachedUser.role}`,
  );
  return cachedUser;
}

/** Reset the in-memory cache (useful for tests / hot reload). */
function resetDemoUserCache() {
  cachedUser = null;
}

module.exports = {
  isDemoAuthDisabled,
  getDemoUser,
  getDemoEmail,
  resetDemoUserCache,
};
