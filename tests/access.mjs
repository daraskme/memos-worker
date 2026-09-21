import assert from 'node:assert/strict';
import { generateKeyPair, exportJWK, SignJWT, createLocalJWKSet } from 'jose';
import { verifyAccess, accessConfigured } from '../src/access.js';
import worker from '../src/index.js';
const env = { AUTH_MODE:'cloudflare-access', CF_ACCESS_TEAM_DOMAIN:'https://example-team.cloudflareaccess.com', CF_ACCESS_AUD:'test-app', CF_ACCESS_EMAIL:'owner@example.com' };
const { privateKey, publicKey } = await generateKeyPair('RS256');
const jwk = await exportJWK(publicKey); jwk.kid = 'test';
const keys = createLocalJWKSet({keys:[jwk]});
async function sign(overrides = {}, key = privateKey) {
  return new SignJWT({ email:'owner@example.com', sub:'owner', iss:env.CF_ACCESS_TEAM_DOMAIN, aud:env.CF_ACCESS_AUD, iat:Math.floor(Date.now()/1000), exp:Math.floor(Date.now()/1000)+300, ...overrides }).setProtectedHeader({alg:'RS256',kid:'test'}).sign(key);
}
const req = token => new Request('https://notes.example.com/api/session',{headers:{'Cf-Access-Jwt-Assertion':token}});
assert.equal((await verifyAccess(req(await sign()),env,keys)).email,env.CF_ACCESS_EMAIL);
for (const claims of [{email:'other@example.com'}, {aud:'other-app'}, {iss:'https://evil.example'}, {exp:1}, {exp:undefined}, {email:undefined}]) {
  assert.equal(await verifyAccess(req(await sign(claims)),env,keys),null);
}
const other = await generateKeyPair('RS256');
assert.equal(await verifyAccess(req(await sign({},other.privateKey)),env,keys),null);
assert.equal(await verifyAccess(req('invalid'),env,keys),null);
assert.equal(accessConfigured({...env,CF_ACCESS_AUD:''}),false);
for (const path of ['/api/notes','/api/session','/api/login','/api/public/note/test','/api/public/file/test','/api/telegram_webhook/test']) {
  const response = await worker.fetch(new Request(`https://notes.example.com${path}`,{headers:{Cookie:'__session=legacy','Cf-Access-Authenticated-User-Email':'owner@example.com'}}),env);
  assert.equal(response.status,401,path);
}
assert.equal((await worker.fetch(req('invalid'),{...env,CF_ACCESS_AUD:''})).status,503);
assert.equal((await worker.fetch(req('invalid'),{})).status,503);
const originalFetch = globalThis.fetch;
globalThis.fetch = async url => {
  assert.equal(String(url),`${env.CF_ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`);
  return Response.json({keys:[jwk]});
};
try {
  const signed = await sign();
  const response = await worker.fetch(req(signed),env);
  assert.equal(response.status,200);
  assert.equal((await response.json()).email,env.CF_ACCESS_EMAIL);
  for (const [path,status] of [['/api/login',410],['/api/logout',200]]) {
    const result = await worker.fetch(new Request(`https://notes.example.com${path}`,{method:'POST',headers:{'Cf-Access-Jwt-Assertion':signed}}),env);
    assert.equal(result.status,status);
    if (path.endsWith('/logout')) assert.equal((await result.json()).logoutUrl,'/cdn-cgi/access/logout');
  }
  assert.equal((await worker.fetch(new Request('https://notes.example.com/api/logout',{method:'POST',headers:{'Cf-Access-Jwt-Assertion':signed,Origin:'https://evil.example'}}),env)).status,403);
} finally { globalThis.fetch = originalFetch; }
console.log('PASS Access signed JWT, email, audience, issuer, expiration, signature, fail-closed configuration, legacy cookie and email-header bypass checks');
