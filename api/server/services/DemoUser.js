const { logger } = require('@librechat/data-schemas');
const { SystemRoles } = require('librechat-data-provider');
const { findUser, createUser, getUserById } = require('~/models');

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

let cachedUserId = null;
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
async function getDemoUser() {
  logBootWarningOnce();

  if (cachedUserId) {
    const cached = await getUserById(cachedUserId, '-password -__v -totpSecret -backupCodes');
    if (cached) {
      return cached;
    }
    cachedUserId = null;
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

  if (!user || !user._id) {
    throw new Error('[DemoUser] Failed to resolve demo user document');
  }

  cachedUserId = user._id;
  return user;
}

module.exports = {
  isDemoAuthDisabled,
  getDemoUser,
  getDemoEmail,
};
