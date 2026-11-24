import React, { useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, Image, Linking, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { C, F, G, inr } from '../theme';
import { Btn, useToast } from '../ui';
import { Ticket, TicketKind, useStore } from '../store';
import { api } from '../api';
import {
  CardData, CiItem, EnquiryItem, EnquiryStatus, IdItem, LowItem, TaskItem, ciFmtDay,
  computeCheckins, computeEnquiries, computeIdsPending, computeLowStock, computePayouts, computeReviews,
  computeStays, computeTasks, fmtEnquiryWhen, taskWhen, todayIso, unitNumberOf,
} from '../logic';
import { unitNo } from '../propertyPicker';
import { coverFor } from '../unitCovers';
import Svg, { Path } from 'react-native-svg';
import TaskForm from './TaskForm';

/* The Action tab: the property manager's morning screen.

   It answers three questions, in this order, on one screen:
     1. Today       who arrives and who leaves, at what time, in which flat,
                    and whether anything is missing for them (ID, money)
     2. Needs you   every queue that has work in it, most urgent first, one
                    line each, so 30 seconds of reading says what the day holds
     3. Coming up   the next week's arrivals, to prepare the flats

   Each queue opens as its own page (L2). Every page uses the same compact
   booking row: name, unit, the stay on one line, the problem as a coloured
   tag, and the one or two buttons that actually clear it (Call, WhatsApp,
   Upload ID, Mark paid, Asked / Got it). The old cards spent most of a screen
   on a single booking, repeating "time not recorded" and an empty unit box;
   these rows fit four or five to a screen and say only what is known.

   All figures come from the same computeX functions the Dashboard uses. */

type SectionKey = 'ci' | 'co' | 'up' | 'rev' | 'ids' | 'pay' | 'low' | 'act' | 'enq';
type Tone = { ink: string; bg: string };
const TONE: Record<SectionKey, Tone> = {
  ci: { ink: C.green, bg: C.greenbg },
  co: { ink: G.gold3, bg: C.amberbg },
  up: { ink: C.sky, bg: C.skybg },
  rev: { ink: G.gold2, bg: C.amberbg },
  ids: { ink: C.red, bg: C.redbg },
  pay: { ink: C.red, bg: C.redbg },
  low: { ink: C.amber, bg: C.amberbg },
  act: { ink: C.navy, bg: C.bone },
  enq: { ink: C.blue2, bg: C.amberbg },
};
const TITLE: Record<SectionKey, string> = {
  ci: 'Arriving today',
  co: 'Leaving today',
  up: 'Coming up',
  rev: 'Ask for reviews',
  ids: 'IDs missing',
  pay: 'Payments due',
  low: 'Low stock',
  act: 'To-do list',
  enq: 'Website enquiries',
};
const UPCOMING_CAP = 60;
const DAY = 86400000;

const nameOf = (x: { guest: string; id: string }) => x.guest || x.id;
const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
const daysFromToday = (d: Date | null) => (d ? Math.round((dayStart(d) - dayStart(new Date())) / DAY) : null);
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const relDay = (d: Date | null) => {
  if (!d) return '';
  const n = daysFromToday(d)!;
  if (n === 0) return 'Today';
  if (n === 1) return 'Tomorrow';
  if (n === -1) return 'Yesterday';
  if (n > 1 && n < 7) return WD[d.getDay()];
  return ciFmtDay(d);
};
const dayHead = (d: Date) => {
  const n = daysFromToday(d)!;
  const full = WD[d.getDay()] + ', ' + ciFmtDay(d);
  return n === 0 ? 'Today · ' + full : n === 1 ? 'Tomorrow · ' + full : full;
};
function mins(t: string) {
  const m = String(t || '').trim().match(/^(\d{1,2}):(\d{2})\s*(am|pm)?$/i);
  if (!m) return 9999;
  let h = parseInt(m[1], 10);
  const ap = (m[3] || '').toLowerCase();
  if (ap === 'pm' && h < 12) h += 12;
  if (ap === 'am' && h === 12) h = 0;
  return h * 60 + parseInt(m[2], 10);
}
/* The flat to go to. The stay unit when one was written, else the booked
   property's own number. A stay unit equal to the trailing number of the
   property name ("45" for "403, …, Sector 45") is the property itself. */
function unitOf(c: CardData) {
  const u = c.unit.trim();
  const own = unitNo(c.prop) || c.prop;
  if (!u || u === c.prop || u === unitNumberOf(c.prop)) return own;
  return u;
}
const waNumber = (p: string) => {
  const d = p.replace(/[^0-9]/g, '');
  return d.length === 10 ? '91' + d : d;
};

export default function ActionScreen() {
  const s = useStore();
  const toast = useToast();
  const scroller = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const [page, setPage] = useState<SectionKey | null>(null);
  useEffect(() => { s.setActionDeep(!!page); }, [page]);
  const [form, setForm] = useState<{ task: TaskItem | null } | null>(null);
  const [selPay, setSelPay] = useState<Record<number, boolean>>({});
  const [revTab, setRevTab] = useState<'pending' | 'requested'>('pending');
  const [enqTab, setEnqTab] = useState<EnquiryStatus>('new');
  /* A request raised by a Manager changes nothing until approved, so the page
     keeps a receipt on top and every affected row says it is waiting. */
  const [sent, setSent] = useState<{ msg: string; ids: number[] } | null>(null);
  useEffect(() => { setSent(null); setSelPay({}); }, [page]);
  const reqFor = (kind: TicketKind, row: number | string): Ticket | null => {
    const t = s.ticketFor(kind, row);
    return t && t.status === 'pending' ? t : null;
  };
  const afterWrite = async (r: any, done: string) => {
    if (r?.pendingApproval) {
      const ids: number[] = r.tickets && r.tickets.length ? r.tickets : (r.ticket ? [r.ticket] : []);
      setSent({ msg: r.message || 'Sent for approval', ids });
      toast(r.message || 'Sent for approval', true);
      await s.reloadTickets();
      return;
    }
    toast(r?.message || done, true);
    await s.reloadLogs();
  };
  const [prop, setProp] = useState('All');
  const manage = s.can('action.manage');

  useEffect(() => { scroller.current?.scrollTo({ y: 0, animated: true }); }, [s.retapSig]);
  useEffect(() => { if (s.retapSig) setPage(null); }, [s.retapSig]);
  useEffect(() => { scroller.current?.scrollTo({ y: 0, animated: false }); }, [page]);
  useEffect(() => {
    if (!page) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { setPage(null); return true; });
    return () => sub.remove();
  }, [page]);

  const b = s.logs?.bookings || null;
  const ci = useMemo(() => computeCheckins(b, prop), [b, prop]);
  const pay = useMemo(() => computePayouts(b, prop), [b, prop]);
  const rev = useMemo(() => computeReviews(b, prop), [b, prop]);
  const ids = useMemo(() => computeIdsPending(b, prop, s.idMap), [b, prop, s.idMap]);
  const low = useMemo(() => computeLowStock(s.inv, prop, b), [s.inv, prop, b]);
  const tasks = useMemo(() => computeTasks(s.logs?.tasks || null), [s.logs]);
  const enq = useMemo(() => computeEnquiries(s.logs?.enquiries, prop), [s.logs, prop]);
  const tk = todayIso();
  const inHouse = useMemo(() => computeStays(b, prop).stays.filter((x) => x.inK < tk && x.outK > tk).length, [b, prop, tk]);
  /* IDs sorted by who arrives first: a missing ID for tonight is urgent, one
     for next month is not. */
  const idsSorted = useMemo(() => [...ids].sort((a, c) => (a.ci ? a.ci.getTime() : 9e15) - (c.ci ? c.ci.getTime() : 9e15)), [ids]);
  const idByRow = useMemo(() => { const m: Record<number, IdItem> = {}; ids.forEach((x) => { m[x.row] = x; }); return m; }, [ids]);
  const idsSoon = ids.filter((x) => { const n = daysFromToday(x.ci); return n !== null && n <= 2; }).length;

  const count: Record<SectionKey, number> = {
    ci: ci.today.length, co: ci.checkoutsToday.length, up: ci.upcoming.length,
    rev: rev.length, ids: ids.length, pay: pay.list.length, low: low.length,
    act: tasks.due.length, enq: enq.fresh.length,
  };
  useEffect(() => {
    if (page && page !== 'act' && page !== 'enq' && page !== 'ci' && page !== 'co' && !count[page]) setPage(null);
  }, [page, count[page as SectionKey]]);

  /* ── writes ── */
  const selRows = pay.list.filter((p) => selPay[p.row] && !reqFor('payout', p.row));
  const selTotal = selRows.reduce((t, p) => t + p.pending, 0);
  const markPaid = async () => {
    if (!selRows.length) return;
    try {
      const r = await api.setPayouts(s.pin, selRows.map((p) => p.row));
      setSelPay({});
      await afterWrite(r, 'Marked paid');
    } catch (e: any) { toast(e?.message || 'Could not save', false); }
  };
  const setReview = async (row: number, status: 'requested' | 'received' | 'skipped') => {
    try {
      const r = await api.setReviewStatus(s.pin, row, status);
      await afterWrite(r, status === 'received' ? 'Marked reviewed' : status === 'skipped' ? 'Skipped' : 'Marked as asked');
    } catch (e: any) { toast(e?.message || 'Could not save', false); }
  };
  const toggleTask = async (t: TaskItem) => {
    if (!manage) { toast('Your role can view the to-do list but not change it', false); return; }
    try {
      const r = await api.setTaskDone(s.pin, t.row, !t.done);
      if (r?.pendingApproval) await afterWrite(r, '');
      else await s.reloadLogs();
    } catch (e: any) { toast(e?.message || 'Could not save', false); }
  };
  const setEnquiry = async (e: EnquiryItem, status: EnquiryStatus) => {
    if (!manage) { toast('Your role can view enquiries but not change them', false); return; }
    try {
      const r = await api.setEnquiryStatus(s.pin, e.row, status);
      await afterWrite(r, 'Moved to ' + ENQ_LABEL[status]);
    } catch (err: any) { toast(err?.message || 'Could not save', false); }
  };
  const addStock = (i: LowItem) => {
    if (!s.can('inventory.add')) { toast('Your role cannot log stock', false); return; }
    s.setInvTarget(i.key); s.setAddSeg('inv'); s.setTab('add');
  };
  const docFor = (row: number) => {
    const docs = s.idDocs?.[String(row)] || [];
    const pick = docs.find((d) => d.slot === 'lead') || docs.find((d) => d.slot === 'co') || docs[0];
    return pick && !/pdf/i.test(pick.type || '') ? pick.id : undefined;
  };
  const openBooking = (row: number) => s.openBooking(row);
  const contact = (c: CardData) => (c.phone ? [
    { label: 'Call', onPress: () => Linking.openURL('tel:' + c.phone.replace(/[^0-9+]/g, '')) },
    { label: 'WhatsApp', onPress: () => Linking.openURL('https://wa.me/' + waNumber(c.phone)) },
  ] : []);
  /* The problems a booking still has, as tags: the same everywhere. */
  const flagsOf = (c: CardData, skip: { id?: boolean; due?: boolean } = {}) => {
    const f: Flag[] = [];
    const idx = idByRow[c.row];
    if (!skip.id && idx && idx.missing.length) f.push({ text: 'ID missing · ' + idx.have + ' of ' + idx.expected, tone: 'bad' });
    if (c.type === 'Resold' && c.referrer) f.push({ text: 'Resold · ' + c.referrer, tone: 'info' });
    return f;
  };

  if (form) {
    return <TaskForm task={form.task} pin={s.pin} onClose={() => setForm(null)} onSaved={(r) => afterWrite(r, 'Saved')} />;
  }

  /* ════════════════ L2: one queue ════════════════ */
  if (page) {
    const tone = TONE[page];
    const subline = (() => {
      switch (page) {
        case 'ci': return ci.today.length ? ci.today.length + ' guest' + (ci.today.length === 1 ? '' : 's') + ' · ' + ci.today.filter((x) => idByRow[x.row]).length + ' without ID' : 'Nobody arriving';
        case 'co': return ci.checkoutsToday.length ? ci.checkoutsToday.length + ' departure' + (ci.checkoutsToday.length === 1 ? '' : 's') : 'Nobody leaving';
        case 'up': return ci.upcoming.length + ' arrival' + (ci.upcoming.length === 1 ? '' : 's') + ' ahead';
        case 'rev': return rev.length + ' guest' + (rev.length === 1 ? '' : 's') + ' to follow up';
        case 'ids': return ids.reduce((t, x) => t + (x.expected - x.have), 0) + ' documents missing' + (idsSoon ? ' · ' + idsSoon + ' arriving within 2 days' : '');
        case 'pay': return pay.list.length + ' booking' + (pay.list.length === 1 ? '' : 's');
        case 'low': return low.filter((i) => i.outNow).length + ' out of stock · ' + low.filter((i) => !i.outNow).length + ' running low';
        case 'act': return tasks.open.length + ' open · ' + tasks.due.length + ' due';
        case 'enq': return enq.fresh.length + ' new · ' + enq.all.length + ' total';
      }
    })();
    const headRight = page === 'pay' && manage && pay.list.length ? (
      <TouchableOpacity onPress={() => {
        const all = pay.list.filter((p) => !reqFor('payout', p.row));
        const on = all.every((p) => selPay[p.row]);
        setSelPay(on ? {} : Object.fromEntries(all.map((p) => [p.row, true])));
      }} hitSlop={8}>
        <Text style={st.headLink}>{pay.list.filter((p) => !reqFor('payout', p.row)).every((p) => selPay[p.row]) ? 'Clear' : 'Select all'}</Text>
      </TouchableOpacity>
    ) : page === 'act' && manage ? (
      <TouchableOpacity onPress={() => setForm({ task: null })} hitSlop={8}><Text style={st.headLink}>+ Add</Text></TouchableOpacity>
    ) : null;

    return (
      <View style={{ flex: 1, backgroundColor: C.bg }}>
        <View style={st.head}>
          <TouchableOpacity onPress={() => setPage(null)} style={st.back} activeOpacity={0.6} hitSlop={10} accessibilityLabel="Back">
            <Text style={st.backTxt}>‹</Text>
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={st.headTitle} numberOfLines={1}>{TITLE[page]}</Text>
            <Text style={[st.headSub, { color: tone.ink }]} numberOfLines={1}>{subline}{prop !== 'All' ? ' · ' + prop : ''}</Text>
          </View>
          {headRight}
        </View>

        {page === 'pay' ? (
          <View style={st.sumBar}>
            <Text style={st.sumLbl}>STILL TO COLLECT</Text>
            <Text style={st.sumVal}>{inr(pay.total)}</Text>
          </View>
        ) : null}
        {page === 'rev' ? (
          <Seg value={revTab} onChange={(v) => setRevTab(v as any)} options={[
            { key: 'pending', label: 'To ask', n: rev.filter((x) => x.status !== 'requested').length },
            { key: 'requested', label: 'Asked, waiting', n: rev.filter((x) => x.status === 'requested').length },
          ]} />
        ) : null}
        {page === 'enq' ? (
          <Seg value={enqTab} onChange={(v) => setEnqTab(v as EnquiryStatus)} options={(['new', 'contacted', 'booked', 'closed'] as const).map((k) => ({
            key: k, label: ENQ_LABEL[k], n: enq.all.filter((e) => e.status === k).length,
          }))} />
        ) : null}

        {sent ? (
          <View style={st.sentBox}>
            <Text style={st.sentHead}>{sent.msg}</Text>
            <Text style={st.sentBody}>Nothing below changes until an admin approves{sent.ids.length > 1 ? ' each request' : ' it'}; the rows are marked “waiting”.</Text>
            <View style={st.sentRow}>
              {sent.ids.length ? <Btn title={sent.ids.length > 1 ? `View my ${sent.ids.length} requests` : `View request #${sent.ids[0]}`} kind="mini" onPress={() => s.openMyRequests(sent.ids[0])} /> : null}
              <Btn title="Dismiss" kind="mini" onPress={() => setSent(null)} />
            </View>
          </View>
        ) : null}

        <ScrollView ref={scroller} style={{ flex: 1 }} contentContainerStyle={{ padding: 14, paddingBottom: page === 'pay' && selRows.length ? 110 : 40 }}>
          {page === 'ci' && (ci.today.length ? ci.today.map((x) => (
            <BRow key={'ci' + x.row} c={x.card} pin={s.pin} docId={docFor(x.row)} focus="in"
              flags={flagsOf(x.card)} actions={contact(x.card)}
              primary={idByRow[x.row] ? { label: 'Upload ID', onPress: () => s.setIdTarget(idByRow[x.row]) } : undefined}
              onPress={() => openBooking(x.row)} />
          )) : <Empty title="Nobody arriving today" sub="Arrivals for the next days are under Coming up." />)}

          {page === 'co' && (ci.checkoutsToday.length ? ci.checkoutsToday.map((x) => (
            <BRow key={'co' + x.row} c={x.card} pin={s.pin} docId={docFor(x.row)} focus="out"
              flags={flagsOf(x.card, { id: true })} actions={contact(x.card)}
              onPress={() => openBooking(x.row)} />
          )) : <Empty title="Nobody leaving today" />)}

          {page === 'up' && (
            <>
              {groupByDay(ci.upcoming.slice(0, UPCOMING_CAP)).map((g) => (
                <View key={g.key}>
                  <Text style={st.groupHead}>{dayHead(g.date)}</Text>
                  {g.items.map((x) => (
                    <BRow key={'up' + x.row} c={x.card} pin={s.pin} docId={docFor(x.row)} focus="in"
                      flags={flagsOf(x.card)} onPress={() => openBooking(x.row)}
                      primary={idByRow[x.row] ? { label: 'Upload ID', onPress: () => s.setIdTarget(idByRow[x.row]) } : undefined} />
                  ))}
                </View>
              ))}
              {ci.upcoming.length > UPCOMING_CAP ? <Text style={st.more}>+{ci.upcoming.length - UPCOMING_CAP} later arrivals: see the Calendar</Text> : null}
            </>
          )}

          {page === 'rev' && (() => {
            const list = rev.filter((x) => (revTab === 'requested') === (x.status === 'requested'));
            if (!list.length) return <Empty title={revTab === 'requested' ? 'No one waiting' : 'Everyone has been asked'} sub={revTab === 'requested' ? 'Guests you have asked show here until the review arrives.' : 'Guests who checked out appear here the day after.'} />;
            return list.map((x) => {
              const req = reqFor('review', x.row);
              return (
                <BRow key={'rv' + x.row} c={x.card} pin={s.pin} docId={docFor(x.row)} focus="out"
                  wait={req ? '#' + req.id + ' · review status' : undefined}
                  flags={[]} actions={contact(x.card)}
                  buttons={!manage || req ? undefined : [
                    ...(x.status !== 'requested' ? [{ label: 'Asked', onPress: () => setReview(x.row, 'requested') }] : []),
                    { label: 'Got review', onPress: () => setReview(x.row, 'received'), solid: true },
                    { label: 'Skip', onPress: () => setReview(x.row, 'skipped'), quiet: true },
                  ]}
                  onPress={() => openBooking(x.row)} />
              );
            });
          })()}

          {page === 'ids' && idsSorted.map((x) => {
            const n = daysFromToday(x.ci);
            const urgent = n !== null && n <= 2;
            /* Name who is missing only when it is not simply the guest on the card. */
            const who = x.missing.length === 1 && x.missing[0] === 'lead' ? ''
              : ' · missing ' + x.missing.map((sl) => sl === 'lead' ? (x.guest || 'lead guest') : (x.coGuest || 'co-guest')).join(' and ');
            return (
              <BRow key={'id' + x.row} c={x.card} pin={s.pin} docId={docFor(x.row)} focus="in"
                note={x.ci ? (who ? who.slice(3).replace(/^m/, 'M') : undefined) : 'No check-in date' + who}
                noteTone={urgent ? C.red : undefined}
                flags={flagsOf(x.card)}
                primary={{ label: 'Upload ID', onPress: () => s.setIdTarget(x) }}
                onPress={() => s.setIdTarget(x)} onOpen={() => openBooking(x.row)} />
            );
          })}

          {page === 'pay' && pay.list.map((p) => {
            const req = reqFor('payout', p.row);
            const on = !!selPay[p.row] && !req;
            return (
              <BRow key={'pay' + p.row} c={p.card} pin={s.pin} docId={docFor(p.row)} focus="none"
                select={manage && !req ? on : undefined}
                note={[p.card.paid ? 'Guest paid ' + inr(p.card.paid) : '', 'net ' + inr(p.card.net)].filter(Boolean).join(' · ')}
                wait={req ? '#' + req.id + ' · marked paid' : undefined}
                flags={[]} actions={contact(p.card)}
                onPress={manage && !req ? () => setSelPay((m) => ({ ...m, [p.row]: !m[p.row] })) : () => openBooking(p.row)}
                onOpen={manage && !req ? () => openBooking(p.row) : undefined} />
            );
          })}

          {page === 'low' && [...low].sort((a, c) => Number(c.outNow) - Number(a.outNow)).map((i) => (
            <LowRow key={'low' + i.r} i={i} onAdd={() => addStock(i)} />
          ))}

          {page === 'enq' && (() => {
            const list = enq.all.filter((e) => e.status === enqTab);
            if (!list.length) return <Empty title={'No ' + ENQ_LABEL[enqTab].toLowerCase() + ' enquiries'} sub="Enquiries from roam-in-heels.com land here." />;
            return list.map((e) => <EnquiryRow key={'e' + e.row} e={e} manage={manage} onStatus={(x) => setEnquiry(e, x)} />);
          })()}

          {page === 'act' && (tasks.all.length ? (
            <>
              {(['overdue', 'today', 'upcoming'] as const).map((k) => {
                const g = tasks.open.filter((t) => t.state === k);
                if (!g.length) return null;
                return (
                  <View key={k}>
                    <Text style={[st.groupHead, k === 'overdue' && { color: C.red }]}>{k === 'overdue' ? 'Overdue' : k === 'today' ? 'Due today' : 'Later'} · {g.length}</Text>
                    <View style={st.listCard}>
                      {g.map((t, i) => <TaskRow key={'t' + t.row} t={t} last={i === g.length - 1} req={reqFor('taskdone', t.row) || reqFor('task', t.row)}
                        onToggle={() => toggleTask(t)} onEdit={() => { if (manage) setForm({ task: t }); }} />)}
                    </View>
                  </View>
                );
              })}
              {tasks.done.length ? (
                <View>
                  <Text style={st.groupHead}>Done · {tasks.done.length}</Text>
                  <View style={st.listCard}>
                    {tasks.done.map((t, i) => <TaskRow key={'t' + t.row} t={t} last={i === tasks.done.length - 1} req={reqFor('taskdone', t.row) || reqFor('task', t.row)}
                      onToggle={() => toggleTask(t)} onEdit={() => { if (manage) setForm({ task: t }); }} />)}
                  </View>
                </View>
              ) : null}
            </>
          ) : (
            <Empty title="Nothing on the list" sub="For anything that is not a booking, an expense or stock: fix the geyser, renew the listing. Give it a date and it shows here when due."
              cta={manage ? { label: '+ Add a to-do', onPress: () => setForm({ task: null }) } : undefined} />
          ))}
        </ScrollView>

        {page === 'pay' && manage && selRows.length > 0 ? (
          <View style={st.footer}>
            <Btn title={`Mark ${selRows.length} paid · ${inr(selTotal)}`} onPress={markPaid} />
          </View>
        ) : null}
      </View>
    );
  }

  /* ════════════════ L1: the overview ════════════════ */
  const waiting = s.can('tickets.approve') ? (s.tickets?.review || []).filter((t) => t.status === 'pending') : [];
  const mine = s.myLive;
  const sentBack = mine.filter((t) => t.status === 'open').length;

  /* Today's movements, in time order: the door list. */
  const moves = [
    ...ci.today.map((x) => ({ x, kind: 'in' as const, t: x.card.inT })),
    ...ci.checkoutsToday.map((x) => ({ x, kind: 'out' as const, t: x.card.outT })),
  ].sort((a, c) => mins(a.t) - mins(c.t) || (a.kind === 'out' ? -1 : 1));
  const MOVES_SHOWN = 5;

  /* Needs you: urgency order, one line each. Empty queues stay out. */
  const outNow = low.filter((i) => i.outNow).length;
  const needs: { key: string; n: number; title: string; sub: string; tone: Tone; onPress: () => void }[] = [];
  if (waiting.length) needs.push({ key: 'apr', n: waiting.length, title: waiting.length === 1 ? 'Approval needed' : 'Approvals needed', sub: waiting[0].label + (waiting[0].requester ? ' · from ' + waiting[0].requester : ''), tone: { ink: G.gold3, bg: C.amberbg }, onPress: s.openApprovals });
  if (mine.length) needs.push({ key: 'mine', n: mine.length, title: sentBack ? 'Sent back to you' : 'Your requests', sub: sentBack ? sentBack + ' need your fix' : 'Waiting for approval · ' + mine[0].label, tone: { ink: C.amber, bg: C.amberbg }, onPress: () => s.openMyRequests() });
  if (count.ids) needs.push({ key: 'ids', n: count.ids, title: TITLE.ids, sub: idsSoon ? idsSoon + ' guest' + (idsSoon === 1 ? '' : 's') + ' arriving within 2 days' : nameOf(idsSorted[0]) + ' · ' + (idsSorted[0].ci ? 'arrives ' + relDay(idsSorted[0].ci) : 'no date'), tone: TONE.ids, onPress: () => setPage('ids') });
  if (count.pay) needs.push({ key: 'pay', n: count.pay, title: TITLE.pay, sub: inr(pay.total) + ' still to collect', tone: TONE.pay, onPress: () => setPage('pay') });
  if (count.enq) needs.push({ key: 'enq', n: count.enq, title: 'New enquiries', sub: enq.fresh[0].name + (enq.fresh[0].property ? ' · ' + enq.fresh[0].property : ''), tone: TONE.enq, onPress: () => setPage('enq') });
  if (count.rev) needs.push({ key: 'rev', n: count.rev, title: TITLE.rev, sub: rev.filter((x) => x.status !== 'requested').length + ' not asked yet · ' + rev.filter((x) => x.status === 'requested').length + ' waiting', tone: TONE.rev, onPress: () => setPage('rev') });
  if (count.low) needs.push({ key: 'low', n: count.low, title: TITLE.low, sub: outNow ? outNow + ' out of stock' : low[0].item + ' running low', tone: TONE.low, onPress: () => setPage('low') });
  if (count.act) needs.push({ key: 'act', n: count.act, title: 'To-dos due', sub: tasks.due[0].name, tone: TONE.act, onPress: () => setPage('act') });

  const soon = ci.upcoming.filter((x) => { const n = daysFromToday(x.date); return n !== null && n <= 7; });
  const now = new Date();
  const hello = now.getHours() < 12 ? 'Good morning' : now.getHours() < 17 ? 'Good afternoon' : 'Good evening';

  return (
    <View style={{ flex: 1 }}>
      <ScrollView ref={scroller} style={{ flex: 1 }} contentContainerStyle={{ padding: 14, paddingBottom: 96 }}>
        {s.props.length > 1 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.propRow}>
            {['All', ...s.props.map((pp) => pp.name)].map((n) => {
              const on = n === prop;
              return (
                <TouchableOpacity key={n} style={[st.pChip, on && st.pChipOn]} onPress={() => setProp(n)} activeOpacity={0.7}>
                  <Text style={[st.pTxt, on && st.pTxtOn]}>{n === 'All' ? 'All units' : unitNo(n) || n}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        ) : null}

        <Text style={st.hello}>{hello}</Text>
        <Text style={st.lede}>
          {needs.length + (moves.length ? 1 : 0) === 0 ? 'All clear. Nothing needs you right now.'
            : [moves.length ? moves.length + ' movement' + (moves.length === 1 ? '' : 's') + ' today' : '', needs.length ? needs.length + ' queue' + (needs.length === 1 ? '' : 's') + ' need you' : ''].filter(Boolean).join(' · ')}
        </Text>

        {/* ── Today ── */}
        <View style={st.todayCard}>
          <View style={st.todayHead}>
            <View style={{ flex: 1 }}>
              <Text style={st.kick}>TODAY</Text>
              <Text style={st.todayDate}>{WD[now.getDay()]}, {ciFmtDay(now)}</Text>
            </View>
            <TouchableOpacity onPress={() => s.setTab('cal')} hitSlop={8}><Text style={st.headLink}>Calendar ›</Text></TouchableOpacity>
          </View>
          <View style={st.stats}>
            <Stat n={count.ci} label="Arriving" ink={C.green} onPress={() => setPage('ci')} />
            <Stat n={count.co} label="Leaving" ink={G.gold3} onPress={() => setPage('co')} />
            <Stat n={inHouse} label="Staying on" ink={C.sky} onPress={() => s.setTab('cal')} />
          </View>
          {moves.length ? (
            <View style={{ marginTop: 6 }}>
              {moves.slice(0, MOVES_SHOWN).map(({ x, kind, t }, i) => {
                const idx = idByRow[x.row];
                return (
                  <TouchableOpacity key={kind + x.row} style={[st.move, i === 0 && { borderTopWidth: 0 }]} onPress={() => openBooking(x.row)} activeOpacity={0.7}>
                    <View style={st.moveTime}>
                      <Text style={[st.moveKind, { color: kind === 'in' ? C.green : G.gold3 }]}>{kind === 'in' ? 'IN' : 'OUT'}</Text>
                      <Text style={[st.moveT, !t && { color: C.muted }]}>{t || '—'}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={st.moveName} numberOfLines={1}>{nameOf(x)}</Text>
                      <View style={st.subRow}><Platform ch={x.card.channel} small /><Text style={st.moveSub} numberOfLines={1}>Unit {unitOf(x.card)}{x.card.guests ? ' · ' + x.card.guests + ' guest' + (x.card.guests === 1 ? '' : 's') : ''}</Text></View>
                    </View>
                    {kind === 'in' && idx ? <Tag text="No ID" tone="bad" /> : null}
                    {x.card.pending > 0 ? <Tag text={inr(x.card.pending)} tone="bad" /> : null}
                    <Text style={st.chev}>›</Text>
                  </TouchableOpacity>
                );
              })}
              {moves.length > MOVES_SHOWN ? (
                <TouchableOpacity onPress={() => setPage(count.ci >= count.co ? 'ci' : 'co')} style={st.moreBtn}>
                  <Text style={st.headLink}>+{moves.length - MOVES_SHOWN} more today</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          ) : <Text style={st.quiet}>No arrivals or departures today.</Text>}
        </View>

        {/* ── Needs you ── */}
        {needs.length ? (
          <>
            <Text style={st.section}>Needs you</Text>
            <View style={st.listCard}>
              {needs.map((r, i) => (
                <TouchableOpacity key={r.key} style={[st.need, i === needs.length - 1 && { borderBottomWidth: 0 }]} onPress={r.onPress} activeOpacity={0.7}>
                  <View style={[st.needN, { backgroundColor: r.tone.bg }]}>
                    <Text style={[st.needNTxt, { color: r.tone.ink }]} numberOfLines={1} adjustsFontSizeToFit>{r.n}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={st.needTitle}>{r.title}</Text>
                    <Text style={st.needSub} numberOfLines={1}>{r.sub}</Text>
                  </View>
                  <Text style={st.chev}>›</Text>
                </TouchableOpacity>
              ))}
            </View>
          </>
        ) : (
          <View style={st.clear}>
            <Text style={st.clearMark}>✓</Text>
            <Text style={st.clearTitle}>Nothing waiting on you</Text>
            <Text style={st.clearSub}>IDs, payments, reviews, enquiries and stock are all up to date{prop !== 'All' ? ' for ' + prop : ''}.</Text>
          </View>
        )}

        {/* ── Coming up ── */}
        <View style={st.sectionRow}>
          <Text style={[st.section, { flex: 1, marginTop: 0, marginBottom: 0 }]}>Coming up</Text>
          {ci.upcoming.length ? <TouchableOpacity onPress={() => setPage('up')} hitSlop={8}><Text style={st.headLink}>All {ci.upcoming.length} ›</Text></TouchableOpacity> : null}
        </View>
        {soon.length ? (
          <View style={st.listCard}>
            {soon.slice(0, 5).map((x, i) => (
              <TouchableOpacity key={'s' + x.row} style={[st.need, i === Math.min(5, soon.length) - 1 && { borderBottomWidth: 0 }]} onPress={() => openBooking(x.row)} activeOpacity={0.7}>
                <View style={st.dateBox}>
                  <Text style={st.dateWd}>{WD[x.date.getDay()].toUpperCase()}</Text>
                  <Text style={st.dateD}>{x.date.getDate()}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={st.needTitle} numberOfLines={1}>{nameOf(x)}</Text>
                  <View style={st.subRow}><Platform ch={x.card.channel} small /><Text style={st.needSub} numberOfLines={1}>Unit {unitOf(x.card)} · {x.card.nights === null ? 'stay' : x.card.nights === 0 ? 'day use' : x.card.nights + ' night' + (x.card.nights === 1 ? '' : 's')}</Text></View>
                </View>
                {idByRow[x.row] ? <Tag text="No ID" tone="bad" /> : null}
                <Text style={st.chev}>›</Text>
              </TouchableOpacity>
            ))}
          </View>
        ) : <Text style={[st.quiet, { paddingHorizontal: 4 }]}>No arrivals in the next 7 days.</Text>}

        {/* ── Lists you keep ── */}
        <Text style={st.section}>Lists</Text>
        <View style={st.listCard}>
          <ListLink title="To-do list" sub={tasks.open.length ? tasks.open.length + ' open' + (tasks.due.length ? ' · ' + tasks.due.length + ' due' : '') : 'Nothing open'} onPress={() => setPage('act')} last={!enq.all.length} />
          {enq.all.length ? <ListLink title="Website enquiries" sub={enq.all.length + ' total · ' + enq.fresh.length + ' new'} onPress={() => setPage('enq')} last /> : null}
        </View>
      </ScrollView>
      {manage ? (
        <TouchableOpacity style={st.fab} onPress={() => setForm({ task: null })} activeOpacity={0.85} accessibilityLabel="Add a to-do">
          <Text style={st.fabTxt}>+  To-do</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

/* ── pieces ─────────────────────────────────────────────────────────────── */
const ENQ_LABEL: Record<EnquiryStatus, string> = { new: 'New', contacted: 'Contacted', booked: 'Booked', closed: 'Closed' };

function groupByDay(list: CiItem[]) {
  const out: { key: string; date: Date; items: CiItem[] }[] = [];
  list.forEach((x) => {
    const k = String(dayStart(x.date));
    let g = out.find((o) => o.key === k);
    if (!g) { g = { key: k, date: x.date, items: [] }; out.push(g); }
    g.items.push(x);
  });
  return out;
}

function Stat({ n, label, ink, onPress }: { n: number; label: string; ink: string; onPress: () => void }) {
  return (
    <TouchableOpacity style={st.stat} onPress={onPress} activeOpacity={0.7}>
      <Text style={[st.statN, { color: n ? ink : C.muted }]}>{n}</Text>
      <Text style={st.statL}>{label}</Text>
    </TouchableOpacity>
  );
}

function ListLink({ title, sub, onPress, last }: { title: string; sub: string; onPress: () => void; last?: boolean }) {
  return (
    <TouchableOpacity style={[st.need, last && { borderBottomWidth: 0 }]} onPress={onPress} activeOpacity={0.7}>
      <View style={{ flex: 1 }}>
        <Text style={st.needTitle}>{title}</Text>
        <Text style={st.needSub} numberOfLines={1}>{sub}</Text>
      </View>
      <Text style={st.chev}>›</Text>
    </TouchableOpacity>
  );
}

type Flag = { text: string; tone: 'bad' | 'info' | 'ok' };
function Tag({ text, tone }: Flag) {
  const c = tone === 'bad' ? { bg: C.redbg, fg: C.red } : tone === 'ok' ? { bg: C.greenbg, fg: C.green } : { bg: C.amberbg, fg: G.gold3 };
  return <View style={[st.tag, { backgroundColor: c.bg }]}><Text style={[st.tagTxt, { color: c.fg }]} numberOfLines={1}>{text}</Text></View>;
}
function TimePill({ t, kind }: { t: string; kind: 'in' | 'out' }) {
  return (
    <View style={[st.timePill, { backgroundColor: kind === 'in' ? C.greenbg : C.amberbg }]}>
      <Text style={[st.timeTxt, { color: kind === 'in' ? C.green : G.gold3 }]}>{t}</Text>
    </View>
  );
}

function Seg({ value, options, onChange }: { value: string; options: { key: string; label: string; n: number }[]; onChange: (k: string) => void }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={st.segRow}>
      {options.map((o) => {
        const on = o.key === value;
        return (
          <TouchableOpacity key={o.key} style={[st.segBtn, on && st.segOn]} onPress={() => onChange(o.key)} activeOpacity={0.75}>
            <Text style={[st.segTxt, on && st.segTxtOn]}>{o.label}{o.n ? '  ' + o.n : ''}</Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

function Empty({ title, sub, cta }: { title: string; sub?: string; cta?: { label: string; onPress: () => void } }) {
  return (
    <View style={st.clear}>
      <Text style={st.clearMark}>✓</Text>
      <Text style={st.clearTitle}>{title}</Text>
      {sub ? <Text style={st.clearSub}>{sub}</Text> : null}
      {cta ? <View style={{ marginTop: 14 }}><Btn title={cta.label} onPress={cta.onPress} /></View> : null}
    </View>
  );
}

/* ── the booking card, shared by every booking queue ─────────────────────
   Read top to bottom, it answers the five questions a manager has about a
   booking, in the order they are asked:
     who and where   the unit's photo with the guest's face (their ID photo,
                     else their initial) laid over it, name, unit, party size
     from where      the platform as a coloured badge: where to go and check
     how much        anything still owed, large, in the top-right corner
     when            a check-in / check-out strip: date first, then day and time,
                     the end this queue is about in colour, nights between
     what to do      problems as tags, then the buttons that clear them
   Nothing unknown is printed: no "time not recorded", no empty boxes. */
type Btnish = { label: string; onPress: () => void; solid?: boolean; quiet?: boolean };
function BRow({ c, pin, docId, focus, note, noteTone, flags, actions, primary, buttons, wait, select, onPress, onOpen }: {
  c: CardData; pin: string; docId?: number; focus: 'in' | 'out' | 'none';
  note?: string; noteTone?: string; flags: Flag[];
  actions?: Btnish[]; primary?: Btnish; buttons?: Btnish[]; wait?: string;
  select?: boolean; onPress: () => void; onOpen?: () => void;
}) {
  const call = actions?.find((x) => x.label === 'Call');
  const wa = actions?.find((x) => x.label === 'WhatsApp');
  const btns: Btnish[] = [...(buttons || []), ...(primary ? [{ ...primary, solid: true }] : [])];
  const people = c.guests ? c.guests + (c.guests === 1 ? ' guest' : ' guests') : '';
  return (
    <View style={[st.card, select && st.cardOn]}>
      <TouchableOpacity onPress={onPress} activeOpacity={0.8}>
        <View style={st.cardTop}>
          {select !== undefined ? (
            <View style={[st.check, select && st.checkOn]}>{select ? <Text style={st.checkMark}>✓</Text> : null}</View>
          ) : null}
          <DuoAvatar c={c} pin={pin} docId={docId} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={st.cName} numberOfLines={1}>{c.guest || c.id || 'Guest'}</Text>
            <View style={st.subRow}>
              <Platform ch={c.channel} />
              <Text style={st.cMeta} numberOfLines={1}>Unit {unitOf(c)}{people ? ' · ' + people : ''}</Text>
            </View>
          </View>
          {c.pending > 0 ? (
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={st.cDue}>{inr(c.pending)}</Text>
              <Text style={st.cDueLbl}>PENDING</Text>
            </View>
          ) : c.paid > 0 ? (
            <View style={st.paidChip}><Text style={st.paidTxt}>Paid</Text></View>
          ) : null}
        </View>

        {c.inD || c.outD ? <StayStrip c={c} focus={focus} /> : null}

        {note ? <Text style={[st.note, noteTone ? { color: noteTone } : null]} numberOfLines={2}>{note}</Text> : null}
        {flags.length || wait ? (
          <View style={st.tags}>
            {wait ? <Tag text={'Waiting for approval · ' + wait} tone="info" /> : null}
            {flags.map((f, i) => <Tag key={i} {...f} />)}
          </View>
        ) : null}
      </TouchableOpacity>

      {call || wa || btns.length || onOpen ? (
        <View style={st.cFoot}>
          {call ? <IconBtn kind="call" onPress={call.onPress} /> : null}
          {wa ? <IconBtn kind="wa" onPress={wa.onPress} /> : null}
          {btns.map((x, i) => (
            <TouchableOpacity key={i} onPress={x.onPress} activeOpacity={0.7} style={[st.act, x.solid && st.actSolid]}>
              <Text style={[st.actTxt, x.solid && { color: '#fff' }, x.quiet && { color: C.muted }]}>{x.label}</Text>
            </TouchableOpacity>
          ))}
          <View style={{ flex: 1 }} />
          {onOpen ? <TouchableOpacity onPress={onOpen} hitSlop={8}><Text style={st.headLink}>Booking ›</Text></TouchableOpacity> : null}
        </View>
      ) : null}
    </View>
  );
}

/* Check-in and check-out side by side. Date first (that is what is
   compared), then the weekday or Today/Tomorrow and the time underneath. */
const MON3 = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function StayStrip({ c, focus }: { c: CardData; focus: 'in' | 'out' | 'none' }) {
  const end = (d: Date | null, t: string, lbl: string, on: boolean, ink: string, right?: boolean) => {
    const n = daysFromToday(d);
    const rel = n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : n === -1 ? 'Yesterday' : d ? WD[d.getDay()] : '';
    return (
      <View style={[{ flex: 1 }, right && { alignItems: 'flex-end' }]}>
        <Text style={[st.sLbl, on && { color: ink }]}>{lbl}</Text>
        <Text style={[st.sDate, on && { color: ink }]}>{d ? d.getDate() + ' ' + MON3[d.getMonth()] : '—'}</Text>
        <Text style={[st.sSub, n !== null && Math.abs(n) <= 1 && { color: ink, fontFamily: F.bold }]} numberOfLines={1}>
          {[rel, t].filter(Boolean).join(' · ') || ' '}
        </Text>
      </View>
    );
  };
  const n = c.nights;
  return (
    <View style={st.strip}>
      {end(c.inD, c.inT, 'CHECK-IN', focus === 'in', C.green)}
      <View style={st.sMid}>
        <View style={st.sLine} />
        <Text style={st.sNights}>{n === null ? '' : n === 0 ? 'day use' : n + (n === 1 ? ' night' : ' nights')}</Text>
        <View style={st.sLine} />
      </View>
      {end(c.outD, c.outT, 'CHECK-OUT', focus === 'out', G.gold3, true)}
    </View>
  );
}

/* The flat's photo, with the guest overlapping it: their ID photo when one
   was uploaded, else their initial. Which flat and which person, at once. */
function DuoAvatar({ c, pin, docId }: { c: CardData; pin: string; docId?: number }) {
  const [failed, setFailed] = useState(false);
  const u = unitOf(c);
  const cover = coverFor(unitNo(u) || u);
  const initial = (c.guest || '?').trim().slice(0, 1).toUpperCase();
  return (
    <View style={st.duo}>
      {cover ? <Image source={cover} style={st.duoUnit} /> : (
        <View style={[st.duoUnit, st.duoUnitFallback]}><Text style={[st.duoUnitTxt, u.length > 3 && { fontSize: 10.5 }, u.length > 4 && { fontSize: 9 }]} numberOfLines={1}>{u.slice(0, 6)}</Text></View>
      )}
      <View style={st.duoGuest}>
        {docId && !failed
          ? <Image source={{ uri: api.attachmentUrl(pin, docId) }} style={st.duoGuestImg} onError={() => setFailed(true)} />
          : <Text style={st.duoGuestTxt}>{initial}</Text>}
      </View>
    </View>
  );
}

/* Where the booking came from, so you know where to go and check. Plain
   coloured labels; the colours are only there to tell them apart at a glance. */
const PLATFORM: Record<string, { label: string; fg: string; bg: string }> = {
  airbnb: { label: 'Airbnb', fg: '#D93B4A', bg: '#FDECEE' },
  booking: { label: 'Booking.com', fg: '#1D4F9E', bg: '#E8EFFA' },
  agoda: { label: 'Agoda', fg: '#6A3FC4', bg: '#F0EBFB' },
  mmt: { label: 'MMT', fg: '#C2410C', bg: '#FDEFE6' },
  host: { label: 'From host', fg: G.gold3, bg: C.amberbg },
  direct: { label: 'Direct', fg: '#3F4A44', bg: '#ECEFED' },
};
function platformOf(ch: string) {
  const v = String(ch || '').toLowerCase();
  if (v.includes('airbnb')) return PLATFORM.airbnb;
  if (v.includes('booking')) return PLATFORM.booking;
  if (v.includes('agoda')) return PLATFORM.agoda;
  if (v.includes('mmt') || v.includes('makemytrip') || v.includes('goibibo')) return PLATFORM.mmt;
  if (v.includes('host') || v.includes('offline')) return PLATFORM.host;
  if (!v) return null;
  if (v.includes('direct') || v.includes('referral')) return PLATFORM.direct;
  return { ...PLATFORM.direct, label: ch };
}
function Platform({ ch, small }: { ch: string; small?: boolean }) {
  const p = platformOf(ch);
  if (!p) return null;
  return (
    <View style={[st.plat, { backgroundColor: p.bg }, small && st.platSm]}>
      <View style={[st.platDot, { backgroundColor: p.fg }]} />
      <Text style={[st.platTxt, { color: p.fg }, small && { fontSize: 10.5 }]} numberOfLines={1}>{p.label}</Text>
    </View>
  );
}

function IconBtn({ kind, onPress }: { kind: 'call' | 'wa'; onPress: () => void }) {
  const wa = kind === 'wa';
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.7} accessibilityLabel={wa ? 'WhatsApp the guest' : 'Call the guest'}
      style={[st.iconBtn, wa && { backgroundColor: '#E7F7EE', borderColor: '#BFE8CF' }]}>
      <Svg width={17} height={17} viewBox="0 0 24 24">
        {wa ? (
          <>
            <Path d="M12 3a9 9 0 0 0-7.8 13.5L3 21l4.6-1.2A9 9 0 1 0 12 3z" fill="none" stroke="#1E9E57" strokeWidth={1.9} strokeLinejoin="round" />
            <Path d="M9 8.6c.2-.4.5-.4.8-.4h.5c.2 0 .4.1.5.4l.6 1.5c.1.2 0 .5-.1.6l-.5.6c.6 1.1 1.5 2 2.6 2.6l.6-.5c.2-.1.4-.2.6-.1l1.5.6c.3.1.4.3.4.5v.5c0 .3-.1.6-.4.8-.5.4-1.2.6-1.9.4-2.6-.7-4.6-2.7-5.3-5.3-.1-.7 0-1.4.5-1.9z" fill="#1E9E57" />
          </>
        ) : (
          <Path d="M6.6 3.5h2.1c.4 0 .8.3.9.7l.9 3.3c.1.4 0 .8-.3 1L8.7 9.8a12 12 0 0 0 5.5 5.5l1.3-1.5c.3-.3.7-.4 1-.3l3.3.9c.4.1.7.5.7.9v2.1c0 1-.8 1.8-1.8 1.8C10.3 19.2 4.8 13.7 4.8 5.3c0-1 .8-1.8 1.8-1.8z" fill="none" stroke={C.ink} strokeWidth={1.8} strokeLinejoin="round" />
        )}
      </Svg>
    </TouchableOpacity>
  );
}

function TaskRow({ t, req, onToggle, onEdit, last }: { t: TaskItem; req?: Ticket | null; onToggle: () => void; onEdit: () => void; last?: boolean }) {
  const tone = t.done ? C.muted : t.state === 'overdue' ? C.red : t.state === 'today' ? G.gold3 : C.bark;
  return (
    <View style={[st.task, last && { borderBottomWidth: 0 }]}>
      <TouchableOpacity onPress={onToggle} hitSlop={12} activeOpacity={0.7} accessibilityRole="checkbox" accessibilityState={{ checked: t.done }}>
        <View style={[st.check, st.checkRound, t.done && st.checkOn]}>{t.done ? <Text style={st.checkMark}>✓</Text> : null}</View>
      </TouchableOpacity>
      <TouchableOpacity style={{ flex: 1 }} onPress={onEdit} activeOpacity={0.75}>
        <Text style={[st.taskName, t.done && st.taskDone]} numberOfLines={2}>{t.name}</Text>
        {t.desc ? <Text style={st.taskDesc} numberOfLines={2}>{t.desc}</Text> : null}
        <Text style={[st.taskWhen, { color: tone }]}>{req ? 'Waiting for approval · #' + req.id : taskWhen(t)}</Text>
      </TouchableOpacity>
    </View>
  );
}

function LowRow({ i, onAdd }: { i: LowItem; onAdd: () => void }) {
  const goal = i.required || (i.reorder !== '' ? Number(i.reorder) * 2 : 0) || Math.max(1, i.inStock);
  const p = Math.max(0, Math.min(1, i.inStock / goal));
  const when = i.outNow ? 'Out of stock'
    : i.runOut ? (i.estimated ? 'About ' : '') + (i.daysLeft !== null ? i.daysLeft + ' day' + (i.daysLeft === 1 ? '' : 's') + ' left' : 'runs out ' + ciFmtDay(i.runOut))
      : 'Running low';
  return (
    <View style={st.row}>
      <View style={st.rowHead}>
        <View style={{ flex: 1 }}>
          <Text style={st.rowName} numberOfLines={1}>{i.item}</Text>
          <Text style={st.rowMeta} numberOfLines={1}>{[unitNo(i.property) || i.property, i.category].filter(Boolean).join(' · ')}</Text>
        </View>
        <Text style={[st.count, i.outNow && st.countBad]}>{i.inStock}{i.required ? ' / ' + i.required : ''}</Text>
      </View>
      <View style={st.bar}><View style={[st.barFill, { width: `${Math.round(p * 100)}%` as `${number}%`, backgroundColor: i.outNow ? C.red : p < 0.5 ? C.amber : C.green }]} /></View>
      <Text style={[st.note, i.outNow && { color: C.red }]}>{when}{i.reorder !== '' ? ' · reorder at ' + i.reorder : ''}</Text>
      <View style={st.btnRow}>
        <TouchableOpacity style={[st.act, st.actSolid]} onPress={onAdd} activeOpacity={0.7}><Text style={[st.actTxt, { color: '#fff' }]}>+ Add stock</Text></TouchableOpacity>
      </View>
    </View>
  );
}

function EnquiryRow({ e, manage, onStatus }: { e: EnquiryItem; manage: boolean; onStatus: (s: EnquiryStatus) => void }) {
  const digits = e.mobile.replace(/[^0-9+]/g, '');
  const received = (() => {
    const d = new Date(e.received);
    return isNaN(d.getTime()) ? e.received : relDay(d) + ', ' + d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
  })();
  const stay = [e.checkIn && fmtEnquiryWhen(e.checkIn), e.checkOut && fmtEnquiryWhen(e.checkOut)].filter(Boolean).join('  →  ');
  const next: EnquiryStatus[] = e.status === 'new' ? ['contacted', 'booked', 'closed'] : e.status === 'contacted' ? ['booked', 'closed'] : ['new'];
  return (
    <View style={st.row}>
      <View style={st.rowHead}>
        <View style={st.avatar}><Text style={st.avatarTxt}>{(e.name || '?').trim().slice(0, 1).toUpperCase()}</Text></View>
        <View style={{ flex: 1 }}>
          <Text style={st.rowName} numberOfLines={1}>{e.name}</Text>
          <Text style={st.rowMeta} numberOfLines={1}>{[e.property ? unitNo(e.property) || e.property : '', e.guests ? e.guests + ' guests' : '', received].filter(Boolean).join(' · ')}</Text>
        </View>
      </View>
      <Text style={st.stay}>{stay || 'Dates not given'}</Text>
      {e.message ? <Text style={st.quote} numberOfLines={3}>“{e.message}”</Text> : null}
      {e.referral ? <Text style={st.note}>Heard via {e.referral}</Text> : null}
      <View style={st.btnRow}>
        {digits ? <TouchableOpacity style={st.act} onPress={() => Linking.openURL('tel:' + digits)}><Text style={st.actTxt}>Call</Text></TouchableOpacity> : null}
        {digits ? <TouchableOpacity style={st.act} onPress={() => Linking.openURL('https://wa.me/' + waNumber(digits))}><Text style={st.actTxt}>WhatsApp</Text></TouchableOpacity> : null}
        <View style={{ flex: 1 }} />
      </View>
      {manage ? (
        <View style={[st.btnRow, { marginTop: 8 }]}>
          <Text style={st.moveLbl}>Mark as</Text>
          {next.map((k) => (
            <TouchableOpacity key={k} style={[st.act, st.actSm, k === 'booked' && st.actGreen]} onPress={() => onStatus(k)} activeOpacity={0.7}>
              <Text style={[st.actTxt, k === 'booked' && { color: '#fff' }, k === 'closed' && { color: C.muted }]}>{k === 'new' ? 'Reopen' : ENQ_LABEL[k]}</Text>
            </TouchableOpacity>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const st = StyleSheet.create({
  propRow: { gap: 7, alignItems: 'center', paddingBottom: 12, paddingRight: 4 },
  pChip: { paddingVertical: 6, paddingHorizontal: 13, borderRadius: 999, borderWidth: 1, borderColor: C.line, backgroundColor: C.card },
  pChipOn: { backgroundColor: C.navy, borderColor: C.navy },
  pTxt: { fontFamily: F.semi, fontSize: 12, color: C.bark },
  pTxtOn: { color: '#fff', fontFamily: F.bold },

  hello: { fontFamily: F.xbold, fontSize: 24, color: C.ink, letterSpacing: -0.5, marginLeft: 2 },
  lede: { fontFamily: F.semi, fontSize: 13, color: C.bark, marginTop: 2, marginBottom: 14, marginLeft: 2 },
  kick: { fontFamily: F.bold, fontSize: 10, letterSpacing: 1.4, color: G.gold2 },
  section: { fontFamily: F.xbold, fontSize: 16, color: C.ink, marginTop: 22, marginBottom: 8, marginLeft: 2 },
  sectionRow: { flexDirection: 'row', alignItems: 'baseline', marginTop: 22, marginBottom: 8, paddingRight: 4 },
  headLink: { fontFamily: F.bold, fontSize: 13, color: G.gold2 },

  todayCard: {
    backgroundColor: '#fff', borderRadius: 22, padding: 16, borderWidth: 1, borderColor: 'rgba(90,58,20,0.10)',
    shadowColor: G.shadow, shadowOpacity: 0.07, shadowRadius: 10, shadowOffset: { width: 0, height: 3 }, elevation: 2,
  },
  todayHead: { flexDirection: 'row', alignItems: 'center' },
  todayDate: { fontFamily: F.xbold, fontSize: 18, color: C.ink, marginTop: 1 },
  stats: { flexDirection: 'row', gap: 8, marginTop: 12 },
  stat: { flex: 1, backgroundColor: C.warm2, borderRadius: 14, paddingVertical: 10, paddingHorizontal: 12, borderWidth: 1, borderColor: C.hair },
  statN: { fontFamily: F.xbold, fontSize: 24, lineHeight: 28 },
  statL: { fontFamily: F.semi, fontSize: 11.5, color: C.bark, marginTop: 1 },
  move: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 11, borderTopWidth: 1, borderTopColor: C.hair },
  moveTime: { width: 64 },
  moveKind: { fontFamily: F.xbold, fontSize: 9.5, letterSpacing: 0.9 },
  moveT: { fontFamily: F.bold, fontSize: 12.5, color: C.ink, marginTop: 1 },
  moveName: { fontFamily: F.bold, fontSize: 14.5, color: C.ink },
  moveSub: { fontFamily: F.med, fontSize: 12, color: C.muted, marginTop: 1 },
  moreBtn: { paddingTop: 10, alignItems: 'center', borderTopWidth: 1, borderTopColor: C.hair },
  chev: { fontFamily: F.bold, fontSize: 20, color: '#C9C6BD', marginLeft: 2 },
  quiet: { fontFamily: F.med, fontSize: 13, color: C.muted, paddingTop: 12 },

  listCard: { backgroundColor: '#fff', borderRadius: 18, borderWidth: 1, borderColor: 'rgba(90,58,20,0.10)', paddingHorizontal: 14, marginBottom: 4 },
  need: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: C.hair },
  needN: { minWidth: 38, height: 38, borderRadius: 12, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center' },
  needNTxt: { fontFamily: F.xbold, fontSize: 16 },
  needTitle: { fontFamily: F.bold, fontSize: 14.5, color: C.ink },
  needSub: { fontFamily: F.med, fontSize: 12, color: C.muted, marginTop: 2 },
  dateBox: { width: 38, alignItems: 'center', paddingVertical: 3, borderRadius: 10, backgroundColor: C.warm2, borderWidth: 1, borderColor: C.hair },
  dateWd: { fontFamily: F.bold, fontSize: 8.5, letterSpacing: 0.6, color: C.muted },
  dateD: { fontFamily: F.xbold, fontSize: 15, color: C.ink },

  clear: { backgroundColor: '#fff', borderRadius: 18, borderWidth: 1, borderColor: C.hair, alignItems: 'center', paddingVertical: 30, paddingHorizontal: 20, marginTop: 18 },
  clearMark: { fontSize: 26, color: C.green, fontFamily: F.bold },
  clearTitle: { fontFamily: F.xbold, fontSize: 16, color: C.ink, marginTop: 4 },
  clearSub: { fontFamily: F.med, fontSize: 12.5, color: C.muted, textAlign: 'center', marginTop: 5, lineHeight: 18 },

  fab: {
    position: 'absolute', right: 16, bottom: 18, height: 46, paddingHorizontal: 18, borderRadius: 23, backgroundColor: C.navy,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 6,
  },
  fabTxt: { color: '#fff', fontSize: 14, fontFamily: F.bold },

  /* L2 */
  head: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingTop: 12, paddingBottom: 12, backgroundColor: C.card, borderBottomWidth: 1, borderBottomColor: C.line },
  back: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: C.bone },
  backTxt: { fontSize: 26, lineHeight: 28, color: C.ink, fontFamily: F.bold },
  headTitle: { fontFamily: F.xbold, fontSize: 19, color: C.ink, letterSpacing: -0.3 },
  headSub: { fontFamily: F.semi, fontSize: 12, marginTop: 1 },
  sumBar: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', backgroundColor: C.redbg, paddingHorizontal: 16, paddingVertical: 11 },
  sumLbl: { fontFamily: F.bold, fontSize: 10, letterSpacing: 1, color: C.red },
  sumVal: { fontFamily: F.xbold, fontSize: 22, color: C.red },
  segRow: { gap: 7, paddingHorizontal: 14, paddingTop: 12 },
  segBtn: { paddingVertical: 7, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1, borderColor: C.line, backgroundColor: '#fff' },
  segOn: { backgroundColor: C.navy, borderColor: C.navy },
  segTxt: { fontFamily: F.semi, fontSize: 12.5, color: C.bark },
  segTxtOn: { color: '#fff', fontFamily: F.bold },
  groupHead: { fontFamily: F.bold, fontSize: 12, color: C.bark, marginBottom: 8, marginTop: 6, marginLeft: 2 },
  more: { fontFamily: F.med, fontSize: 12, color: C.muted, paddingTop: 4, textAlign: 'center' },

  card: {
    backgroundColor: '#fff', borderRadius: 20, padding: 14, marginBottom: 12,
    borderWidth: 1, borderColor: 'rgba(90,58,20,0.09)',
    shadowColor: G.shadow, shadowOpacity: 0.06, shadowRadius: 10, shadowOffset: { width: 0, height: 3 }, elevation: 2,
  },
  cardOn: { borderColor: C.navy, borderWidth: 1.5 },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  cName: { fontFamily: F.xbold, fontSize: 16.5, color: C.ink, letterSpacing: -0.2 },
  subRow: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 4 },
  cMeta: { fontFamily: F.semi, fontSize: 12, color: C.bark, flexShrink: 1 },
  cDue: { fontFamily: F.xbold, fontSize: 17, color: C.red, letterSpacing: -0.3 },
  cDueLbl: { fontFamily: F.bold, fontSize: 8.5, letterSpacing: 1, color: C.red, opacity: 0.75, marginTop: 1 },
  paidChip: { backgroundColor: C.greenbg, borderRadius: 999, paddingVertical: 4, paddingHorizontal: 10 },
  paidTxt: { fontFamily: F.bold, fontSize: 11, color: C.green },
  duo: { width: 56, height: 50 },
  duoUnit: { width: 46, height: 46, borderRadius: 23, backgroundColor: C.bone },
  duoUnitFallback: { backgroundColor: '#2B2B33', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  duoUnitTxt: { fontFamily: F.xbold, fontSize: 12, color: '#fff' },
  duoGuest: {
    position: 'absolute', right: 0, bottom: 0, width: 30, height: 30, borderRadius: 15, borderWidth: 2.5, borderColor: '#fff',
    backgroundColor: '#EFE7DA', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },
  duoGuestImg: { width: '100%', height: '100%' },
  duoGuestTxt: { fontFamily: F.xbold, fontSize: 12.5, color: G.gold3 },
  plat: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 999, paddingVertical: 3, paddingHorizontal: 8 },
  platSm: { paddingVertical: 2, paddingHorizontal: 7 },
  platDot: { width: 6, height: 6, borderRadius: 3 },
  platTxt: { fontFamily: F.bold, fontSize: 11 },
  strip: { flexDirection: 'row', alignItems: 'center', marginTop: 12, backgroundColor: C.warm2, borderRadius: 14, paddingVertical: 10, paddingHorizontal: 12, borderWidth: 1, borderColor: C.hair },
  sLbl: { fontFamily: F.bold, fontSize: 8.5, letterSpacing: 1, color: C.muted },
  sDate: { fontFamily: F.xbold, fontSize: 15.5, color: C.ink, marginTop: 2, letterSpacing: -0.2 },
  sSub: { fontFamily: F.semi, fontSize: 11, color: C.bark, marginTop: 1 },
  sMid: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 4 },
  sLine: { width: 12, height: 1, backgroundColor: '#D9D5CB' },
  sNights: { fontFamily: F.bold, fontSize: 10.5, color: C.muted },
  cFoot: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 7, marginTop: 12 },
  iconBtn: { width: 34, height: 34, borderRadius: 17, borderWidth: 1, borderColor: C.line, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  row: { backgroundColor: '#fff', borderRadius: 16, borderWidth: 1, borderColor: 'rgba(90,58,20,0.10)', padding: 13, marginBottom: 10 },
  rowOn: { borderColor: C.navy, borderWidth: 1.5 },
  rowHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  rowName: { fontFamily: F.bold, fontSize: 15.5, color: C.ink },
  rowMeta: { fontFamily: F.med, fontSize: 12, color: C.muted, marginTop: 1 },
  avatar: { width: 38, height: 38, borderRadius: 19, backgroundColor: C.bone, alignItems: 'center', justifyContent: 'center' },
  avatarTxt: { fontFamily: F.xbold, fontSize: 15, color: C.bark },
  stay: { fontFamily: F.semi, fontSize: 12.5, color: C.bark, marginTop: 10 },
  stayOn: { fontFamily: F.xbold, color: C.ink },
  stayArrow: { color: C.muted },
  stayN: { color: C.muted, fontFamily: F.med },
  note: { fontFamily: F.med, fontSize: 12, color: C.bark, marginTop: 6, lineHeight: 17 },
  quote: { fontFamily: F.med, fontSize: 13, color: C.ink, marginTop: 8, lineHeight: 19, fontStyle: 'italic' },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 9 },
  tag: { borderRadius: 999, paddingVertical: 3, paddingHorizontal: 9, maxWidth: '100%' },
  tagTxt: { fontFamily: F.bold, fontSize: 11 },
  timePill: { borderRadius: 10, paddingVertical: 5, paddingHorizontal: 9 },
  timeTxt: { fontFamily: F.xbold, fontSize: 12.5 },
  chan: { fontFamily: F.bold, fontSize: 11.5, color: C.bark, backgroundColor: C.bone, borderRadius: 999, paddingVertical: 4, paddingHorizontal: 10, overflow: 'hidden' },
  count: { fontFamily: F.xbold, fontSize: 13, color: C.ink, backgroundColor: C.bone, borderRadius: 999, paddingVertical: 4, paddingHorizontal: 10, overflow: 'hidden' },
  countBad: { color: C.red, backgroundColor: C.redbg },
  due: { fontFamily: F.xbold, fontSize: 16, color: C.red },
  btnRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 7, marginTop: 11 },
  act: { paddingVertical: 7, paddingHorizontal: 13, borderRadius: 999, borderWidth: 1, borderColor: C.line, backgroundColor: '#fff' },
  actSm: { paddingVertical: 5, paddingHorizontal: 11 },
  actSolid: { backgroundColor: C.navy, borderColor: C.navy },
  actGreen: { backgroundColor: C.green, borderColor: C.green },
  actTxt: { fontFamily: F.semi, fontSize: 12.5, color: C.ink },
  moveLbl: { fontFamily: F.semi, fontSize: 11.5, color: C.muted, marginRight: 2 },
  check: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.6, borderColor: '#CFCBC1', alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
  checkRound: { borderRadius: 11 },
  checkOn: { backgroundColor: C.navy, borderColor: C.navy },
  checkMark: { color: '#fff', fontSize: 12, fontFamily: F.bold },
  bar: { height: 6, borderRadius: 3, backgroundColor: C.hair, marginTop: 10, overflow: 'hidden' },
  barFill: { height: 6, borderRadius: 3 },

  task: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: C.hair },
  taskName: { fontFamily: F.bold, fontSize: 14.5, color: C.ink, lineHeight: 20 },
  taskDone: { color: C.muted, textDecorationLine: 'line-through' },
  taskDesc: { fontFamily: F.med, fontSize: 12.5, color: C.bark, marginTop: 2, lineHeight: 18 },
  taskWhen: { fontFamily: F.semi, fontSize: 11.5, marginTop: 3 },

  sentBox: { marginHorizontal: 14, marginTop: 10, backgroundColor: C.amberbg, borderWidth: 1, borderColor: '#e9d2a3', borderRadius: 14, paddingVertical: 11, paddingHorizontal: 13 },
  sentHead: { fontFamily: F.bold, fontSize: 13, color: C.amber },
  sentBody: { fontFamily: F.med, fontSize: 12, color: C.bark, marginTop: 4, lineHeight: 17 },
  sentRow: { flexDirection: 'row', gap: 8, marginTop: 9 },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: 14, backgroundColor: C.card, borderTopWidth: 1, borderTopColor: C.line },
});
