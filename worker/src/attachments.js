/**
 * Guest ID documents — R2 storage behind the Worker's PIN check.
 *
 * Container model: the BOOKING is the container (attachments.entity_id), and
 * `slot` identifies both the guest and the side of their ID:
 *   lead | co            front of that guest's document (the required side)
 *   lead-back | co-back  the reverse, where the document has one
 *
 * The bucket is private. Nothing here ever returns an R2 URL — downloads are
 * streamed back through the Worker so an identity document is never sitting on
 * a guessable public address.
 */

/* The IST day, not the UTC one: `new Date().toISOString().slice(0,10)` stamped
   an upload made between midnight and 05:30 IST with the previous date, and
   that date is what the ID list shows beside the file. Kept local rather than
   imported from index.js, which already imports this module. */
const todayISO = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);

const MAX_BYTES = 12 * 1024 * 1024;          // 12 MB — comfortably above a phone photo or PDF scan
const ALLOWED = /^(image\/(jpeg|png|heic|heif|webp)|application\/pdf)$/i;
/* 'lead'/'co' are the FRONT of each guest's ID; '-back' the reverse side.
   One object per slot, so replacing a side never disturbs the other. */
/* lead / co = guests 1–2; g3 … g12 = further guests (bookings.extra_guests).
   Each has a front and an optional '-back'. */
const SLOTS = new Set(['lead', 'co', ...Array.from({ length: 10 }, (_, i) => 'g' + (i + 3))]
  .flatMap((f) => [f, f + '-back']));

class AttachError extends Error {}
const fail = (m) => { throw new AttachError(m); };

/* Object keys are namespaced by booking and slot, with a timestamp so replacing
   a document never silently overwrites the previous object mid-request. */
function objectKey(bookingRow, slot, filename) {
  const safe = String(filename || 'upload').replace(/[^A-Za-z0-9._-]/g, '_').slice(-60);
  return `bookings/${bookingRow}/${slot}-${Date.now()}-${safe}`;
}

/* Per-booking upload state, used by the Action tab's "IDs pending" list.
   Returns { [bookingRow]: ['lead','co'] } — only slots that actually have a
   document, so the client can compute what is still missing. */
export async function idStatus(env) {
  const { results } = await env.DB.prepare(
    `SELECT entity_id, slot FROM attachments
      WHERE entity_type = 'booking' AND kind = 'id_proof' AND slot <> ''`
  ).all();
  const map = {};
  for (const r of results) {
    const k = String(r.entity_id);
    (map[k] = map[k] || []).push(r.slot);
  }
  return map;
}

/* Like idStatus, but carrying the attachment id so a client can render the
   document itself (the Action tab shows the lead guest's ID photo as the card's
   avatar). Kept as a separate action rather than widening idStatus: the deployed
   web build consumes that shape, and changing it under a live client to save one
   round trip is not a trade worth making. */
export async function idDocs(env) {
  const { results } = await env.DB.prepare(
    `SELECT id, entity_id, slot, content_type FROM attachments
      WHERE entity_type = 'booking' AND kind = 'id_proof' AND slot <> ''
      ORDER BY id`
  ).all();
  const map = {};
  for (const r of results) {
    const k = String(r.entity_id);
    (map[k] = map[k] || []).push({ id: r.id, slot: r.slot, type: r.content_type });
  }
  return map;
}

export async function listAttachments(env, bookingRow) {
  if (!bookingRow) fail('Booking is required');
  const { results } = await env.DB.prepare(
    `SELECT id, slot, filename, content_type, size_bytes, uploaded_at
       FROM attachments
      WHERE entity_type = 'booking' AND entity_id = ? AND kind = 'id_proof'
      ORDER BY id`
  ).bind(bookingRow).all();
  return results;
}

