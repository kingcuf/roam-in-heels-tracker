/* AI Analyst — the Report tab's floating "Ask AI" button and the full-screen
   report view it opens.

   Every question becomes a report tab: the question, a short answer, headline
   numbers, charts, insights and three follow-up questions. Tapping a
   follow-up (or typing while a report is open) asks in that report's thread,
   so "and last month?" works. Charts are drawn from rows the server computed
   — the model only chooses which queries to show. Reports are kept in this
   browser only. */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text,
  TextInput, TouchableOpacity, View,
} from 'react-native';
import Svg, { Circle, Line, Path, Polyline, Rect, Text as SvgText, Defs, LinearGradient as SvgGrad, Stop } from 'react-native-svg';
import { SafeAreaView } from 'react-native-safe-area-context';
import { C, F, G, groupINR } from './theme';
import { api } from './api';
import { useStore } from './store';
import { Shimmer } from './ui';

type Row = { key: string; value: number };
type Chart = { kind: 'bar' | 'line' | 'table'; title: string; unit: string; measure: string; group: string; rows: Row[]; total: number };
export type Report = {
  id: string; question: string; title: string; summary: string;
  kpis: { label: string; value: string; note?: string }[];
  charts: Chart[]; records: { kind: string; rows: any[] } | null;
  insights: string[]; followups: string[];
  queries: number; ms: number; model: string; at: string;
  history: { q: string; a: string }[];   // the thread this report was asked in
};

const KEY = 'spira_ai_reports_v1';
const MAX_KEEP = 20;
const load = (): Report[] => { try { return JSON.parse(globalThis.localStorage?.getItem(KEY) || '[]'); } catch { return []; } };
const save = (r: Report[]) => { try { globalThis.localStorage?.setItem(KEY, JSON.stringify(r.slice(0, MAX_KEEP))); } catch {} };

const STARTERS = [
  'How is revenue trending month by month?',
  'Which channel brings the most money, and how has that changed?',
  'Which guests still owe us money?',
  'Compare my properties on revenue and nights booked this month',
  'Which weekdays get the most bookings?',
  'What are my biggest expenses and how is profit trending?',
];

/* ── formatting ── */
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function keyLabel(k: string, group: string) {
  if (/^\d{4}-\d{2}$/.test(k)) return MON[+k.slice(5, 7) - 1] + ' ' + k.slice(2, 4);
  if (/^\d{4}-\d{2}-\d{2}$/.test(k)) return +k.slice(8, 10) + ' ' + MON[+k.slice(5, 7) - 1];
  return group === 'none' ? 'Total' : k;
}
function fmt(v: number, unit: string, short = false) {
  if (unit === 'INR') {
    if (short && Math.abs(v) >= 100000) return '₹' + (v / 100000).toFixed(Math.abs(v) >= 1000000 ? 0 : 1) + 'L';
    if (short && Math.abs(v) >= 1000) return '₹' + Math.round(v / 1000) + 'k';
    return '₹' + groupINR(v);
  }
  if (unit === 'nights') return (Math.round(v * 10) / 10) + (short ? '' : ' nights');
  return groupINR(v);
}

/* ── the floating button ── */
export function AIFab({ onPress }: { onPress: () => void }) {
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.85} style={st.fabWrap} accessibilityLabel="Ask AI">
      <View style={st.fab}>
        <Sparkle size={18} color="#fff" />
        <Text style={st.fabTxt}>Ask AI</Text>
      </View>
    </TouchableOpacity>
  );
}

function Sparkle({ size = 16, color = C.blue }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M12 2l1.9 5.6L19.5 9.5l-5.6 1.9L12 17l-1.9-5.6L4.5 9.5l5.6-1.9z" fill={color} />
      <Path d="M19 14l.9 2.4 2.4.9-2.4.9L19 20.6l-.9-2.4-2.4-.9 2.4-.9z" fill={color} opacity={0.75} />
    </Svg>
  );
}

