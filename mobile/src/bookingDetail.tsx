import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { C, F, inr } from './theme';
import { CardData, ciFmtDay, ciParse } from './logic';
import { Btn } from './ui';

/* Read-only detail of one booking, from the raw row via cardOf(). Same look as
   the Calendar's stay detail, but built on CardData so it also copes with a
   booking that has no check-in date — the Report lists those (booking-date
   basis), the Calendar never shows them. */
export function BookingDetail({ b, onEdit }: { b: CardData; onEdit?: () => void }) {
  const when = (d: Date | null, t: string) => (d ? ciFmtDay(d) + (t ? ' · ' + t : '') : '');
  const sameDay = !!(b.inD && b.outD && b.nights === 0);
  return (
    <View>
      <View style={st.head}>
        <View style={st.pill}>
          <Text style={st.pillLbl}>BOOKING</Text>
          <Text style={st.pillTxt} numberOfLines={1}>{b.prop || '—'}</Text>
        </View>
        <View style={[st.pill, st.pillGold]}>
          <Text style={[st.pillLbl, { color: C.blue2 }]}>STAY UNIT</Text>
          <Text style={[st.pillTxt, { color: C.blue2 }]} numberOfLines={1}>{b.unit || '—'}</Text>
        </View>
        {b.channel ? <View style={st.src}><Text style={st.srcTxt}>{b.channel}</Text></View> : null}
      </View>

      <Row label="Booking ID" value={b.id} />
      <Row label="Booked on" value={when(ciParse(b.bookedOn), '')} />
      <Row label="Check-in" value={when(b.inD, b.inT) || 'not recorded'} tone={b.inD ? C.navy : C.muted} />
      <Row label="Check-out" value={when(b.outD, b.outT) || 'not recorded'} tone={b.outD ? C.navy : C.muted} />
      <Row label="Nights" value={b.nights === null ? '' : sameDay ? 'Day use · 0 nights' : String(b.nights)} />
      <Row label="Guests" value={b.guests ? String(b.guests) : ''} />
      {b.coGuest ? <Row label="Co-guest" value={b.coGuest} /> : null}
      <Row label="Type" value={b.type} />
      {b.type === 'Resold' && b.referrer ? <Row label="Resold" value={b.referrer} tone={C.blue2} /> : null}
      {b.type !== 'Resold' && b.referrer ? <Row label="Source" value={b.referrer} /> : null}
      <Row label="Total paid" value={b.paid ? inr(b.paid) : ''} />
      <Row label="Net earning" value={inr(b.net)} tone={C.green} />
      <Row label="Awaiting payout" value={b.pending > 0 ? inr(b.pending) : '—'} tone={b.pending > 0 ? C.red : C.muted} />
      {b.notes ? <Row label="Notes" value={b.notes} /> : null}

      {onEdit ? <Btn title="Edit this booking" onPress={onEdit} style={{ marginTop: 16 }} /> : null}
    </View>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <View style={st.row}>
      <Text style={st.lbl}>{label}</Text>
      <Text style={[st.val, tone ? { color: tone } : null]}>{value || '—'}</Text>
    </View>
  );
}

const st = StyleSheet.create({
  head: { flexDirection: 'row', gap: 8, marginTop: 4, marginBottom: 8 },
  pill: { flex: 1, backgroundColor: C.bone, borderRadius: 12, paddingVertical: 9, paddingHorizontal: 12 },
  pillGold: { backgroundColor: C.amberbg, borderWidth: 1, borderColor: C.copper },
  pillLbl: { fontFamily: F.semi, fontSize: 9, color: C.muted, letterSpacing: 0.9 },
  pillTxt: { fontFamily: F.bold, fontSize: 14.5, color: C.ink, marginTop: 3 },
  src: { justifyContent: 'center', backgroundColor: C.navy, borderRadius: 12, paddingHorizontal: 12 },
  srcTxt: { fontFamily: F.bold, fontSize: 11.5, color: '#fff' },
  row: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: C.hair, gap: 14,
  },
  lbl: { fontFamily: F.med, fontSize: 12.5, color: C.muted },
  val: { fontFamily: F.bold, fontSize: 14, color: C.ink, flexShrink: 1, textAlign: 'right' },
});