export async function uploadAttachment(env, bookingRow, slot, file) {
  if (!bookingRow) fail('Booking is required');
  if (!SLOTS.has(slot)) fail('Invalid guest slot: ' + slot);
  if (!file || typeof file.arrayBuffer !== 'function') fail('No file received');
  if (!env.FILES) fail('File storage is not configured');

  const booking = await env.DB.prepare('SELECT id FROM bookings WHERE id = ?').bind(bookingRow).first();
  if (!booking) fail('Booking not found');

  const type = String(file.type || '');
  if (!ALLOWED.test(type)) fail('Only images or PDF files are accepted');
  const buf = await file.arrayBuffer();
  if (buf.byteLength > MAX_BYTES) fail('File is too large (max 12 MB)');
  if (!buf.byteLength) fail('File is empty');

  const key = objectKey(bookingRow, slot, file.name);
  await env.FILES.put(key, buf, { httpMetadata: { contentType: type } });

  /* One document per guest slot: replacing an ID should not leave the old
     object orphaned in the bucket, so remove any previous one after the new
     upload has succeeded. */
  const prev = await env.DB.prepare(
    `SELECT id, r2_key FROM attachments
      WHERE entity_type='booking' AND entity_id=? AND kind='id_proof' AND slot=?`
  ).bind(bookingRow, slot).all();

  await env.DB.prepare(
    `INSERT INTO attachments (entity_type, entity_id, kind, slot, r2_key,
                              filename, content_type, size_bytes, uploaded_at)
     VALUES ('booking', ?, 'id_proof', ?, ?, ?, ?, ?, ?)`
  ).bind(bookingRow, slot, key, String(file.name || ''), type, buf.byteLength,
         todayISO()).run();

  for (const p of prev.results || []) {
    try { await env.FILES.delete(p.r2_key); } catch {}
    await env.DB.prepare('DELETE FROM attachments WHERE id = ?').bind(p.id).run();
  }
  return { ok: true, message: 'ID uploaded', slot, key };
}

/* Streams the object back through the Worker. Callers have already passed the
   PIN check in the router, so this is the only path to the file. */
export async function getAttachment(env, attachmentId) {
  if (!attachmentId) fail('Attachment is required');
  const row = await env.DB.prepare(
    'SELECT r2_key, content_type, filename FROM attachments WHERE id = ?'
  ).bind(attachmentId).first();
  if (!row) fail('Attachment not found');
  if (!env.FILES) fail('File storage is not configured');
  const obj = await env.FILES.get(row.r2_key);
  if (!obj) fail('File missing from storage');
  return new Response(obj.body, {
    headers: {
      'Content-Type': row.content_type || 'application/octet-stream',
      'Content-Disposition': `inline; filename="${String(row.filename || 'id').replace(/"/g, '')}"`,
      'Cache-Control': 'private, no-store',
      'Access-Control-Allow-Origin': '*'
    }
  });
}

export async function deleteAttachment(env, attachmentId) {
  if (!attachmentId) fail('Attachment is required');
  const row = await env.DB.prepare('SELECT r2_key FROM attachments WHERE id = ?').bind(attachmentId).first();
  if (!row) fail('Attachment not found');
  if (env.FILES) { try { await env.FILES.delete(row.r2_key); } catch {} }
  await env.DB.prepare('DELETE FROM attachments WHERE id = ?').bind(attachmentId).run();
  return { ok: true, message: 'ID deleted' };
}

/**
 * Retention sweep — keep 6 months, delete older.
 *
 * Runs on the cron trigger. Scoped strictly by the booking's CHECKOUT date:
 * a booking with no checkout date is never swept, because "unknown" must not be
 * treated as "old". Deliberate data minimisation — the app should not accumulate
 * an indefinite archive of other people's identity documents.
 *
 * Destructive and irreversible, so it logs what it removed.
 */
export async function sweepExpiredIds(env) {
  if (!env.FILES) return { ok: false, skipped: 'no bucket bound' };
  const cutoff = new Date(Date.now() - 183 * 86400_000).toISOString().slice(0, 10);
  const { results } = await env.DB.prepare(
    `SELECT a.id, a.r2_key, b.checkout_date
       FROM attachments a
       JOIN bookings b ON b.id = a.entity_id
      WHERE a.entity_type = 'booking' AND a.kind = 'id_proof'
        AND b.checkout_date <> '' AND b.checkout_date < ?`
  ).bind(cutoff).all();

  let n = 0;
  for (const r of results) {
    try { await env.FILES.delete(r.r2_key); } catch {}
    await env.DB.prepare('DELETE FROM attachments WHERE id = ?').bind(r.id).run();
    n++;
  }
  console.log(`id retention sweep: removed ${n} document(s) with checkout before ${cutoff}`);
  return { ok: true, removed: n, cutoff };
}

export { AttachError };

