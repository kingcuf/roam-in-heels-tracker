import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, Animated, Modal, PanResponder, Platform, Pressable, ScrollView, StyleSheet,
  Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { C, F, G, inr } from './theme';
import Reanimated, { Easing, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { CountUp, Glass, GoldFill, Tilt3D } from './motion';

const APressable = Reanimated.createAnimatedComponent(Pressable);
const SPRING = { damping: 16, stiffness: 200, mass: 0.6 };

/* ── Destructive confirm ──
   react-native-web ships Alert as an empty stub (`static alert() {}`), so every
   Alert.alert confirm silently did nothing on dashboard.roam-in-heels.com and
   the Delete buttons were dead. Routed through one helper so a destructive
   action can never again be wired to a no-op on one platform.

   It then asked through the PHONE's box rather than the app's, and that was its
   own kind of dead: the browser's confirm() is drawn by the browser, at its own
   speed, sometimes behind the page — "Request delete" was pressed twice, 1.2 s
   apart, with nothing visibly happening either time. Every other question this
   app asks is a sheet that rises from the bottom, so this one is too. The
   signature is unchanged, so all seven call sites keep working. */
type ConfirmReq = { title: string; message: string; confirmLabel: string; onConfirm: () => void };
let askConfirm: ((r: ConfirmReq) => void) | null = null;

export function confirmDestructive(title: string, message: string, onConfirm: () => void, confirmLabel = 'Delete') {
  if (askConfirm) { askConfirm({ title, message, confirmLabel, onConfirm }); return; }
  /* Only if ConfirmHost is not mounted — the old behaviour, so a destructive
     action still asks rather than firing or dying silently. */
  if (Platform.OS === 'web') {
    if (typeof window === 'undefined' || window.confirm(message)) onConfirm();
    return;
  }
  Alert.alert(title, message, [
    { text: 'Cancel', style: 'cancel' },
    { text: confirmLabel, style: 'destructive', onPress: onConfirm },
  ]);
}

/* Mounted once, at the root. */
export function ConfirmHost() {
  const [req, setReq] = useState<ConfirmReq | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    askConfirm = (r) => { setReq(r); setOpen(true); };
    return () => { askConfirm = null; };
  }, []);
  const close = () => setOpen(false);
  const go = () => { const f = req?.onConfirm; setOpen(false); if (f) f(); };
  return (
    <SheetShell
      visible={open} onClose={close} maxHeight="60%"
      header={
        <View style={st.sheetHead}>
          <View style={{ flex: 1 }}>
            <Text style={st.sheetT}>{req?.title || ''}</Text>
          </View>
          <TouchableOpacity onPress={close} style={st.xBtn} hitSlop={8}><Text style={st.xTxt}>×</Text></TouchableOpacity>
        </View>
      }
    >
      <View style={{ paddingHorizontal: 18, paddingTop: 14, paddingBottom: 30 }}>
        <Text style={{ fontSize: 15, lineHeight: 22, color: C.ink, fontFamily: F.med }}>{req?.message || ''}</Text>
        <View style={{ flexDirection: 'row', gap: 10, marginTop: 18, justifyContent: 'flex-end' }}>
          <Btn title="Cancel" kind="ghost" onPress={close} />
          <Btn title={req?.confirmLabel || 'Delete'} kind="danger" onPress={go} />
        </View>
      </View>
    </SheetShell>
  );
}

/* ── Toast ── */
type ToastFn = (msg: string, ok?: boolean) => void;
const ToastCtx = createContext<ToastFn>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [msg, setMsg] = useState('');
  const [ok, setOk] = useState(true);
  const anim = useRef(new Animated.Value(0)).current;
  const timer = useRef<any>(null);
  const show: ToastFn = (m, good = true) => {
    setMsg(m); setOk(good);
    Animated.timing(anim, { toValue: 1, duration: 250, useNativeDriver: true }).start();
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      Animated.timing(anim, { toValue: 0, duration: 250, useNativeDriver: true }).start();
    }, 3200);
  };
  return (
    <ToastCtx.Provider value={show}>
      {children}
      <Animated.View
        pointerEvents="none"
        style={[st.toast, { backgroundColor: ok ? C.green : C.red, opacity: anim,
          transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [80, 0] }) }] }]}
      >
        <Text style={{ color: '#fff', fontSize: 14, fontFamily: F.semi }}>{msg}</Text>
      </Animated.View>
    </ToastCtx.Provider>
  );
}

