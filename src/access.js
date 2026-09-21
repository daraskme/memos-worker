import { createRemoteJWKSet, jwtVerify } from 'jose';

const keySets = new Map();

export function accessConfigured(env) {
  return /^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(env.CF_ACCESS_TEAM_DOMAIN || '')
    && Boolean(env.CF_ACCESS_AUD && env.CF_ACCESS_EMAIL);
}

// Authenticate the signed assertion, never the user-controlled email header.
export async function verifyAccess(request, env, keySet) {
  if (!accessConfigured(env)) return null;
  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token) return null;
  try {
    if (!keySet) {
      if (!keySets.has(env.CF_ACCESS_TEAM_DOMAIN)) {
        keySets.set(env.CF_ACCESS_TEAM_DOMAIN, createRemoteJWKSet(new URL(`${env.CF_ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`)));
      }
      keySet = keySets.get(env.CF_ACCESS_TEAM_DOMAIN);
    }
    const { payload } = await jwtVerify(token, keySet, {
      issuer: env.CF_ACCESS_TEAM_DOMAIN,
      audience: env.CF_ACCESS_AUD,
      algorithms: ['RS256'],
      requiredClaims: ['exp', 'iat', 'sub', 'email'],
    });
    if (typeof payload.email !== 'string' || payload.email.toLowerCase() !== env.CF_ACCESS_EMAIL.toLowerCase()) return null;
    return { email: payload.email, username: payload.email, subject: payload.sub };
  } catch {
    return null;
  }
}
