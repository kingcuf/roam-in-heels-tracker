/* Guest history for the booking form: every name that has appeared on a
   booking (lead, co-guest or further guest), with what we last knew about
   them, and a name box that suggests matches as you type. */
import React, { useMemo, useState } from 'react';
import { Image, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { C, F, G } from './theme';
import { useStore } from './store';
import { ciParse, dayKeyOf, frontForGuest, parseExtraGuests } from './logic';
import { api } from './api';

export type KnownGuest = {
  name: string;
  birthYr: string;
  phone: string;          // only ever taken from a lead-guest row
  stays: number;
  lastKey: string;        // yyyy-mm-dd of the most recent stay (or booking)
  lastProp: string;
  lastUnit: string;
  stayingNow: boolean;
  /* Their most recent booking, which guest they were on it (1 = lead, 2 =
     co-guest, 3+ = further guests), and — when they led it — who came with
     them, so picking them can bring the whole party back. */
  lastRow: number;
  lastPos: number;
  party: { name: string; birthYr: string }[];
};

const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();

export function useGuestDirectory(excludeRow?: number) {
  const s = useStore();
  const rows = s.logs?.bookings?.rows;
  return useMemo(() => {
    const today = dayKeyOf(new Date());
    const map = new Map<string, KnownGuest>();
    (rows || []).forEach((o) => {
      if (o.r === excludeRow) return;
      const c = o.cells;
      const ci = ciParse(c[20]) || ciParse(c[0]);
      const co = ciParse(c[21]);
      const key = ci ? dayKeyOf(ci) : '';
      const outKey = co ? dayKeyOf(co) : key;
      const staying = !!key && key <= today && outKey > today;
      const others = [{ name: String(c[15] ?? '').trim(), birthYr: String(c[16] ?? '').trim() },
        ...parseExtraGuests(c[27]).map((x) => ({ name: String(x.name || '').trim(), birthYr: String(x.birthYr || '').trim() }))];
      const add = (name: any, birth: any, phone: string, pos: number) => {
        const n = String(name ?? '').trim();
        if (n.length < 2) return;
        const k = norm(n);
        const g = map.get(k) || {
          name: n, birthYr: '', phone: '', stays: 0, lastKey: '', lastProp: '', lastUnit: '', stayingNow: false,
          lastRow: 0, lastPos: 0, party: [],
        };
        g.stays += 1;
        g.stayingNow = g.stayingNow || staying;
        const newer = key >= g.lastKey;
        const b = String(birth ?? '').trim();
        if (b && (newer || !g.birthYr)) g.birthYr = b;
        if (phone && (newer || !g.phone)) g.phone = phone;
        if (newer) {
          g.lastKey = key; g.lastProp = String(c[1] ?? ''); g.lastUnit = String(c[24] ?? ''); g.name = n;
          g.lastRow = o.r; g.lastPos = pos;
          g.party = pos === 1 ? others.filter((x) => x.name.length >= 2) : [];
        }
        map.set(k, g);
      };
      add(c[2], c[14], String(c[13] ?? '').trim(), 1);
      add(c[15], c[16], '', 2);
      parseExtraGuests(c[27]).forEach((x, i) => add(x.name, x.birthYr, '', i + 3));
    });
    return map;
  }, [rows, excludeRow]);
}

function matches(dir: Map<string, KnownGuest>, q: string, exclude: string[]) {
  const nq = norm(q);
  if (nq.length < 2) return [];
  const skip = new Set(exclude.map(norm));
  const out: { g: KnownGuest; score: number }[] = [];
  dir.forEach((g, k) => {
    if (skip.has(k) || k === nq) return;
    const i = k.indexOf(nq);
    if (i < 0) return;
    const word = i === 0 || k[i - 1] === ' ';
    out.push({ g, score: (i === 0 ? 0 : word ? 1 : 2) * 1000 - g.stays });
  });
  return out.sort((a, b) => a.score - b.score || b.g.lastKey.localeCompare(a.g.lastKey)).slice(0, 6).map((x) => x.g);
}

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmt = (k: string) => (k ? Number(k.slice(8)) + ' ' + MON[Number(k.slice(5, 7)) - 1] + ' ' + k.slice(2, 4) : '');

/* Name input with history suggestions. Picking one hands the whole record
   back so the form can fill the rest. */
export function GuestNameInput({ value, onChange, onPick, dir, exclude, placeholder }: {
  value: string;
  onChange: (v: string) => void;
  onPick: (g: KnownGuest) => void;
  dir: Map<string, KnownGuest>;
  exclude: string[];            // names already on this booking
  placeholder?: string;
}) {
  const s = useStore();
  const [focus, setFocus] = useState(false);
  const list = focus ? matches(dir, value, exclude) : [];
  return (
    <View>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder || 'Guest name'}
        placeholderTextColor="#C0BFC6"
        style={st.input}
        autoCorrect={false}
        /* 'sentences' capitalises the first word only, so "priya sharma" was
           entered as "Priya sharma". A guest name is words. */
        autoCapitalize="words"
        enterKeyHint="next"
        onFocus={() => setFocus(true)}
        /* Give a tap on a suggestion time to land before the list closes. */
        onBlur={() => setTimeout(() => setFocus(false), 180)}
      />
      {list.length ? (
        <View style={st.list}>
          <Text style={st.listHead}>From past stays</Text>
          {list.map((g) => (
            <TouchableOpacity
              key={g.name + g.lastKey}
              style={st.item}
              activeOpacity={0.7}
              onPress={() => { onPick(g); setFocus(false); }}
            >
              {(() => {
                /* Their own ID photo from the last stay, so the right person is recognisable. */
                const docs = ((s.idDocs || {})[String(g.lastRow)] || []) as { id: number; slot: string; type: string }[];
                const mine = docs.find((d) => d.slot === frontForGuest(g.lastPos || 1) && /^image\//.test(d.type));
                return mine
                  ? <Image source={{ uri: api.attachmentUrl(s.pin, mine.id) }} style={st.idAvatar} />
                  : <View style={st.avatar}><Text style={st.avatarTxt}>{g.name.slice(0, 1).toUpperCase()}</Text></View>;
              })()}
              <View style={{ flex: 1 }}>
                <Text style={st.name} numberOfLines={1}>{g.name}</Text>
                {g.party.length ? <Text style={st.party} numberOfLines={1}>{'with ' + g.party.map((x) => x.name).join(', ')}</Text> : null}
                {(() => {
                  const n = (((s.idDocs || {})[String(g.lastRow)] || []) as { slot: string }[]).filter((d) => !/-back$/.test(d.slot)).length;
                  return n ? <Text style={st.ids}>{n + ' ID' + (n === 1 ? '' : 's') + ' on file'}</Text> : null;
                })()}
                <Text style={st.meta} numberOfLines={1}>
                  {[g.birthYr && 'b. ' + g.birthYr, g.phone, g.stays + ' stay' + (g.stays === 1 ? '' : 's'),
                    g.lastKey && 'last ' + fmt(g.lastKey) + (g.lastUnit ? ' · ' + g.lastUnit : g.lastProp ? ' · ' + g.lastProp : '')]
                    .filter(Boolean).join(' · ')}
                </Text>
              </View>
              {g.stayingNow ? <Text style={st.now}>Staying now</Text> : null}
            </TouchableOpacity>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const st = StyleSheet.create({
  input: {
    borderWidth: 1, borderColor: C.line, borderRadius: 12, paddingVertical: 11, paddingHorizontal: 13,
    fontSize: 15, backgroundColor: '#fff', color: C.ink, fontFamily: F.med,
  },
  list: {
    marginTop: 6, borderRadius: 14, borderWidth: 1, borderColor: G.glassLine, backgroundColor: '#FFFCF8', overflow: 'hidden',
    shadowColor: G.shadow, shadowOpacity: 0.1, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 4,
  },
  listHead: { fontFamily: F.bold, fontSize: 10.5, letterSpacing: 1, textTransform: 'uppercase', color: C.muted, paddingHorizontal: 12, paddingTop: 9, paddingBottom: 3 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9, paddingHorizontal: 12, borderTopWidth: 1, borderTopColor: C.hair },
  avatar: { width: 30, height: 30, borderRadius: 15, backgroundColor: 'rgba(233,185,110,0.22)', alignItems: 'center', justifyContent: 'center' },
  avatarTxt: { fontFamily: F.xbold, fontSize: 13, color: G.gold3 },
  name: { fontFamily: F.bold, fontSize: 14, color: C.ink },
  idAvatar: { width: 40, height: 40, borderRadius: 10, backgroundColor: C.line },
  ids: { fontFamily: F.bold, fontSize: 11, color: C.green, marginTop: 1 },
  party: { fontFamily: F.semi, fontSize: 11.5, color: C.blue2, marginTop: 1 },
  meta: { fontFamily: F.med, fontSize: 11.5, color: C.bark, marginTop: 1 },
  now: { fontFamily: F.bold, fontSize: 10.5, color: C.green, backgroundColor: C.greenbg, paddingVertical: 3, paddingHorizontal: 8, borderRadius: 999, overflow: 'hidden' },
});
