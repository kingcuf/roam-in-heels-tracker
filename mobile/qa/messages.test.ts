/**
 * Suite for the message library (src/logic.ts): renderMessage, messageValues,
 * messagesFor, waNumber, factKeyOf.
 * Run: bash qa/run-tests.sh
 */
import { MessagesData, MessageTemplate, factKeyOf, messageValues, messagesFor, renderMessage, waLink, waNumber } from '../src/logic';

let pass = 0, fail = 0;
const failures: string[] = [];
function eq(name: string, got: any, want: any) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++;
  else { fail++; failures.push(`✗ ${name}\n    got:  ${g}\n    want: ${w}`); }
}
function bk(o: { prop?: string; inD?: string; outD?: string; inT?: string; guest?: string; phone?: string; stayProp?: string; unit?: string }) {
  const c: any[] = new Array(30).fill('');
  c[0] = '2026-11-01'; c[1] = o.prop || 'Spira 3028'; c[2] = o.guest ?? 'Aarav Mehta'; c[13] = o.phone || '';
  c[17] = 2; c[18] = 'B9'; c[20] = o.inD || '2026-11-22'; c[21] = o.outD || '2026-11-25'; c[22] = o.inT || '';
  c[24] = o.unit || '';
  if (o.stayProp) { c[28] = o.stayProp; c[29] = 500; }
  return { r: 7, cells: c };
}
const facts = { wifi_name: 'Spira_3028', wifi_password: 'pass123', checkin_time: '2:00 PM', checkout_time: '11:00 AM' };

/* ══ values ══ */
{
  const v = messageValues(bk({}), facts);
  eq('first name', v.guest_first_name, 'Aarav');
  eq('unit from property', v.unit, '3028');
  eq('standard check-in time from the unit', v.checkin_time, '2:00 PM');
  eq('booking time beats the unit', messageValues(bk({ inT: '1:00 PM' }), facts).checkin_time, '1:00 PM');
  eq('long date', v.checkin_date, 'Sun, 22 Nov');
  eq('nights', v.nights, '3');
  eq('blank guest phone is not a value', 'guest_phone' in v, false);
}

/* ══ render ══ */
{
  const v = messageValues(bk({}), facts);
  const r = renderMessage('Hi {guest_first_name}! Wi-Fi {wifi_name} / {wifi_password}. Door {door_code}, again {door_code}.', v);
  eq('fills known', r.text.startsWith('Hi Aarav! Wi-Fi Spira_3028 / pass123.'), true);
  eq('missing listed once, left visible', [r.missing, r.text.includes('{door_code}')], [['door_code'], true]);
  eq('no variables', renderMessage('Plain text', v), { text: 'Plain text', missing: [] });
  eq('braces that are not variables are left alone', renderMessage('{ not a var } {Caps}', v).missing, []);
}

/* ══ which messages, in what order ══ */
{
  let id = 0;
  const t = (o: Partial<MessageTemplate>): MessageTemplate =>
    ({ id: ++id, title: 'T' + id, body: '', stage: 'any', audience: 'guest', properties: [], preset: '', sort: id, ...o } as MessageTemplate);
  const data: MessagesData = {
    templates: [
      t({ title: 'before', stage: 'before' }),
      t({ title: 'stay', stage: 'stay' }),
      t({ title: 'only 403', properties: ['403, Plot no 685, Sector 45'] }),
      t({ title: 'only 3028', stage: 'checkout', properties: ['Spira 3028'] }),
    ],
    facts: [], sends: [],
  };
  const now = new Date('2026-11-23T12:00:00');
  const r = messagesFor(bk({}), data, now);   // in-house 22–25 Nov
  eq('in-house → stay is due', r.due, 'stay');
  eq('unit filter + due first', r.list.map((x) => x.title), ['stay', 'before', 'only 3028']);
  eq('split stay follows the guest', messagesFor(bk({ stayProp: '403, Plot no 685, Sector 45' }), data, now).list.map((x) => x.title),
    ['stay', 'before', 'only 403']);
  eq('upcoming → before is due', messagesFor(bk({ inD: '2026-11-28', outD: '2026-11-30' }), data, now).due, 'before');
  eq('no data', messagesFor(bk({}), undefined, now).list, []);
}

/* ══ WhatsApp ══ */
eq('10-digit → +91', waNumber('98765 43210'), '919876543210');
eq('already international', waNumber('+44 7700 900123'), '447700900123');
eq('leading 0 dropped', waNumber('09876543210'), '919876543210');
eq('link encodes text', waLink('9876543210', 'Hi & bye\nok'), 'https://wa.me/919876543210?text=Hi%20%26%20bye%0Aok');

/* ══ custom fact keys ══ */
eq('label → key', factKeyOf('Door code'), 'door_code');
eq('symbols squashed', factKeyOf('  Parking slot #2! '), 'parking_slot_2');
eq('leading digits dropped', factKeyOf('2nd key'), 'nd_key');

console.log(failures.join('\n'));
console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exitCode = 1;
