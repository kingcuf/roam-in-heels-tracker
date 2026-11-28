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
  ActivityIndicator, KeyboardAvoidingView, useWindowDimensions, Modal, Platform, Pressable, ScrollView, StyleSheet, Text,
  TextInput, TouchableOpacity, View,
} from 'react-native';
import Svg, { Circle, Line, Path, Polyline, Rect, Text as SvgText, Defs, LinearGradient as SvgGrad, Stop } from 'react-native-svg';
import { SafeAreaView } from 'react-native-safe-area-context';
import { C, F, G, groupINR } from './theme';
import { api } from './api';
import { useStore } from './store';
import { Shimmer, useToast } from './ui';

type Row = { key: string; value: number };
type Chart = { kind: 'bar' | 'line' | 'table'; title: string; unit: string; measure: string; group: string; rows: Row[]; total: number };
export type Usage = {
  budget: number; spentInr: number; pct: number; questions: number; cacheHits?: number; avgInr?: number;
  since?: string; emailOn?: boolean; tokens?: { in: number; cached: number; out: number };
  recent?: { at: string; user: string; model: string; inr: number; cached: boolean; ok: boolean; q: string }[];
};
export type Report = {
  kind?: 'report'; question: string; title: string; summary: string;
  kpis: { label: string; value: string; note?: string }[];
  charts: Chart[]; records: { kind: string; rows: any[] } | null;
  insights: string[]; followups: string[];
  queries: number; ms: number; model: string; at: string; cached?: boolean;
};
export type Answer = {
  kind: 'chat'; question: string; text: string; chart: Chart | null;
  records: { kind: string; rows: any[] } | null; followups: string[];
  queries: number; ms: number; at: string; cached?: boolean;
};
type Msg =
  | { id: string; role: 'user'; text: string }
  | { id: string; role: 'ai'; a: Answer }
  | { id: string; role: 'report'; r: Report }
  | { id: string; role: 'error'; text: string; q: string; mode: 'chat' | 'report' };
type Session = { id: string; title: string; msgs: Msg[]; at: string };

/* Chats live in this browser only. */
const KEY = 'spira_ai_chats_v1';
const MAX_KEEP = 15;
const load = (): Session[] => { try { return JSON.parse(globalThis.localStorage?.getItem(KEY) || '[]'); } catch { return []; } };
const save = (r: Session[]) => { try { globalThis.localStorage?.setItem(KEY, JSON.stringify(r.slice(0, MAX_KEEP))); } catch {} };
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

/* What the model is told about the conversation so far: each question with
   our own answer text (or the report's summary). Never earlier tool data. */
function historyOf(msgs: Msg[]) {
  const out: { q: string; a: string }[] = [];
  for (let i = 0; i < msgs.length; i++) {
    const m = msgs[i], n = msgs[i + 1];
    if (m.role !== 'user' || !n) continue;
    if (n.role === 'ai') out.push({ q: m.text, a: n.a.text });
    else if (n.role === 'report') out.push({ q: m.text, a: n.r.title + '. ' + n.r.summary });
  }
  return out;
}

