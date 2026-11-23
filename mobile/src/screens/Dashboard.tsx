import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { C, F, G, inr, groupINR } from '../theme';
import { CountUp, Glass, Rise } from '../motion';
import HeelsArt from '../intro/HeelsArt';
import { LinearGradient } from 'expo-linear-gradient';
import { useStore, rangeText, RangeSel } from '../store';
import {
  computeCash, computeMonthDrill, computePayback, computeRepeatByMonth, computeSavings,
  Payback, Savings,
} from '../logic';
import {
  Btn, H4, Hint, KpiCard, KpiH, Panel, PanelTitle, Pill, STable, Sheet, SumLine, useToast, Cell,
} from '../ui';
import { SelectField, DateField } from '../fields';
import { BankChart } from '../charts';
import RevenueTarget from './RevenueTarget';

type Drill =
  | { kind: 'metric'; metric: string }
  | { kind: 'month'; mk: string; metric: 'bk' | 'rev' | 'exp' | 'net' }
  | null;

export default function Dashboard() {
  const s = useStore();
  const toast = useToast();
  const d = s.dash;
  const [drill, setDrill] = useState<Drill>(null);
  const scrollRef = useRef<React.ComponentRef<typeof ScrollView>>(null);

  // T5: re-tapping the active Dashboard tab scrolls back to the top
  useEffect(() => {
    if (s.tab === 'dash') scrollRef.current?.scrollTo({ y: 0, animated: true });
  }, [s.retapSig]);

  /* The Report refresh deliberately fetches the dashboard only, so the requests
     behind the waiting line below can be older than the figures. Same staleness
     window every other tab uses; it is a no-op when they are fresh. */
  useEffect(() => { if (s.tab === 'dash') s.maybeReloadTickets(); }, [s.tab]);

  /* What this person has asked for and has not got yet.
     Kept strictly beside the KPIs, never inside them: the figures above are
     what the books say, and this is what is queued against them. Every number
     here is one the person typed into their own request — nothing is modelled. */
  const queued = useMemo(() => {
    const num = (v: any) => {
      const n = parseFloat(String(v ?? '').replace(/[^0-9.\-]/g, ''));
      return isFinite(n) ? n : 0;
    };
    let bkN = 0, bkAmt = 0, exN = 0, exAmt = 0, otherN = 0, changeN = 0, sentBack = 0;
    for (const t of s.myLive) {
      if (t.status === 'open') { sentBack++; continue; }
      const p = t.payload || {};
      /* The Report is scoped to one property; so is this. */
      if (s.filter !== 'All' && p.property && String(p.property) !== s.filter) continue;
      if (t.op !== 'create') { changeN++; continue; }
      if (t.kind === 'booking') { bkN++; bkAmt += num(p.net); }
      else if (t.kind === 'expense') { exN++; exAmt += num(p.amount); }
      else otherN++;
    }
    return { bkN, bkAmt, exN, exAmt, otherN, changeN, sentBack, any: bkN + exN + otherN + changeN + sentBack > 0 };
  }, [s.tickets, s.filter]);

  const cash = useMemo(
    () => computeCash(s.logs?.bookings || null, s.logs?.expenses || null, s.filter, s.logs?.savings || null),
    [s.logs, s.filter]
  );
  const sav = useMemo(
    () => computeSavings(s.logs?.savings || null),
    [s.logs]
  );
  const repeat = useMemo(
    () => computeRepeatByMonth(s.logs?.bookings || null, s.filter),
    [s.logs, s.filter]
  );
  const pb = useMemo(
    () => computePayback(s.logs?.expenses || null, cash, s.filter),
    [s.logs, cash, s.filter]
  );

  const setRange = (v: string) => {
    const map: Record<string, RangeSel> = { 'All time': 'all', 'Last 7 days': '7', 'Last 30 days': '30', 'Custom…': 'custom' };
    const sel = map[v] || 'all';
    s.setRangeSel(sel);
    if (sel !== 'custom') s.refreshReport({ rangeSel: sel });
  };
  const rangeLabel = { all: 'All time', '7': 'Last 7 days', '30': 'Last 30 days', custom: 'Custom…' }[s.rangeSel];

  if (!d) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ color: C.muted }}>Loading dashboard…</Text>
      </View>
    );
  }

  /* Report metric rights (server also strips these figures). */
  const canMoney = s.can('metric.money'), canCash = s.can('metric.cash');
  const canBk = s.can('metric.bookings'), canExp = s.can('metric.expenses');
  const k = d.kpis || {};
  const m = d.kpisMonth || { totalRev: 0, totalExp: 0, netPnL: 0, bookings: 0 };
  const mn = d.currentMonth || 'This Month';
  const e = d.expenses || {};

  /* Revenue by Channel */
  const ch = d.byChannel || {};
  const chKeys = Object.keys(ch).sort((a, b) => ch[b].net - ch[a].net);
  const chTot = chKeys.reduce((t, kk) => ({ c: t.c + ch[kk].c, net: t.net + ch[kk].net }), { c: 0, net: 0 });

  /* Income by Type */
  const bt = d.byType || { Stay: { c: 0, net: 0 }, Resold: { c: 0, net: 0 }, Pass: { c: 0, net: 0 } };
  const btC = bt.Stay.c + bt.Resold.c + bt.Pass.c;
  const btN = bt.Stay.net + bt.Resold.net + bt.Pass.net;

  /* Monthly PnL */
  const pnl: any[] = d.monthlyPnl || [];
  let tR = 0, tRec = 0, tBk = 0;
  pnl.forEach((x) => { tR += x.revenue; tRec += x.recurring; tBk += x.bookings; });

  return (
    <View style={{ flex: 1 }}>
      <ScrollView ref={scrollRef} contentContainerStyle={{ padding: 14, paddingBottom: 40 }}>
        {/* hero — bank balance over the heels art */}
        {canCash && <Rise i={0}>
          <Glass radius={30} strong style={{ marginBottom: 14 }}>
            <View style={st.hero}>
              <View style={st.heroText}>
                <Text style={st.heroLbl}>Bank balance</Text>
                <CountUp value={inr(cash.bank)} style={st.heroVal} numberOfLines={1} adjustsFontSizeToFit duration={1200} />
                <View style={st.heroChip}>
                  <Text style={st.heroChipTxt}>{inr(cash.pending)} pending</Text>
                </View>
              </View>
              <HeelsArt style={st.hero3d} viewBox="30 380 350 260" />
              {/* melt the art's left edge into the card */}
              <LinearGradient
                colors={['rgba(255,251,246,1)', 'rgba(255,251,246,0)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                style={st.heroMelt} pointerEvents="none"
              />
            </View>
          </Glass>
        </Rise>}
        {/* toolbar */}
        <Panel>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <View style={{ flex: 1 }}>
              <Text style={st.tLbl}>Property</Text>
              <SelectField
                title="Property" value={s.filter}
                options={['All', ...s.props.map((p) => p.name)]}
                onChange={(v) => { s.setFilter(v); s.refreshReport({ filter: v }); }}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={st.tLbl}>Range</Text>
              <SelectField
                title="Range" value={rangeLabel || 'All time'}
                options={['All time', 'Last 7 days', 'Last 30 days', 'Custom…']}
                onChange={setRange}
              />
            </View>
          </View>
          {s.rangeSel === 'custom' && (
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
              <View style={{ flex: 1 }}>
                <Text style={st.tLbl}>From</Text>
                <DateField value={s.rFrom} onChange={(v) => { s.setRFrom(v); s.refreshReport({ rFrom: v }); }} allowClear />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={st.tLbl}>To</Text>
                <DateField value={s.rTo} onChange={(v) => { s.setRTo(v); s.refreshReport({ rTo: v }); }} allowClear />
              </View>
            </View>
          )}
        </Panel>

        {/* Above the figures, not below them. It rendered correctly under the
            month KPIs and was still missed: on a 390 px phone it starts ~805 px
            down the scroller, so a manager opening Report reads "₹0 · ₹0 · ₹0 ·
            0" for the current month with nothing on screen to say that ₹4.8 lakh
            of their own bookings is queued against it. What it says has to be
            legible before anyone decides the screen is only eight numbers. */}
        {queued.any && <QueuedPanel q={queued} canMoney={canMoney} onOpen={() => s.openMyRequests()} />}

        {!canMoney && !canCash && !canBk && !canExp && (
          <Panel><Text style={{ color: C.muted, fontFamily: F.med }}>No report metrics are enabled for your account. Ask an admin.</Text></Panel>
        )}

        {/* overall KPIs */}
        {(canMoney || canBk) && <>
        <KpiH>{rangeText(s.rangeSel, s.rFrom, s.rTo)}</KpiH>
        <View style={st.kpis}>
          {canMoney && <KpiCard kind="rev" label="Total Revenue" value={inr(k.totalRev)} onPress={() => setDrill({ kind: 'metric', metric: 'revenue' })} />}
          {canMoney && <KpiCard kind="exp" label="Total Expense" value={inr(k.totalExp)} onPress={() => setDrill({ kind: 'metric', metric: 'expense' })} />}
          {canMoney && <KpiCard kind={(k.netPnL ?? 0) >= 0 ? 'rev' : 'pnl'} label="Net P&L" value={inr(k.netPnL)} onPress={() => setDrill({ kind: 'metric', metric: 'pnl' })} />}
          {canBk && <KpiCard kind="bkg" label="Bookings" value={k.bookings} onPress={() => setDrill({ kind: 'metric', metric: 'bookings' })} />}
        </View>

        {/* month KPIs */}
        <KpiH>{mn} (current month)</KpiH>
        <View style={st.kpis}>
          {canMoney && <KpiCard kind="rev" label="Revenue" value={inr(m.totalRev)} onPress={() => setDrill({ kind: 'metric', metric: 'mrevenue' })} />}
          {canMoney && <KpiCard kind="exp" label="Expense" value={inr(m.totalExp)} onPress={() => setDrill({ kind: 'metric', metric: 'recurring' })} />}
          {canMoney && <KpiCard kind={(m.netPnL ?? 0) >= 0 ? 'rev' : 'pnl'} label="Net P&L" value={inr(m.netPnL)} onPress={() => setDrill({ kind: 'metric', metric: 'mpnl' })} />}
          {canBk && <KpiCard kind="bkg" label="Bookings" value={m.bookings} onPress={() => setDrill({ kind: 'metric', metric: 'mbookings' })} />}
        </View>
        </>}

        {/* Daily revenue against the target. Its own window (7 / 30 days / this
            month) rather than the Range above: a target is judged day by day,
            and "All time" has no meaningful daily average to compare. */}
        {canMoney && <RevenueTarget />}

        {/* cash position */}
        {canCash && <>
        <KpiH>Cash position</KpiH>
        <View style={st.kpis}>
          <KpiCard kind="rev" label="Total Bank Balance" value={inr(cash.bank)} onPress={() => setDrill({ kind: 'metric', metric: 'bank' })} />
          {s.filter === 'All' && (
            <KpiCard kind="inv" label="Invested" value={inr(sav.invested)} onPress={() => setDrill({ kind: 'metric', metric: 'invested' })} />
          )}
          {/* Two distinct pending figures. They are labelled explicitly rather
              than both as "pending" — same-label-different-number is exactly how
              the web/mobile cash position drifted apart. */}
          <KpiCard kind="exp" label="Total Pending Amount" value={inr(cash.pending)}
                   onPress={() => s.setTab('action')} />
          <KpiCard kind="exp" label="This Month — Awaiting Payout" value={inr(cash.curUnpaid)} />
        </View>

        {/* initial investment payback */}
        <KpiH>Initial investment</KpiH>
        <View style={st.kpis}>
          <KpiCard kind="inv" label="Initial Investment" value={inr(pb.invested)}
                   onPress={() => setDrill({ kind: 'metric', metric: 'payback' })} />
          <KpiCard kind="pnl" label="Recovered so far" value={inr(pb.recovered)}
                   onPress={() => setDrill({ kind: 'metric', metric: 'payback' })} />
          {/* The card that answers the question directly: a number while capital
              is still outstanding, a verdict once it is not. */}
          <KpiCard kind={pb.covered ? 'rev' : 'exp'}
                   label={pb.covered ? 'Surplus over capital' : 'Left to Recover'}
                   value={pb.covered ? inr(pb.surplus) : inr(pb.remaining)}
                   onPress={() => setDrill({ kind: 'metric', metric: 'payback' })} />
          <KpiCard kind="bkg" label="Payback" value={Math.round(pb.pct) + '%'}
                   onPress={() => setDrill({ kind: 'metric', metric: 'payback' })} />
        </View>
        <Panel>
          <PanelTitle>{pb.covered ? 'Capital recovered ✓' : 'Capital recovery'}</PanelTitle>
          <PaybackBar pb={pb} />
        </Panel>

        {/* Pending payments and the earnings calendar used to live here. Both
           now have a home of their own — the Action tab's Pending amount queue
           and the Calendar tab — and keeping second copies here meant two
           surfaces to change for every fix. The Cash position cards above still
           link into the Action tab. */}
        {/* charts */}
        <Panel>
          <PanelTitle>Cumulative Bank Balance</PanelTitle>
          <BankChart dayMap={cash.dayMap} />
        </Panel>
        </>}

        {/* revenue by channel */}
        {canBk && <>
        <Panel>
          <PanelTitle>Revenue by Channel</PanelTitle>
          <STable
            headers={[{ t: 'Channel' }, { t: 'Bookings', num: true }, { t: 'Net', num: true }]}
            rows={chKeys.map((kk) => [{ v: kk }, { v: String(ch[kk].c), num: true }, { v: inr(ch[kk].net), num: true }])}
            totalRow={[{ v: 'Total' }, { v: String(chTot.c), num: true }, { v: inr(chTot.net), num: true }]}
          />
        </Panel>

        {/* income by type */}
        <Panel>
          <PanelTitle>Income by Booking Type</PanelTitle>
          <STable
            headers={[{ t: 'Type' }, { t: 'Bookings', num: true }, { t: 'Net', num: true }]}
            rows={(['Stay', 'Resold', 'Pass'] as const).map((t) => [{ v: t }, { v: String(bt[t].c), num: true }, { v: inr(bt[t].net), num: true }])}
            totalRow={[{ v: 'Total' }, { v: String(btC), num: true }, { v: inr(btN), num: true }]}
          />
        </Panel>

        </>}

        {/* expenses */}
        {canExp && <Panel>
          <PanelTitle>Expenses</PanelTitle>
          <SumLine label="One-time" amt={e.oneTime || 0} />
          <SumLine label="Recurring" amt={e.recurring || 0} />
          <SumLine label="Operating" amt={e.operating || 0} />
          <SumLine label="Total Expense" amt={e.total || 0} tot />
          {canCash && <SumLine label="Refundable Deposits (memo)" amt={e.deposits || 0} />}
        </Panel>}

        {/* monthly PnL */}
        {canMoney && <Panel>
          <PanelTitle>Monthly P&L (recurring + operating)</PanelTitle>
          <STable
            headers={[{ t: 'Month' }, { t: 'Bk', num: true }, { t: 'Revenue', num: true }, { t: 'Expense', num: true }, { t: 'Net P&L', num: true }]}
            rows={pnl.map((x) => [
              { v: x.month }, { v: String(x.bookings), num: true }, { v: inr(x.revenue), num: true },
              { v: inr(x.recurring), num: true },
              { v: inr(x.netPnl), num: true, color: x.netPnl < 0 ? C.red : C.green },
            ])}
            totalRow={
              pnl.length
                ? [{ v: 'Total' }, { v: String(tBk), num: true }, { v: inr(tR), num: true }, { v: inr(tRec), num: true }, { v: inr(tR - tRec), num: true }]
                : undefined
            }
            onCellPress={(ri, ci) => {
              const mk = ri === -1 ? '*' : pnl[ri]?.month;
              if (!mk) return;
              const metric = (['net', 'bk', 'rev', 'exp', 'net'] as const)[ci];
              if (!s.logs) { toast('Details still loading — tap again in a moment', false); return; }
              setDrill({ kind: 'month', mk, metric });
            }}
          />
          <Hint>Tap any month row / cell for the breakdown.</Hint>
        </Panel>}

        {/* repeat customers */}
        {canBk && <>
        <Panel>
          <PanelTitle>Repeat Customers by Month</PanelTitle>
          <STable
            headers={[{ t: 'Month' }, { t: 'Repeat', num: true }, { t: 'Total Bk', num: true }, { t: 'Repeat %', num: true }]}
            rows={repeat.map((x) => [
              { v: x.month }, { v: String(x.rep), num: true }, { v: String(x.tot), num: true },
              { v: (x.tot ? Math.round((x.rep / x.tot) * 100) : 0) + '%', num: true },
            ])}
            totalRow={
              repeat.length
                ? (() => {
                    const rep = repeat.reduce((a, x) => a + x.rep, 0);
                    const tot = repeat.reduce((a, x) => a + x.tot, 0);
                    return [
                      { v: 'Total' }, { v: String(rep), num: true }, { v: String(tot), num: true },
                      { v: (tot ? Math.round((rep / tot) * 100) : 0) + '%', num: true },
                    ] as Cell[];
                  })()
                : undefined
            }
          />
        </Panel>

        {/* recent bookings */}
        <Panel>
          <PanelTitle>Recent Bookings</PanelTitle>
          <STable
            headers={[{ t: 'ID' }, { t: 'Date' }, { t: 'Guest' }, { t: 'Type' }, { t: 'Net', num: true }]}
            rows={(d.recent || []).map((r: any) => [
              { v: r.id }, { v: r.date }, { v: r.guest || '' },
              { v: <Pill label={r.type} /> }, { v: inr(r.net), num: true },
            ])}
          />
        </Panel>
        </>}

        <Text style={{ textAlign: 'center', color: C.muted, fontSize: 11 }}>
          {(s.filter !== 'All' ? s.filter + ' · ' : '') + 'updated ' + (d.generatedAt || '')}
        </Text>
      </ScrollView>

      <DrillSheet drill={drill} onClose={() => setDrill(null)} cash={cash} sav={sav} pb={pb} />
    </View>
  );
}

/* ── what this person has asked for and has not got yet ──
   The Report reads from the books, so a booking sitting in approval shows here
   as ₹0 — which is correct and, to the person who sent it ten minutes ago,
   unreadable. This sits BESIDE the figures, never inside them: the KPI cards
   keep saying exactly what the books say, and this says what is queued against
   them. It sits ABOVE them because below them it was not found. The amounts are the ones the requester typed into their own request;
   change and delete requests are counted, not valued, because what they would
   do to a figure is not knowable from here. */
function QueuedPanel({ q, canMoney, onOpen }: {
  q: { bkN: number; bkAmt: number; exN: number; exAmt: number; otherN: number; changeN: number; sentBack: number };
  canMoney: boolean; onOpen: () => void;
}) {
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const lines: string[] = [];
  if (q.bkN) lines.push(plural(q.bkN, 'new booking', 'new bookings') + (canMoney ? ' · ' + inr(q.bkAmt) + ' net, as entered' : ''));
  if (q.exN) lines.push(plural(q.exN, 'new expense', 'new expenses') + (canMoney ? ' · ' + inr(q.exAmt) + ', as entered' : ''));
  if (q.otherN) lines.push(plural(q.otherN, 'other new record', 'other new records'));
  if (q.changeN) lines.push(plural(q.changeN, 'change to a record that already exists', 'changes to records that already exist'));
  return (
    <View style={st.queued}>
      <Text style={st.qHead}>Waiting for approval — not counted in any figure below</Text>
      {lines.map((l) => <Text key={l} style={st.qLine}>• {l}</Text>)}
      <Text style={st.qBody}>
        Requests you sent. They count towards revenue, expense and P&amp;L only once an admin approves them.
      </Text>
      {q.sentBack ? (
        <Text style={st.qBack}>
          {plural(q.sentBack, 'request was', 'requests were')} sent back to you — fix and submit again.
        </Text>
      ) : null}
      <View style={{ flexDirection: 'row', marginTop: 10 }}>
        <Btn title="View my requests" kind="mini" onPress={onOpen} />
      </View>
    </View>
  );
}

/* ── capital recovery bar ──
   The fill is capped at 100%: once the capital is back the question is answered,
   and letting the bar run past its track would say nothing extra. */
function PaybackBar({ pb }: { pb: Payback }) {
  const pct = Math.max(0, Math.min(100, pb.pct));
  if (pb.invested <= 0) {
    return (
      <Hint>
        No expense is flagged as Initial investment yet. Tick "Initial Investment" on a setup expense and it will
        be counted here as capital to earn back.
      </Hint>
    );
  }
  return (
    <>
      <View style={st.barTrack}>
        <View style={[st.barFill, { width: (pct + '%') as any, backgroundColor: pb.covered ? C.green : C.blue }]} />
      </View>
      <View style={st.barLbl}>
        <Text style={{ fontFamily: F.bold, color: pb.covered ? C.green : C.ink }}>
          {inr(pb.recovered) + ' of ' + inr(pb.invested)}
        </Text>
        <Text style={{ fontFamily: F.bold, color: pb.covered ? C.green : C.blue }}>{Math.round(pb.pct) + '%'}</Text>
      </View>
      <Text style={{ marginTop: 4, fontFamily: F.semi, color: pb.covered ? C.green : C.amber }}>
        {pb.covered
          ? 'Entire initial investment recovered — ' + inr(pb.surplus) + ' earned beyond it.'
          : inr(pb.remaining) + ' still to earn back.'}
      </Text>
      <Hint>
        Recovered = operating profit to date (revenue − recurring/operating expense), the same basis as the Net P&L
        card. Setup capital itself is excluded from that expense, so it is never counted twice.
      </Hint>
    </>
  );
}

/* ── matrix table (channel × booking type) ── */
function MxTable({ mx }: { mx: Record<string, { Stay: number; Resold: number; Pass: number }> }) {
  const chans = Object.keys(mx);
  if (!chans.length) return <Text style={st.empty}>No data.</Text>;
  const types = ['Stay', 'Resold', 'Pass'] as const;
  const colTot = { Stay: 0, Resold: 0, Pass: 0 };
  let grand = 0;
  chans.sort((a, b) => {
    const ta = types.reduce((s2, t) => s2 + (mx[a][t] || 0), 0);
    const tb = types.reduce((s2, t) => s2 + (mx[b][t] || 0), 0);
    return tb - ta;
  });
  const nf = (n: number) => (n ? groupINR(n) : '–');
  const rows: Cell[][] = chans.map((chn) => {
    let rt = 0;
    const tds: Cell[] = types.map((t) => {
      const v = mx[chn][t] || 0;
      colTot[t] += v; rt += v;
      return { v: nf(v), num: true, color: v ? undefined : '#D8D5CC' };
    });
    grand += rt;
    return [{ v: chn }, ...tds, { v: nf(rt), num: true }];
  });
  return (
    <STable
      headers={[{ t: 'Channel' }, { t: 'Stay', num: true }, { t: 'Resold', num: true }, { t: 'Pass', num: true }, { t: 'Total', num: true }]}
      rows={rows}
      totalRow={[{ v: 'Total' }, ...types.map((t) => ({ v: nf(colTot[t]), num: true } as Cell)), { v: nf(grand), num: true }]}
    />
  );
}
function ChTable({ obj }: { obj: Record<string, { c: number; net: number }> }) {
  const ks = Object.keys(obj).sort((a, b) => obj[b].net - obj[a].net);
  if (!ks.length) return <Text style={st.empty}>No data.</Text>;
  return (
    <STable
      headers={[{ t: 'Channel' }, { t: 'Bk', num: true }, { t: 'Net', num: true }]}
      rows={ks.map((kk) => [{ v: kk }, { v: String(obj[kk].c), num: true }, { v: inr(obj[kk].net), num: true }])}
    />
  );
}
function TypeTable({ obj, totalRow }: { obj: any; totalRow?: Cell[] }) {
  return (
    <STable
      headers={[{ t: 'Type' }, { t: 'Bk', num: true }, { t: 'Net', num: true }]}
      rows={(['Stay', 'Resold', 'Pass'] as const).map((kk) => {
        const o = obj[kk] || { c: 0, net: 0 };
        return [{ v: kk }, { v: String(o.c), num: true }, { v: inr(o.net), num: true }];
      })}
      totalRow={totalRow}
    />
  );
}

/* ── the drill-down bottom sheet, ported from openDrill/openMonthDrill ── */
function DrillSheet({ drill, onClose, cash, sav, pb }: { drill: Drill; onClose: () => void; cash: any; sav: Savings; pb: Payback }) {
  const s = useStore();
  const d = s.dash;
  if (!drill || !d) return <Sheet visible={false} title="" value="" onClose={onClose}>{null}</Sheet>;

  /* Open a saving in the form (to exit it). Close the drill first and only
     switch tabs once the sheet's dismissal has finished — a tab switch under a
     still-animating Modal leaves a dead window over the app (see
     CalendarScreen.editStay). */
  const openSaving = (row: number) => {
    const o = s.logs?.savings?.rows?.find((y) => y.r === row);
    if (!o || !s.addSegs.includes('sav')) return;
    onClose();
    setTimeout(() => {
      s.setEditS({ row, from: 'slog', cells: o.cells });
      s.setAddSeg('sav');
      s.setTab('add');
    }, 320);
  };

  /* Report metric rights (server also strips these figures). */
  const canMoney = s.can('metric.money'), canCash = s.can('metric.cash');
  const canBk = s.can('metric.bookings'), canExp = s.can('metric.expenses');
  const k = d.kpis || {};
  const m = d.kpisMonth || { totalRev: 0, totalExp: 0, netPnL: 0, bookings: 0 };
  const mn = d.currentMonth || 'This month';
  let title = '', value = '';
  let body: React.ReactNode = null;

  if (drill.kind === 'metric') {
    const metric = drill.metric;
    if (metric === 'revenue') {
      title = 'Total Revenue'; value = inr(k.totalRev);
      body = (<><H4>Net revenue (₹) · channel × booking type</H4><MxTable mx={d.revMatrix || {}} /></>);
    } else if (metric === 'expense') {
      const e = d.expenses || {};
      const ec = d.expenseByCategory || {};
      const cks = Object.keys(ec).sort((a, b) => ec[b] - ec[a]);
      title = 'Total Expense'; value = inr(k.totalExp);
      body = (
        <>
          <H4>By bucket</H4>
          <SumLine label="One-time" amt={e.oneTime || 0} />
          <SumLine label="Recurring" amt={e.recurring || 0} />
          <SumLine label="Operating" amt={e.operating || 0} />
          <SumLine label="Total Expense" amt={e.total || 0} tot />
          <H4>By category</H4>
          {cks.length ? cks.map((c) => <SumLine key={c} label={c} amt={ec[c]} />) : <Text style={st.empty}>No data.</Text>}
        </>
      );
    } else if (metric === 'pnl') {
      title = 'Net P&L (overall)'; value = inr(k.netPnL);
      body = (
        <>
          <H4>Components</H4>
          <SumLine label="Revenue" amt={k.totalRev} />
          <SumLine label="Less: Total Expense" amt={-k.totalExp} />
          <SumLine label="Net P&L" amt={k.netPnL} tot />
          <Hint>Refundable deposits are excluded.</Hint>
        </>
      );
    } else if (metric === 'bookings') {
      title = 'Bookings'; value = String(k.bookings);
      body = (<><H4>By type</H4><TypeTable obj={d.byType || {}} /><H4>By channel</H4><ChTable obj={d.byChannel || {}} /></>);
    } else if (metric === 'mrevenue') {
      title = mn + ' · Revenue'; value = inr(m.totalRev);
      body = (<><H4>Net revenue (₹) · channel × booking type</H4><MxTable mx={cash?.curMatrix || {}} /></>);
    } else if (metric === 'recurring') {
      const list: any[] = d.recurringChecklist || [];
      let matched = 0, addedN = 0;
      list.forEach((x) => { if (x.added) { matched += x.amount; addedN++; } });
      const other = Math.round((m.recurExp || 0) - matched);
      title = mn + ' · Expense'; value = inr(m.totalExp);
      body = (
        <>
          <H4>By bucket</H4>
          <SumLine label="Recurring" amt={m.recurExp || 0} />
          <SumLine label="Operating" amt={m.operExp || 0} />
          <SumLine label="Total Expense" amt={m.totalExp} tot />
          <H4>{'Recurring charges · ' + addedN + ' of ' + list.length + ' added'}</H4>
          {list.map((x, i) => (
            <View key={i} style={st.chkRow}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9, flex: 1 }}>
                <View style={[st.dotSt, { backgroundColor: x.added ? C.greenbg : '#fdecea' }]}>
                  <Text style={{ color: x.added ? C.green : C.red, fontSize: 12, fontFamily: F.xbold }}>{x.added ? '✓' : '—'}</Text>
                </View>
                <Text style={{ fontFamily: F.semi, color: C.ink }}>{x.name}</Text>
              </View>
              {x.added
                ? <Text style={{ color: C.ink }}>{inr(x.amount)}</Text>
                : <Text style={{ color: C.amber, fontFamily: F.bold, fontSize: 12 }}>Not added</Text>}
            </View>
          ))}
          {other > 0 && <SumLine label="Other recurring" amt={other} />}
        </>
      );
    } else if (metric === 'mpnl') {
      title = mn + ' · Net P&L'; value = inr(m.netPnL);
      body = (
        <>
          <H4>Components</H4>
          <SumLine label="Revenue" amt={m.totalRev} />
          <SumLine label="Less: Expense" amt={-m.totalExp} />
          <SumLine label="Net P&L" amt={m.netPnL} tot />
          <Hint>Expense = Recurring + Operating (one-time setup excluded).</Hint>
        </>
      );
    } else if (metric === 'mbookings') {
      title = mn + ' · Bookings'; value = String(m.bookings);
      body = (<><H4>By type</H4><TypeTable obj={d.monthByType || {}} /></>);
    } else if (metric === 'bank') {
      const cc = cash || {};
      const mly: any[] = cc.monthly || [];
      title = 'Total Bank Balance'; value = inr(cc.bank || 0);
      body = (
        <>
          {mly.length > 0 && (
            <>
              <H4>Cash generated by month</H4>
              <STable
                headers={[{ t: 'Month' }, { t: 'Received', num: true }, { t: 'Opex', num: true }, { t: 'One-time', num: true }, { t: 'Cash', num: true }]}
                rows={mly.map((x) => [
                  { v: x.month }, { v: inr(x.recv), num: true }, { v: inr(x.opex), num: true }, { v: inr(x.oneTime), num: true },
                  { v: inr(x.cash), num: true, color: x.cash < 0 ? C.red : C.green },
                ])}
                /* Cash totals the column above it — Received − Opex, i.e. the bank
                   before savings, exactly as the hint below promises. It printed
                   cc.bank (savings already deducted), so the row visibly failed to
                   add up: ₹186,785 of months under an ₹87,647 total. */
                totalRow={[
                  { v: 'Total' },
                  { v: inr((cc.totalNet || 0) - (cc.pending || 0)), num: true },
                  { v: inr(cc.totalExp || 0), num: true },
                  { v: inr(cc.oneTime || 0), num: true },
                  { v: inr(cc.bankBeforeSavings || 0), num: true },
                ]}
              />
            </>
          )}
          {s.filter === 'All' && (
            <>
              <H4>Savings adjustments</H4>
              <SumLine label="Less: Invested (active)" amt={-sav.invested} />
              <SumLine label="Add: Gain / loss on exited savings" amt={sav.returnsRealized} />
              <SumLine label="Bank balance" amt={cc.bank || 0} />
            </>
          )}
          <Hint>
            Monthly Cash = net actually received that month − recurring/operating opex − one-time spend paid from business
            cash. Expenses flagged initial investment are outside capital and excluded. Months sum to the bank balance before
            savings adjustments. Follows the property filter.
          </Hint>
        </>
      );
    } else if (metric === 'invested') {
      const scks = Object.keys(sav.byScheme).sort((a, b) => sav.byScheme[b].amt - sav.byScheme[a].amt);
      const pfks = Object.keys(sav.byPlatform).sort((a, b) => sav.byPlatform[b].amt - sav.byPlatform[a].amt);
      title = 'Invested (Active)'; value = inr(sav.invested);
      body = (
        <>
          <H4>By scheme</H4>
          {scks.length ? scks.map((c) => <SumLine key={c} label={c + ' (' + sav.byScheme[c].c + ')'} amt={sav.byScheme[c].amt} />) : <Text style={st.empty}>No active investments.</Text>}
          <H4>By platform</H4>
          {pfks.length ? pfks.map((c) => <SumLine key={c} label={c + ' (' + sav.byPlatform[c].c + ')'} amt={sav.byPlatform[c].amt} />) : <Text style={st.empty}>No active investments.</Text>}
          <SumLine label="Received back from exited savings" amt={sav.receivedBack} />
          <SumLine label="Gain / loss on exited savings" amt={sav.returnsRealized} />
          {sav.entries.length > 0 && (
            <>
              <H4>All entries</H4>
              <STable
                headers={[{ t: 'Date' }, { t: 'Scheme' }, { t: 'Platform' }, { t: 'Amount', num: true }, { t: 'Status' }, { t: 'Exited' }, { t: 'Received', num: true }]}
                rows={sav.entries.map((x) => [
                  { v: x.date, nowrap: true }, { v: x.scheme }, { v: x.platform },
                  { v: inr(x.amount), num: true }, { v: x.status },
                  { v: x.status === 'Active' ? '—' : x.exitDate || '—', nowrap: true },
                  { v: x.status === 'Active' ? '—' : inr(x.returns), num: true,
                    color: x.status === 'Active' ? undefined : x.returns >= x.amount ? C.green : C.red },
                ])}
                onRowPress={s.addSegs.includes('sav') ? (i) => openSaving(sav.entries[i].row) : undefined}
              />
            </>
          )}
          <Hint>
            Tap an entry to open it — use “Exit investment” when an FD matures or you withdraw from Groww. Active
            principal is out of the bank balance; on exit the amount received comes back in on the exit date.
          </Hint>
        </>
      );
    } else if (metric === 'payback') {
      const cks = Object.keys(pb.byCategory).sort((a, b) => pb.byCategory[b].amt - pb.byCategory[a].amt);
      title = 'Initial Investment'; value = inr(pb.invested);
      body = (
        <>
          <H4>Recovery</H4>
          <PaybackBar pb={pb} />
          <H4>How it adds up</H4>
          <SumLine label="Initial investment (capital put in)" amt={pb.invested} />
          <SumLine label="Less: Operating profit to date" amt={-pb.profit} />
          <SumLine label={pb.covered ? 'Surplus over capital' : 'Left to recover'}
                   amt={pb.covered ? pb.surplus : pb.remaining} tot />
          {/* Cash-in-hand check. Profit counts money earned; this counts money
              actually collected, so a big awaiting-payout balance cannot read as
              capital already back in the account. */}
          <SumLine label="Memo: recovered on cash received" amt={Math.max(0, Math.min(pb.received, pb.invested))} />
          <H4>{'Capital by category (' + pb.count + ' item' + (pb.count === 1 ? '' : 's') + ')'}</H4>
          {cks.length
            ? cks.map((c) => <SumLine key={c} label={c + ' (' + pb.byCategory[c].c + ')'} amt={pb.byCategory[c].amt} />)
            : <Text style={st.empty}>Nothing flagged as initial investment.</Text>}
          {pb.items.length > 0 && (
            <>
              <H4>Line items</H4>
              <STable
                headers={[{ t: 'Date' }, { t: 'Item' }, { t: 'Category' }, { t: 'Amount', num: true }]}
                rows={pb.items.map((x) => [
                  { v: x.date, nowrap: true }, { v: x.item }, { v: x.category }, { v: inr(x.amt), num: true },
                ])}
                totalRow={[{ v: 'Total' }, { v: '' }, { v: '' }, { v: inr(pb.invested), num: true }]}
              />
            </>
          )}
          <Hint>Follows the property filter. Capital is every expense flagged Initial investment, of any type.</Hint>
        </>
      );
    }
  } else if (drill.kind === 'month') {
    const r = computeMonthDrill(s.logs?.bookings || null, s.logs?.expenses || null, s.filter, drill.mk);
    const mnn = drill.mk === '*' ? 'All months' : drill.mk;
    if (drill.metric === 'bk') {
      title = mnn + ' · Bookings'; value = String(r.bk);
      body = (
        <>
          <H4>By type</H4>
          <TypeTable obj={r.byType} totalRow={[{ v: 'Total' }, { v: String(r.bk), num: true }, { v: inr(r.rev), num: true }]} />
          <H4>By channel</H4>
          <ChTable obj={r.byChan} />
        </>
      );
    } else if (drill.metric === 'rev') {
      title = mnn + ' · Revenue'; value = inr(r.rev);
      body = (<><H4>Net revenue (₹) · channel × booking type</H4><MxTable mx={r.mx} /></>);
    } else if (drill.metric === 'exp') {
      const cks = Object.keys(r.byCat).sort((a, b) => r.byCat[b] - r.byCat[a]);
      title = mnn + ' · Expense'; value = inr(r.exp);
      body = (
        <>
          <H4>By bucket</H4>
          <SumLine label="Recurring" amt={r.rec} />
          <SumLine label="Operating" amt={r.op} />
          <SumLine label="Total Expense" amt={r.exp} tot />
          <H4>By category</H4>
          {cks.length ? cks.map((c) => <SumLine key={c} label={c} amt={r.byCat[c]} />) : <Text style={st.empty}>No expenses.</Text>}
          {r.items.length > 0 && (
            <>
              <H4>Line items</H4>
              <STable
                headers={[{ t: 'Item' }, { t: 'Type' }, { t: 'Amount', num: true }]}
                rows={r.items.map((x) => [{ v: x.item }, { v: x.type }, { v: inr(x.amt), num: true }])}
              />
            </>
          )}
          <Hint>Recurring + Operating, by expense month. One-time setup excluded.</Hint>
        </>
      );
    } else {
      title = mnn + ' · Net P&L'; value = inr(r.net);
      body = (
        <>
          <H4>Components</H4>
          <SumLine label="Revenue" amt={r.rev} />
          <SumLine label="Less: Expense" amt={-r.exp} />
          <SumLine label="Net P&L" amt={r.net} tot />
          <Hint>Expense = Recurring + Operating for {mnn}. One-time setup & refundable deposits excluded.</Hint>
        </>
      );
    }
  }

  return (
    <Sheet visible={!!drill} title={title} value={value} onClose={onClose}>
      {body}
    </Sheet>
  );
}

