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
    if (!skip.id && idx && idx.missing.length) f.push({ text: idx.have + '/' + idx.expected + ' IDs', tone: 'bad' });
    if (!skip.due && c.pending > 0) f.push({ text: inr(c.pending) + ' due', tone: 'bad' });
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
              right={x.card.inT ? <TimePill t={x.card.inT} kind="in" /> : undefined}
              flags={flagsOf(x.card)} actions={contact(x.card)}
              primary={idByRow[x.row] ? { label: 'Upload ID', onPress: () => s.setIdTarget(idByRow[x.row]) } : undefined}
              onPress={() => openBooking(x.row)} />
          )) : <Empty title="Nobody arriving today" sub="Arrivals for the next days are under Coming up." />)}

          {page === 'co' && (ci.checkoutsToday.length ? ci.checkoutsToday.map((x) => (
            <BRow key={'co' + x.row} c={x.card} pin={s.pin} docId={docFor(x.row)} focus="out"
              right={x.card.outT ? <TimePill t={x.card.outT} kind="out" /> : undefined}
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
                      right={x.card.inT ? <TimePill t={x.card.inT} kind="in" /> : undefined}
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
                right={<Text style={[st.count, urgent && st.countBad]}>{x.have}/{x.expected}</Text>}
                note={(x.ci ? (n! < 0 ? 'Checked in ' + relDay(x.ci) : n === 0 ? 'Arrives today' : n === 1 ? 'Arrives tomorrow' : 'Arrives ' + relDay(x.ci)) : 'No check-in date') + who}
                noteTone={urgent ? C.red : undefined}
                flags={flagsOf(x.card, { id: true })}
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
                right={<Text style={st.due}>{inr(p.pending)}</Text>}
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
                      <Text style={st.moveSub} numberOfLines={1}>{unitOf(x.card)}{x.card.channel ? ' · ' + x.card.channel : ''}{x.card.guests ? ' · ' + x.card.guests + ' guest' + (x.card.guests === 1 ? '' : 's') : ''}</Text>
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
                  <Text style={st.needSub} numberOfLines={1}>{unitOf(x.card)} · {x.card.nights === null ? 'stay' : x.card.nights === 0 ? 'day use' : x.card.nights + ' night' + (x.card.nights === 1 ? '' : 's')}{x.card.channel ? ' · ' + x.card.channel : ''}</Text>
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

/* ── the booking row, shared by every booking queue ──────────────────────
   Name and unit first (who, and which door), the stay on one line with the
   end this queue cares about in bold, the problems as tags, then the buttons
   that clear them. Nothing that is not known is printed. */
type Btnish = { label: string; onPress: () => void; solid?: boolean; quiet?: boolean };
function BRow({ c, pin, docId, focus, right, note, noteTone, flags, actions, primary, buttons, wait, select, onPress, onOpen }: {
  c: CardData; pin: string; docId?: number; focus: 'in' | 'out' | 'none';
  right?: React.ReactNode; note?: string; noteTone?: string; flags: Flag[];
  actions?: Btnish[]; primary?: Btnish; buttons?: Btnish[]; wait?: string;
  select?: boolean; onPress: () => void; onOpen?: () => void;
}) {
  const inS = c.inD ? relDay(c.inD) : '';
  const outS = c.outD ? relDay(c.outD) : '';
  const nights = c.nights !== null ? (c.nights === 0 ? 'day use' : c.nights + 'n') : '';
  const meta = [unitOf(c), c.channel, c.guests ? c.guests + ' guest' + (c.guests === 1 ? '' : 's') : ''].filter(Boolean).join(' · ');
  const btns: Btnish[] = [...(actions || []), ...(buttons || []), ...(primary ? [{ ...primary, solid: true }] : [])];
  return (
    <View style={[st.row, select && st.rowOn]}>
      <TouchableOpacity onPress={onPress} activeOpacity={0.75}>
        <View style={st.rowHead}>
          {select !== undefined ? (
            <View style={[st.check, select && st.checkOn]}>{select ? <Text style={st.checkMark}>✓</Text> : null}</View>
          ) : null}
          <Avatar name={c.guest || 'Guest'} pin={pin} docId={docId} />
          <View style={{ flex: 1 }}>
            <Text style={st.rowName} numberOfLines={1}>{c.guest || c.id || 'Guest'}</Text>
            <Text style={st.rowMeta} numberOfLines={1}>{meta}</Text>
          </View>
          {right}
        </View>
        {inS || outS ? (
          <Text style={st.stay} numberOfLines={1}>
            <Text style={focus === 'in' ? st.stayOn : undefined}>{inS || '—'}{c.inT ? ' ' + c.inT : ''}</Text>
            <Text style={st.stayArrow}>{'  →  '}</Text>
            <Text style={focus === 'out' ? st.stayOn : undefined}>{outS || '—'}{c.outT ? ' ' + c.outT : ''}</Text>
            {nights ? <Text style={st.stayN}>{'   ' + nights}</Text> : null}
          </Text>
        ) : null}
        {note ? <Text style={[st.note, noteTone ? { color: noteTone } : null]} numberOfLines={2}>{note}</Text> : null}
        {flags.length || wait ? (
          <View style={st.tags}>
            {wait ? <Tag text={'Waiting for approval · ' + wait} tone="info" /> : null}
            {flags.map((f, i) => <Tag key={i} {...f} />)}
          </View>
        ) : null}
      </TouchableOpacity>
      {btns.length || onOpen ? (
        <View style={st.btnRow}>
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

function Avatar({ name, pin, docId }: { name: string; pin: string; docId?: number }) {
  const [failed, setFailed] = useState(false);
  if (docId && !failed) {
    return <Image source={{ uri: api.attachmentUrl(pin, docId) }} style={st.avatar} onError={() => setFailed(true)} />;
  }
  return <View style={st.avatar}><Text style={st.avatarTxt}>{(name || '?').trim().slice(0, 1).toUpperCase()}</Text></View>;
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