/* ── charts ── */
function BarChart({ c }: { c: Chart }) {
  const rows = c.rows.slice(0, 12);
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.value)));
  return (
    <View style={{ gap: 9 }}>
      {rows.map((r, i) => (
        <View key={r.key + i}>
          <View style={st.barHead}>
            <Text style={st.barLbl} numberOfLines={1}>{keyLabel(r.key, c.group)}</Text>
            <Text style={[st.barVal, r.value < 0 && { color: C.red }]}>{fmt(r.value, c.unit)}</Text>
          </View>
          <View style={st.barTrack}>
            <View style={[st.barFill, { width: `${Math.max(2, (Math.abs(r.value) / max) * 100)}%` as any },
              r.value < 0 && { backgroundColor: C.red }, i === 0 && r.value >= 0 && { backgroundColor: G.gold2 }]} />
          </View>
        </View>
      ))}
      {c.rows.length > rows.length ? <Text style={st.meta}>{'+ ' + (c.rows.length - rows.length) + ' more'}</Text> : null}
    </View>
  );
}

function LineChart({ c }: { c: Chart }) {
  const [w, setW] = useState(320);
  const [sel, setSel] = useState<number | null>(null);
  const rows = c.rows;
  const H = 170, padL = 6, padR = 6, padT = 18, padB = 26;
  const vals = rows.map((r) => r.value);
  const max = Math.max(...vals, 0), min = Math.min(...vals, 0);
  const span = max - min || 1;
  const x = (i: number) => padL + (rows.length === 1 ? (w - padL - padR) / 2 : (i * (w - padL - padR)) / (rows.length - 1));
  const y = (v: number) => padT + (1 - (v - min) / span) * (H - padT - padB);
  const pts = rows.map((r, i) => `${x(i)},${y(r.value)}`).join(' ');
  const area = rows.length > 1 ? `M${x(0)},${y(min)} L` + rows.map((r, i) => `${x(i)},${y(r.value)}`).join(' L') + ` L${x(rows.length - 1)},${y(min)} Z` : '';
  const step = Math.max(1, Math.ceil(rows.length / 6));
  const hi = sel ?? rows.length - 1;
  return (
    <View onLayout={(e) => setW(e.nativeEvent.layout.width)}>
      {rows[hi] ? (
        <Text style={st.lineSel}>
          <Text style={{ color: C.muted, fontFamily: F.semi }}>{keyLabel(rows[hi].key, c.group) + '  '}</Text>
          {fmt(rows[hi].value, c.unit)}
        </Text>
      ) : null}
      <Svg width={w} height={H}>
        <Defs>
          <SvgGrad id="aiArea" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={G.gold1} stopOpacity={0.45} />
            <Stop offset="1" stopColor={G.gold1} stopOpacity={0.02} />
          </SvgGrad>
        </Defs>
        {min < 0 ? <Line x1={padL} x2={w - padR} y1={y(0)} y2={y(0)} stroke={C.line} strokeDasharray="4 4" /> : null}
        {area ? <Path d={area} fill="url(#aiArea)" /> : null}
        <Polyline points={pts} fill="none" stroke={G.gold2} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
        {rows.map((r, i) => (
          <React.Fragment key={r.key}>
            <Circle cx={x(i)} cy={y(r.value)} r={i === hi ? 5 : 3} fill={i === hi ? G.gold2 : '#fff'} stroke={G.gold2} strokeWidth={2} />
            <Rect x={x(i) - (w / rows.length) / 2} y={0} width={w / rows.length} height={H} fill="transparent" onPress={() => setSel(i)} />
            {i % step === 0 || i === rows.length - 1 ? (
              <SvgText x={x(i)} y={H - 6} fontSize={10} fontFamily={F.semi} fill={C.muted} textAnchor={i === 0 ? 'start' : i === rows.length - 1 ? 'end' : 'middle'}>
                {keyLabel(r.key, c.group)}
              </SvgText>
            ) : null}
          </React.Fragment>
        ))}
      </Svg>
    </View>
  );
}

function TableChart({ c }: { c: Chart }) {
  return (
    <View>
      {c.rows.slice(0, 30).map((r, i) => (
        <View key={r.key + i} style={[st.tRow, i % 2 === 1 && { backgroundColor: C.warm2 }]}>
          <Text style={st.tKey} numberOfLines={1}>{keyLabel(r.key, c.group)}</Text>
          <Text style={st.tVal}>{fmt(r.value, c.unit)}</Text>
        </View>
      ))}
    </View>
  );
}