const st = StyleSheet.create({
  tLbl: { fontSize: 12, fontFamily: F.semi, color: C.muted, marginBottom: 5 },
  kpis: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 18 },
  /* Same amber panel the forms and the log use for "waiting for approval", so
     it reads as the one thing it is wherever it appears. */
  queued: {
    backgroundColor: C.amberbg, borderWidth: 1, borderColor: '#e9d2a3', borderRadius: 12,
    paddingVertical: 11, paddingHorizontal: 13, marginBottom: 14,
  },
  qHead: { fontFamily: F.bold, fontSize: 13, color: C.amber },
  qLine: { fontFamily: F.semi, fontSize: 13.5, color: C.ink, marginTop: 6, lineHeight: 19 },
  qBody: { fontFamily: F.med, fontSize: 12, color: C.bark, marginTop: 7, lineHeight: 17 },
  qBack: { fontFamily: F.semi, fontSize: 12, color: C.red, marginTop: 6, lineHeight: 17 },
  hero: { flexDirection: 'row', alignItems: 'center', minHeight: 176, overflow: 'hidden', borderRadius: 30 },
  heroText: { flex: 1, paddingLeft: 20, paddingVertical: 18, zIndex: 2 },
  heroLbl: { fontFamily: F.bold, fontSize: 11, letterSpacing: 1.6, textTransform: 'uppercase', color: G.gold3 },
  heroVal: { fontFamily: F.xbold, fontSize: 34, color: C.ink, letterSpacing: -1.2, marginTop: 6 },
  heroChip: {
    alignSelf: 'flex-start', marginTop: 10, paddingVertical: 5, paddingHorizontal: 10, borderRadius: 999,
    backgroundColor: 'rgba(185,128,54,0.12)', borderWidth: 1, borderColor: 'rgba(185,128,54,0.2)',
  },
  heroChipTxt: { fontFamily: F.semi, fontSize: 11.5, color: G.gold3 },
  heroMelt: { position: 'absolute', left: '44%', width: '20%', top: 0, bottom: 0 },
  hero3d: { position: 'absolute', right: 0, top: 0, bottom: 0, width: '55%' },
  empty: { color: '#bbb', fontSize: 13, paddingVertical: 6 },
  poRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: C.hair },
  chk: {
    width: 22, height: 22, borderRadius: 5, borderWidth: 1.5, borderColor: C.line,
    alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff',
  },
  chkRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.hair },
  dotSt: { width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  barTrack: { height: 12, borderRadius: 6, backgroundColor: C.bone, overflow: 'hidden' },
  barFill: { height: 12, borderRadius: 6 },
  barLbl: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 7 },
});
