import React, { useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, Image, Linking, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { C, F, inr } from '../theme';
import { Tilt3D } from '../motion';
import { Panel, Btn, useToast } from '../ui';
import { Ticket, TicketKind, useStore } from '../store';
import { api } from '../api';
import {
  CardData, EnquiryItem, EnquiryStatus, LowItem, TaskItem, ciFmtDay,
  computeCheckins, computeEnquiries, computeIdsPending, computeLowStock, computePayouts, computeReviews,
  computeTasks, fmtEnquiryWhen, taskWhen,
} from '../logic';
import TaskForm from './TaskForm';

/* The Action tab — the app's default landing surface.
   Everything here is derived from the same computations the Dashboard uses
   (computeCheckins / computePayouts), never a second copy: the two surfaces
   deliberately overlap, so a duplicated calculation would let them drift.

   Two levels, not one. The overview is a grid of large cards — one per queue,
   each showing only its count and the single most urgent item — and tapping one
   opens that queue as its own page. Previously every section expanded inline on
   the same screen, so seven open accordions of dense rows competed for the same
   scroll; the count you wanted was somewhere below three other lists. Splitting
   it means the landing screen answers "what needs me?" at a glance and the
   detail page has the room to actually show a record. */

type SectionKey = 'ci' | 'co' | 'up' | 'rev' | 'ids' | 'pay' | 'low' | 'act' | 'enq';

type Accent = { line: string; bg: string; ink: string };
const ACCENT: Record<SectionKey, Accent> = {
  ci:  { line: C.green,  bg: C.greenbg, ink: C.green },
  co:  { line: C.sky,    bg: C.skybg,   ink: C.sky },
  up:  { line: C.blue,   bg: C.amberbg, ink: C.blue2 },
  rev: { line: C.copper, bg: C.amberbg, ink: C.blue2 },
  ids: { line: C.red,    bg: C.redbg,   ink: C.red },
  pay: { line: C.red,    bg: C.redbg,   ink: C.red },
  low: { line: C.amber,  bg: C.amberbg, ink: C.amber },
  act: { line: C.navy,   bg: C.bone,    ink: C.navy },
  enq: { line: C.blue,   bg: C.amberbg, ink: C.blue2 },
};
const TITLE: Record<SectionKey, string> = {
  ci: "Today's check-in",
  co: "Today's check-out",
  up: 'Upcoming bookings',
  rev: 'Review follow-ups',
  ids: 'IDs pending',
  pay: 'Pending amount',
  low: 'Low stock',
  /* Named for what it is — a list you keep by hand. It used to be 'Actions',
     which on a screen that now also carries a 'Waiting for approval' card read
     as "my requests" and said 0 beside a card saying 13. */
  act: 'To-do list',
  enq: 'Website enquiries',
};
/* Only the first N of a long queue render; the rest are counted, never dropped
   silently. Upcoming is the only list that regularly runs past this. */
const UPCOMING_CAP = 50;

export default function ActionScreen() {
  const s = useStore();
  const toast = useToast();
  const scroller = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const [page, setPage] = useState<SectionKey | null>(null);
  /* The app header shows on the overview only, not on these detail pages. */
  useEffect(() => { s.setActionDeep(!!page); }, [page]);
  /* null = closed. { task: null } = adding, { task } = editing that one. */
  const [form, setForm] = useState<{ task: TaskItem | null } | null>(null);
  const [selPay, setSelPay] = useState<Record<number, boolean>>({});
  /* For a Manager, marking a payout paid, moving a review on and ticking an
     action off are all REQUESTS now: the worker returns pendingApproval and the
     row does not move. A tap that changes nothing and says nothing is the
     "I pressed it and nothing happened" failure this loop has been closing
     everywhere else, so each of them now leaves two marks — a receipt at the
     top of the page that stays, and a band on every row that has a request
     against it. */
  const [sent, setSent] = useState<{ msg: string; ids: number[] } | null>(null);
  /* A receipt belongs to the queue it was raised from. */
  useEffect(() => { setSent(null); }, [page]);
  const reqFor = (kind: TicketKind, row: number | string): Ticket | null => {
    const t = s.ticketFor(kind, row);
    return t && t.status === 'pending' ? t : null;
  };
  /* One line, and it has to fit one line: the approver's name went in here
     first and was clipped to "Any …". Who is deciding is on the receipt above. */
  const waitBand = (t: Ticket, what: string) => ({
    label: 'WAITING FOR APPROVAL',
    text: `Request #${t.id} · ${what}`,
  });
  /* One place where a write either happened or became a request, so the three
     controls below cannot drift apart again. */
  const afterWrite = async (r: any, done: string) => {
    if (r?.pendingApproval) {
      const ids: number[] = r.tickets && r.tickets.length ? r.tickets : (r.ticket ? [r.ticket] : []);
      setSent({ msg: r.message || 'Sent for approval', ids });
      toast(r.message || 'Sent for approval', true);
      /* Nothing was written, so nothing needs re-reading but the requests. */
      await s.reloadTickets();
      return;
    }
    toast(r?.message || done, true);
    await s.reloadLogs();
  };
  /* This tab's own property scope — deliberately not the Report tab's, which is
     scoped to the Report. */
  const [prop, setProp] = useState('All');
  /* Seeing the queues is action.view (it gates the tab); ticking, paying out,
     chasing reviews and editing the to-do list is action.manage. */
  const manage = s.can('action.manage');

  // re-tapping the active tab scrolls back to the top (matches the other tabs)
  useEffect(() => { scroller.current?.scrollTo({ y: 0, animated: true }); }, [s.retapSig]);
  // a new page always starts at the top rather than inheriting the last scroll
  useEffect(() => { scroller.current?.scrollTo({ y: 0, animated: false }); }, [page]);

  /* Android's back gesture closes the detail page instead of the app — a page
     you can only leave by hunting for an on-screen arrow reads as a trap. */
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
  /* Actions are the one queue with no property of their own — they are typed in,
     not derived from a booking — so the property chips do not filter them. */
  const tasks = useMemo(() => computeTasks(s.logs?.tasks || null), [s.logs]);
  /* Leads from roam-in-heels.com. Property-scoped like the booking queues. */
  const enq = useMemo(() => computeEnquiries(s.logs?.enquiries, prop), [s.logs, prop]);

  const count: Record<SectionKey, number> = {
    ci: ci.today.length, co: ci.checkoutsToday.length, up: ci.upcoming.length,
    rev: rev.length, ids: ids.length, pay: pay.list.length, low: low.length,
    /* Only actions that have reached their end date count as needing attention;
       the tile is a door to the whole list either way. */
    act: tasks.due.length,
    /* Only leads nobody has replied to yet need attention. */
    enq: enq.fresh.length,
  };
  const total = (Object.keys(count) as SectionKey[]).reduce((t, k) => t + count[k], 0);

  /* A queue can empty while its page is open — marking the last payout paid,
     say. Dropping back to the overview beats an empty page with no explanation. */
  useEffect(() => {
    /* 'act' is exempt: its count is only what is *due*, and the page is the
       list of everything — ticking the last due action must not eject you. */
    if (page && page !== 'act' && page !== 'enq' && !count[page]) setPage(null);
  }, [page, count[page as SectionKey]]);

  /* One line of context per card, so the overview is scannable without opening
     anything: whichever item that queue would put first. */
  const preview: Record<SectionKey, string> = {
    ci: ci.today[0] ? nameOf(ci.today[0]) + (ci.today[0].inT ? ' · ' + ci.today[0].inT : '') : '',
    co: ci.checkoutsToday[0]
      ? nameOf(ci.checkoutsToday[0]) + (ci.checkoutsToday[0].outT ? ' · ' + ci.checkoutsToday[0].outT : '') : '',
    up: ci.upcoming[0] ? ciFmtDay(ci.upcoming[0].date) + ' · ' + nameOf(ci.upcoming[0]) : '',
    rev: rev[0] ? (rev[0].guest || rev[0].id) + ' · left ' + ciFmtDay(rev[0].out) : '',
    ids: ids.reduce((t, x) => t + (x.expected - x.have), 0) + ' document(s) missing',
    pay: inr(pay.total),
    act: tasks.due.length
      ? tasks.due[0].name
      : tasks.open.length
        ? 'Next: ' + tasks.open[0].name
        : (tasks.done.length ? 'All done · ' + tasks.done.length + ' completed' : 'Nothing on the list yet'),
    enq: enq.fresh[0]
      ? enq.fresh[0].name + (enq.fresh[0].property ? ' · ' + enq.fresh[0].property : '')
      : (enq.all.length ? 'All replied · ' + enq.all.length + ' total' : ''),
    low: low.filter((i) => i.outNow).length
      ? low.filter((i) => i.outNow).length + ' out of stock'
      : (low[0] ? low[0].item : ''),
  };

  /* ── pending payments: multi-select → mark paid ── */
  const selCount = Object.values(selPay).filter(Boolean).length;
  const selTotal = pay.list.reduce((t, p) => (selPay[p.row] ? t + p.pending : t), 0);
  const markPaid = async () => {
    const rows = pay.list.filter((p) => selPay[p.row]).map((p) => p.row);
    if (!rows.length) return;
    try {
      const r = await api.setPayouts(s.pin, rows);
      setSelPay({});
      await afterWrite(r, 'Marked paid');
    } catch (e: any) { toast(e?.message || 'Could not save', false); }
  };

  /* ── review follow-ups: advance the tracked state ── */
  const setReview = async (row: number, status: 'requested' | 'received' | 'skipped') => {
    try {
      const r = await api.setReviewStatus(s.pin, row, status);
      await afterWrite(r, status === 'received' ? 'Marked reviewed' : status === 'skipped' ? 'Skipped' : 'Marked requested');
    } catch (e: any) { toast(e?.message || 'Could not save', false); }
  };

  /* ── actions: tick / untick ── */
  const toggleTask = async (t: TaskItem) => {
    if (!manage) { toast('Your role can view actions but not change them', false); return; }
    try {
      /* The desired state is sent, not a toggle, so a double tap or a retry
         after a timeout lands on the same value instead of undoing itself. */
      const r = await api.setTaskDone(s.pin, t.row, !t.done);
      /* An instant tick needs no words — the box fills in. A request changes
         nothing on screen, so it has to say so. */
      if (r?.pendingApproval) await afterWrite(r, '');
      else await s.reloadLogs();
    } catch (e: any) { toast(e?.message || 'Could not save', false); }
  };

  /* ── website enquiries: move a lead along ── */
  const setEnquiry = async (e: EnquiryItem, status: EnquiryStatus) => {
    if (!manage) { toast('Your role can view enquiries but not change them', false); return; }
    try {
      const r = await api.setEnquiryStatus(s.pin, e.row, status);
      await afterWrite(r, 'Saved');
    } catch (err: any) { toast(err?.message || 'Could not save', false); }
  };

  /* Restock: open the Inventory movement form prefilled for this item. */
  const addStock = (i: LowItem) => {
    if (!s.can('inventory.add')) { toast('Your role cannot log stock', false); return; }
    s.setInvTarget(i.key);
    s.setAddSeg('inv');
    s.setTab('add');
  };

  /* The lead guest's ID document, if one has been uploaded — the card shows it
     as the avatar. Falls back to the co-guest's so a card is not blank when only
     the second document exists. */
  const docFor = (row: number) => {
    const docs = s.idDocs?.[String(row)] || [];
    /* The front of the lead guest's ID is the portrait side; a back is a
       document scan and makes a poor avatar, so it is the last resort. */
    const pick = docs.find((d) => d.slot === 'lead')
      || docs.find((d) => d.slot === 'co')
      || docs[0];
    /* PDFs are documents, not portraits — <Image> cannot render one, so the
       initial is shown instead. */
    return pick && !/pdf/i.test(pick.type || '') ? pick.id : undefined;
  };

  /* The booking page; editing is one tap from there. */
  const openBooking = (row: number) => s.openBooking(row);

  /* ── add / edit an action ── */
  if (form) {
    return (
      <TaskForm
        task={form.task}
        pin={s.pin}
        onClose={() => setForm(null)}
        onSaved={(r) => afterWrite(r, 'Saved')}
      />
    );
  }

  /* ── detail page ── */
  if (page) {
    return (
      <View style={{ flex: 1 }}>
        <PageHead
          title={TITLE[page]}
          /* The Actions page is about the whole open list, not just what is
             due — which is the number the tile shows. */
          n={page === 'act' ? tasks.open.length : page === 'enq' ? enq.all.length : count[page]}
          accent={ACCENT[page]}
          scope={prop === 'All' ? '' : prop}
          onBack={() => setPage(null)}
        />
        {/* The number the page is about, before any of the rows — sitting above
            the scroll so it stays put however far down the list you are. */}
        {page === 'pay' ? (
          <View style={st.totalBar}>
            <View style={{ flex: 1 }}>
              <Text style={st.totalLbl}>TOTAL AWAITING PAYOUT</Text>
              <Text style={st.totalVal}>{inr(pay.total)}</Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={st.totalSub}>
                across {pay.list.length} booking{pay.list.length === 1 ? '' : 's'}
              </Text>
              {selCount > 0 ? (
                <Text style={st.totalSel}>{selCount} ticked · {inr(selTotal)}</Text>
              ) : null}
            </View>
          </View>
        ) : null}
        {/* The receipt for what was just asked for. Outside the scroll, like
            the payout total above it, so it is still there after scrolling the
            list looking for the row that did not change. */}
        {sent ? (
          <View style={st.sentBox}>
            <Text style={st.sentHead}>{sent.msg}</Text>
            <Text style={st.sentBody}>
              Nothing below changes until an admin approves
              {sent.ids.length > 1 ? ' each request' : ' it'}. The rows stay as they are, marked “waiting”.
            </Text>
            <View style={st.sentRow}>
              {sent.ids.length ? (
                <Btn
                  title={sent.ids.length > 1 ? `View my ${sent.ids.length} requests` : `View request #${sent.ids[0]}`}
                  kind="mini" onPress={() => s.openMyRequests(sent.ids[0])}
                />
              ) : null}
              <Btn title="Dismiss" kind="mini" onPress={() => setSent(null)} />
            </View>
          </View>
        ) : null}
        <ScrollView
          ref={scroller}
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: 14, paddingBottom: page === 'pay' && selCount ? 96 : 36 }}
        >
          {page === 'ci' && ci.today.map((x) => (
            <BookingCard
              key={'ci' + x.row} c={x.card} pin={s.pin} docId={docFor(x.row)}
              emphasis="in"
              sub={'Arriving today' + (x.card.inT ? ' · ' + x.card.inT : '')}
              band={x.card.type === 'Resold' && x.card.referrer
                ? { label: 'RESOLD', text: x.card.referrer } : undefined}
              fields={moneyFields(x.card)}
              onOpen={() => openBooking(x.row)}
            />
          ))}
          {page === 'co' && ci.checkoutsToday.map((x) => (
            <BookingCard
              key={'co' + x.row} c={x.card} pin={s.pin} docId={docFor(x.row)}
              emphasis="out"
              sub={'Leaving today' + (x.card.outT ? ' · ' + x.card.outT : '')}
              band={x.card.type === 'Resold' && x.card.referrer
                ? { label: 'RESOLD', text: x.card.referrer } : undefined}
              fields={moneyFields(x.card)}
              onOpen={() => openBooking(x.row)}
            />
          ))}
          {page === 'up' && (
            <>
              {ci.upcoming.slice(0, UPCOMING_CAP).map((x) => (
                <BookingCard
                  key={'up' + x.row} c={x.card} pin={s.pin} docId={docFor(x.row)}
                  emphasis="in"
                  sub={'Arrives ' + ciFmtDay(x.date)}
                  band={x.card.type === 'Resold' && x.card.referrer
                    ? { label: 'RESOLD', text: x.card.referrer } : undefined}
                  fields={moneyFields(x.card)}
                  onOpen={() => openBooking(x.row)}
                />
              ))}
              {ci.upcoming.length > UPCOMING_CAP ? (
                <Text style={st.more}>+{ci.upcoming.length - UPCOMING_CAP} more upcoming not shown</Text>
              ) : null}
            </>
          )}
          {page === 'rev' && rev.map((x) => {
            const req = reqFor('review', x.row);
            return (
            <BookingCard
              key={'rv' + x.row} c={x.card} pin={s.pin} docId={docFor(x.row)}
              emphasis="out"
              sub={x.status === 'requested' ? 'Already asked — waiting' : 'Not asked yet'}
              band={req ? waitBand(req, 'review status') : undefined}
              /* The queue is about the review, so the fields are about the
                 review: money is a tap away on the booking. */
              fields={[
                { label: 'Left', value: ciFmtDay(x.out) },
                { label: 'Chase since', value: ciFmtDay(x.due) },
                { label: 'Status', value: x.status === 'requested' ? 'Asked' : 'Not asked',
                  tone: x.status === 'requested' ? C.blue2 : C.muted },
              ]}
              actions={!manage ? undefined :
                <View style={st.btnRow}>
                  {x.status === 'pending' ? (
                    <TouchableOpacity style={st.act} onPress={() => setReview(x.row, 'requested')} activeOpacity={0.7}>
                      <Text style={st.actTxt}>Asked</Text>
                    </TouchableOpacity>
                  ) : null}
                  <TouchableOpacity style={[st.act, st.actOk]} onPress={() => setReview(x.row, 'received')} activeOpacity={0.7}>
                    <Text style={[st.actTxt, { color: '#fff' }]}>Got it</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={st.act} onPress={() => setReview(x.row, 'skipped')} activeOpacity={0.7}>
                    <Text style={[st.actTxt, { color: C.muted }]}>Skip</Text>
                  </TouchableOpacity>
                </View>
              }
              onOpen={() => openBooking(x.row)}
            />
            );
          })}
          {page === 'ids' && ids.map((x) => (
            <BookingCard
              key={'id' + x.row} c={x.card} pin={s.pin} docId={docFor(x.row)}
              emphasis="in"
              sub={(x.guests ? x.guests + ' guest' + (x.guests === 1 ? '' : 's') + ' · ' : '') +
                   (x.ci ? 'checks in ' + ciFmtDay(x.ci) : 'no check-in date')}
              right={<Text style={[st.tag, x.have > 0 && st.tagPart]}>{x.have} of {x.expected}</Text>}
              /* Name the people, not the storage slots: "lead" is what the
                 database calls the row, not something anyone should read. */
              band={x.missing.length ? {
                label: 'ID NOT UPLOADED',
                text: x.missing
                  .map((sl) => sl === 'lead'
                    ? (x.guest ? x.guest + ' (lead guest)' : 'Lead guest')
                    : (x.coGuest ? x.coGuest + ' (co-guest)' : 'Co-guest — name not recorded'))
                  .join(' · '),
              } : undefined}
              fields={[
                { label: 'IDs on file', value: x.have + ' of ' + x.expected },
                { label: 'Lead guest', value: x.missing.indexOf('lead') < 0 ? 'On file' : 'Missing',
                  tone: x.missing.indexOf('lead') < 0 ? C.green : C.red },
                { label: 'Co-guest', value: !x.coGuest ? 'None' :
                    x.missing.indexOf('co') < 0 ? 'On file' : 'Missing',
                  tone: !x.coGuest ? C.muted : x.missing.indexOf('co') < 0 ? C.green : C.red },
              ]}
              onPress={() => s.setIdTarget(x)}
              hint="Tap to upload documents"
              onOpen={() => openBooking(x.row)}
            />
          ))}
          {page === 'pay' && pay.list.map((p) => {
            /* A payout with a request already against it: the row is still here
               because nothing has been settled, and this is why. */
            const req = reqFor('payout', p.row);
            return (
            <BookingCard
              key={'pay' + p.row} c={p.card} pin={s.pin} docId={docFor(p.row)}
              emphasis="none"
              sub={(p.card.type || 'Stay') + (p.date ? ' · booked ' + p.date : '')}
              band={req ? waitBand(req, 'marked paid') : undefined}
              selectable={manage && !req} selected={!!selPay[p.row]}
              /* Not just the tick box: the whole card stops being tickable once
                 a request is against it. Hiding the box while the body still
                 toggled left a row that showed no tick and was counted in
                 "1 ticked · ₹6,990" all the same. */
              onToggle={req ? undefined : () => setSelPay((m) => ({ ...m, [p.row]: !m[p.row] }))}
              fields={[
                { label: p.card.paid > 0 ? 'Total paid' : 'Total', value: p.card.paid > 0 ? inr(p.card.paid) : '' },
                { label: 'Net earning', value: inr(p.card.net), tone: C.green },
                { label: 'Awaiting', value: inr(p.pending), tone: C.red, big: true },
              ]}
              hint={!manage ? undefined
                : req ? 'Already asked for — waiting for approval'
                : selPay[p.row] ? 'Ticked — will be marked paid' : 'Tap the card to tick'}
              onOpen={() => openBooking(p.row)}
            />
            );
          })}
          {page === 'low' && low.map((i) => (
            <LowCard key={'low' + i.r} i={i} onAdd={() => addStock(i)} />
          ))}
          {page === 'enq' && (
            enq.all.length ? (
              (['new', 'contacted', 'booked', 'closed'] as const).map((k) => {
                const g = enq.all.filter((e) => e.status === k);
                if (!g.length) return null;
                return (
                  <View key={k}>
                    <Text style={st.groupHead}>{ENQ_LABEL[k].toUpperCase()} · {g.length}</Text>
                    {g.map((e) => (
                      <EnquiryCard key={'e' + e.row} e={e} manage={manage} onStatus={(x) => setEnquiry(e, x)} />
                    ))}
                  </View>
                );
              })
            ) : (
              <Panel style={{ alignItems: 'center', paddingVertical: 38 }}>
                <Text style={st.clearTitle}>No enquiries yet</Text>
                <Text style={st.clearSub}>Enquiries sent from roam-in-heels.com will appear here.</Text>
              </Panel>
            )
          )}
          {page === 'act' && (
            tasks.all.length ? (
              <>
                {(['overdue', 'today', 'upcoming'] as const).map((k) => {
                  const g = tasks.open.filter((t) => t.state === k);
                  if (!g.length) return null;
                  return (
                    <View key={k}>
                      <Text style={st.groupHead}>
                        {k === 'overdue' ? 'OVERDUE' : k === 'today' ? 'DUE TODAY' : 'UPCOMING'} · {g.length}
                      </Text>
                      {g.map((t) => (
                        <TaskCard key={'t' + t.row} t={t} req={reqFor('taskdone', t.row) || reqFor('task', t.row)}
                          onToggle={() => toggleTask(t)} onEdit={() => { if (manage) setForm({ task: t }); }} />
                      ))}
                    </View>
                  );
                })}
                {tasks.done.length ? (
                  <View>
                    <Text style={st.groupHead}>DONE · {tasks.done.length}</Text>
                    {tasks.done.map((t) => (
                      <TaskCard key={'t' + t.row} t={t} req={reqFor('taskdone', t.row) || reqFor('task', t.row)}
                        onToggle={() => toggleTask(t)} onEdit={() => { if (manage) setForm({ task: t }); }} />
                    ))}
                  </View>
                ) : null}
              </>
            ) : (
              <Panel style={{ alignItems: 'center', paddingVertical: 38 }}>
                <Text style={st.clearTitle}>No actions yet</Text>
                <Text style={st.clearSub}>
                  Anything that needs doing but is not a booking, an expense or a stock item.
                  Give it a name and an end date and it will show up here when it comes due.
                </Text>
                <View style={{ marginTop: 14 }}>
                  {manage ? <Btn title="+ Add an action" onPress={() => setForm({ task: null })} /> : null}
                </View>
              </Panel>
            )
          )}
        </ScrollView>
        {/* Same + as the overview, so a new action can be filed from the list
            you are already looking at. */}
        {page === 'act' && manage ? <Fab onPress={() => setForm({ task: null })} /> : null}
        {/* Kept out of the scroll so the action stays reachable however far down
            the list the last tick was. */}
        {page === 'pay' && manage && selCount > 0 ? (
          <View style={st.footer}>
            <Btn title={`Mark ${selCount} paid · ${inr(selTotal)}`} onPress={markPaid} />
          </View>
        ) : null}
      </View>
    );
  }

  /* ── overview ── */
  const keys: SectionKey[] = ['ci', 'co', 'up', 'rev', 'ids', 'pay', 'low'];
  /* Empty queues stay out of the way — except Actions, which is always shown:
     it is the only tile that is also the way *in* to a list you maintain by
     hand, and hiding it when nothing is due would hide the list itself. */
  const live: SectionKey[] = [
    ...keys.filter((k) => count[k] > 0),
    /* Shown once any enquiry exists, even when all are answered: the tile is
       also the way back to a lead you called last week. */
    ...(enq.all.length ? ['enq' as SectionKey] : []),
    'act',
  ];
  /* Change requests waiting for this user's approval — only for approvers,
     and only when there is something to decide. Not property-scoped: a
     request is about a record, and the decision is yours either way. */
  const waiting = s.can('tickets.approve')
    ? (s.tickets?.review || []).filter((t) => t.status === 'pending')
    : [];
  const aprSub = waiting.length
    ? `${waiting[0].label}${waiting[0].requester ? ' · from ' + waiting[0].requester : ''}`
    : '';
  /* This user's own live requests. Without this tile the home screen answered
     "nothing on the list" to someone who had just sent six things — the two
     places you look after submitting both said there was nothing. */
  const mine = s.myLive;
  const sentBack = mine.filter((t) => t.status === 'open').length;
  const mineSub = sentBack
    ? `${sentBack} sent back — needs your fix`
    : (mine[0] ? mine[0].label : '');

  return (
    <View style={{ flex: 1 }}>
    <ScrollView ref={scroller} style={{ flex: 1 }} contentContainerStyle={{ padding: 14, paddingBottom: 36 }}>
      {/* property scope for this tab only */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.propRow}>
        {['All', ...s.props.map((pp) => pp.name)].map((n) => {
          const on = n === prop;
          return (
            <TouchableOpacity
              key={n}
              style={[st.pChip, on && st.pChipOn]}
              onPress={() => setProp(n)}
              activeOpacity={0.7}
            >
              <Text style={[st.pTxt, on && st.pTxtOn]}>{n === 'All' ? 'All properties' : n}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {total + waiting.length + mine.length === 0 ? (
        <Panel style={{ alignItems: 'center', paddingVertical: 42, marginBottom: 12 }}>
          <Text style={st.clearMark}>✓</Text>
          <Text style={st.clearTitle}>All clear</Text>
          <Text style={st.clearSub}>
            No check-ins, departures, reviews, IDs, payments or stock need attention
            {prop !== 'All' ? ' for ' + prop : ''} right now.
          </Text>
        </Panel>
      ) : (
        <Text style={st.lede}>
          {total + waiting.length + mine.length} thing{total + waiting.length + mine.length === 1 ? '' : 's'} need attention
          {prop !== 'All' ? ' · ' + prop : ''}
        </Text>
      )}
      <View style={st.grid}>
        {waiting.length ? (
          <TileCard
            key="apr" k="apr" n={waiting.length}
            title={waiting.length === 1 ? 'Approval needed' : 'Approvals needed'}
            sub={aprSub}
            accent={{ line: C.blue2, bg: C.amberbg, ink: C.blue2 }}
            onPress={s.openApprovals}
          />
        ) : null}
        {mine.length ? (
          <TileCard
            key="mine" k="mine" n={mine.length}
            title="Waiting for approval"
            sub={mineSub}
            accent={{ line: C.amber, bg: C.amberbg, ink: C.amber }}
            onPress={() => s.openMyRequests()}
          />
        ) : null}
        {live.map((k) => (
          <TileCard
            key={k} k={k} n={count[k]} title={TITLE[k]} sub={preview[k]}
            onPress={() => setPage(k)}
          />
        ))}
      </View>
    </ScrollView>
    <Fab onPress={() => setForm({ task: null })} />
    </View>
  );
}

/* ── website enquiry ─────────────────────────────────────────────────────── */
const ENQ_LABEL: Record<EnquiryStatus, string> = { new: 'New', contacted: 'Contacted', booked: 'Booked', closed: 'Closed' };

/* A guest who asked, from the website. Call and WhatsApp are the first things
   you do with a lead, so they sit on the card rather than behind a tap; the
   status row below records how it went. */
function EnquiryCard({ e, manage, onStatus }: {
  e: EnquiryItem; manage: boolean; onStatus: (s: EnquiryStatus) => void;
}) {
  const digits = e.mobile.replace(/[^0-9+]/g, '');
  /* wa.me wants the number with country code and no '+'. A bare 10-digit
     Indian mobile gets 91 in front. */
  const wa = (() => {
    const d = digits.replace(/^\+/, '');
    return d.length === 10 ? '91' + d : d;
  })();
  const received = (() => {
    const d = new Date(e.received);
    return isNaN(d.getTime()) ? e.received : ciFmtDay(d) + ', ' +
      d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
  })();
  const stay = [e.checkIn && fmtEnquiryWhen(e.checkIn), e.checkOut && fmtEnquiryWhen(e.checkOut)].filter(Boolean).join('  →  ');
  return (
    <View style={st.card}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
        <View style={{ flex: 1 }}>
          <Text style={st.enqName} numberOfLines={1}>{e.name}</Text>
          <Text style={st.enqMeta} numberOfLines={1}>{[e.property, 'Received ' + received].filter(Boolean).join(' · ')}</Text>
        </View>
        <View style={[st.enqPill, e.status === 'new' && st.enqPillNew]}>
          <Text style={[st.enqPillTxt, e.status === 'new' && { color: '#fff' }]}>{ENQ_LABEL[e.status]}</Text>
        </View>
      </View>
      <Text style={st.enqStay}>{stay || 'Dates not given'}</Text>
      <View style={st.enqGrid}>
        <Field label="Guests" value={e.guests ? String(e.guests) : '—'} />
        <Field label="Mobile" value={e.mobile} lines={2} />
        {e.referral ? <Field label="Heard via" value={e.referral} lines={3} /> : null}
      </View>
      {e.message ? <Text style={st.enqMsg}>“{e.message}”</Text> : null}
      <View style={st.btnRow}>
        <TouchableOpacity style={st.act} onPress={() => Linking.openURL('tel:' + digits)} activeOpacity={0.7}>
          <Text style={st.actTxt}>Call</Text>
        </TouchableOpacity>
        <TouchableOpacity style={st.act} onPress={() => Linking.openURL('https://wa.me/' + wa)} activeOpacity={0.7}>
          <Text style={st.actTxt}>WhatsApp</Text>
        </TouchableOpacity>
      </View>
      {manage ? (
        <View style={st.btnRow}>
          {(['contacted', 'booked', 'closed'] as const).filter((k) => k !== e.status).map((k) => (
            <TouchableOpacity key={k} style={[st.act, k === 'booked' && st.actOk]} onPress={() => onStatus(k)} activeOpacity={0.7}>
              <Text style={[st.actTxt, k === 'booked' && { color: '#fff' }, k === 'closed' && { color: C.muted }]}>
                {k === 'contacted' ? 'Contacted' : k === 'booked' ? 'Booked' : 'Close'}
              </Text>
            </TouchableOpacity>
          ))}
          {e.status !== 'new' ? (
            <TouchableOpacity style={st.act} onPress={() => onStatus('new')} activeOpacity={0.7}>
              <Text style={[st.actTxt, { color: C.muted }]}>Reopen</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

/* The + that files a new action. Sits above the tab bar rather than in the
   scroll, so it is reachable from anywhere in a long list of queues. */
function Fab({ onPress }: { onPress: () => void }) {
  return (
    <TouchableOpacity
      style={st.fab} onPress={onPress} activeOpacity={0.85}
      accessibilityRole="button" accessibilityLabel="Add an action"
    >
      <Text style={st.fabTxt}>+</Text>
    </TouchableOpacity>
  );
}

/* One action. The tick is its own hit area, deliberately: the rest of the card
   opens the editor, and a checkbox that also navigates is a checkbox nobody
   trusts. */
function TaskCard({ t, req, onToggle, onEdit }: {
  t: TaskItem; onToggle: () => void; onEdit: () => void;
  /* A request waiting on this action. The tick box cannot move until it is
     approved, so the card says which request is holding it. */
  req?: Ticket | null;
}) {
  const tone = t.done ? C.muted : t.state === 'overdue' ? C.red : t.state === 'today' ? C.blue2 : C.bark;
  return (
    <View style={[st.card, t.done && st.cardDone]}>
      <View style={st.cardHead}>
        <TouchableOpacity onPress={onToggle} activeOpacity={0.7} hitSlop={12}>
          <View style={[st.check, t.done && st.checkOn]}>
            {t.done ? <Text style={st.checkMark}>✓</Text> : null}
          </View>
        </TouchableOpacity>
        <TouchableOpacity style={{ flex: 1 }} onPress={onEdit} activeOpacity={0.75}>
          <Text style={[st.taskName, t.done && st.taskNameDone]} numberOfLines={3}>{t.name}</Text>
          <Text style={[st.cardSub, { color: tone }]} numberOfLines={1}>
            {taskWhen(t)}{!t.done && t.endIso ? ' · ' + t.endIso : ''}
          </Text>
        </TouchableOpacity>
      </View>
      {t.desc ? (
        <TouchableOpacity onPress={onEdit} activeOpacity={0.75}>
          <Text style={st.taskDesc}>{t.desc}</Text>
        </TouchableOpacity>
      ) : null}
      {req ? (
        <View style={st.band}>
          <Text style={st.bandLbl}>WAITING FOR APPROVAL</Text>
          <Text style={st.bandTxt} numberOfLines={1}>#{req.id} · {req.approver || 'an admin'}</Text>
        </View>
      ) : null}
      <View style={st.cardFoot}>
        <Text style={st.tapHint}>
          {req ? 'Asked for — waiting' : t.done ? 'Tick to reopen' : 'Tick when done'}
        </Text>
        <View style={{ flex: 1 }} />
        <TouchableOpacity onPress={onEdit} activeOpacity={0.6} hitSlop={8}>
          <Text style={st.link}>{t.desc ? 'Edit' : 'Add a description'} ›</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const nameOf = (x: { guest: string; id: string }) => x.guest || x.id;

/* ── overview tile ── */
function TileCard({ k, n, title, sub, onPress, accent }: {
  k: SectionKey | 'apr' | 'mine'; n: number; title: string; sub: string; onPress: () => void; accent?: Accent;
}) {
  const a = accent || ACCENT[k as SectionKey];
  /* Solid white card: the tinted-glass version disappeared into the warm
     backdrop. Colour lives on the count badge only. */
  return (
    <Tilt3D style={st.tile} onPress={onPress} max={7}>
      <View style={st.tileTop}>
        <View style={[st.tileBadge, { backgroundColor: a.bg, borderColor: a.line }]}>
          <Text style={[st.tileN, { color: a.ink }]} numberOfLines={1} adjustsFontSizeToFit>{n}</Text>
        </View>
        <Text style={[st.tileChev, { color: a.ink }]}>›</Text>
      </View>
      <Text style={st.tileTitle} numberOfLines={2}>{title}</Text>
      {sub ? <Text style={st.tileSub} numberOfLines={2}>{sub}</Text> : null}
    </Tilt3D>
  );
}

/* ── detail page header ── */
function PageHead({ title, n, accent, scope, onBack }: {
  title: string; n: number; accent: Accent; scope?: string; onBack: () => void;
}) {
  return (
    <View style={st.head}>
      <TouchableOpacity onPress={onBack} style={st.back} activeOpacity={0.6} hitSlop={10}>
        <Text style={st.backTxt}>‹</Text>
      </TouchableOpacity>
      <View style={{ flex: 1 }}>
        <Text style={st.headTitle} numberOfLines={1}>{title}</Text>
        <Text style={[st.headSub, { color: accent.ink }]}>
          {n} item{n === 1 ? '' : 's'}{scope ? ' · ' + scope : ''}
        </Text>
      </View>
    </View>
  );
}

/* ── detail cards ── */
function DCard({ onPress, children }: { onPress?: () => void; children: React.ReactNode }) {
  if (!onPress) return <View style={st.card}>{children}</View>;
  return (
    <TouchableOpacity style={st.card} onPress={onPress} activeOpacity={0.75}>{children}</TouchableOpacity>
  );
}

function Field({ label, value, tone, lines = 1 }: { label: string; value: string; tone?: string; lines?: number }) {
  return (
    <View style={st.field}>
      <Text style={st.fieldLbl}>{label}</Text>
      <Text style={[st.fieldVal, tone ? { color: tone } : null]} numberOfLines={lines}>{value || '—'}</Text>
    </View>
  );
}

/* ── the booking card ────────────────────────────────────────────────────────
   One card, five queues. Every Action list is looking at the same thing — a
   booking — so the skeleton never changes: avatar and name, the two pills that
   say which flat, the source chip, the stay strip, then three fields and a
   footer. What changes per queue is only which end of the stay is emphasised,
   which three fields are worth the space, and what you can do from it.

   Keeping them literally the same component is the point. When each queue had
   its own card they drifted — one showed the unit, another the booking id, a
   third neither — and the same booking looked like a different record depending
   on which list you reached it from. */

type CardField = { label: string; value: string; tone?: string; big?: boolean };

function BookingCard({
  c, pin, docId, emphasis, sub, fields, band, right, actions, hint,
  selectable, selected, onToggle, onPress, onOpen, openLabel,
}: {
  c: CardData;
  pin: string;
  docId?: number;
  emphasis: 'in' | 'out' | 'none';   // which end of the stay leads
  sub?: string;                       // line under the guest name
  fields: CardField[];                // exactly what this queue needs
  band?: { label: string; text: string };
  right?: React.ReactNode;
  actions?: React.ReactNode;
  hint?: string;
  selectable?: boolean;
  selected?: boolean;
  onToggle?: () => void;
  onPress?: () => void;               // tapping the body
  onOpen?: () => void;                // the footer link
  openLabel?: string;
}) {
  const body = (
    <>
      <View style={st.cardHead}>
        {selectable ? (
          <View style={[st.check, selected && st.checkOn]}>
            {selected ? <Text style={st.checkMark}>✓</Text> : null}
          </View>
        ) : null}
        <GuestAvatar name={c.guest || 'Guest'} pin={pin} docId={docId} />
        <View style={{ flex: 1 }}>
          <Text style={st.cardTitle} numberOfLines={1}>{c.guest || 'Guest'}</Text>
          <Text style={st.cardSub} numberOfLines={1}>
            {sub || (c.type || 'Stay') + (c.guests ? ' · ' + c.guests + ' guests' : '')}
          </Text>
        </View>
        {right}
      </View>

      {/* Booked under vs slept in: guests are regularly moved between flats, and
          both answers matter — one is what they were sold, the other is where to
          go knocking. */}
      <View style={st.pills}>
        <View style={st.pillA}>
          <Text style={st.pillLbl}>BOOKING</Text>
          <Text style={st.pillTxt} numberOfLines={1}>{c.prop || '—'}</Text>
        </View>
        <View style={st.pillB}>
          <Text style={st.pillLblB}>STAY UNIT</Text>
          <Text style={st.pillTxtB} numberOfLines={1}>{c.unit || '—'}</Text>
        </View>
        {c.channel ? (
          <View style={st.srcChipSm}><Text style={st.srcTxtSm}>{c.channel}</Text></View>
        ) : null}
      </View>

      {band ? (
        <View style={st.band}>
          <Text style={st.bandLbl}>{band.label}</Text>
          <Text style={st.bandTxt} numberOfLines={1}>{band.text}</Text>
        </View>
      ) : null}

      <View style={st.stayBox}>
        <View style={st.stayHalf}>
          <Text style={[st.stayLbl, emphasis === 'in' && st.stayLblOn]}>CHECK-IN</Text>
          <Text style={[st.stayDate, emphasis === 'in' && st.stayDateOn]}>
            {c.inD ? ciFmtDay(c.inD) : '—'}
          </Text>
          <Text style={st.stayTime}>{c.inT || 'time not recorded'}</Text>
        </View>
        <View style={st.stayArrow}>
          <Text style={st.stayArrowTxt}>{c.nights !== null ? c.nights + 'n' : '→'}</Text>
        </View>
        <View style={st.stayHalf}>
          <Text style={[st.stayLbl, emphasis === 'out' && st.stayLblOn]}>CHECK-OUT</Text>
          <Text style={[st.stayDate, emphasis === 'out' && st.stayDateOn]}>
            {c.outD ? ciFmtDay(c.outD) : '—'}
          </Text>
          <Text style={st.stayTime}>{c.outT || 'time not recorded'}</Text>
        </View>
      </View>

      <View style={st.fields}>
        {fields.map((f, i) => (
          <View key={i} style={st.field}>
            <Text style={st.fieldLbl}>{f.label}</Text>
            <Text
              style={[f.big ? st.fieldBig : st.fieldVal, f.tone ? { color: f.tone } : null]}
              numberOfLines={1}
            >
              {f.value || '—'}
            </Text>
          </View>
        ))}
      </View>
    </>
  );

  const tap = onToggle || onPress;
  return (
    <View style={[st.card, selected && st.cardOn]}>
      {tap ? (
        <TouchableOpacity activeOpacity={0.75} onPress={tap}>{body}</TouchableOpacity>
      ) : body}

      {actions}

      {hint || onOpen ? (
        <View style={st.cardFoot}>
          {hint ? <Text style={st.tapHint}>{hint}</Text> : null}
          <View style={{ flex: 1 }} />
          {onOpen ? (
            <TouchableOpacity onPress={onOpen} activeOpacity={0.6} hitSlop={8}>
              <Text style={st.link}>{openLabel || 'Open booking'} ›</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

/* Guest photo from the uploaded ID document, falling back to the initial.
   The image is streamed through the Worker behind the PIN — an identity
   document never sits on a public URL — and a failed load silently returns to
   the initial rather than leaving a broken frame on the card. */
function GuestAvatar({ name, pin, docId }: { name: string; pin: string; docId?: number }) {
  const [failed, setFailed] = useState(false);
  const initial = (name || '?').trim().slice(0, 1).toUpperCase();
  if (docId && !failed) {
    return (
      <Image
        source={{ uri: api.attachmentUrl(pin, docId) }}
        style={st.avatarImg}
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <View style={st.avatar}><Text style={st.avatarTxt}>{initial}</Text></View>
  );
}

/* Money is what a stay card leads with once the dates are shown, except where
   the queue exists for another reason entirely. */
function moneyFields(c: CardData): CardField[] {
  const totalIsPaid = c.paid > 0;
  return [
    { label: totalIsPaid ? 'Total paid' : 'List price', value: totalIsPaid ? inr(c.paid) : (c.listPrice ? inr(c.listPrice) : '') },
    { label: 'Net earning', value: inr(c.net), tone: C.green },
    { label: 'Due', value: c.pending > 0 ? inr(c.pending) : '—', tone: c.pending > 0 ? C.red : C.muted },
  ];
}

function LowCard({ i, onAdd }: { i: LowItem; onAdd: () => void }) {
  /* Says plainly when it cannot project. All movement history is currently
     "Opening Balance", so until consumption is logged there is no burn rate to
     compute and a date here would be invented. */
  const when = i.outNow
    ? 'Out of stock'
    : i.runOut
      ? (i.estimated ? '~' : '') + 'Runs out ' + ciFmtDay(i.runOut) +
        (i.daysLeft !== null ? ' · ' + i.daysLeft + 'd' : '')
      : 'No booking data to project from';
  return (
    <View style={st.card}>
      <View style={st.cardHead}>
        <Text style={st.cardTitle} numberOfLines={1}>{i.item}</Text>
        <Text style={[st.tag, i.inStock > 0 && st.tagPart]}>
          {i.inStock}{i.required ? ' / ' + i.required : ' left'}
        </Text>
      </View>
      <Text style={st.cardSub} numberOfLines={1}>
        {i.id}{i.property ? ' · ' + i.property : ''}
      </Text>
      <View style={st.fields}>
        <Field label="In stock" value={String(i.inStock)} tone={i.outNow ? C.red : C.ink} />
        <Field label="Reorder at" value={i.reorder !== '' ? String(i.reorder) : ''} />
        <Field label="Outlook" value={when} tone={i.outNow ? C.red : C.ink} />
      </View>
      {/* The basis is always shown, so an estimate is never mistaken for a
          measurement. Switches to "measured" once consumption is logged. */}
      <Text style={st.note}>{i.rateNote}{i.estimated ? ' · estimated' : ''}</Text>
      <View style={st.btnRow}>
        <TouchableOpacity style={[st.act, st.actAdd]} onPress={onAdd} activeOpacity={0.7}>
          <Text style={[st.actTxt, { color: '#fff' }]}>+ Add stock</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  lede: { fontFamily: F.semi, fontSize: 12.5, color: C.muted, marginBottom: 12, marginLeft: 2 },
  propRow: { gap: 8, alignItems: 'center', paddingBottom: 12, paddingRight: 4 },
  pChip: {
    paddingVertical: 6, paddingHorizontal: 13, borderRadius: 999,
    borderWidth: 1, borderColor: C.line, backgroundColor: C.card,
  },
  pChipOn: { backgroundColor: C.amberbg, borderColor: C.copper },
  pTxt: { fontFamily: F.semi, fontSize: 12, color: C.bark },
  pTxtOn: { color: C.blue2, fontFamily: F.bold },

  /* overview grid — two tiles per row, big enough to read at arm's length */
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  tile: {
    flexGrow: 1, flexBasis: '46%', minHeight: 132,
    borderRadius: 22, padding: 16,
    backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: 'rgba(90,58,20,0.12)',
    shadowColor: '#5A3A14', shadowOpacity: 0.07, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 2,
  },
  tileTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  tileBadge: {
    minWidth: 48, height: 48, paddingHorizontal: 10, borderRadius: 16, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center',
  },
  tileN: { fontFamily: F.xbold, fontSize: 24, lineHeight: 28 },
  tileTitle: { fontFamily: F.bold, fontSize: 15, color: C.ink, marginTop: 12 },
  tileSub: { fontFamily: F.med, fontSize: 12, color: C.bark, marginTop: 4, lineHeight: 17 },
  tileChev: { fontSize: 22, fontFamily: F.bold, opacity: 0.5 },

  /* detail page */
  head: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 12, paddingTop: 10, paddingBottom: 12,
    backgroundColor: C.card, borderBottomWidth: 1, borderBottomColor: C.line,
  },
  back: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
  backTxt: { fontSize: 30, lineHeight: 32, color: C.ink, fontFamily: F.med },
  headTitle: { fontFamily: F.xbold, fontSize: 17, color: C.ink },
  headSub: { fontFamily: F.semi, fontSize: 12, marginTop: 1 },

  card: {
    backgroundColor: C.card, borderRadius: 18, borderWidth: 1, borderColor: C.line,
    padding: 17, marginBottom: 13,
  },
  cardOn: { borderColor: C.navy },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  cardTitle: { fontFamily: F.bold, fontSize: 18, color: C.ink, flex: 1 },
  cardSub: { fontFamily: F.med, fontSize: 13, color: C.muted, marginTop: 3 },

  avatar: {
    width: 48, height: 48, borderRadius: 24, backgroundColor: C.bone,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarTxt: { fontFamily: F.xbold, fontSize: 19, color: C.bark },
  avatarImg: { width: 48, height: 48, borderRadius: 24, backgroundColor: C.bone },

  /* The unit is what you need at the door, so it is the loudest thing after the
     name — it replaces the booking id that used to sit here. */
  unitPill: {
    alignItems: 'center', backgroundColor: C.navy,
    paddingVertical: 5, paddingHorizontal: 12, borderRadius: 12,
  },
  unitLbl: { fontFamily: F.semi, fontSize: 8.5, color: C.copper, letterSpacing: 1 },
  unitTxt: { fontFamily: F.xbold, fontSize: 15, color: '#fff', marginTop: 1 },

  resold: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 11,
    backgroundColor: C.amberbg, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 11,
  },
  resoldLbl: {
    fontFamily: F.xbold, fontSize: 9.5, color: C.blue2, letterSpacing: 0.8,
  },
  resoldTxt: { fontFamily: F.bold, fontSize: 13.5, color: C.ink, flex: 1 },
  cardHint: { fontFamily: F.semi, fontSize: 11.5, color: C.blue2, marginTop: 10 },
  cardFoot: { flexDirection: 'row', alignItems: 'center', marginTop: 12 },
  link: { fontFamily: F.semi, fontSize: 12, color: C.blue2 },
  note: { fontFamily: F.med, fontSize: 11.5, color: C.bark, marginTop: 10, lineHeight: 16 },

  fields: {
    flexDirection: 'row', gap: 10, marginTop: 13,
    borderTopWidth: 1, borderTopColor: C.hair, paddingTop: 12,
  },
  field: { flex: 1 },
  fieldLbl: { fontFamily: F.med, fontSize: 10.5, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.4 },
  fieldVal: { fontFamily: F.bold, fontSize: 15, color: C.ink, marginTop: 4 },
  fieldBig: { fontFamily: F.xbold, fontSize: 18, color: C.ink, marginTop: 2 },

  /* The receipt for a request just raised from this queue. Amber and the same
     words as the panel on the forms, because it is the same situation. */
  sentBox: {
    marginHorizontal: 14, marginBottom: 4, backgroundColor: C.amberbg, borderWidth: 1, borderColor: '#e9d2a3',
    borderRadius: 14, paddingVertical: 11, paddingHorizontal: 13,
  },
  sentHead: { fontFamily: F.bold, fontSize: 13, color: C.amber },
  sentBody: { fontFamily: F.med, fontSize: 12, color: C.bark, marginTop: 5, lineHeight: 17 },
  sentRow: { flexDirection: 'row', gap: 8, marginTop: 10 },

  /* A one-line aside for whatever this queue needs said in words: who a resale
     went to, which documents are missing. */
  band: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 11,
    backgroundColor: C.amberbg, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 11,
  },
  bandLbl: { fontFamily: F.xbold, fontSize: 9.5, color: C.blue2, letterSpacing: 0.8 },
  bandTxt: { fontFamily: F.bold, fontSize: 13, color: C.ink, flex: 1 },

  chip: {
    fontFamily: F.semi, fontSize: 11, color: C.bark,
    backgroundColor: C.bone, paddingVertical: 3, paddingHorizontal: 9, borderRadius: 999,
  },
  tag: {
    fontFamily: F.bold, fontSize: 12, color: C.red,
    backgroundColor: C.redbg, paddingVertical: 5, paddingHorizontal: 10, borderRadius: 999,
  },
  tagPart: { color: C.navy, backgroundColor: C.bg },
  amt: { fontFamily: F.xbold, fontSize: 17, color: C.red },

  /* booking source — the platform the review has to be asked on */
  srcChip: {
    backgroundColor: C.navy, borderRadius: 999, paddingVertical: 6, paddingHorizontal: 13,
  },
  srcTxt: { fontFamily: F.xbold, fontSize: 12.5, color: '#fff' },

  pills: { flexDirection: 'row', gap: 9, marginTop: 14 },
  pillA: {
    flex: 1, backgroundColor: C.bone, borderRadius: 12, paddingVertical: 9, paddingHorizontal: 12,
  },
  pillB: {
    flex: 1, backgroundColor: C.amberbg, borderRadius: 12, paddingVertical: 9, paddingHorizontal: 12,
    borderWidth: 1, borderColor: C.copper,
  },
  pillLbl: { fontFamily: F.semi, fontSize: 9, color: C.muted, letterSpacing: 0.9 },
  pillLblB: { fontFamily: F.semi, fontSize: 9, color: C.blue2, letterSpacing: 0.9 },
  pillTxt: { fontFamily: F.bold, fontSize: 14.5, color: C.ink, marginTop: 3 },
  pillTxtB: { fontFamily: F.xbold, fontSize: 15.5, color: C.blue2, marginTop: 3 },

  stayBox: {
    flexDirection: 'row', alignItems: 'center', marginTop: 11,
    backgroundColor: C.warm, borderRadius: 12, paddingVertical: 11, paddingHorizontal: 12,
  },
  stayHalf: { flex: 1 },
  stayLbl: { fontFamily: F.semi, fontSize: 9, color: C.muted, letterSpacing: 0.9 },
  /* The end of the stay this queue is about is the one that gets the colour. */
  stayLblOn: { color: C.blue2 },
  stayDate: { fontFamily: F.xbold, fontSize: 15, color: C.ink, marginTop: 3 },
  stayDateOn: { color: C.blue2 },
  stayTime: { fontFamily: F.med, fontSize: 11.5, color: C.bark, marginTop: 1 },
  stayArrow: { paddingHorizontal: 10 },
  stayArrowTxt: { fontFamily: F.bold, fontSize: 15, color: C.muted },

  srcChipSm: {
    justifyContent: 'center', backgroundColor: C.navy, borderRadius: 12,
    paddingVertical: 9, paddingHorizontal: 12,
  },
  srcTxtSm: { fontFamily: F.bold, fontSize: 11.5, color: '#fff' },
  dueVal: { fontFamily: F.xbold, fontSize: 18, color: C.red, marginTop: 2 },
  tapHint: { fontFamily: F.med, fontSize: 11, color: C.muted },
  check: {
    width: 24, height: 24, borderRadius: 6, borderWidth: 1.6, borderColor: C.line,
    alignItems: 'center', justifyContent: 'center',
  },
  checkOn: { backgroundColor: C.navy, borderColor: C.navy },
  checkMark: { color: '#fff', fontSize: 14, fontFamily: F.bold },

  btnRow: { flexDirection: 'row', gap: 8, marginTop: 13 },
  act: {
    paddingVertical: 9, paddingHorizontal: 14, borderRadius: 999,
    borderWidth: 1, borderColor: C.line, backgroundColor: '#fff',
  },
  actOk: { backgroundColor: C.green, borderColor: C.green },
  actAdd: { backgroundColor: C.navy, borderColor: C.navy },
  actTxt: { fontFamily: F.semi, fontSize: 12.5, color: C.ink },

  totalBar: {
    flexDirection: 'row', alignItems: 'flex-end',
    backgroundColor: C.redbg, paddingHorizontal: 16, paddingVertical: 13,
    borderBottomWidth: 1, borderBottomColor: C.line,
  },
  totalLbl: { fontFamily: F.semi, fontSize: 9.5, color: C.red, letterSpacing: 0.9 },
  totalVal: { fontFamily: F.xbold, fontSize: 26, color: C.red, marginTop: 3 },
  totalSub: { fontFamily: F.med, fontSize: 11.5, color: C.bark },
  totalSel: { fontFamily: F.bold, fontSize: 11.5, color: C.navy, marginTop: 3 },

  footer: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    padding: 14, backgroundColor: C.card, borderTopWidth: 1, borderTopColor: C.line,
  },

  /* actions */
  fab: {
    position: 'absolute', right: 18, bottom: 20,
    width: 56, height: 56, borderRadius: 28, backgroundColor: C.navy,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOpacity: 0.22, shadowRadius: 10, shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  fabTxt: { color: '#fff', fontSize: 30, lineHeight: 34, fontFamily: F.med },
  enqName: { fontFamily: F.bold, fontSize: 16, color: C.ink },
  enqMeta: { fontFamily: F.med, fontSize: 12, color: C.muted, marginTop: 2 },
  enqPill: {
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999,
    backgroundColor: C.bone, borderWidth: 1, borderColor: C.line,
  },
  enqPillNew: { backgroundColor: C.blue, borderColor: C.blue },
  enqPillTxt: { fontFamily: F.bold, fontSize: 11, color: C.ink },
  enqStay: { fontFamily: F.bold, fontSize: 14, color: C.navy, marginTop: 12 },
  enqGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 12 },
  enqMsg: { fontFamily: F.med, fontSize: 13, color: C.ink, lineHeight: 19, marginTop: 10, fontStyle: 'italic' },
  groupHead: {
    fontFamily: F.xbold, fontSize: 10.5, color: C.muted, letterSpacing: 1,
    marginBottom: 9, marginLeft: 2,
  },
  cardDone: { backgroundColor: C.warm2, borderColor: C.hair },
  taskName: { fontFamily: F.bold, fontSize: 16.5, color: C.ink, lineHeight: 22 },
  taskNameDone: { color: C.muted, textDecorationLine: 'line-through' },
  taskDesc: {
    fontFamily: F.med, fontSize: 13, color: C.bark, lineHeight: 19, marginTop: 11,
    borderTopWidth: 1, borderTopColor: C.hair, paddingTop: 11,
  },

  more: { fontFamily: F.med, fontSize: 11.5, color: C.muted, paddingTop: 4, textAlign: 'center' },
  clearMark: { fontSize: 34, color: C.green, fontFamily: F.bold },
  clearTitle: { fontFamily: F.xbold, fontSize: 17, color: C.ink, marginTop: 6 },
  clearSub: {
    fontFamily: F.med, fontSize: 12.5, color: C.muted,
    textAlign: 'center', marginTop: 6, lineHeight: 18, paddingHorizontal: 16,
  },
});
