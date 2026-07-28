import fp from 'fastify-plugin';
import { verifyToken } from '@clerk/backend';

export const authPlugin = fp(async (app) => {
  app.decorateRequest('principal', null);

  app.addHook('onRequest', async (request, reply) => {
    const path = request.url.split('?')[0] ?? '/';
    if (path.startsWith('/health') || path.startsWith('/docs')) return;

    const authHeader = request.headers.authorization;
    const devUser = request.headers['x-dev-user-id'];
    const devEmail = request.headers['x-dev-user-email'];

    if (!authHeader) {
      if (app.config.NODE_ENV !== 'production' && typeof devUser === 'string' && devUser.length > 0) {
        request.principal = {
          clerkUserId: devUser,
          email: typeof devEmail === 'string' ? devEmail : null
        };
        return;
      }

      reply.code(401).send({ error: 'Missing Authorization header', requestId: request.id });
      return;
    }

    if (!app.config.CLERK_SECRET_KEY && !app.config.CLERK_JWT_KEY) {
      reply.code(500).send({ error: 'Clerk verification is not configured', requestId: request.id });
      return;
    }

    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!token) {
      reply.code(401).send({ error: 'Invalid Authorization header', requestId: request.id });
      return;
    }

    try {
      const verificationKey = app.config.CLERK_JWT_KEY?.trim();
      const authorizedParties = [
        ...new Set([
          ...app.config.CLERK_AUTHORIZED_PARTIES.split(',').map((value) => value.trim()),
          // The current Render static-site URL remains valid while the legacy
          // Blueprint is repointed to this repository.
          'https://teacheros-aidan-web.onrender.com'
        ])
      ];
      const tokenClaims = await verifyToken(token, {
        // Prefer the instance's public JWT key. It avoids a runtime lookup and
        // is safer to deploy than a long-lived backend secret.
        ...(verificationKey
          ? { jwtKey: verificationKey }
          : { secretKey: app.config.CLERK_SECRET_KEY?.trim() }),
        authorizedParties
      });

      request.principal = {
        clerkUserId: tokenClaims.sub,
        email: typeof tokenClaims.email === 'string' ? tokenClaims.email : null
      };
    } catch (error) {
      const clerkError = error as { message?: unknown; code?: unknown };
      request.log.warn(
        {
          clerkErrorCode: typeof clerkError.code === 'string' ? clerkError.code : undefined,
          clerkErrorMessage:
            typeof clerkError.message === 'string' ? clerkError.message : 'Unknown Clerk token verification error'
        },
        'Clerk token verification failed'
      );
      reply.code(401).send({ error: 'Invalid authentication token', requestId: request.id });
    }
  });
});