/* ── Loader overlay ── */
export function Loader({ visible }: { visible: boolean }) {
  /* Most fetches finish in well under half a second; flashing a dimmed
     overlay for each one read as the whole app blinking. Show a small pill,
     and only once a load has actually been slow. */
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (!visible) { setShow(false); return; }
    const t = setTimeout(() => setShow(true), 350);
    return () => clearTimeout(t);
  }, [visible]);
  if (!show) return null;
  return (
    <View style={st.loaderWrap} pointerEvents="none">
      <View style={st.loaderCard}>
        <ActivityIndicator color={C.blue} size="small" />
        <Text style={{ fontFamily: F.semi, color: C.navy, fontSize: 13 }}>Updating…</Text>
      </View>
    </View>
  );
}

/* ── Panel / headings ── */
export function Panel({ children, style }: { children: React.ReactNode; style?: any }) {
  return <Glass style={[st.panel, style]} radius={24} padding={16}>{children}</Glass>;
}
export function PanelTitle({ children, right, onPress }: { children: React.ReactNode; right?: React.ReactNode; onPress?: () => void }) {
  const inner = (
    <View style={st.panelTitleRow}>
      <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
        <View style={st.dot} />
        <Text style={st.panelTitle}>{children}</Text>
      </View>
      {right}
    </View>
  );
  return onPress ? <Pressable onPress={onPress}>{inner}</Pressable> : inner;
}
export function KpiH({ children }: { children: React.ReactNode }) {
  return <Text style={st.kpiH}>{children}</Text>;
}
export function CountBadge({ n }: { n: number }) {
  return (
    <View style={st.badge}><Text style={{ color: '#fff', fontSize: 11, fontFamily: F.bold }}>{n}</Text></View>
  );
}

/* ── KPI card ── */
const KPI_COLORS: Record<string, { border: string; bg: string; val: string }> = {
  rev: { border: C.green, bg: C.greenbg, val: C.green },
  exp: { border: C.amber, bg: C.amberbg, val: C.amber },
  pnl: { border: C.red, bg: C.redbg, val: C.red },
  bkg: { border: C.sky, bg: C.skybg, val: C.sky },
  inv: { border: C.copper, bg: C.amberbg, val: C.blue2 },   // gold — invested savings
};
export function KpiCard({ kind, label, value, onPress }: { kind: 'rev' | 'exp' | 'pnl' | 'bkg' | 'inv'; label: string; value: string | number; onPress?: () => void }) {
  const cc = KPI_COLORS[kind];
  return (
    <Tilt3D style={st.kpi} onPress={onPress} disabled={!onPress}>
      <Glass radius={22} style={{ flex: 1 }} padding={15}>
        <Text style={st.kpiLbl}>{label}</Text>
        <CountUp value={value} style={[st.kpiVal, { color: cc.val }]} numberOfLines={1} adjustsFontSizeToFit />
        {onPress ? <Text style={st.kpiChev}>›</Text> : null}
      </Glass>
    </Tilt3D>
  );
}