function ChartCard({ c }: { c: Chart }) {
  const kind = c.kind === 'line' && c.rows.length < 2 ? 'bar' : c.kind;
  return (
    <View style={st.card}>
      <View style={st.cardHead}>
        <Text style={st.cardTitle}>{c.title}</Text>
        {c.group !== 'none' && c.rows.length > 1 ? <Text style={st.cardTotal}>{(c.measure === 'avg_booking_value' ? 'Avg ' : 'Total ') + fmt(c.total, c.unit)}</Text> : null}
      </View>
      {kind === 'line' ? <LineChart c={c} /> : kind === 'table' ? <TableChart c={c} /> : <BarChart c={c} />}
    </View>
  );
}

const REC_COLS: Record<string, { k: string; l: string; money?: boolean }[]> = {
  bookings: [{ k: 'guest', l: 'Guest' }, { k: 'net', l: 'Net', money: true }, { k: 'pending', l: 'Pending', money: true }, { k: 'checkin', l: 'Check-in' }, { k: 'property', l: 'Property' }],
  expenses: [{ k: 'date', l: 'Date' }, { k: 'item', l: 'Item' }, { k: 'category', l: 'Category' }, { k: 'amount', l: 'Amount', money: true }],
};
function RecordsCard({ rec }: { rec: NonNullable<Report['records']> }) {
  const cols = (REC_COLS[rec.kind] || []).filter((c) => rec.rows.some((r) => r[c.k] !== undefined && r[c.k] !== ''));
  return (
    <View style={st.card}>
      <Text style={[st.cardTitle, { marginBottom: 8 }]}>{rec.kind === 'expenses' ? 'Expenses' : 'Bookings'}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View>
          <View style={[st.tRow, { borderBottomWidth: 1, borderColor: C.line }]}>
            {cols.map((c) => <Text key={c.k} style={[st.recH, c.money && st.recMoney, c.money && { textAlign: 'right' }]}>{c.l}</Text>)}
          </View>
          {rec.rows.map((r, i) => (
            <View key={i} style={[st.tRow, i % 2 === 1 && { backgroundColor: C.warm2 }]}>
              {cols.map((c) => (
                <Text key={c.k} numberOfLines={1} style={[st.recC, c.money && st.recMoney, c.money && { textAlign: 'right', fontFamily: F.bold },
                  c.k === 'pending' && r.pending > 0 && { color: G.gold3 }]}>
                  {c.money ? (r[c.k] ? '₹' + groupINR(r[c.k]) : '—') : String(r[c.k] ?? '').replace(/^(\d{4})-(\d{2})-(\d{2}).*/, (_, y, m, d) => +d + ' ' + MON[+m - 1])}
                </Text>
              ))}
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

/* ── one report ── */
function ReportView({ r, onAsk, busy }: { r: Report; onAsk: (q: string) => void; busy: boolean }) {
  return (
    <View style={{ gap: 12 }}>
      <View style={st.qBubble}>
        <Text style={st.qTxt}>{r.question}</Text>
      </View>
      <View style={[st.card, st.answer]}>
        <View style={st.answerHead}>
          <Sparkle size={15} />
          <Text style={st.answerKicker}>ANSWER</Text>
        </View>
        <Text style={st.title}>{r.title}</Text>
        <Text style={st.summary}>{r.summary}</Text>
      </View>
      {r.kpis.length ? (
        <View style={st.kpiGrid}>
          {r.kpis.map((k, i) => (
            <View key={i} style={st.kpi}>
              <Text style={st.kpiLbl} numberOfLines={2}>{k.label}</Text>
              <Text style={st.kpiVal} numberOfLines={1} adjustsFontSizeToFit>{k.value}</Text>
              {k.note ? <Text style={st.kpiNote} numberOfLines={2}>{k.note}</Text> : null}
            </View>
          ))}
        </View>
      ) : null}
      {r.charts.map((c, i) => <ChartCard key={i} c={c} />)}
      {r.records && r.records.rows.length ? <RecordsCard rec={r.records} /> : null}
      {r.insights.length ? (
        <View style={st.card}>
          <Text style={[st.cardTitle, { marginBottom: 10 }]}>Insights & trends</Text>
          {r.insights.map((t, i) => (
            <View key={i} style={st.insight}>
              <View style={st.insightDot}><Text style={st.insightN}>{i + 1}</Text></View>
              <Text style={st.insightTxt}>{t}</Text>
            </View>
          ))}
        </View>
      ) : null}
      {r.followups.length ? (
        <View style={{ gap: 8 }}>
          <Text style={st.sectionLbl}>Ask next</Text>
          {r.followups.map((q, i) => (
            <TouchableOpacity key={i} disabled={busy} onPress={() => onAsk(q)} style={st.follow} activeOpacity={0.7}>
              <Text style={st.followTxt}>{q}</Text>
              <Text style={st.followArrow}>↗</Text>
            </TouchableOpacity>
          ))}
        </View>
      ) : null}
      <Text style={st.meta}>
        {new Date(r.at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
          + ' · ' + r.queries + (r.queries === 1 ? ' query' : ' queries') + ' · ' + (r.ms / 1000).toFixed(1) + 's · AI can make mistakes; figures come from your data'}
      </Text>
    </View>
  );
}

function Thinking({ q }: { q: string }) {
  const steps = ['Reading your question', 'Running queries on your data', 'Building charts', 'Writing the report'];
  const [i, setI] = useState(0);
  useEffect(() => { const t = setInterval(() => setI((n) => Math.min(n + 1, steps.length - 1)), 2600); return () => clearInterval(t); }, []);
  return (
    <View style={{ gap: 12 }}>
      <View style={st.qBubble}><Text style={st.qTxt}>{q}</Text></View>
      <View style={[st.card, { gap: 10 }]}>
        <View style={st.answerHead}>
          <ActivityIndicator size="small" color={C.blue} />
          <Text style={[st.answerKicker, { color: C.blue }]}>{steps[i].toUpperCase() + '…'}</Text>
        </View>
        <Shimmer h={20} w="70%" />
        <Shimmer h={12} /><Shimmer h={12} w="90%" /><Shimmer h={12} w="60%" />
      </View>
      <View style={st.kpiGrid}>
        {[0, 1].map((k) => <View key={k} style={st.kpi}><Shimmer h={10} w="60%" /><Shimmer h={22} w="80%" style={{ marginTop: 8 }} /></View>)}
      </View>
      <View style={st.card}><Shimmer h={150} r={14} /></View>
    </View>
  );
}

/* ── the screen ── */
export function AIAnalyst({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const s = useStore();
  const [reports, setReports] = useState<Report[]>(() => load());
  const [active, setActive] = useState<string>('new');
  const [text, setText] = useState('');
  const [pending, setPending] = useState<{ q: string; tab: string } | null>(null);
  const [err, setErr] = useState<{ q: string; msg: string; history: Report['history'] } | null>(null);
  const scroll = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const tabsRef = useRef<React.ComponentRef<typeof ScrollView>>(null);

  useEffect(() => { save(reports); }, [reports]);
  const cur = useMemo(() => reports.find((r) => r.id === active) || null, [reports, active]);

  const ask = async (qRaw: string, history?: Report['history']) => {
    const q = qRaw.trim();
    if (!q || pending) return;
    /* Asking from an open report continues its thread; from "New" starts one. */
    const hist = history ?? (cur ? [...cur.history, { q: cur.question, a: cur.summary }].slice(-4) : []);
    setText(''); setErr(null);
    setPending({ q, tab: 'pending' }); setActive('pending');
    setTimeout(() => scroll.current?.scrollTo({ y: 0, animated: true }), 30);
    try {
      const r = await api.askAI(s.pin, q, hist);
      const rep: Report = { ...r.report, id: String(Date.now()), history: hist };
      setReports((all) => [rep, ...all].slice(0, MAX_KEEP));
      setActive(rep.id);
      setTimeout(() => tabsRef.current?.scrollTo({ x: 0, animated: true }), 30);
    } catch (e: any) {
      setErr({ q, msg: e?.message || 'Something went wrong.', history: hist });
      setActive('error');
    } finally {
      setPending(null);
      setTimeout(() => scroll.current?.scrollTo({ y: 0, animated: true }), 30);
    }
  };

  const remove = (id: string) => {
    setReports((all) => all.filter((r) => r.id !== id));
    if (active === id) setActive('new');
  };

  const tabs: { id: string; label: string }[] = [
    ...(pending ? [{ id: 'pending', label: 'Thinking…' }] : []),
    ...(err && !pending ? [{ id: 'error', label: 'Didn’t work' }] : []),
    ...reports.map((r) => ({ id: r.id, label: r.title })),
  ];

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} presentationStyle="fullScreen">
      <View style={st.screen}>
        <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
          <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            {/* header */}
            <View style={st.header}>
              <View style={st.hIcon}><Sparkle size={20} color="#fff" /></View>
              <View style={{ flex: 1 }}>
                <Text style={st.hTitle}>AI Analyst</Text>
                <Text style={st.hSub}>Ask about bookings, revenue, guests & costs</Text>
              </View>
              <TouchableOpacity onPress={onClose} style={st.close} accessibilityLabel="Close AI Analyst">
                <Text style={st.closeX}>✕</Text>
              </TouchableOpacity>
            </View>

            {/* report tabs */}
            <ScrollView ref={tabsRef} horizontal showsHorizontalScrollIndicator={false} style={st.tabsBar} contentContainerStyle={st.tabs}>
              <TouchableOpacity onPress={() => setActive('new')} style={[st.tab, st.tabNew, active === 'new' && st.tabOn]}>
                <Text style={[st.tabTxt, active === 'new' && st.tabTxtOn]}>＋ New</Text>
              </TouchableOpacity>
              {tabs.map((t) => (
                <Pressable key={t.id} onPress={() => setActive(t.id)} style={[st.tab, active === t.id && st.tabOn]}>
                  {t.id === 'pending' ? <ActivityIndicator size="small" color={active === t.id ? '#fff' : C.blue} style={{ marginRight: 6 }} /> : null}
                  <Text style={[st.tabTxt, active === t.id && st.tabTxtOn]} numberOfLines={1}>{t.label}</Text>
                  {active === t.id && t.id !== 'pending' ? (
                    <TouchableOpacity onPress={() => t.id === 'error' ? (setErr(null), setActive('new')) : remove(t.id)} hitSlop={8} accessibilityLabel="Remove report">
                      <Text style={st.tabX}>✕</Text>
                    </TouchableOpacity>
                  ) : null}
                </Pressable>
              ))}
            </ScrollView>

            {/* body */}
            <ScrollView ref={scroll} style={{ flex: 1 }} contentContainerStyle={st.body} keyboardShouldPersistTaps="handled">
              {active === 'pending' && pending ? <Thinking q={pending.q} />
                : active === 'error' && err ? (
                  <View style={{ gap: 12 }}>
                    <View style={st.qBubble}><Text style={st.qTxt}>{err.q}</Text></View>
                    <View style={[st.card, { borderColor: C.redbg }]}>
                      <Text style={[st.cardTitle, { color: C.red }]}>Couldn’t build this report</Text>
                      <Text style={[st.summary, { marginTop: 6 }]}>{err.msg}</Text>
                      <TouchableOpacity onPress={() => ask(err.q, err.history)} style={[st.follow, { marginTop: 12, justifyContent: 'center' }]}>
                        <Text style={[st.followTxt, { flex: 0, fontFamily: F.bold }]}>Try again</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ) : cur ? <ReportView r={cur} onAsk={(q) => ask(q)} busy={!!pending} />
                : (
                  <View style={{ gap: 14 }}>
                    <View style={st.hero}>
                      <Sparkle size={30} />
                      <Text style={st.heroT}>What do you want to know?</Text>
                      <Text style={st.heroS}>Ask in plain English. You’ll get a report with the answer, charts, trends and what to ask next — built from your own data.</Text>
                    </View>
                    <Text style={st.sectionLbl}>Try one of these</Text>
                    {STARTERS.map((q) => (
                      <TouchableOpacity key={q} onPress={() => ask(q, [])} style={st.follow} disabled={!!pending} activeOpacity={0.7}>
                        <Text style={st.followTxt}>{q}</Text>
                        <Text style={st.followArrow}>↗</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
            </ScrollView>

            {/* composer */}
            <View style={st.composer}>
              <TextInput
                value={text} onChangeText={setText} placeholder={cur ? 'Ask a follow-up…' : 'Ask about your business…'}
                placeholderTextColor={C.muted} style={st.input} multiline numberOfLines={1} maxLength={600}
                onSubmitEditing={() => ask(text)} blurOnSubmit returnKeyType="send"
                onKeyPress={(e: any) => { if (Platform.OS === 'web' && e.nativeEvent.key === 'Enter' && !e.nativeEvent.shiftKey) { e.preventDefault?.(); ask(text); } }}
              />
              <TouchableOpacity onPress={() => ask(text)} disabled={!text.trim() || !!pending}
                style={[st.send, (!text.trim() || !!pending) && { opacity: 0.35 }]} accessibilityLabel="Send question">
                {pending ? <ActivityIndicator color="#fff" size="small" /> : <Text style={st.sendTxt}>↑</Text>}
              </TouchableOpacity>
            </View>
            {cur && !pending ? <Text style={st.thread}>Follow-ups continue this report’s conversation · tap ＋ New to start fresh</Text> : null}
          </KeyboardAvoidingView>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const st = StyleSheet.create({
  fabWrap: { position: 'absolute', right: 16, bottom: 112, zIndex: 20 },
  fab: {
    flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: C.navy, paddingVertical: 13, paddingHorizontal: 18,
    borderRadius: 999, shadowColor: G.shadow, shadowOpacity: 0.35, shadowRadius: 16, shadowOffset: { width: 0, height: 8 }, elevation: 8,
    borderWidth: 1, borderColor: 'rgba(233,185,110,0.6)',
  },
  fabTxt: { color: '#fff', fontFamily: F.xbold, fontSize: 14, letterSpacing: 0.2 },

  screen: { flex: 1, backgroundColor: G.bgMid },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 8 },
  hIcon: { width: 40, height: 40, borderRadius: 14, backgroundColor: C.navy, alignItems: 'center', justifyContent: 'center' },
  hTitle: { fontFamily: F.xbold, fontSize: 20, color: C.ink },
  hSub: { fontFamily: F.med, fontSize: 12, color: C.bark, marginTop: 1 },
  close: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.8)', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: C.line },
  closeX: { fontSize: 15, color: C.ink, fontFamily: F.bold },

  tabsBar: { flexGrow: 0, borderBottomWidth: 1, borderColor: G.glassLine },
  tabs: { paddingHorizontal: 14, paddingVertical: 10, gap: 8, alignItems: 'center' },
  tab: { flexDirection: 'row', alignItems: 'center', maxWidth: 210, paddingVertical: 8, paddingHorizontal: 13, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.7)', borderWidth: 1, borderColor: C.line },
  tabNew: { borderStyle: 'dashed', borderColor: G.gold2 },
  tabOn: { backgroundColor: C.navy, borderColor: C.navy, borderStyle: 'solid' },
  tabTxt: { fontFamily: F.semi, fontSize: 13, color: C.ink, flexShrink: 1 },
  tabTxtOn: { color: '#fff' },
  tabX: { color: 'rgba(255,255,255,0.7)', fontSize: 11, marginLeft: 8, fontFamily: F.bold },

  body: { padding: 16, paddingBottom: 30 },
  hero: { alignItems: 'center', paddingVertical: 22, paddingHorizontal: 12, gap: 8 },
  heroT: { fontFamily: F.xbold, fontSize: 22, color: C.ink, textAlign: 'center' },
  heroS: { fontFamily: F.med, fontSize: 13.5, color: C.bark, textAlign: 'center', lineHeight: 20 },
  sectionLbl: { fontFamily: F.bold, fontSize: 12, color: C.bark, letterSpacing: 0.6, textTransform: 'uppercase', marginTop: 4 },

  qBubble: { alignSelf: 'flex-end', maxWidth: '88%', backgroundColor: C.navy, borderRadius: 18, borderBottomRightRadius: 6, paddingVertical: 10, paddingHorizontal: 14 },
  qTxt: { color: '#fff', fontFamily: F.semi, fontSize: 14, lineHeight: 20 },

  card: { backgroundColor: 'rgba(255,255,255,0.88)', borderRadius: 20, padding: 16, borderWidth: 1, borderColor: G.glassEdge,
    shadowColor: G.shadow, shadowOpacity: 0.06, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } },
  answer: { borderColor: 'rgba(185,128,54,0.25)' },
  answerHead: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  answerKicker: { fontFamily: F.bold, fontSize: 11, letterSpacing: 1, color: G.gold3 },
  title: { fontFamily: F.xbold, fontSize: 20, color: C.ink, lineHeight: 26 },
  summary: { fontFamily: F.med, fontSize: 14.5, color: '#3A3A42', lineHeight: 22, marginTop: 6 },

  kpiGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  kpi: { flexGrow: 1, flexBasis: '45%', backgroundColor: 'rgba(255,255,255,0.88)', borderRadius: 18, padding: 14, borderWidth: 1, borderColor: G.glassEdge },
  kpiLbl: { fontFamily: F.semi, fontSize: 12, color: C.bark },
  kpiVal: { fontFamily: F.xbold, fontSize: 22, color: C.ink, marginTop: 4 },
  kpiNote: { fontFamily: F.semi, fontSize: 11.5, color: C.green, marginTop: 3 },

  cardHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, marginBottom: 12 },
  cardTitle: { fontFamily: F.xbold, fontSize: 15.5, color: C.ink, flexShrink: 1 },
  cardTotal: { fontFamily: F.bold, fontSize: 12, color: C.bark },

  barHead: { flexDirection: 'row', justifyContent: 'space-between', gap: 10, marginBottom: 4 },
  barLbl: { fontFamily: F.semi, fontSize: 13, color: C.ink, flexShrink: 1 },
  barVal: { fontFamily: F.bold, fontSize: 13, color: C.ink },
  barTrack: { height: 9, borderRadius: 6, backgroundColor: C.bone, overflow: 'hidden' },
  barFill: { height: 9, borderRadius: 6, backgroundColor: G.gold1 },
  lineSel: { fontFamily: F.xbold, fontSize: 16, color: C.ink, marginBottom: 4 },

  tRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, paddingHorizontal: 6, borderRadius: 6 },
  tKey: { fontFamily: F.semi, fontSize: 13, color: C.ink, flexShrink: 1 },
  tVal: { fontFamily: F.bold, fontSize: 13, color: C.ink },
  recMoney: { width: 78, paddingRight: 8 },
  recH: { width: 100, fontFamily: F.bold, fontSize: 11, color: C.bark, textTransform: 'uppercase' },
  recC: { width: 100, fontFamily: F.med, fontSize: 12.5, color: C.ink },

  insight: { flexDirection: 'row', gap: 10, marginBottom: 10 },
  insightDot: { width: 22, height: 22, borderRadius: 11, backgroundColor: C.amberbg, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  insightN: { fontFamily: F.xbold, fontSize: 11, color: G.gold3 },
  insightTxt: { flex: 1, fontFamily: F.med, fontSize: 14, color: '#3A3A42', lineHeight: 21 },

  follow: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: 'rgba(255,255,255,0.78)', borderRadius: 16, paddingVertical: 13, paddingHorizontal: 15, borderWidth: 1, borderColor: C.line },
  followTxt: { flex: 1, fontFamily: F.semi, fontSize: 14, color: C.ink, lineHeight: 20 },
  followArrow: { fontSize: 15, color: C.blue, fontFamily: F.bold },

  meta: { fontFamily: F.med, fontSize: 11, color: C.muted, textAlign: 'center', marginTop: 4, lineHeight: 16 },

  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 10, marginHorizontal: 14, marginTop: 6, marginBottom: 4, padding: 6, paddingLeft: 16,
    backgroundColor: '#fff', borderRadius: 26, borderWidth: 1, borderColor: C.line, shadowColor: G.shadow, shadowOpacity: 0.08, shadowRadius: 14, shadowOffset: { width: 0, height: 4 } },
  input: { flex: 1, minHeight: 40, maxHeight: 110, height: 40, fontFamily: F.med, fontSize: 15, color: C.ink, paddingTop: 10, paddingBottom: 10, outlineStyle: 'none' as any },
  send: { width: 40, height: 40, borderRadius: 20, backgroundColor: C.navy, alignItems: 'center', justifyContent: 'center' },
  sendTxt: { color: '#fff', fontSize: 19, fontFamily: F.xbold, marginTop: -2 },
  thread: { fontFamily: F.med, fontSize: 10.5, color: C.muted, textAlign: 'center', marginBottom: 6 },
});
