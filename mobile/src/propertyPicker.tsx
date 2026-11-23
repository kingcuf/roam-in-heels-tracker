import React from 'react';
import { Image, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { C, F, G } from './theme';
import { coverFor } from './unitCovers';

/* ── Property picker with photos ────────────────────────────────────────────
   A unit is recognised by sight faster than by name ("403, Plot no 685, Sector
   45" vs the blue-sofa flat). The chosen unit shows as a photo banner, so a
   booking filed against the wrong flat is obvious before Save; the tiles
   beneath switch units in one tap, with no dropdown in between. */

export const unitNo = (name: string) => (String(name || '').match(/\d{3,4}/) || [''])[0];

type Opt = { name: string; location?: string };

export function PropertyPicker({ value, options, onChange, compact }: {
  value: string; options: Opt[]; onChange: (name: string) => void;
  /* Smaller banner, for forms where the unit is one field among many. */
  compact?: boolean;
}) {
  const cur = options.find((o) => o.name === value);
  return (
    <View style={{ gap: 10 }}>
      {cur ? <UnitBanner name={cur.name} sub={cur.location} height={compact ? 112 : 150} /> : (
        <View style={[st.empty, { height: compact ? 70 : 90 }]}><Text style={st.emptyT}>Pick a unit below</Text></View>
      )}
      {options.length > 1 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingVertical: 2 }}>
          {options.map((o) => <UnitTile key={o.name} name={o.name} on={o.name === value} onPress={() => onChange(o.name)} />)}
        </ScrollView>
      ) : null}
    </View>
  );
}

export function UnitBanner({ name, sub, height = 150 }: { name: string; sub?: string; height?: number }) {
  const no = unitNo(name);
  const cover = coverFor(no);
  /* The listing photos are portrait (3:4), so a plain cover crop lands on the
     ceiling. Lay the photo out at full width and lift it, as the booking
     page's banner does, so the room itself fills the strip. */
  const [w, setW] = React.useState(0);
  const imgH = w * 4 / 3;
  return (
    <View style={[st.banner, { height }]} onLayout={(e) => setW(e.nativeEvent.layout.width)}>
      {cover && w ? <Image source={cover} style={{ position: 'absolute', left: 0, width: w, height: imgH, top: -(imgH - height) * 0.62 }} resizeMode="cover" /> : !cover ? (
        <LinearGradient colors={['#2B2B33', '#16161A']} style={StyleSheet.absoluteFill} />
      ) : null}
      <LinearGradient colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.62)']} style={StyleSheet.absoluteFill} />
      <View style={st.bannerTxt}>
        <Text style={st.bannerKick}>UNIT</Text>
        <Text style={st.bannerNo}>{no || name}</Text>
        <Text style={st.bannerName} numberOfLines={1}>{no ? name + (sub ? ' · ' + sub : '') : sub || ''}</Text>
      </View>
    </View>
  );
}

export function UnitTile({ name, on, onPress, label }: { name: string; on: boolean; onPress: () => void; label?: string }) {
  const no = unitNo(name);
  const cover = coverFor(no);
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.8} accessibilityRole="radio" accessibilityState={{ selected: on }}
      accessibilityLabel={name} style={{ alignItems: 'center', gap: 5 }}>
      <View style={[st.tile, on && st.tileOn]}>
        {cover ? <Image source={cover} style={st.tileImg} /> : (
          <LinearGradient colors={['#3A3A44', '#1C1C22']} style={[st.tileImg, st.center]}>
            <Text style={st.tileFallback}>{no || '•'}</Text>
          </LinearGradient>
        )}
        {on ? <View style={st.check}><Text style={st.checkT}>✓</Text></View> : null}
      </View>
      <Text style={[st.tileLbl, on && { color: C.ink }]} numberOfLines={1}>{label || no || name}</Text>
    </TouchableOpacity>
  );
}

/* Quick choice for a short, fixed list (booking type, channel): every option
   visible, one tap, instead of a dropdown that hides them. */
export function ChoiceChips({ value, options, onChange }: {
  value: string; options: string[]; onChange: (v: string) => void;
}) {
  return (
    <View style={st.chips}>
      {options.map((o) => {
        const on = o === value;
        return (
          <TouchableOpacity key={o} onPress={() => onChange(o)} activeOpacity={0.75}
            accessibilityRole="radio" accessibilityState={{ selected: on }} style={[st.chip, on && st.chipOn]}>
            <Text style={[st.chipT, on && st.chipTOn]}>{o}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const st = StyleSheet.create({
  banner: { borderRadius: 18, overflow: 'hidden', backgroundColor: C.ink, justifyContent: 'flex-end' },
  bannerTxt: { padding: 14 },
  bannerKick: { fontFamily: F.bold, fontSize: 10, letterSpacing: 1.6, color: 'rgba(255,255,255,0.75)' },
  bannerNo: { fontFamily: F.xbold, fontSize: 30, color: '#fff', letterSpacing: -0.8, lineHeight: 34 },
  bannerName: { fontFamily: F.semi, fontSize: 12, color: 'rgba(255,255,255,0.88)', marginTop: 1 },
  empty: { borderRadius: 18, borderWidth: 1.5, borderStyle: 'dashed', borderColor: C.line, alignItems: 'center', justifyContent: 'center' },
  emptyT: { fontFamily: F.semi, fontSize: 13, color: C.muted },
  tile: { width: 66, height: 66, borderRadius: 16, padding: 2, borderWidth: 2, borderColor: 'transparent' },
  tileOn: { borderColor: G.gold2 },
  tileImg: { width: '100%', height: '100%', borderRadius: 12 },
  center: { alignItems: 'center', justifyContent: 'center' },
  tileFallback: { fontFamily: F.xbold, fontSize: 15, color: '#fff' },
  tileLbl: { fontFamily: F.bold, fontSize: 12, color: C.bark, maxWidth: 70 },
  check: { position: 'absolute', top: -4, right: -4, width: 20, height: 20, borderRadius: 10, backgroundColor: G.gold2, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#fff' },
  checkT: { color: '#fff', fontSize: 10, fontFamily: F.xbold },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  chip: { borderRadius: 999, borderWidth: 1, borderColor: C.line, backgroundColor: '#fff', paddingVertical: 8, paddingHorizontal: 13 },
  chipOn: { backgroundColor: C.navy, borderColor: C.navy },
  chipT: { fontFamily: F.semi, fontSize: 13, color: C.bark },
  chipTOn: { color: '#fff' },
});
