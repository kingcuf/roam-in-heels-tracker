/**
 * Profile pictures.
 *
 * One object per account in the same private R2 bucket as guest IDs, keyed by
 * user id (the built-in owner is id 0, which has no users row — that is why the
 * key, not a users column, is the source of truth). Nothing is served from a
 * bucket URL; getAvatar streams it back to a signed-in caller.
 *
 * The object's upload time doubles as the version the app appends to the image
 * URL, so a new photo is not hidden behind a cached old one.
 */

const MAX_BYTES = 3 * 1024 * 1024;   // a cropped, compressed square is ~100–400 KB
const ALLOWED = /^image\/(jpeg|png|webp|heic|heif)$/i;
const PREFIX = 'avatars/';
const keyFor = (userId) => PREFIX + Number(userId);

export class AvatarError extends Error {}
const fail = (m) => { throw new AvatarError(m); };

/* Only ever the caller's own picture — there is no id parameter to abuse. */
export async function uploadAvatar(env, me, file) {
  if (!env.FILES) fail('File storage is not configured');
  if (!file || typeof file.arrayBuffer !== 'function') fail('No file received');
  const type = String(file.type || '');
  if (!ALLOWED.test(type)) fail('Profile picture must be a JPEG, PNG, WebP or HEIC image');
  const buf = await file.arrayBuffer();
  if (!buf.byteLength) fail('File is empty');
  if (buf.byteLength > MAX_BYTES) fail('Image is too large (max 3 MB)');
  const obj = await env.FILES.put(keyFor(me.id), buf, { httpMetadata: { contentType: type } });
  return { ok: true, message: 'Profile picture updated', avatarAt: obj.uploaded.getTime() };
}

export async function deleteAvatar(env, me) {
  if (env.FILES) await env.FILES.delete(keyFor(me.id));
  return { ok: true, message: 'Profile picture removed', avatarAt: 0 };
}

export async function getAvatar(env, userId) {
  if (!Number.isInteger(userId) || userId < 0) fail('Invalid user');
  if (!env.FILES) fail('File storage is not configured');
  const obj = await env.FILES.get(keyFor(userId));
  if (!obj) return new Response('Not found', { status: 404, headers: { 'Access-Control-Allow-Origin': '*' } });
  return new Response(obj.body, {
    headers: {
      'Content-Type': obj.httpMetadata?.contentType || 'image/jpeg',
      /* The URL carries the version, so a private cache is safe and saves a
         round-trip on every Users-list render. */
      'Cache-Control': 'private, max-age=86400',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

/* Upload time for one account (0 = no picture). */
export async function avatarAt(env, userId) {
  if (!env.FILES) return 0;
  const h = await env.FILES.head(keyFor(userId));
  return h ? h.uploaded.getTime() : 0;
}

/* Upload times for every account in one listing, for the Users screen. */
export async function avatarMap(env) {
  const out = {};
  if (!env.FILES) return out;
  let cursor;
  do {
    const page = await env.FILES.list({ prefix: PREFIX, cursor });
    for (const o of page.objects) out[o.key.slice(PREFIX.length)] = o.uploaded.getTime();
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return out;
}