const STARTERS = [
  'How is this month going compared to last month?',
  'Who still owes us money?',
  'Which property earned more this month?',
  'Which booking channel brings the most revenue?',
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
    <TouchableOpacity onPress={onPress} activeOpacity={0.85} style={st.fab} accessibilityLabel="Ask AI">
      <Sparkle size={17} color={G.gold1} />
      <Text style={st.fabTxt}>Ask AI</Text>
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

/* ── a report, shown inside the chat when the user asks for one ── */
function ReportBlock({ r }: { r: Report }) {
  return (
    <View style={st.reportWrap}>
      <View style={st.reportHead}>
        <View style={st.reportBadge}><Text style={st.reportBadgeTxt}>REPORT</Text></View>
        <Text style={st.meta2}>{new Date(r.at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</Text>
      </View>
      <Text style={st.title}>{r.title}</Text>
      <Text style={st.summary}>{r.summary}</Text>
      {r.kpis.length ? (
        <View style={[st.kpiGrid, { marginTop: 12 }]}>
          {r.kpis.map((k, i) => (
            <View key={i} style={st.kpi}>
              <Text style={st.kpiLbl} numberOfLines={2}>{k.label}</Text>
              <Text style={st.kpiVal} numberOfLines={1} adjustsFontSizeToFit>{k.value}</Text>
              {k.note ? <Text style={[st.kpiNote, /^\s*[-−–]|\b(down|fell|drop)/i.test(k.note) && { color: C.red }]} numberOfLines={2}>{k.note}</Text> : null}
            </View>
          ))}
        </View>
      ) : null}
      <View style={{ gap: 12, marginTop: 12 }}>
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
      </View>
    </View>
  );
}

function AiAvatar() {
  return <View style={st.avatar}><Sparkle size={13} color={G.gold1} /></View>;
}

function AnswerBubble({ a }: { a: Answer }) {
  return (
    <View style={st.aiRow}>
      <AiAvatar />
      <View style={{ flex: 1, gap: 10 }}>
        <View style={st.aiBubble}><Text style={st.aiTxt}>{a.text}</Text></View>
        {a.chart ? <ChartCard c={a.chart} /> : null}
        {a.records && a.records.rows.length ? <RecordsCard rec={a.records} /> : null}
      </View>
    </View>
  );
}

function Typing({ report }: { report: boolean }) {
  const steps = report ? ['Gathering the conversation', 'Running queries', 'Building charts', 'Writing the report'] : ['Thinking', 'Checking your data', 'Writing the answer'];
  const [i, setI] = useState(0);
  useEffect(() => { const t = setInterval(() => setI((n) => Math.min(n + 1, steps.length - 1)), 2200); return () => clearInterval(t); }, []);
  return (
    <View style={st.aiRow}>
      <AiAvatar />
      <View style={{ flex: 1, gap: 10 }}>
        <View style={[st.aiBubble, { flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start' }]}>
          <ActivityIndicator size="small" color={C.blue} />
          <Text style={[st.aiTxt, { color: C.bark }]}>{steps[i] + '…'}</Text>
        </View>
        {report ? <View style={st.card}><Shimmer h={18} w="60%" /><Shimmer h={12} style={{ marginTop: 10 }} /><Shimmer h={120} r={14} style={{ marginTop: 12 }} /></View> : null}
      </View>
    </View>
  );
}

/* ── credit meter ── */
const meterColor = (pct: number) => (pct >= 100 ? C.red : pct >= 70 ? G.gold2 : C.green);
function Meter({ u, onPress }: { u: Usage; onPress: () => void }) {
  return (
    <TouchableOpacity onPress={onPress} style={st.meterChip} accessibilityLabel="AI credit usage">
      <View style={[st.meterDot, { backgroundColor: meterColor(u.pct) }]} />
      <Text style={st.meterTxt}>{'Credit ₹' + u.spentInr.toFixed(2) + ' of ₹' + groupINR(u.budget) + ' used'}</Text>
      <Text style={st.meterChev}>›</Text>
    </TouchableOpacity>
  );
}

function UsageView({ u, admin, onTopUp, onTest }: { u: Usage; admin: boolean; onTopUp: (n: number) => void; onTest: () => void }) {
  const [amt, setAmt] = useState('');
  const pct = Math.min(100, u.pct);
  return (
    <View style={{ gap: 12 }}>
      <View style={st.card}>
        <Text style={st.answerKicker}>AI CREDIT</Text>
        <Text style={[st.title, { marginTop: 6 }]}>{'₹' + u.spentInr.toFixed(2) + ' of ₹' + groupINR(u.budget)}</Text>
        <View style={[st.barTrack, { height: 12, marginTop: 12 }]}>
          <View style={[st.barFill, { height: 12, width: `${Math.max(1, pct)}%` as any, backgroundColor: meterColor(u.pct) }]} />
          <View style={st.mark70} />
        </View>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 }}>
          <Text style={st.meta}>{u.pct.toFixed(1) + '% used'}</Text>
          <Text style={st.meta}>alert at 70% · stops at 100%</Text>
        </View>
        <View style={[st.kpiGrid, { marginTop: 12 }]}>
          <View style={st.uStat}><Text style={st.kpiLbl}>Questions</Text><Text style={st.uVal}>{u.questions}</Text></View>
          <View style={st.uStat}><Text style={st.kpiLbl}>Free (cached)</Text><Text style={st.uVal}>{u.cacheHits ?? 0}</Text></View>
          <View style={st.uStat}><Text style={st.kpiLbl}>Avg / question</Text><Text style={st.uVal}>{'₹' + (u.avgInr ?? 0).toFixed(2)}</Text></View>
          <View style={st.uStat}><Text style={st.kpiLbl}>Left (≈ questions)</Text><Text style={st.uVal}>{u.avgInr ? groupINR(Math.max(0, (u.budget - u.spentInr) / u.avgInr)) : '—'}</Text></View>
        </View>
        <Text style={[st.meta, { textAlign: 'left', marginTop: 10 }]}>
          {'Since ' + (u.since ? new Date(u.since).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : 'start')
            + '. The app’s own estimate from token counts, plus 10% margin — Google AI Studio’s billing page is exact. Repeat questions within 24 hours are answered free from the cache.'}
        </Text>
      </View>
      {admin ? (
        <View style={st.card}>
          <Text style={st.cardTitle}>Alerts</Text>
          <Text style={[st.summary, { fontSize: 13.5 }]}>
            {u.emailOn ? 'Email alert is on: you get one email at 70% and one at 100%. Admins also see a banner on the Action tab.'
              : 'Admins see a banner on the Action tab at 70%. Email alerts are off — they need a Resend key (see setup).'}
          </Text>
          {u.emailOn ? (
            <TouchableOpacity onPress={onTest} style={[st.follow, { marginTop: 10, justifyContent: 'center' }]}>
              <Text style={[st.followTxt, { flex: 0, fontFamily: F.bold }]}>Send a test email</Text>
            </TouchableOpacity>
          ) : null}
          <Text style={[st.cardTitle, { marginTop: 16 }]}>Record a top-up</Text>
          <Text style={[st.summary, { fontSize: 13.5 }]}>After adding credit in Google AI Studio, enter the new balance. The meter restarts from now.</Text>
          <View style={[st.composer, { marginHorizontal: 0, marginTop: 10 }]}>
            <TextInput value={amt} onChangeText={(t) => setAmt(t.replace(/[^0-9]/g, ''))} placeholder="New credit, e.g. 500"
              placeholderTextColor={C.muted} keyboardType="number-pad" style={st.input} />
            <TouchableOpacity onPress={() => { const n = Number(amt); if (n) { onTopUp(n); setAmt(''); } }} disabled={!Number(amt)}
              style={[st.send, { width: 'auto' as any, paddingHorizontal: 16 }, !Number(amt) && { opacity: 0.35 }]}>
              <Text style={[st.sendTxt, { fontSize: 14, marginTop: 0 }]}>Save</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}
      {u.recent && u.recent.length ? (
        <View style={st.card}>
          <Text style={[st.cardTitle, { marginBottom: 8 }]}>Recent questions</Text>
          {u.recent.map((r, i) => (
            <View key={i} style={[st.tRow, { alignItems: 'center' }, i % 2 === 1 && { backgroundColor: C.warm2 }]}>
              <View style={{ flex: 1, paddingRight: 8 }}>
                <Text style={st.tKey} numberOfLines={1}>{r.q}</Text>
                <Text style={st.meta2}>{(r.user || 'owner') + ' · ' + new Date(r.at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) + (r.ok ? '' : ' · failed')}</Text>
              </View>
              <Text style={[st.tVal, r.cached && { color: C.green }]}>{r.cached ? 'free' : '₹' + r.inr.toFixed(2)}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

/* ── the screen ── */
export function AIAnalyst({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const s = useStore();
  const toast = useToast();
  const { width } = useWindowDimensions();
  const starters = STARTERS.slice(0, width < 600 ? 2 : 4);
  const admin = s.me?.role === 'Admin' || !s.me?.username;
  const [usage, setUsage] = useState<Usage | null>(null);
  const [chats, setChats] = useState<Session[]>(() => load());
  const [active, setActive] = useState<string>('new');      // session id | 'new' | 'usage'
  const [text, setText] = useState('');
  const [pending, setPending] = useState<{ sid: string; report: boolean } | null>(null);
  const scroll = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const tabsRef = useRef<React.ComponentRef<typeof ScrollView>>(null);

  useEffect(() => { save(chats); }, [chats]);
  const cur = useMemo(() => chats.find((c) => c.id === active) || null, [chats, active]);
  const lastAns = useMemo(() => {
    if (!cur) return null;
    for (let i = cur.msgs.length - 1; i >= 0; i--) { const m = cur.msgs[i]; if (m.role === 'ai') return m.a; if (m.role === 'report') return m.r; }
    return null;
  }, [cur]);
  const hasAnswer = !!cur && cur.msgs.some((m) => m.role === 'ai' || m.role === 'report');

  const loadUsage = () => api.aiUsage(s.pin).then((r) => setUsage(r.usage)).catch(() => {});
  useEffect(() => { if (visible) loadUsage(); }, [visible]);
  const topUp = async (n: number) => {
    try { const r = await api.aiSetBudget(s.pin, n); setUsage(r.usage); toast(r.message); }
    catch (e: any) { toast(e?.message || 'Could not save', false); }
  };
  const testMail = async () => {
    try { const r = await api.aiTestAlert(s.pin); toast(r.message); } catch (e: any) { toast(e?.message || 'Could not send', false); }
  };
  const toEnd = () => setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 60);
  /* A new report opens at its title, not its last line. */
  const [focusId, setFocusId] = useState<string | null>(null);
  const patch = (sid: string, f: (c: Session) => Session) => setChats((all) => all.map((c) => (c.id === sid ? f(c) : c)));

  /* Send one message. `mode` 'report' builds a report from the whole chat;
     anything else is a normal chat answer (the server also spots "generate a
     report" typed in words). */
  const send = async (raw: string, mode?: 'chat' | 'report') => {
    const q = raw.trim();
    if (!q || pending) return;
    let sid = cur ? cur.id : '';
    const prior = cur ? cur.msgs : [];
    if (!sid) {
      sid = uid();
      const sess: Session = { id: sid, title: q.length > 42 ? q.slice(0, 40) + '…' : q, msgs: [], at: new Date().toISOString() };
      setChats((all) => [sess, ...all].slice(0, MAX_KEEP));
      setActive(sid);
      setTimeout(() => tabsRef.current?.scrollTo({ x: 0, animated: true }), 30);
    }
    const hist = historyOf(prior.filter((m) => m.role !== 'error'));
    const isReport = mode === 'report' || /\breport\b/i.test(q);
    setText('');
    patch(sid, (c) => ({ ...c, msgs: [...c.msgs.filter((m) => m.role !== 'error'), { id: uid(), role: 'user', text: q }] }));
    setPending({ sid, report: isReport });
    toEnd();
    try {
      const r = await api.askAI(s.pin, q, hist, mode);
      const out = r.report;
      const msg: Msg = out.kind === 'report' ? { id: uid(), role: 'report', r: out } : { id: uid(), role: 'ai', a: out };
      patch(sid, (c) => ({ ...c, msgs: [...c.msgs, msg], at: new Date().toISOString() }));
      if (msg.role === 'report') setFocusId(msg.id);
      if (r.usage) setUsage((u) => ({ ...(u || {}), ...r.usage }));
      if (r.usage && r.usage.pct >= 70) loadUsage();
    } catch (e: any) {
      patch(sid, (c) => ({ ...c, msgs: [...c.msgs, { id: uid(), role: 'error', text: e?.message || 'Something went wrong.', q, mode: mode || 'chat' }] }));
    } finally {
      setPending(null);
      if (!isReport) toEnd();
    }
  };
  const retry = (m: Extract<Msg, { role: 'error' }>) => {
    if (!cur) return;
    /* Drop the failed question and its error, then ask it again. */
    const msgs = cur.msgs.slice(0, -2);
    patch(cur.id, (c) => ({ ...c, msgs }));
    setTimeout(() => send(m.q, m.mode), 0);
  };
  const remove = (id: string) => { setChats((all) => all.filter((c) => c.id !== id)); if (active === id) setActive('new'); };
  const busyHere = !!pending && (!cur || pending.sid === cur.id);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} presentationStyle="fullScreen">
      <View style={st.screen}>
        <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
          <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            {/* header */}
            <View style={[st.header, st.col]}>
              <View style={st.hIcon}><Sparkle size={20} color="#fff" /></View>
              <View style={{ flex: 1 }}>
                <Text style={st.hTitle}>AI Analyst</Text>
                {usage ? <Meter u={usage} onPress={() => { setActive('usage'); loadUsage(); }} />
                  : <Text style={st.hSub}>Chat about bookings, revenue, guests & costs</Text>}
              </View>
              <TouchableOpacity onPress={onClose} style={st.close} accessibilityLabel="Close AI Analyst">
                <Text style={st.closeX}>✕</Text>
              </TouchableOpacity>
            </View>

            {/* chat sessions */}
            <View style={st.tabsBar}><View style={st.col}>
            <ScrollView ref={tabsRef} horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={st.tabs}>
              <TouchableOpacity onPress={() => setActive('new')} style={[st.tab, st.tabNew, active === 'new' && st.tabOn]}>
                <Text style={[st.tabTxt, active === 'new' && st.tabTxtOn]}>＋ New chat</Text>
              </TouchableOpacity>
              {chats.map((c) => (
                <Pressable key={c.id} onPress={() => { setActive(c.id); toEnd(); }} style={[st.tab, active === c.id && st.tabOn]}>
                  {pending?.sid === c.id ? <ActivityIndicator size="small" color={active === c.id ? '#fff' : C.blue} style={{ marginRight: 6 }} /> : null}
                  <Text style={[st.tabTxt, active === c.id && st.tabTxtOn]} numberOfLines={1}>{c.title}</Text>
                  {active === c.id && pending?.sid !== c.id ? (
                    <TouchableOpacity onPress={() => remove(c.id)} hitSlop={8} accessibilityLabel="Delete chat">
                      <Text style={st.tabX}>✕</Text>
                    </TouchableOpacity>
                  ) : null}
                </Pressable>
              ))}
            </ScrollView>
            </View></View>

            {/* body */}
            <ScrollView ref={scroll} style={{ flex: 1 }} contentContainerStyle={[st.body, st.col]} keyboardShouldPersistTaps="handled">
              {active === 'usage' && usage ? <UsageView u={usage} admin={admin} onTopUp={topUp} onTest={testMail} />
                : cur ? (
                  <View style={{ gap: 14 }}>
                    {cur.msgs.map((m) => m.role === 'user' ? (
                      <View key={m.id} style={st.qBubble}><Text style={st.qTxt}>{m.text}</Text></View>
                    ) : m.role === 'ai' ? <AnswerBubble key={m.id} a={m.a} />
                      : m.role === 'report' ? (
                        <View key={m.id} onLayout={(e) => {
                          if (focusId !== m.id) return;
                          const y = e.nativeEvent.layout.y;
                          setFocusId(null);
                          setTimeout(() => scroll.current?.scrollTo({ y: Math.max(0, y - 8), animated: true }), 30);
                        }}><ReportBlock r={m.r} /></View>
                      )
                      : (
                        <View key={m.id} style={st.aiRow}>
                          <AiAvatar />
                          <View style={[st.aiBubble, { flex: 1, borderColor: C.redbg }]}>
                            <Text style={[st.aiTxt, { color: C.red }]}>{m.text}</Text>
                            <TouchableOpacity onPress={() => retry(m)} style={{ marginTop: 6 }}><Text style={st.retry}>Try again</Text></TouchableOpacity>
                          </View>
                        </View>
                      ))}
                    {busyHere ? <Typing report={!!pending?.report} /> : null}
                    <Text style={st.meta}>AI can make mistakes · figures come from your own data</Text>
                  </View>
                ) : (
                  <View style={{ gap: 14 }}>
                    <View style={st.hero}>
                      <View style={st.heroIcon}><Sparkle size={26} /></View>
                      <Text style={st.heroT}>Ask about your business</Text>
                      <Text style={st.heroS}>Chat in plain English. Ask follow-ups, and say “generate report” whenever you want it all in one report.</Text>
                    </View>
                    <Text style={st.sectionLbl}>Try asking</Text>
                    {starters.map((q) => (
                      <TouchableOpacity key={q} onPress={() => send(q)} style={st.follow} disabled={!!pending} activeOpacity={0.7}>
                        <Text style={st.followTxt}>{q}</Text>
                        <Text style={st.followArrow}>↗</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
            </ScrollView>

            <View style={st.col}>
            {/* After every answer: the report action, then the next questions. */}
            {cur && hasAnswer && !busyHere && active !== 'usage' ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={st.chips} keyboardShouldPersistTaps="handled">
                <TouchableOpacity onPress={() => send('Generate a report of this conversation', 'report')} style={[st.chip, st.chipReport]} activeOpacity={0.8}>
                  <Text style={st.chipReportTxt}>▤  Generate report</Text>
                </TouchableOpacity>
                {(lastAns?.followups || []).map((q, i) => (
                  <TouchableOpacity key={i} onPress={() => send(q)} style={st.chip} activeOpacity={0.75}>
                    <Sparkle size={12} />
                    <Text style={st.chipTxt} numberOfLines={1}>{q}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            ) : null}
            {/* composer */}
            <View style={st.composer}>
              <TextInput
                value={text} onChangeText={setText} placeholder={cur ? 'Message…' : 'Ask about your business…'}
                placeholderTextColor={C.muted} style={st.input} multiline numberOfLines={1} maxLength={600}
                onSubmitEditing={() => send(text)} blurOnSubmit returnKeyType="send"
                onKeyPress={(e: any) => { if (Platform.OS === 'web' && e.nativeEvent.key === 'Enter' && !e.nativeEvent.shiftKey) { e.preventDefault?.(); send(text); } }}
              />
              <TouchableOpacity onPress={() => send(text)} disabled={!text.trim() || !!pending}
                style={[st.send, (!text.trim() || !!pending) && { opacity: 0.35 }]} accessibilityLabel="Send message">
                {pending ? <ActivityIndicator color="#fff" size="small" /> : <Text style={st.sendTxt}>↑</Text>}
              </TouchableOpacity>
            </View>
            </View>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const st = StyleSheet.create({
  /* Same spot, height and shape as the Action tab's "+ To-do" button, so the
     two floating actions line up across tabs. */
  fab: {
    position: 'absolute', right: 16, bottom: 18, height: 46, paddingHorizontal: 18, borderRadius: 23, backgroundColor: C.navy,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, zIndex: 20,
    shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 6,
  },
  fabTxt: { color: '#fff', fontSize: 14, fontFamily: F.bold },

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
  hero: { alignItems: 'center', paddingTop: 36, paddingBottom: 18, paddingHorizontal: 12, gap: 8 },
  heroIcon: { width: 56, height: 56, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.85)', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: G.glassEdge, marginBottom: 4 },
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

  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 10, marginHorizontal: 14, marginTop: 8, marginBottom: 10, padding: 6, paddingLeft: 16,
    backgroundColor: '#fff', borderRadius: 26, borderWidth: 1, borderColor: C.line, shadowColor: G.shadow, shadowOpacity: 0.08, shadowRadius: 14, shadowOffset: { width: 0, height: 4 } },
  input: { flex: 1, minHeight: 40, maxHeight: 110, height: 40, fontFamily: F.med, fontSize: 15, color: C.ink, paddingTop: 10, paddingBottom: 10, outlineStyle: 'none' as any },
  send: { width: 40, height: 40, borderRadius: 20, backgroundColor: C.navy, alignItems: 'center', justifyContent: 'center' },
  sendTxt: { color: '#fff', fontSize: 19, fontFamily: F.xbold, marginTop: -2 },
  meterChip: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', marginTop: 3, paddingVertical: 3, paddingHorizontal: 9, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.75)', borderWidth: 1, borderColor: C.line },
  meterDot: { width: 7, height: 7, borderRadius: 4 },
  meterTxt: { fontFamily: F.semi, fontSize: 11.5, color: C.bark },
  meterChev: { fontFamily: F.bold, fontSize: 12, color: C.muted },
  mark70: { position: 'absolute', left: '70%', top: -3, bottom: -3, width: 2, backgroundColor: C.ink, opacity: 0.25 },
  uStat: { flexGrow: 1, flexBasis: '45%', backgroundColor: C.warm2, borderRadius: 14, padding: 12 },
  uVal: { fontFamily: F.xbold, fontSize: 18, color: C.ink, marginTop: 2 },
  meta2: { fontFamily: F.med, fontSize: 11, color: C.muted, marginTop: 2 },
  /* On a wide screen the analyst reads as a centred column, like a chat app. */
  col: { width: '100%', maxWidth: 780, alignSelf: 'center' },
  aiRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  avatar: { width: 28, height: 28, borderRadius: 10, backgroundColor: C.navy, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  aiBubble: { backgroundColor: 'rgba(255,255,255,0.92)', borderRadius: 18, borderTopLeftRadius: 6, paddingVertical: 11, paddingHorizontal: 14, borderWidth: 1, borderColor: G.glassEdge },
  aiTxt: { fontFamily: F.med, fontSize: 14.5, color: C.ink, lineHeight: 22 },
  retry: { fontFamily: F.bold, fontSize: 13, color: C.blue },
  reportWrap: { backgroundColor: 'rgba(255,255,255,0.6)', borderRadius: 22, padding: 14, borderWidth: 1, borderColor: 'rgba(185,128,54,0.3)' },
  reportHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  reportBadge: { backgroundColor: C.navy, borderRadius: 8, paddingVertical: 3, paddingHorizontal: 8 },
  reportBadgeTxt: { color: G.gold1, fontFamily: F.xbold, fontSize: 10.5, letterSpacing: 1 },
  chipReport: { backgroundColor: C.navy, borderColor: C.navy },
  chipReportTxt: { fontFamily: F.bold, fontSize: 13, color: '#fff' },
  chips: { paddingHorizontal: 14, paddingTop: 8, paddingBottom: 2, gap: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, maxWidth: 280, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 999,
    backgroundColor: '#fff', borderWidth: 1, borderColor: 'rgba(185,128,54,0.35)' },
  chipTxt: { fontFamily: F.semi, fontSize: 13, color: C.ink, flexShrink: 1 },
  thread: { fontFamily: F.med, fontSize: 10.5, color: C.muted, textAlign: 'center', marginBottom: 6 },
});
