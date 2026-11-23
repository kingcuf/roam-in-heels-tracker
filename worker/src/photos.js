/**
 * Unit photo albums — the pictures you send a guest who asks "what does the
 * flat look like?". One album per property.
 *
 * Storage: the existing attachments table + R2 bucket, entity_type 'property',
 * kind 'property_photo', entity_id = the property's ROWID. Not its id or name:
 * both can be edited (updateProperty renames them), the rowid never changes, so
 * an album survives a rename with nothing to re-point. No migration needed.
 *
 * Sharing: signed-in users stream photos through getAttachment as usual. For a
 * guest, each album also has a public page (?action=album) behind an HMAC token
 * — unguessable, but deliberately no login: it is the link you WhatsApp to
 * someone who is not a user. Only photos in THAT album are reachable with it.
 */

const MAX_PHOTOS = 60;
const MAX_BYTES = 12 * 1024 * 1024;
const ALLOWED = /^image\/(jpeg|png|webp|heic|heif)$/i;
const today = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);

class PhotoError extends Error {}
const fail = (m) => { throw new PhotoError(m); };
export { PhotoError };

async function tokenFor(env, rowid) {
  const secret = String(env.MIRROR_SECRET || env.PIN || 'spira');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode('album:' + secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode('album/' + rowid));
  return [...new Uint8Array(sig)].slice(0, 12).map((b) => b.toString(16).padStart(2, '0')).join('');
}
function same(a, b) {   // constant-time-ish compare of two hex strings
  a = String(a || ''); b = String(b || '');
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

async function rowidOf(env, name) {
  const r = await env.DB.prepare('SELECT rowid AS rid FROM properties WHERE name = ?').bind(String(name || '')).first();
  if (!r) fail('Unknown property: ' + name);
  return r.rid;
}

/* For getLogs: [{ property, album, photos: [{id, type, name}] }] for every unit. */
export async function photosData(env, origin) {
  const props = await env.DB.prepare('SELECT rowid AS rid, name FROM properties ORDER BY sort, rowid').all();
  const { results } = await env.DB.prepare(
    `SELECT id, entity_id, filename, content_type FROM attachments
      WHERE entity_type = 'property' AND kind = 'property_photo' ORDER BY id`).all();
  const by = {};
  for (const r of results || []) (by[r.entity_id] = by[r.entity_id] || []).push({ id: r.id, type: r.content_type, name: r.filename });
  const out = [];
  for (const p of props.results || []) {
    out.push({
      property: p.name,
      album: `${origin}/?action=album&p=${p.rid}&t=${await tokenFor(env, p.rid)}`,
      photos: by[p.rid] || [],
    });
  }
  return out;
}

export async function uploadPropertyPhoto(env, me, property, file) {
  if (!me.isAdmin) fail('Only an Admin can change a unit’s photos');
  if (!file || typeof file.arrayBuffer !== 'function') fail('No file received');
  if (!env.FILES) fail('File storage is not configured');
  const rid = await rowidOf(env, property);
  const n = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM attachments WHERE entity_type = 'property' AND entity_id = ? AND kind = 'property_photo'`
  ).bind(rid).first();
  if ((n && n.n) >= MAX_PHOTOS) fail(`A unit can hold at most ${MAX_PHOTOS} photos`);
  const type = String(file.type || '');
  if (!ALLOWED.test(type)) fail('Only photos (JPEG, PNG, WebP, HEIC) can be added');
  const buf = await file.arrayBuffer();
  if (!buf.byteLength) fail('File is empty');
  if (buf.byteLength > MAX_BYTES) fail('Photo is too large (max 12 MB)');
  const safe = String(file.name || 'photo').replace(/[^A-Za-z0-9._-]/g, '_').slice(-60);
  const key = `properties/${rid}/${Date.now()}-${safe}`;
  await env.FILES.put(key, buf, { httpMetadata: { contentType: type } });
  await env.DB.prepare(
    `INSERT INTO attachments (entity_type, entity_id, kind, slot, r2_key, filename, content_type, size_bytes, uploaded_at)
     VALUES ('property', ?, 'property_photo', '', ?, ?, ?, ?, ?)`
  ).bind(rid, key, String(file.name || ''), type, buf.byteLength, today()).run();
  return { ok: true, message: 'Photo added' };
}

export async function deletePropertyPhoto(env, me, id) {
  if (!me.isAdmin) fail('Only an Admin can change a unit’s photos');
  const row = await env.DB.prepare(
    `SELECT r2_key FROM attachments WHERE id = ? AND entity_type = 'property' AND kind = 'property_photo'`).bind(id).first();
  if (!row) fail('Photo not found');
  if (env.FILES) { try { await env.FILES.delete(row.r2_key); } catch {} }
  await env.DB.prepare('DELETE FROM attachments WHERE id = ?').bind(id).run();
  return { ok: true, message: 'Photo removed' };
}

/* When a property itself is deleted: its album goes with it. */
export async function deletePropertyPhotos(env, propertyId) {
  const r = await env.DB.prepare('SELECT rowid AS rid FROM properties WHERE id = ?').bind(propertyId).first();
  if (!r) return;
  const { results } = await env.DB.prepare(
    `SELECT id, r2_key FROM attachments WHERE entity_type = 'property' AND entity_id = ? AND kind = 'property_photo'`).bind(r.rid).all();
  for (const x of results || []) { if (env.FILES) { try { await env.FILES.delete(x.r2_key); } catch {} } }
  await env.DB.prepare(`DELETE FROM attachments WHERE entity_type = 'property' AND entity_id = ? AND kind = 'property_photo'`).bind(r.rid).run();
}

/* ── Public album (no sign-in; token-gated) ── */
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export async function albumPage(env, p, origin) {
  const rid = Number(p.p);
  const notFound = () => new Response('This album link is not valid.', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  if (!rid || !same(p.t, await tokenFor(env, rid))) return notFound();
  const prop = await env.DB.prepare('SELECT name, location FROM properties WHERE rowid = ?').bind(rid).first();
  if (!prop) return notFound();
  const { results } = await env.DB.prepare(
    `SELECT id FROM attachments WHERE entity_type = 'property' AND entity_id = ? AND kind = 'property_photo' ORDER BY id`).bind(rid).all();
  const img = (id) => `${origin}/?action=albumImg&p=${rid}&t=${esc(p.t)}&id=${id}`;
  const unit = (String(prop.name).match(/\d{3,4}/) || [prop.name])[0];
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="robots" content="noindex,nofollow">
<title>Unit ${esc(unit)} · Roam in Heels</title>
<meta property="og:title" content="Unit ${esc(unit)} · Roam in Heels">
${results.length ? `<meta property="og:image" content="${img(results[0].id)}">` : ''}
<style>
:root{color-scheme:light}
body{margin:0;font:15px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#F7F3EC;color:#16161A}
header{padding:28px 18px 14px;max-width:960px;margin:0 auto}
.k{font-size:11px;letter-spacing:.16em;color:#9A6A2B;font-weight:700}
h1{font-size:30px;margin:2px 0 2px;letter-spacing:-.02em}
.s{color:#6E6E76;font-size:14px}
main{max-width:960px;margin:0 auto;padding:0 12px 40px;display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:10px}
main a{display:block;border-radius:14px;overflow:hidden;background:#e9e3d8;aspect-ratio:4/3}
main img{width:100%;height:100%;object-fit:cover;display:block}
footer{text-align:center;color:#9A99A1;font-size:12px;padding:0 16px 32px}
</style></head><body>
<header><div class="k">ROAM IN HEELS</div><h1>Unit ${esc(unit)}</h1>
<div class="s">${esc(prop.name)}${prop.location ? ' · ' + esc(prop.location) : ''} · ${results.length} photo${results.length === 1 ? '' : 's'}</div></header>
<main>${results.map((r) => `<a href="${img(r.id)}" target="_blank" rel="noopener"><img loading="lazy" src="${img(r.id)}" alt="Unit ${esc(unit)}"></a>`).join('')}</main>
<footer>Tap a photo to see it full size.</footer>
</body></html>`;
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'private, max-age=300', 'X-Robots-Tag': 'noindex' } });
}

export async function albumImage(env, p) {
  const rid = Number(p.p);
  if (!rid || !same(p.t, await tokenFor(env, rid))) return new Response('Not found', { status: 404 });
  const row = await env.DB.prepare(
    `SELECT r2_key, content_type FROM attachments WHERE id = ? AND entity_type = 'property' AND entity_id = ? AND kind = 'property_photo'`
  ).bind(Number(p.id), rid).first();
  if (!row || !env.FILES) return new Response('Not found', { status: 404 });
  const obj = await env.FILES.get(row.r2_key);
  if (!obj) return new Response('Not found', { status: 404 });
  return new Response(obj.body, { headers: { 'Content-Type': row.content_type || 'image/jpeg', 'Cache-Control': 'public, max-age=86400' } });
}
