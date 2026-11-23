/**
 * Suite for hosts & the host ledger (src/logic.ts): dealAmount, hostLedger,
 * hostTotals, defaultCollector, guestFactsFor, messageValues for a host unit.
 * Run: bash qa/run-tests.sh
 */
import { dealAmount, defaultCollector, guestFactsFor, hostLedger, hostTotals, messageValues, HostsData, MessagesData } from '../src/logic';

let pass = 0, fail = 0;
const failures: string[] = [];
function eq(name: string, got: any, want: any) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++; else { fail++; failures.push(`✗ ${name}\n    got:  ${g}\n    want: ${w}`); }
}
/* cells: 0 booked · 1 property · 2 guest · 4 channel · 8 paid · 9 net · 10 commission · 20 in · 24 stay unit */
function bk(r: number, o: { prop?: string; guest?: string; paid?: number; net?: number; comm?: number; inD?: string; unit?: string; channel?: string }) {
  const c: any[] = new Array(30).fill('');
  c[0] = '2026-11-01'; c[1] = o.prop || 'Spira 3028'; c[2] = o.guest || 'Guest ' + r; c[4] = o.channel || 'Offline';
  c[8] = o.paid ?? 2400; c[9] = o.net ?? 600; c[10] = o.comm ?? 1800; c[20] = o.inD || '2026-11-10'; c[24] = o.unit || '';
  return { r, cells: c };
}
const unit = { id: 5, host_id: 1, unit: '3103', building: 'Spira, Sector 68', address: 'Tower C, 3103', map_link: 'https://m/x', wifi_name: 'C3103', wifi_password: 'pw3103', checkin_time: '1:00 PM', checkout_time: '', caretaker_name: 'Raju', caretaker_phone: '999', notes: '' };
const data: HostsData = {
  hosts: [{ id: 1, name: 'Arbaz Khan', phone: '98', notes: '' }, { id: 2, name: 'Nimmy', phone: '', notes: '' }],
  units: [unit],
  deals: [
    { booking_row: 1, host_id: 1, unit_id: 5, collected_by: 'host', settled: 0 },     // host owes us 600
    { booking_row: 2, host_id: 1, unit_id: 5, collected_by: 'us', settled: 0 },       // we owe 1800
    { booking_row: 3, host_id: 1, unit_id: 0, collected_by: 'host', settled: 1 },     // history
    { booking_row: 4, host_id: 2, unit_id: 0, collected_by: 'host', settled: 0 },     // Nimmy owes our net 1000
  ],
  payments: [
    { id: 1, host_id: 1, txn_date: '2026-11-15', amount: 500, direction: 'paid', mode: 'UPI', note: '' },
  ],
};
const rows = [bk(1, { inD: '2026-11-05', unit: '3103' }), bk(2, { inD: '2026-11-08', unit: '3103', channel: 'Airbnb' }), bk(3, { inD: '2026-10-01' }), bk(4, { net: 1000, comm: 200, inD: '2026-11-20' })];

eq('host collected → host owes us our net', dealAmount(data.deals[0], rows[0].cells), 600);
eq('we collected → we owe their share', dealAmount(data.deals[1], rows[1].cells), -1800);
eq('settled history counts nothing', dealAmount(data.deals[2], rows[2].cells), 0);

{
  const L = hostLedger(1, data, rows);
  eq('ledger order: by date, settled kept as history', L.entries.map((e) => e.kind + ':' + (e.row || 'p')), ['deal:3', 'deal:1', 'deal:2', 'payment:p']);
  eq('running balance', L.entries.map((e) => e.balance), [0, 600, -1200, -700]);
  eq('balance: −700 = we still owe Arbaz 700', L.balance, -700);
  eq('open deals exclude settled', L.open, 2);
  eq('deal label says where they stayed', L.entries[1].label, 'Guest 1 · in their 3103');
}
{
  const T = hostTotals(data, rows);
  eq('totals: we owe 700, owed to us 1000', [T.weOwe, T.owedToUs], [700, 1000]);
}
eq('OTA → we collected', defaultCollector('Airbnb'), 'us');
eq('offline → host collected', defaultCollector('Offline'), 'host');

/* Guest facts: a guest in the host's 3103 never gets 3028's Wi-Fi or door code. */
{
  const msgs: MessagesData = { templates: [], sends: [], facts: [
    { property: 'Spira 3028', key: 'wifi_name', label: '', value: 'Spira_3028' },
    { property: 'Spira 3028', key: 'door_code', label: 'Door code', value: '4455#' },
    { property: 'Spira 3028', key: 'checkout_time', label: '', value: '11:00 AM' },
    { property: 'Spira 3028', key: 'manager_phone', label: '', value: '9811122233' },
  ] };
  const { facts, hostUnit } = guestFactsFor(rows[0], msgs, data);
  eq('host unit Wi-Fi replaces ours', facts.wifi_name, 'C3103');
  eq('our door code does not leak', facts.door_code, undefined);
  eq('blank host field stays blank, not our checkout time', facts.checkout_time, undefined);
  eq('our manager stays the contact', facts.manager_phone, '9811122233');
  const v = messageValues(rows[0], facts, hostUnit);
  eq('{property} is the building, never Spira 3028', v.property, 'Spira, Sector 68');
  eq('{unit} is their unit', v.unit, '3103');
  const own = guestFactsFor(rows[3], msgs, data);
  eq('their guest in OUR flat → our facts', own.facts.wifi_name, 'Spira_3028');
}

console.log(failures.join('\n'));
console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exitCode = 1;