/* ── Buttons ── */
export function Btn({ title, onPress, kind = 'primary', disabled, style }: {
  title: string; onPress?: () => void; kind?: 'primary' | 'ghost' | 'danger' | 'mini'; disabled?: boolean; style?: any;
}) {
  const sc = useSharedValue(1);
  const a = useAnimatedStyle(() => ({ transform: [{ scale: sc.value }] }));
  const base: any[] = [st.btn];
  const txt: any[] = [{ fontFamily: F.bold, fontSize: 14 }];
  if (kind === 'primary') { base.push(st.btnPrimary); txt.push({ color: '#fff', letterSpacing: 0.2 }); }
  if (kind === 'ghost') { base.push(st.btnGhost); txt.push({ color: C.bark }); }
  if (kind === 'danger') { base.push({ backgroundColor: 'rgba(255,255,255,0.75)', borderWidth: 1, borderColor: C.red }); txt.push({ color: C.red }); }
  if (kind === 'mini') { base.push(st.btnGhost, { paddingVertical: 5, paddingHorizontal: 12, borderRadius: 10 }); txt.push({ color: C.blue2, fontSize: 12 }); }
  if (disabled) base.push({ opacity: 0.5 });
  return (
    <APressable
      style={[...base, style, a]} onPress={onPress} disabled={disabled}
      onPressIn={() => { sc.value = withSpring(0.95, SPRING); }}
      onPressOut={() => { sc.value = withSpring(1, SPRING); }}
    >
      {kind === 'primary' ? <GoldFill radius={999} /> : null}
      <Text style={txt}>{title}</Text>
    </APressable>
  );
}

/* ── Pills ── */
const PILL: Record<string, { bg: string; fg: string }> = {
  Stay: { bg: C.greenbg, fg: C.green },
  Resold: { bg: C.amberbg, fg: C.amber },
  Pass: { bg: C.skybg, fg: C.sky },
  Active: { bg: C.greenbg, fg: C.green },
  Inactive: { bg: '#f1f1f1', fg: '#777' },
};
export function Pill({ label }: { label: string }) {
  const p = PILL[label] || { bg: C.bone, fg: C.bark };
  return (
    <View style={{ backgroundColor: p.bg, borderRadius: 20, paddingHorizontal: 8, paddingVertical: 2, alignSelf: 'flex-start' }}>
      <Text style={{ color: p.fg, fontSize: 11, fontFamily: F.semi }}>{label}</Text>
    </View>
  );
}

/* ── Simple table ── */
export type Cell = { v: React.ReactNode; num?: boolean; color?: string; nowrap?: boolean };
export function STable({ headers, rows, totalRow, onRowPress, onCellPress, minColWidth }: {
  headers: { t: string; num?: boolean }[];
  rows: Cell[][];
  totalRow?: Cell[];
  onRowPress?: (i: number) => void;
  onCellPress?: (row: number, col: number) => void;
  minColWidth?: number;
}) {
  const renderCell = (c: Cell, j: number, ri: number, isTotal: boolean) => {
    const oneLine = c.num || c.nowrap;   // digits/dates must never wrap mid-value
    const content = typeof c.v === 'string' || typeof c.v === 'number' ? (
      <Text
        style={[st.td, c.num && st.tdNum, isTotal && { fontFamily: F.bold, color: C.navy }, c.color ? { color: c.color } : null]}
        numberOfLines={oneLine ? 1 : undefined}
        adjustsFontSizeToFit={oneLine || undefined}
        minimumFontScale={0.75}
      >
        {String(c.v)}
      </Text>
    ) : (c.v as any);
    const cell = (
      <View key={j} style={[st.tdWrap, minColWidth ? { minWidth: minColWidth } : null, c.num && { alignItems: 'flex-end' }]}>
        {content}
      </View>
    );
    if (onCellPress) {
      return (
        <Pressable key={j} style={[st.tdWrap, minColWidth ? { minWidth: minColWidth } : null, c.num && { alignItems: 'flex-end' }]}
          onPress={() => onCellPress(ri, j)}>
          {content}
        </Pressable>
      );
    }
    return cell;
  };
  return (
    <View>
      <View style={[st.tr, { borderBottomColor: C.line }]}>
        {headers.map((h, j) => (
          <View key={j} style={[st.tdWrap, minColWidth ? { minWidth: minColWidth } : null, h.num && { alignItems: 'flex-end' }]}>
            <Text style={st.th}>{h.t}</Text>
          </View>
        ))}
      </View>
      {rows.length === 0 && (
        <Text style={{ color: '#999', paddingVertical: 8, fontSize: 13 }}>No data</Text>
      )}
      {rows.map((r, i) => {
        const inner = <View style={st.tr}>{r.map((c, j) => renderCell(c, j, i, false))}</View>;
        return onRowPress ? (
          <Pressable key={i} onPress={() => onRowPress(i)}>{inner}</Pressable>
        ) : (
          <View key={i}>{inner}</View>
        );
      })}
      {totalRow && rows.length > 0 && (
        <View style={[st.tr, { backgroundColor: C.warm2, borderTopWidth: 1, borderTopColor: C.line, borderBottomWidth: 0 }]}>
          {totalRow.map((c, j) => renderCell(c, j, -1, true))}
        </View>
      )}
    </View>
  );
}

