const cookies = require('cookie');
const passport = require('passport');
const { isEnabled, tenantContextMiddleware } = require('@librechat/api');
const { isDemoAuthDisabled, getDemoUser } = require('~/server/services/DemoUser');

/**
 * Custom Middleware to handle JWT authentication, with support for OpenID token reuse.
 * Switches between JWT and OpenID authentication based on cookies and environment settings.
 *
 * After successful authentication (req.user populated), automatically chains into
 * `tenantContextMiddleware` to propagate `req.user.tenantId` into AsyncLocalStorage
 * for downstream Mongoose tenant isolation.
 *
 * When LATENCE_DEMO_DISABLE_AUTH=true the entire passport flow is bypassed and
 * every request is attributed to the shared demo user (see services/DemoUser.js).
 */
const requireJwtAuth = (req, res, next) => {
  if (isDemoAuthDisabled()) {
    getDemoUser()
      .then((user) => {
        req.user = user;
        return tenantContextMiddleware(req, res, next);
      })
      .catch((err) => next(err));
    return;
  }

  const cookieHeader = req.headers.cookie;
  const tokenProvider = cookieHeader ? cookies.parse(cookieHeader).token_provider : null;

  const strategy =
    tokenProvider === 'openid' && isEnabled(process.env.OPENID_REUSE_TOKENS) ? 'openidJwt' : 'jwt';

  passport.authenticate(strategy, { session: false })(req, res, (err) => {
    if (err) {
      return next(err);
    }
    // req.user is now populated by passport — set up tenant ALS context
    tenantContextMiddleware(req, res, next);
  });
};

module.exports = requireJwtAuth;