/**
 * Remove every ID document attached to a booking, R2 objects included.
 *
 * Called when the booking itself is deleted: the booking is the container, so
 * once it is gone the documents have nothing pointing at them and must not sit
 * in the bucket waiting for the six-month sweep. Failures on individual R2
 * deletes are swallowed for the same reason the sweep swallows them — a
 * storage hiccup must not block the user's delete — but the rows always go.
 */
export async function deleteBookingAttachments(env, bookingId) {
  const { results } = await env.DB.prepare(
    `SELECT id, r2_key FROM attachments WHERE entity_type = 'booking' AND entity_id = ?`
  ).bind(bookingId).all();
  if (!results || !results.length) return 0;
  if (env.FILES) {
    for (const r of results) { try { await env.FILES.delete(r.r2_key); } catch {} }
  }
  await env.DB.prepare(
    `DELETE FROM attachments WHERE entity_type = 'booking' AND entity_id = ?`
  ).bind(bookingId).run();
  return results.length;
}

/* ── Message photos ─────────────────────────────────────────────────────────
   Pictures that go out with a library message (the building gate, the parking
   slot, the Wi-Fi card). Same table and bucket as ID documents, told apart by
   entity_type 'message' + kind 'msg_image', so the ID retention sweep (which
   is scoped to entity_type 'booking') never touches them. Admin only to change;
   anyone signed in streams them through getAttachment like any other file. */
const MSG_MAX = 6;
const MSG_MAX_BYTES = 8 * 1024 * 1024;
const MSG_ALLOWED = /^image\/(jpeg|png|webp|heic|heif)$/i;

export async function messageImages(env) {
  const { results } = await env.DB.prepare(
    `SELECT id, entity_id, filename, content_type FROM attachments
      WHERE entity_type = 'message' AND kind = 'msg_image' ORDER BY id`
  ).all();
  const map = {};
  for (const r of results || []) (map[r.entity_id] = map[r.entity_id] || []).push({ id: r.id, type: r.content_type, name: r.filename });
  return map;
}

export async function uploadMessageImage(env, me, templateId, file) {
  if (!me.isAdmin) fail('Only an Admin can change the message library');
  if (!templateId) fail('Save the message first, then add photos');
  if (!file || typeof file.arrayBuffer !== 'function') fail('No file received');
  if (!env.FILES) fail('File storage is not configured');
  const t = await env.DB.prepare(`SELECT id FROM message_templates WHERE id = ? AND removed_at = ''`).bind(templateId).first();
  if (!t) fail('Message not found');
  const n = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM attachments WHERE entity_type = 'message' AND entity_id = ? AND kind = 'msg_image'`
  ).bind(templateId).first();
  if ((n && n.n) >= MSG_MAX) fail(`A message can carry at most ${MSG_MAX} photos`);
  const type = String(file.type || '');
  if (!MSG_ALLOWED.test(type)) fail('Only photos (JPEG, PNG, WebP, HEIC) can be attached');
  const buf = await file.arrayBuffer();
  if (!buf.byteLength) fail('File is empty');
  if (buf.byteLength > MSG_MAX_BYTES) fail('Photo is too large (max 8 MB)');
  const safe = String(file.name || 'photo').replace(/[^A-Za-z0-9._-]/g, '_').slice(-60);
  const key = `messages/${templateId}/${Date.now()}-${safe}`;
  await env.FILES.put(key, buf, { httpMetadata: { contentType: type } });
  await env.DB.prepare(
    `INSERT INTO attachments (entity_type, entity_id, kind, slot, r2_key, filename, content_type, size_bytes, uploaded_at)
     VALUES ('message', ?, 'msg_image', '', ?, ?, ?, ?, ?)`
  ).bind(templateId, key, String(file.name || ''), type, buf.byteLength, todayISO()).run();
  return { ok: true, message: 'Photo added' };
}

export async function deleteMessageImage(env, me, id) {
  if (!me.isAdmin) fail('Only an Admin can change the message library');
  const row = await env.DB.prepare(
    `SELECT r2_key FROM attachments WHERE id = ? AND entity_type = 'message' AND kind = 'msg_image'`
  ).bind(id).first();
  if (!row) fail('Photo not found');
  if (env.FILES) { try { await env.FILES.delete(row.r2_key); } catch {} }
  await env.DB.prepare('DELETE FROM attachments WHERE id = ?').bind(id).run();
  return { ok: true, message: 'Photo removed' };
}