/* ── Summary line (drill sheets) ── */
export function SumLine({ label, amt, tot, raw }: { label: string; amt: number | string; tot?: boolean; raw?: boolean }) {
  return (
    <View style={[st.sumline, tot && st.sumlineTot]}>
      <Text style={{ fontSize: 14, fontWeight: tot ? '800' : '400', color: C.ink, flex: 1 }}>{label}</Text>
      <Text style={{ fontSize: 14, fontWeight: tot ? '800' : '400', color: C.ink }}>
        {raw ? String(amt) : inr(Number(amt))}
      </Text>
    </View>
  );
}
export function H4({ children }: { children: React.ReactNode }) {
  return <Text style={st.h4}>{children}</Text>;
}
export function Hint({ children }: { children: React.ReactNode }) {
  return <Text style={{ fontSize: 11, color: C.muted, marginTop: 8 }}>{children}</Text>;
}

/* ── Bottom sheet (drill-down drawer) ── */
/* ── Bottom sheet shell ──
   One implementation behind every sheet and picker:
     • the dim backdrop fades while the sheet springs up (the old
       animationType="slide" slid the backdrop up with it);
     • drag the handle/header down to dismiss, with a velocity flick;
     • closing animates out first, then unmounts the Modal. The whole exit is
       ~220 ms, inside the 320 ms SHEET_DISMISS_MS callers wait before they
       navigate (see CalendarScreen.editStay). */
const SHEET_OUT_MS = 200;
export function SheetShell({ visible, onClose, maxHeight = '88%', children, header }: {
  visible: boolean; onClose: () => void; maxHeight?: any; children: React.ReactNode; header?: React.ReactNode;
}) {
  const [mounted, setMounted] = useState(visible);
  const height = useRef(700);
  const entered = useRef(false);
  const y = useSharedValue(900);
  const fade = useSharedValue(0);

  const enter = () => {
    y.value = height.current;
    y.value = withSpring(0, { damping: 24, stiffness: 260, mass: 0.8 });
    fade.value = withTiming(1, { duration: 220 });
    entered.current = true;
  };

  useEffect(() => {
    if (visible) {
      setMounted(true);
      if (!entered.current && height.current !== 700) enter();
      return;
    }
    if (!mounted) return;
    fade.value = withTiming(0, { duration: SHEET_OUT_MS });
    y.value = withTiming(height.current, { duration: SHEET_OUT_MS, easing: Easing.in(Easing.cubic) });
    const t = setTimeout(() => { setMounted(false); entered.current = false; }, SHEET_OUT_MS + 10);
    return () => clearTimeout(t);
  }, [visible]);

  const drag = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dy) > 4 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderMove: (_, g) => {
        y.value = g.dy > 0 ? g.dy : g.dy * 0.15;          // resist pulling up
        fade.value = 1 - Math.min(1, Math.max(0, g.dy) / (height.current * 1.2));
      },
      onPanResponderRelease: (_, g) => {
        if (g.dy > Math.min(140, height.current * 0.3) || g.vy > 0.9) onCloseRef.current();
        else {
          y.value = withSpring(0, { damping: 22, stiffness: 260 });
          fade.value = withTiming(1, { duration: 150 });
        }
      },
      onPanResponderTerminate: () => { y.value = withSpring(0); fade.value = withTiming(1); },
    })
  ).current;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const sheetA = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }] }));
  const ovlA = useAnimatedStyle(() => ({ opacity: fade.value }));

  if (!mounted) return null;
  return (
    <Modal visible transparent animationType="none" statusBarTranslucent onRequestClose={onClose}>
      <Reanimated.View style={[st.ovl, ovlA]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
      </Reanimated.View>
      <Reanimated.View
        style={[st.sheet, { maxHeight }, sheetA]}
        onLayout={(e) => {
          height.current = e.nativeEvent.layout.height || 600;
          if (visible && !entered.current) enter();
        }}
      >
        <View {...drag.panHandlers}>
          <View style={st.grabZone}><View style={st.grab} /></View>
          {header}
        </View>
        {children}
      </Reanimated.View>
    </Modal>
  );
}

