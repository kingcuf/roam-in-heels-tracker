import React, { useMemo, useState } from 'react';
import { Linking, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { C, F, inr } from '../theme';
import { useStore } from '../store';
import { api } from '../api';
import { Btn, confirmDestructive, useToast } from '../ui';
import { DateField } from '../fields';
import { Host, HostUnit, hostLedger, hostTotals, todayIso, waLink } from '../logic';

/* ── Setup → Hosts ──────────────────────────────────────────────────────────
   The host is the container: profile → units → ledger. The list answers
   "who do I owe, who owes me" before anything else; a profile answers "how
   did we get here" (every booking and payment, oldest first, with the running
   balance), and "settle it" is one button away.
   Sign convention: + = the host owes us, − = we owe the host. */

export const balanceText = (name: string, b: number) =>
  Math.abs(b) < 1 ? 'All settled' : b > 0 ? name + ' owes you ' + inr(b) : 'You owe ' + name + ' ' + inr(-b);
const tone = (b: number) => (Math.abs(b) < 1 ? C.bark : b > 0 ? C.green : C.red);
const toneBg = (b: number) => (Math.abs(b) < 1 ? C.bone : b > 0 ? C.greenbg : C.redbg);

export default function Hosts() {
  const s = useStore();
  const focus = s.hostFocus;
  const data = s.logs?.hosts;
  if (!data) return <Text style={st.empty}>Hosts need the latest app server — refresh in a minute.</Text>;
  const host = focus ? data.hosts.find((h) => h.id === focus) : null;
  if (focus === -1) return <HostForm onDone={(id) => s.setHostFocus(id || null)} />;
  if (host) return <HostProfile host={host} />;
  return <HostList />;
}

function HostList() {
  const s = useStore();
  const data = s.logs!.hosts!;
  const rows = s.logs?.bookings?.rows || [];
  const [q, setQ] = useState('');
  const totals = useMemo(() => hostTotals(data, rows), [data, rows]);
  const admin = s.me?.role === 'Admin';
  const list = data.hosts
    .filter((h) => !q.trim() || (h.name + ' ' + h.phone + ' ' + data.units.filter((u) => u.host_id === h.id).map((u) => u.unit).join(' ')).toLowerCase().includes(q.trim().toLowerCase()))
    .sort((a, b) => Math.abs(totals.by[b.id] || 0) - Math.abs(totals.by[a.id] || 0) || a.name.localeCompare(b.name));
  return (
    <ScrollView contentContainerStyle={st.body} keyboardShouldPersistTaps="handled">
      <Text style={st.h1}>Hosts</Text>
      <Text style={st.sub}>Other hosts you swap guests with — their units, and what’s pending between you.</Text>
      <View style={st.sumRow}>
        <View style={[st.sum, { backgroundColor: C.redbg }]}>
          <Text style={st.sumK}>YOU OWE</Text>
          <Text style={[st.sumV, { color: C.red }]}>{inr(totals.weOwe)}</Text>
        </View>
        <View style={[st.sum, { backgroundColor: C.greenbg }]}>
          <Text style={st.sumK}>OWED TO YOU</Text>
          <Text style={[st.sumV, { color: C.green }]}>{inr(totals.owedToUs)}</Text>
        </View>
      </View>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <TextInput value={q} onChangeText={setQ} placeholder="Search name, phone or unit" placeholderTextColor={C.muted} style={[st.input, { flex: 1 }]} />
        {admin ? <Btn title="+ Host" kind="mini" onPress={() => s.setHostFocus(-1)} /> : null}
      </View>
      {!data.hosts.length ? <Text style={st.empty}>No hosts yet.{admin ? ' Add the first one — then pick their flat on a booking.' : ''}</Text> : null}
      {list.map((h) => {
        const b = totals.by[h.id] || 0;
        const units = data.units.filter((u) => u.host_id === h.id).map((u) => u.unit);
        return (
          <TouchableOpacity key={h.id} style={st.row} onPress={() => s.setHostFocus(h.id)} activeOpacity={0.75}>
            <View style={st.av}><Text style={st.avT}>{h.name.slice(0, 1).toUpperCase()}</Text></View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={st.name} numberOfLines={1}>{h.name}</Text>
              <Text style={st.meta} numberOfLines={1}>{units.length ? 'Units ' + units.join(' · ') : h.phone || 'No units yet'}</Text>
            </View>
            <View style={[st.pill, { backgroundColor: toneBg(b) }]}>
              <Text style={[st.pillT, { color: tone(b) }]}>{Math.abs(b) < 1 ? 'Settled' : (b > 0 ? 'Owes ' : 'You owe ') + inr(Math.abs(b))}</Text>
            </View>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

function HostProfile({ host }: { host: Host }) {
  const s = useStore();
  const toast = useToast();
  const data = s.logs!.hosts!;
  const rows = s.logs?.bookings?.rows || [];
  const admin = s.me?.role === 'Admin';
  const [tab, setTab] = useState<'ledger' | 'units'>('ledger');
  const [edit, setEdit] = useState(false);
  const [unit, setUnit] = useState<HostUnit | 'new' | null>(null);
  const [pay, setPay] = useState(false);
  const led = useMemo(() => hostLedger(host.id, data, rows), [host.id, data, rows]);
  const units = data.units.filter((u) => u.host_id === host.id);

  if (edit) return <HostForm host={host} onDone={() => setEdit(false)} />;
  if (unit) return <UnitForm hostId={host.id} unit={unit === 'new' ? null : unit} onDone={() => setUnit(null)} />;

  const removePayment = (id: number) => confirmDestructive('Remove this payment?', 'The balance moves back by this amount.', async () => {
    try { await api.removeHostPayment(s.pin, id); await s.reloadLogs(); toast('Payment removed', true); }
    catch (e: any) { toast(String(e?.message || e), false); }
  }, 'Remove');

  return (
    <ScrollView contentContainerStyle={st.body} keyboardShouldPersistTaps="handled">
      <TouchableOpacity onPress={() => s.setHostFocus(null)} hitSlop={8}><Text style={st.back}>‹  Hosts</Text></TouchableOpacity>
      <View style={st.headRow}>
        <View style={[st.av, { width: 52, height: 52, borderRadius: 26 }]}><Text style={[st.avT, { fontSize: 22 }]}>{host.name.slice(0, 1).toUpperCase()}</Text></View>
        <View style={{ flex: 1 }}>
          <Text style={st.h1} numberOfLines={1}>{host.name}</Text>
          {host.phone ? (
            <View style={{ flexDirection: 'row', gap: 14, marginTop: 2 }}>
              <Text style={st.meta}>{host.phone}</Text>
              <TouchableOpacity onPress={() => Linking.openURL('tel:' + host.phone.replace(/[^\d+]/g, ''))} hitSlop={6}><Text style={st.link}>Call</Text></TouchableOpacity>
              <TouchableOpacity onPress={() => Linking.openURL(waLink(host.phone, '')).catch(() => {})} hitSlop={6}><Text style={st.link}>WhatsApp</Text></TouchableOpacity>
            </View>
          ) : null}
        </View>
        {admin ? <TouchableOpacity onPress={() => setEdit(true)} hitSlop={8}><Text style={st.link}>Edit</Text></TouchableOpacity> : null}
      </View>
      {host.notes ? <Text style={st.notes}>{host.notes}</Text> : null}

      <View style={[st.bal, { backgroundColor: toneBg(led.balance) }]}>
        <Text style={[st.balT, { color: tone(led.balance) }]}>{balanceText(host.name.split(' ')[0], led.balance)}</Text>
        <Text style={st.meta}>{led.open + ' booking' + (led.open === 1 ? '' : 's') + ' on the ledger · ' + data.payments.filter((p) => p.host_id === host.id).length + ' payments'}</Text>
        {admin && !pay ? <Btn title="Record a payment" onPress={() => setPay(true)} style={{ marginTop: 10 }} /> : null}
        {pay ? <PaymentForm host={host} balance={led.balance} onDone={() => setPay(false)} /> : null}
      </View>

      <View style={st.tabs}>
        {(['ledger', 'units'] as const).map((k) => (
          <TouchableOpacity key={k} style={[st.tab, tab === k && st.tabOn]} onPress={() => setTab(k)}>
            <Text style={[st.tabT, tab === k && st.tabTOn]}>{k === 'ledger' ? 'Ledger' : 'Units · ' + units.length}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {tab === 'ledger' ? (
        led.entries.length ? (
          <View style={st.card}>
            {[...led.entries].reverse().map((e, i) => (
              <TouchableOpacity key={e.kind + (e.row || e.payment?.id) + i} activeOpacity={0.7}
                style={[st.lrow, i === led.entries.length - 1 && { borderBottomWidth: 0 }]}
                onPress={() => (e.row ? s.openBooking(e.row) : undefined)}
                onLongPress={() => (admin && e.payment ? removePayment(e.payment.id) : undefined)}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[st.lLabel, e.settled && { color: C.muted }]} numberOfLines={1}>{e.label}</Text>
                  <Text style={st.lSub} numberOfLines={1}>{fmtDate(e.date) + (e.sub ? ' · ' + e.sub : '')}</Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  {/* Deals: + green = adds to what they owe you, − red = adds to what you owe.
                      Payments are money that moved: plain, no sign to misread. */}
                  <Text style={[st.lAmt, { color: e.settled ? C.muted : e.kind === 'payment' ? C.ink : e.amount >= 0 ? C.green : C.red }]}>
                    {e.settled ? '—' : e.kind === 'payment' ? inr(Math.abs(e.amount)) : (e.amount >= 0 ? '+' : '−') + inr(Math.abs(e.amount))}
                  </Text>
                  <Text style={st.lBal}>{Math.abs(e.balance) < 1 ? 'settled' : e.balance > 0 ? 'owes you ' + inr(e.balance) : 'you owe ' + inr(-e.balance)}</Text>
                </View>
                {admin && e.payment ? (
                  <TouchableOpacity onPress={() => removePayment(e.payment!.id)} hitSlop={8}><Text style={st.x}>×</Text></TouchableOpacity>
                ) : null}
              </TouchableOpacity>
            ))}
          </View>
        ) : <Text style={st.empty}>Nothing on the ledger yet. Pick this host’s flat (or the host) on a booking and it shows up here.</Text>
      ) : (
        <View style={{ gap: 10 }}>
          {units.map((u) => (
            <TouchableOpacity key={u.id} style={st.card} activeOpacity={admin ? 0.75 : 1} onPress={() => (admin ? setUnit(u) : undefined)}>
              <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
                <Text style={st.unitNo}>{u.unit}</Text>
                <Text style={st.meta} numberOfLines={1}>{u.building}</Text>
                {admin ? <Text style={[st.link, { marginLeft: 'auto' }]}>Edit</Text> : null}
              </View>
              {u.address ? <Text style={st.uLine}>{'📍 ' + u.address}</Text> : null}
              {u.wifi_name ? <Text style={st.uLine}>{'Wi-Fi ' + u.wifi_name + (u.wifi_password ? ' · ' + u.wifi_password : '')}</Text> : null}
              {u.checkin_time || u.checkout_time ? <Text style={st.uLine}>{'In ' + (u.checkin_time || '—') + ' · Out ' + (u.checkout_time || '—')}</Text> : null}
              {u.caretaker_phone ? <Text style={st.uLine}>{'Caretaker ' + [u.caretaker_name, u.caretaker_phone].filter(Boolean).join(' · ')}</Text> : null}
              {!u.address || !u.wifi_name ? <Text style={st.warn}>Missing {[!u.address && 'address', !u.wifi_name && 'Wi-Fi'].filter(Boolean).join(' and ')} — guest messages for this flat will ask for it.</Text> : null}
            </TouchableOpacity>
          ))}
          {admin ? <Btn title="+ Add a unit" kind="ghost" onPress={() => setUnit('new')} /> : null}
          {!units.length && !admin ? <Text style={st.empty}>No units recorded for this host.</Text> : null}
        </View>
      )}
    </ScrollView>
  );
}

function PaymentForm({ host, balance, onDone }: { host: Host; balance: number; onDone: () => void }) {
  const s = useStore();
  const toast = useToast();
  /* Prefilled to settle: if we owe them, "We paid them" the full amount. */
  const [dir, setDir] = useState<'paid' | 'received'>(balance > 0 ? 'received' : 'paid');
  const [amount, setAmount] = useState(Math.abs(balance) >= 1 ? String(Math.round(Math.abs(balance))) : '');
  const [date, setDate] = useState(todayIso());
  const [mode, setMode] = useState('UPI');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    const n = Number(amount.replace(/,/g, ''));
    if (!(n > 0)) { toast('Enter the amount', false); return; }
    setBusy(true);
    try {
      const r = await api.addHostPayment(s.pin, { hostId: host.id, amount: n, direction: dir, date, mode, note });
      await s.reloadLogs(); toast(r.message || 'Recorded', true); onDone();
    } catch (e: any) { toast(String(e?.message || e), false); } finally { setBusy(false); }
  };
  return (
    <View style={{ gap: 10, marginTop: 12 }}>
      <View style={st.chips}>
        {([['paid', 'We paid ' + host.name.split(' ')[0]], ['received', host.name.split(' ')[0] + ' paid us']] as const).map(([k, l]) => (
          <TouchableOpacity key={k} style={[st.chip, dir === k && st.chipOn]} onPress={() => setDir(k)}><Text style={[st.chipT, dir === k && st.chipTOn]}>{l}</Text></TouchableOpacity>
        ))}
      </View>
      <TextInput value={amount} onChangeText={setAmount} placeholder="Amount (₹)" keyboardType="numeric" placeholderTextColor={C.muted} style={st.input} />
      <DateField value={date} onChange={setDate} />
      <View style={st.chips}>
        {['UPI', 'Cash', 'Bank', 'Adjusted'].map((m) => (
          <TouchableOpacity key={m} style={[st.chip, mode === m && st.chipOn]} onPress={() => setMode(m)}><Text style={[st.chipT, mode === m && st.chipTOn]}>{m}</Text></TouchableOpacity>
        ))}
      </View>
      <TextInput value={note} onChangeText={setNote} placeholder="Note (optional)" placeholderTextColor={C.muted} style={st.input} />
      <View style={{ flexDirection: 'row', gap: 8, justifyContent: 'flex-end' }}>
        <Btn title="Cancel" kind="ghost" onPress={onDone} />
        <Btn title={busy ? 'Saving…' : 'Save payment'} onPress={save} disabled={busy} />
      </View>
    </View>
  );
}

function HostForm({ host, onDone }: { host?: Host; onDone: (id?: number) => void }) {
  const s = useStore();
  const toast = useToast();
  const [name, setName] = useState(host?.name || '');
  const [phone, setPhone] = useState(host?.phone || '');
  const [notes, setNotes] = useState(host?.notes || '');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      const r = await api.saveHost(s.pin, { id: host?.id, name, phone, notes });
      await s.reloadLogs(); toast(r.message, true); onDone(r.id);
    } catch (e: any) { toast(String(e?.message || e), false); } finally { setBusy(false); }
  };
  const remove = () => confirmDestructive('Remove ' + host!.name + '?', 'Only possible when nothing is open on their ledger.', async () => {
    try { await api.removeHost(s.pin, host!.id); await s.reloadLogs(); toast('Host removed', true); s.setHostFocus(null); }
    catch (e: any) { toast(String(e?.message || e), false); }
  }, 'Remove');
  return (
    <ScrollView contentContainerStyle={st.body} keyboardShouldPersistTaps="handled">
      <TouchableOpacity onPress={() => onDone(host?.id)} hitSlop={8}><Text style={st.back}>‹  {host ? host.name : 'Hosts'}</Text></TouchableOpacity>
      <Text style={st.h1}>{host ? 'Edit host' : 'New host'}</Text>
      <View style={[st.card, { gap: 10 }]}>
        <L t="Name"><TextInput value={name} onChangeText={setName} placeholder="e.g. Chandra Prakash" placeholderTextColor={C.muted} style={st.input} /></L>
        <L t="Mobile"><TextInput value={phone} onChangeText={setPhone} placeholder="+91 …" keyboardType="phone-pad" placeholderTextColor={C.muted} style={st.input} /></L>
        <L t="Notes"><TextInput value={notes} onChangeText={setNotes} placeholder="Rates, bank/UPI, anything to remember" placeholderTextColor={C.muted} style={[st.input, { minHeight: 70 }]} multiline /></L>
      </View>
      <Btn title={busy ? 'Saving…' : 'Save host'} onPress={save} disabled={busy} />
      {host ? <Btn title="Remove host" kind="danger" onPress={remove} /> : null}
    </ScrollView>
  );
}

const UNIT_INPUTS: { k: keyof HostUnit; l: string; ph: string; multi?: boolean; kb?: any }[] = [
  { k: 'unit', l: 'Unit number', ph: '3103' },
  { k: 'building', l: 'Building', ph: 'Spira, Sector 68' },
  { k: 'address', l: 'Address (sent to the guest)', ph: 'Tower B, Flat 3103, …', multi: true },
  { k: 'map_link', l: 'Google Maps link', ph: 'https://maps.app.goo.gl/…' },
  { k: 'wifi_name', l: 'Wi-Fi name', ph: '' },
  { k: 'wifi_password', l: 'Wi-Fi password', ph: '' },
  { k: 'checkin_time', l: 'Check-in time', ph: '2:00 PM' },
  { k: 'checkout_time', l: 'Check-out time', ph: '11:00 AM' },
  { k: 'caretaker_name', l: 'Caretaker (not sent to guests)', ph: '' },
  { k: 'caretaker_phone', l: 'Caretaker mobile', ph: '', kb: 'phone-pad' },
  { k: 'notes', l: 'Notes', ph: 'Key pickup, parking…', multi: true },
];
function UnitForm({ hostId, unit, onDone }: { hostId: number; unit: HostUnit | null; onDone: () => void }) {
  const s = useStore();
  const toast = useToast();
  const [v, setV] = useState<Record<string, string>>(() => {
    const o: Record<string, string> = {};
    for (const x of UNIT_INPUTS) o[x.k] = String((unit as any)?.[x.k] ?? '');
    return o;
  });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try { const r = await api.saveHostUnit(s.pin, { ...v, id: unit?.id, hostId }); await s.reloadLogs(); toast(r.message, true); onDone(); }
    catch (e: any) { toast(String(e?.message || e), false); } finally { setBusy(false); }
  };
  const remove = () => confirmDestructive('Remove unit ' + unit!.unit + '?', 'Past bookings keep showing it.', async () => {
    try { await api.removeHostUnit(s.pin, unit!.id); await s.reloadLogs(); toast('Unit removed', true); onDone(); }
    catch (e: any) { toast(String(e?.message || e), false); }
  }, 'Remove');
  return (
    <ScrollView contentContainerStyle={st.body} keyboardShouldPersistTaps="handled">
      <TouchableOpacity onPress={onDone} hitSlop={8}><Text style={st.back}>‹  Back</Text></TouchableOpacity>
      <Text style={st.h1}>{unit ? 'Unit ' + unit.unit : 'New unit'}</Text>
      <Text style={st.sub}>Address, Wi-Fi and times go into guest messages when a guest stays here — under your name and your manager’s number, never the host’s.</Text>
      <View style={[st.card, { gap: 10 }]}>
        {UNIT_INPUTS.map((x) => (
          <L key={x.k} t={x.l}>
            <TextInput value={v[x.k]} onChangeText={(t) => setV((p) => ({ ...p, [x.k]: t }))} placeholder={x.ph} placeholderTextColor={C.muted}
              keyboardType={x.kb} multiline={x.multi} style={[st.input, x.multi && { minHeight: 64 }]} autoCapitalize={x.k === 'map_link' || x.k.startsWith('wifi') ? 'none' : 'sentences'} />
          </L>
        ))}
      </View>
      <Btn title={busy ? 'Saving…' : 'Save unit'} onPress={save} disabled={busy} />
      {unit ? <Btn title="Remove unit" kind="danger" onPress={remove} /> : null}
    </ScrollView>
  );
}

function L({ t, children }: { t: string; children: React.ReactNode }) {
  return <View style={{ gap: 5 }}><Text style={st.lbl}>{t}</Text>{children}</View>;
}
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtDate = (iso: string) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ''); return m ? Number(m[3]) + ' ' + MON[Number(m[2]) - 1] + ' ' + m[1].slice(2) : ''; };

const st = StyleSheet.create({
  body: { padding: 14, paddingBottom: 140, gap: 12 },
  h1: { fontFamily: F.xbold, fontSize: 22, color: C.ink, letterSpacing: -0.5 },
  sub: { fontFamily: F.med, fontSize: 13, color: C.bark, lineHeight: 19 },
  back: { fontFamily: F.bold, fontSize: 13.5, color: C.blue2 },
  empty: { fontFamily: F.med, fontSize: 13, color: C.bark, lineHeight: 19, padding: 14 },
  sumRow: { flexDirection: 'row', gap: 10 },
  sum: { flex: 1, borderRadius: 16, padding: 14 },
  sumK: { fontFamily: F.bold, fontSize: 10.5, letterSpacing: 1, color: C.bark },
  sumV: { fontFamily: F.xbold, fontSize: 22, marginTop: 2 },
  input: { borderWidth: 1, borderColor: C.line, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontFamily: F.med, fontSize: 14, color: C.ink, backgroundColor: '#fff' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.85)' },
  av: { width: 40, height: 40, borderRadius: 20, backgroundColor: C.amberbg, alignItems: 'center', justifyContent: 'center' },
  avT: { fontFamily: F.xbold, fontSize: 16, color: C.blue2 },
  name: { fontFamily: F.bold, fontSize: 15, color: C.ink },
  meta: { fontFamily: F.med, fontSize: 12.5, color: C.bark },
  pill: { borderRadius: 999, paddingVertical: 5, paddingHorizontal: 10 },
  pillT: { fontFamily: F.bold, fontSize: 12 },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  link: { fontFamily: F.bold, fontSize: 13, color: C.blue2 },
  notes: { fontFamily: F.med, fontSize: 13, color: C.bark, lineHeight: 19 },
  bal: { borderRadius: 18, padding: 16 },
  balT: { fontFamily: F.xbold, fontSize: 19, marginBottom: 2 },
  tabs: { flexDirection: 'row', backgroundColor: C.bone, borderRadius: 12, padding: 3 },
  tab: { flex: 1, paddingVertical: 8, borderRadius: 10, alignItems: 'center' },
  tabOn: { backgroundColor: '#fff' },
  tabT: { fontFamily: F.semi, fontSize: 13, color: C.bark },
  tabTOn: { fontFamily: F.bold, color: C.ink },
  card: { backgroundColor: 'rgba(255,255,255,0.88)', borderRadius: 18, padding: 14 },
  lrow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.hair },
  lLabel: { fontFamily: F.semi, fontSize: 14, color: C.ink },
  lSub: { fontFamily: F.med, fontSize: 11.5, color: C.muted, marginTop: 1 },
  lAmt: { fontFamily: F.bold, fontSize: 14 },
  lBal: { fontFamily: F.med, fontSize: 10.5, color: C.muted, marginTop: 1 },
  x: { fontFamily: F.bold, fontSize: 18, color: C.muted, paddingHorizontal: 2 },
  unitNo: { fontFamily: F.xbold, fontSize: 18, color: C.ink },
  uLine: { fontFamily: F.med, fontSize: 12.5, color: C.bark, marginTop: 4, lineHeight: 18 },
  warn: { fontFamily: F.semi, fontSize: 12, color: C.red, marginTop: 6, lineHeight: 17 },
  lbl: { fontFamily: F.semi, fontSize: 12.5, color: C.bark },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  chip: { borderRadius: 999, borderWidth: 1, borderColor: C.line, backgroundColor: '#fff', paddingVertical: 7, paddingHorizontal: 12 },
  chipOn: { backgroundColor: C.navy, borderColor: C.navy },
  chipT: { fontFamily: F.semi, fontSize: 12.5, color: C.bark },
  chipTOn: { color: '#fff' },
});
