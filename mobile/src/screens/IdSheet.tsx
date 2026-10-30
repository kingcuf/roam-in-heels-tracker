import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { C, F } from '../theme';
import { Sheet } from '../ui';
import { useStore } from '../store';
import IdUploader from './IdUploader';
import { parseExtraGuests } from '../logic';

/* The Action tab's IDs-pending entry point. All the upload behaviour lives in
   IdUploader, which the booking form embeds as well — this is only the drawer
   around it. */
export default function IdSheet() {
  const s = useStore();
  const t = s.idTarget;
  if (!t) return null;   // nothing selected — the sheet is not mounted at all

  return (
    <Sheet
      visible={!!t}
      title={'IDs · ' + (t.guest || t.id)}
      value={t.have + ' of ' + t.expected + ' on file'}
      onClose={() => s.setIdTarget(null)}
    >
      <Text style={st.meta}>
        {t.prop}{t.guests ? ' · ' + t.guests + ' guest' + (t.guests === 1 ? '' : 's') : ''}
      </Text>
      <IdUploader
        row={t.row}
        guest={t.guest}
        coGuest={t.coGuest}
        needsCo={t.coNamed || t.guests >= 2}
        extras={parseExtraGuests(s.logs?.bookings?.rows?.find((o) => o.r === t.row)?.cells?.[27])
          .map((g) => g.name).filter((n) => n.trim())}
      />
    </Sheet>
  );
}

const st = StyleSheet.create({
  meta: { fontFamily: F.med, fontSize: 12, color: C.muted, marginBottom: 10 },
});