export function Sheet({ visible, title, value, onClose, children }: {
  visible: boolean; title: string; value: string; onClose: () => void; children: React.ReactNode;
}) {
  return (
    <SheetShell
      visible={visible} onClose={onClose}
      header={
        <View style={st.sheetHead}>
          <View style={{ flex: 1 }}>
            <Text style={st.sheetT}>{title}</Text>
            {value ? <Text style={st.sheetV}>{value}</Text> : null}
          </View>
          <TouchableOpacity onPress={onClose} style={st.xBtn} hitSlop={8}><Text style={st.xTxt}>×</Text></TouchableOpacity>
        </View>
      }
    >
      <ScrollView style={{ paddingHorizontal: 18 }} contentContainerStyle={{ paddingBottom: 34 }}>
        {children}
      </ScrollView>
    </SheetShell>
  );
}

/* ── Picker modal (used by Select / time fields) ── */
/* Above this many options the list runs past the foot of a 70 %-tall sheet on a
   390 px phone — Expense has 20 categories and "Utilities", the 12th, could not
   be reached without scrolling the sheet. A filter box costs one line and turns
   "scroll and hunt" into "type three letters". Below the threshold the box would
   only be in the way. */
const FILTER_FROM = 10;

export function PickerModal({ visible, title, options, value, onSelect, onClose }: {
  visible: boolean; title: string; options: string[]; value: string;
  onSelect: (v: string) => void; onClose: () => void;
}) {
  const [q, setQ] = useState('');
  /* Cleared on every open: a leftover filter would hide the list it is meant
     to shorten. */
  useEffect(() => { if (visible) setQ(''); }, [visible]);
  const filter = options.length > FILTER_FROM;
  const nq = q.trim().toLowerCase();
  const shown = nq ? options.filter((o) => o.toLowerCase().includes(nq)) : options;
  return (
    <SheetShell
      visible={visible} onClose={onClose} maxHeight="70%"
      header={
        <View>
          <View style={st.sheetHead}>
            <Text style={[st.sheetT, { flex: 1 }]}>{title}</Text>
            <TouchableOpacity onPress={onClose} style={st.xBtn} hitSlop={8}><Text style={st.xTxt}>×</Text></TouchableOpacity>
          </View>
          {filter && (
            <View style={{ paddingHorizontal: 16, paddingBottom: 10 }}>
              <SearchInput value={q} onChange={setQ} placeholder={`Search ${options.length} options…`} />
            </View>
          )}
        </View>
      }
    >
      <ScrollView contentContainerStyle={{ paddingBottom: 30, paddingHorizontal: 10, paddingTop: 6 }} keyboardShouldPersistTaps="handled">
        {!shown.length && (
          <Text style={{ padding: 16, color: C.muted, fontFamily: F.med, fontSize: 13 }}>
            Nothing matches “{q.trim()}”. Clear the search to see all {options.length}.
          </Text>
        )}
        {shown.map((o, i) => {
          const on = o === value;
          return (
            <TouchableOpacity key={i} style={[st.optRow, on && st.optOn]} activeOpacity={0.6}
              onPress={() => { onSelect(o); onClose(); }}>
              <Text style={{ fontSize: 15, color: on ? G.gold3 : C.ink, fontFamily: on ? F.bold : F.med, flex: 1 }}>
                {o === '' ? '—' : o}
              </Text>
              {on ? <Text style={{ color: G.gold2, fontFamily: F.bold }}>✓</Text> : null}
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </SheetShell>
  );
}

/* ── Segmented control (container tabs' sub-nav, per design/flow.md §2) ── */
export function Segmented({ segments, value, onChange }: {
  segments: { key: string; label: string; dot?: boolean }[];
  value: string;
  onChange: (k: string) => void;
}) {
  const [w, setW] = useState(0);
  const idx = Math.max(0, segments.findIndex((x) => x.key === value));
  const segW = segments.length ? (w - 6) / segments.length : 0;
  const x = useSharedValue(0);
  useEffect(() => { x.value = withSpring(idx * segW, SPRING); }, [idx, segW]);
  const pill = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));
  return (
    <View style={st.segTrack} onLayout={(e) => setW(e.nativeEvent.layout.width)}>
      {w > 0 ? <Reanimated.View style={[st.segPill, { width: segW }, pill]} /> : null}
      {segments.map((sg) => {
        const active = sg.key === value;
        return (
          <TouchableOpacity
            key={sg.key} activeOpacity={0.8} onPress={() => onChange(sg.key)}
            style={st.seg}
          >
            {/* Six segments (an Admin's Add tab) leave ~59 px each on a 390 px
                phone: a size down keeps "Inventory" and "Messages" on one line. */}
            <Text style={[st.segLbl, segments.length > 5 && { fontSize: 11.5, letterSpacing: -0.2 }, active && st.segLblActive]}
              numberOfLines={1}>{sg.label}</Text>
            {sg.dot && <View style={st.segDot} />}
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

/* ── Search input ── */
export function SearchInput({ value, onChange, placeholder }: { value: string; onChange: (s: string) => void; placeholder: string }) {
  return (
    <TextInput
      value={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor={C.muted}
      style={st.search} autoCapitalize="none" autoCorrect={false} enterKeyHint="search"
    />
  );
}

const st = StyleSheet.create({
  toast: {
    position: 'absolute', bottom: 100, left: 20, right: 20, padding: 14,
    borderRadius: 12, alignItems: 'center', zIndex: 100, elevation: 8,
  },
  loaderWrap: { position: 'absolute', top: 96, left: 0, right: 0, alignItems: 'center', zIndex: 90 },
  loaderCard: {
    backgroundColor: 'rgba(255,255,255,0.95)', borderRadius: 999, paddingVertical: 8, paddingHorizontal: 16,
    flexDirection: 'row', alignItems: 'center', gap: 12, elevation: 6,
    shadowColor: C.navy, shadowOpacity: 0.28, shadowRadius: 20, shadowOffset: { width: 0, height: 8 },
  },
  panel: { marginBottom: 14 },
  panelTitleRow: {
    flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: G.glassLine,
    paddingBottom: 10, marginBottom: 12,
  },
  panelTitle: { fontSize: 12, textTransform: 'uppercase', letterSpacing: 1.5, color: C.blue, fontFamily: F.semi },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: C.blue, marginRight: 8 },
  kpiH: { fontSize: 11, fontFamily: F.semi, letterSpacing: 2, textTransform: 'uppercase', color: C.blue, marginBottom: 10, marginTop: 6, marginLeft: 2 },
  badge: { backgroundColor: C.blue, borderRadius: 20, paddingHorizontal: 8, paddingVertical: 1, marginLeft: 6 },
  kpi: { flexBasis: '48%', flexGrow: 1, minHeight: 92 },
  kpiAccent: { position: 'absolute', top: 14, left: -15, width: 4, height: 26, borderTopRightRadius: 3, borderBottomRightRadius: 3 },
  kpiLbl: { fontSize: 10, fontFamily: F.bold, letterSpacing: 0.6, textTransform: 'uppercase', color: C.bark },
  kpiVal: { fontSize: 23, fontFamily: F.xbold, marginTop: 8, letterSpacing: -0.5 },
  kpiChev: { position: 'absolute', top: 11, right: 14, fontSize: 17, opacity: 0.45, fontFamily: F.bold, color: C.bark },
  btn: { paddingVertical: 13, paddingHorizontal: 22, borderRadius: 999, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  btnPrimary: {
    shadowColor: G.gold3, shadowOpacity: 0.35, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 4,
    overflow: 'visible',
  },
  btnGhost: { backgroundColor: 'rgba(255,255,255,0.7)', borderWidth: 1, borderColor: G.glassLine },
  tr: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: C.hair, alignItems: 'center' },
  tdWrap: { flex: 1, paddingVertical: 9, paddingHorizontal: 6 },
  th: { fontSize: 10.5, textTransform: 'uppercase', color: C.muted, letterSpacing: 0.5, fontFamily: F.semi },
  td: { fontSize: 13, color: C.ink },
  tdNum: { textAlign: 'right', fontVariant: ['tabular-nums'] },
  sumline: { flexDirection: 'row', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: C.hair },
  sumlineTot: { borderTopWidth: 2, borderTopColor: C.line, borderBottomWidth: 0, marginTop: 4 },
  h4: { fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.6, color: C.blue, marginTop: 16, marginBottom: 6, fontFamily: F.bold },
  ovl: {
    position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, backgroundColor: 'rgba(40,28,14,.32)',
    ...(Platform.OS === 'web' ? ({ backdropFilter: 'blur(3px)' } as any) : null),
  },
  sheet: {
    position: 'absolute', bottom: 0, left: 0, right: 0, maxHeight: '88%',
    backgroundColor: '#FFFCF8', borderTopLeftRadius: 30, borderTopRightRadius: 30, paddingBottom: 10,
    shadowColor: G.shadow, shadowOpacity: 0.2, shadowRadius: 30, shadowOffset: { width: 0, height: -8 }, elevation: 12,
  },
  grabZone: { paddingTop: 9, paddingBottom: 4, alignItems: 'center' },
  grab: { width: 44, height: 5, borderRadius: 3, backgroundColor: 'rgba(90,58,20,0.18)' },
  xTxt: { fontSize: 20, lineHeight: 22, color: C.bark },
  sheetHead: {
    paddingHorizontal: 18, paddingTop: 6, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: G.glassLine,
    flexDirection: 'row', alignItems: 'flex-start',
  },
  sheetT: { fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, color: C.muted, fontFamily: F.bold },
  sheetV: { fontSize: 22, fontFamily: F.xbold, marginTop: 3, color: C.navy },
  xBtn: { backgroundColor: 'rgba(90,58,20,0.07)', borderRadius: 16, width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  optRow: { paddingVertical: 13, paddingHorizontal: 14, borderRadius: 14, flexDirection: 'row', alignItems: 'center' },
  optOn: { backgroundColor: 'rgba(233,185,110,0.18)' },
  search: {
    borderWidth: 1, borderColor: C.line, borderRadius: 9, paddingVertical: 9, paddingHorizontal: 12,
    fontSize: 14, backgroundColor: '#fff', color: C.ink,
  },
  segTrack: {
    flexDirection: 'row', backgroundColor: 'rgba(255,255,255,0.45)', borderRadius: 999, height: 40,
    borderWidth: 1, borderColor: G.glassEdge, marginHorizontal: 14, marginTop: 14, marginBottom: 10,
    padding: 3,
  },
  segPill: {
    position: 'absolute', top: 3, bottom: 3, left: 3, borderRadius: 999, backgroundColor: '#fff',
    shadowColor: G.shadow, shadowOpacity: 0.16, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 2,
  },
  seg: {
    flex: 1, borderRadius: 999, alignItems: 'center', justifyContent: 'center', flexDirection: 'row',
  },
  segLbl: { fontSize: 12, fontFamily: F.semi, color: 'rgba(15,42,51,.65)' }, // 12px: 4 segments per track
  segLblActive: { color: C.ink, fontFamily: F.bold },
  segDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: C.amber, marginLeft: 5 },
});
