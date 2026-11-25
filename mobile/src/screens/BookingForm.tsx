import React, { useEffect, useRef, useState } from 'react';
import { Image, LayoutChangeEvent, Linking, ScrollView, StyleSheet, Text, View } from 'react-native';
import { C, F, inr } from '../theme';
import { useStore } from '../store';
import { confirmDestructive, useToast } from '../ui';
import { Field, TxtInput, SelectField, DateField, TimeField } from '../fields';
import { api } from '../api';
import IdUploader, { StagedFile } from './IdUploader';
import { ExtraGuest, Host, HostUnit, HostsData, OTA_CHANNELS, frontOf, guestLabel, IdSlot, dealOf, defaultCollector, hostById, unitById, frontForGuest, ownedPropertyName, parseExtraGuests, splitPreview, todayIso, unitNumberOf } from '../logic';
import { BookingChecklist, ExtraStep, NewBookingSteps } from '../checklist';
import { isMoneyText, moneyNum, moneyRule } from '../money';
import { GuestNameInput, KnownGuest, useGuestDirectory } from '../guests';
import { TouchableOpacity } from 'react-native';
import { FormCard, FormFooter, FormHeader, FormScroll } from '../formkit';
import { ChoiceChips, PropertyPicker, unitNo } from '../propertyPicker';
import TicketBanner, { NoAdd, writeLabels } from './TicketBanner';

/* 'Offline' became 'From host' (24-Nov-2026) and 'Pass' left the list — a Pass
   booking still stores channel 'Pass', set by its type. Older values show as an
   extra chip when editing, so a save never rewrites them silently. */
const MON3 = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtKey = (k: string) => (k ? Number(k.slice(8, 10)) + ' ' + MON3[Number(k.slice(5, 7)) - 1] : '');
const CHANNELS = ['Airbnb', 'Booking.com', 'MMT', 'Agoda', 'From host', 'Direct/Referral'];

/* Field names as the person reads them, for "Still needed: …". */
const LABEL: Record<string, string> = { property: 'Property', date: 'Booking date', net: 'Net earned', referrer: 'Passed to' };

const EMPTY = {
  property: '', date: '', guest: '', leadBirthYr: '', type: 'Stay', channel: 'Airbnb',
  referrer: '', listPrice: '', discount: '', guestPaid: '', net: '', commission: '',
  guests: '', phone: '', coGuest: '', coGuestBirthYr: '', notes: '',
  checkinDate: '', checkoutDate: '', checkinTime: '', checkoutTime: '',
  stayUnit: '', pending: '', repeat: '',
};

/* The form is grouped into cards rather than one 24-field column: what the
   booking IS, when the stay runs, who is staying, their documents, the money.
   Related fields share a line where they are naturally a pair. */
function Two({ children }: { children: React.ReactNode }) {
  return <View style={st.two}>{children}</View>;
}

/* ── Cross-unit split preview ────────────────────────────────────────────────
   A booking taken on one of our flats but housed in the other earns the flat
   that took it a flat ₹500 and credits the rest to the flat the guest actually
   gets. That is invisible in the form's own figures — Net earned says 9,294 and
   always will — so this says, live, where the 9,294 is going to land, and the
   same for a pending amount.

   Read-only by design: nothing to fill in, nothing that can fail validation,
   and it disappears the moment the two units stop differing. The ₹500 is a CAP,
   so on a booking worth less than it the receiving flat simply keeps the whole
   net and the other gets ₹0 — never a negative share. */
function SplitNote({ split, pend, prop }: {
  split: ReturnType<typeof splitPreview>;
  pend: ReturnType<typeof splitPreview>;
  prop: string;
}) {
  if (!split) return null;
  return (
    <View style={st.split}>
      <Text style={st.splitHead}>Cross-unit booking</Text>
      <Text style={st.splitTxt}>
        {split.known
          ? `${prop} gets ${inr(split.keep)} · ${split.stayProp} gets ${inr(split.give)}`
          : `${prop} gets ${inr(split.keep)} · ${split.stayProp} gets the rest — enter Net earned to see it`}
      </Text>
      {pend ? (
        <Text style={st.splitTxt}>
          Pending: {prop} {inr(pend.keep)} · {pend.stayProp} {inr(pend.give)}
        </Text>
      ) : null}
    </View>
  );
}

export default function BookingForm() {
  const s = useStore();
  const toast = useToast();
  const [f, setF] = useState({ ...EMPTY });
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [staged, setStaged] = useState<Partial<Record<IdSlot, StagedFile>>>({});
  /* Guests: 1 = lead (with phone), 2 = co-guest, 3+ = extras. The count is
     simply how many guests have been added. */
  const [nGuests, setNGuests] = useState(1);
  /* Returning guests: ID documents to copy from their past booking on save,
     keyed by the guest slot on THIS booking ('lead', 'co', 'g3' …). */
  /* "Filled from a past stay" — what was brought in, and how to undo it. */
  const [filledFrom, setFilledFrom] = useState<null | { name: string; when: string; prop: string; row: number; names: string[]; snap: any }>(null);
  const [idOpen, setIdOpen] = useState<Record<string, boolean>>({});   // ID uploader unfolded per guest
  const onFile = (front: string) => !!s.editB && ((s.idMap as any)?.[String(s.editB.row)] || []).some((x: string) => x === front || x === front + '-back');
  const [idCopies, setIdCopies] = useState<Record<string, { fromRow: number; fromFront: string; when: string }>>({});
  const [partner, setPartner] = useState(false);   // "Host's flat…" chosen, unit not picked yet
  /* The host deal (Setup → Hosts). null = none. `hadDeal` remembers an edit
     started with one, so removing it is sent as an explicit null. */
  const [deal, setDeal] = useState<{ hostId: number; unitId: number; collectedBy: 'host' | 'us' } | null>(null);
  const [hadDeal, setHadDeal] = useState(false);
  /* What the host gets out of this booking. The Commission box then holds only
     the platform's (or other) commission; the booking still stores the total. */
  const [hostShare, setHostShare] = useState('');
  const [fromHost, setFromHost] = useState(false);   // "Their guest → our flat" picker open
  const hostsData = s.logs?.hosts;
  const [extras, setExtras] = useState<ExtraGuest[]>([]);
  /* One-off checklist steps typed for a NEW booking; sent with it. */
  const [steps, setSteps] = useState<ExtraStep[]>([]);
  const dir = useGuestDirectory(s.editB?.row);
  /* Same as the expense form: every complaint at once, on the field it is
     about, rather than one at a time in a bar at the foot of the screen. */
  type Errs = Partial<Record<keyof typeof EMPTY, string>>;
  const [errs, setErrs] = useState<Errs>({});
  const scroller = useRef<React.ComponentRef<typeof ScrollView>>(null);
  /* Where each card sits inside the scroller, and what is on screen right now.
     Net earned is in card 4: a failed submit named it in the bar at the foot
     and left the red-outlined box two screens away, so the complaint and the
     field were never visible at the same time. */
  const cardY = useRef<Record<string, { y: number; h: number }>>({});
  const view = useRef({ y: 0, h: 0 });
  const onCard = (k: string) => (e: LayoutChangeEvent) =>
    { cardY.current[k] = { y: e.nativeEvent.layout.y, h: e.nativeEvent.layout.height }; };
  const revealCard = (k: string, always = false) => {
    const c = cardY.current[k];
    if (!c) return;
    const { y: off, h } = view.current;
    /* Already whole on screen: moving the page under the finger would be the
       more annoying of the two. */
    if (!always && h && c.y >= off && c.y + c.h <= off + h) return;
    scroller.current?.scrollTo({ y: Math.max(0, c.y - 12), animated: true });
  };
  const set = (k: keyof typeof EMPTY) => (v: string) => {
    setF((p) => ({ ...p, [k]: v }));
    setErrs((e) => (e[k] ? { ...e, [k]: undefined } : e));
  };

  // prefill on entering edit mode; default date + property otherwise
  useEffect(() => {
    if (s.editB) {
      const c = s.editB.cells;
      const base = {
        /* Every cell is String()-wrapped: the worker coerces any round-trippable
           numeric text to a real number on the wire (worker sheetish()), so a
           guest named "2" arrives as 2 and any later .trim() on it throws and
           blanks the whole app. */
        property: String(c[1] ?? ''), date: String(c[0] ?? ''), guest: String(c[2] ?? ''), leadBirthYr: String(c[14] ?? ''),
        type: c[3] || 'Stay', channel: c[4] || 'Airbnb', referrer: String(c[5] ?? ''),
        listPrice: String(c[6] ?? ''), discount: String(c[7] ?? ''), guestPaid: String(c[8] ?? ''),
        net: String(c[9] ?? ''), commission: String(c[10] ?? ''), guests: String(c[17] ?? ''),
        phone: String(c[13] ?? ''), coGuest: String(c[15] ?? ''), coGuestBirthYr: String(c[16] ?? ''),
        notes: String(c[12] ?? ''), checkinDate: String(c[20] ?? ''), checkoutDate: String(c[21] ?? ''),
        checkinTime: String(c[22] ?? ''), checkoutTime: String(c[23] ?? ''), stayUnit: String(c[24] ?? ''),
        pending: String(c[11] ?? ''),
        repeat: String(c[25] ?? '').trim() === '1' || String(c[25] ?? '').toLowerCase() === 'yes' ? 'Yes' : 'No',
      };
      /* A sent-back request being edited again: its values over the record. */
      const dr = s.editB.draft;
      if (dr) for (const k of Object.keys(EMPTY) as (keyof typeof EMPTY)[]) {
        if (dr[k] === undefined || dr[k] === null) continue;
        (base as any)[k] = k === 'repeat' ? (String(dr[k]) === '1' || dr[k] === true ? 'Yes' : 'No') : String(dr[k]);
      }
      setF(base);
      const dl = dealOf(s.logs?.hosts, s.editB.row);
      setDeal(dl ? { hostId: dl.host_id, unitId: dl.unit_id, collectedBy: dl.collected_by } : null);
      const hs = dl && dl.host_share !== null && dl.host_share !== undefined ? Number(dl.host_share) : null;
      setHostShare(hs !== null ? String(hs) : '');
      /* The booking stores everything deducted; show only the non-host part here. */
      if (hs !== null && base.commission !== '' && isMoneyText(base.commission)) setF((p) => ({ ...p, commission: String(Math.round((moneyNum(base.commission) - hs) * 100) / 100) }));
      setHadDeal(!!dl); setFromHost(false); setPartner(false); setIdCopies({}); setFilledFrom(null);
      const ex = parseExtraGuests(c[27]);
      const n = Math.max(1, base.coGuest.trim() ? 2 : 1, ex.length ? 2 + ex.length : 1, Number(base.guests) || 1);
      setNGuests(Math.min(12, n));
      setExtras([...ex, ...Array.from({ length: Math.max(0, n - 2 - ex.length) }, () => ({ name: '', birthYr: '' }))]);
    } else {
      setNGuests(1); setExtras([]); setDeal(null); setHadDeal(false); setIdCopies({}); setHostShare('');
      setF((p) => ({
        ...EMPTY,
        date: todayIso(),
        property: p.property || s.props[0]?.name || '',
      }));
    }
  }, [s.editB, s.props.length]);

  /* auto commission = Guest Paid − Net (editable), like the web.
     moneyNum, not parseFloat: parseFloat('25,000') is 25 and stops at the
     comma, so typing money the way a person writes it filled Commission in as
     ₹4 instead of ₹4,000 while the server, which strips separators, agreed with
     neither. The box itself now refuses the comma, and this reads it the same
     way the box and the worker do. */
  /* Commission = paid − net − the host's share (when a host is on the booking). */
  const autoComm = (gp: string, net: string, hs: string = hostShare) => {
    if (!isMoneyText(gp) || !isMoneyText(net)) return;
    const h = deal && hs !== '' && isMoneyText(hs) ? moneyNum(hs) : 0;
    setF((p) => ({ ...p, commission: String(Math.round((moneyNum(gp) - moneyNum(net) - h) * 100) / 100) }));
  };


  /* A sent-back request to create a booking, opened again from the Team tab:
     fill the Add form in with what was asked for and keep the request id, so
     submitting revises that request instead of raising a second one. */
  const [resub, setResub] = useState(0);
  const resubTicket = resub ? (s.tickets?.mine || []).find((t) => t.id === resub) || null : null;
  useEffect(() => {
    const nd = s.newDraft;
    if (!nd || nd.kind !== 'booking') return;
    s.setNewDraft(null);
    setF((p) => ({ ...p, ...Object.fromEntries(Object.keys(EMPTY).map((k) => {
      const v = (nd.payload || {})[k];
      return [k, v === undefined || v === null ? (p as any)[k]
        : k === 'repeat' ? (String(v) === '1' || v === true ? 'Yes' : 'No') : String(v)];
    })) }));
    setResub(nd.ticket);
  }, [s.newDraft]);

  const reset = () => {
    s.setEditB(null);
    setResub(0);
    setErrs({});
    setStaged({});
    setNGuests(1); setExtras([]); setSteps([]);
    setF({ ...EMPTY, date: todayIso(), property: s.props[0]?.name || '' });
    setPartner(false); setDeal(null); setHadDeal(false); setFromHost(false); setIdCopies({}); setIdOpen({}); setHostShare(''); setFilledFrom(null);
  };

  const submit = async () => {
    /* The receipt for the LAST request is not a report on this one. After a
       failed submit the top of the screen still read "Request #167 sent" while
       the red complaint sat at the foot — one screen saying sent and not-sent
       at once, which was read as "the form keeps my values after sending".
       A new attempt clears the old receipt before it starts. */
    s.setLastSubmit(null);
    const d = {
      ...f,
      guests: String(nGuests),
      coGuest: nGuests >= 2 ? f.coGuest : '',
      coGuestBirthYr: nGuests >= 2 ? f.coGuestBirthYr : '',
      extraGuests: extras.slice(0, Math.max(0, nGuests - 2)),
      repeat: f.repeat === 'Yes' ? '1' : '',
      hostDeal: deal
        ? (f.type === 'Pass'
          ? { hostId: deal.hostId, unitId: 0, collectedBy: 'host' as const, hostShare: null }
          : { hostId: deal.hostId, unitId: deal.unitId, collectedBy: deal.collectedBy, hostShare: hostShare.trim() === '' ? null : hostShare })
        : hadDeal ? null : undefined,
      /* Stored commission stays "everything deducted": platform/other + host's share. */
      commission: deal && hostShare.trim() !== '' && isMoneyText(hostShare)
        ? String(Math.round(((isMoneyText(f.commission) && f.commission !== '' ? moneyNum(f.commission) : 0) + moneyNum(hostShare)) * 100) / 100)
        : f.commission,
    };
    const e: Errs = {};
    if (!d.property) e.property = 'Pick the property this booking is for.';
    if (!d.date) e.date = 'Pick the booking date.';
    /* A new Pass needs its host, or nobody owes anybody on the ledger. Older
       Pass rows saved before this was asked can still be edited without one. */
    if (f.type === 'Pass' && !deal && !s.editB) e.referrer = 'Pick the host you passed this guest to.';
    /* Negative is allowed (a loss), but a lone '-' from the ± button is not a
       number — the API's num() would silently coerce it to 0. */
    if (d.net === '') e.net = 'Enter what you keep from this booking.';
    else if (!isMoneyText(d.net)) e.net = moneyRule('Net earned');
    if (deal && hostShare.trim() !== '' && !isMoneyText(hostShare)) { toast(moneyRule('Host’s share'), false); return; }
    setErrs(e);
    const missing = (Object.keys(e) as (keyof typeof EMPTY)[]).map((k) => LABEL[k]);
    if (missing.length) {
      toast('Still needed: ' + missing.join(', '), false);
      /* To the card the FIRST complaint is in, not to the top: Property and
         Booking date are in card 1, but Net earned is in the Money card near
         the foot, and going to the top for that one put the red outline two
         screens away from the bar naming it. */
      revealCard(e.property || e.date || e.referrer ? 'booking' : 'money', true);
      return;
    }
    setSaving(true);
    try {
      let res: any;
      if (s.editB) {
        res = await api.updateBooking(s.pin, s.editB.row, { ...d, bookingId: s.editB.bookingId });
      } else {
        res = await api.addBooking(s.pin, steps.length ? { ...d, checklistExtra: steps } : d, resub);
        /* Guest IDs picked before the booking existed go up now. */
        const slots = Object.keys(staged) as IdSlot[];
        if (slots.length && res?.row) {
          /* All at once, not one after another: four ID photos used to take
             four upload times. */
          const done = await Promise.allSettled(slots.map((k) => api.uploadAttachment(s.pin, res.row, k, staged[k]!)));
          const failed = done.filter((x) => x.status === 'rejected').length;
          if (failed) toast(`Booking saved, but ${failed} ID upload${failed > 1 ? 's' : ''} failed — reopen it to retry`, false);
        }
      }
      /* Returning guests' IDs: copied server-side from their past booking.
         A file picked for the same guest here wins over the copy. */
      const target = s.editB ? s.editB.row : res?.row;
      if (target && Object.keys(idCopies).length) {
        const byRow: Record<number, [string, string][]> = {};
        for (const [to, c] of Object.entries(idCopies)) {
          if (staged[to as IdSlot]) continue;
          (byRow[c.fromRow] = byRow[c.fromRow] || []).push([c.fromFront, to], [c.fromFront + '-back', to + '-back']);
        }
        const copies = await Promise.allSettled(Object.entries(byRow).map(([from, pairs]) => api.copyGuestIds(s.pin, target, Number(from), pairs)));
        if (copies.some((x) => x.status === 'rejected')) toast('Booking saved, but past IDs could not be copied — upload them from the booking', false);
      }
      toast(res?.message || 'Saved', true);
      /* A new record that became a request has nowhere to be seen yet —
         remember which one, so the form can point at it. */
      if (!s.editB && res?.pendingApproval && res?.ticket) s.setLastSubmit(res.ticket);
      const from = s.editB?.from;
      reset();
      /* The booking is saved — free the form now. The refresh runs behind
         it (the "Updating…" pill shows while it does) instead of holding the
         Save button for a full reload of every booking. */
      s.refreshWrite();
      if (from) s.setLogSeg(from);   // log sits below the form now — no navigation needed
    } catch (e: any) {
      toast(e?.message || 'Save failed', false);
    } finally {
      setSaving(false);
    }
  };

  const del = () => {
    if (!s.editB) return;
    confirmDestructive('Delete booking', s.needsApproval
      ? 'Send a request to delete this booking? It is removed only once approved.'
      : 'Delete this booking permanently? This cannot be undone.', async () => {
          setDeleting(true);
          s.setLastSubmit(null);
          try {
            const res = await api.deleteBooking(s.pin, s.editB!.row);
            toast(res?.message || 'Deleted', true);
            const from = s.editB!.from;
            /* A requested delete deletes nothing yet. Clearing the form and
               dropping the person on a blank Add booking left them with no way to
               tell whether the request had been raised at all — they had to walk
               to Team ▸ My requests to find out. Staying on the record puts the
               amber panel above the buttons, which already says "Request #N is
               waiting … nothing is deleted until it is approved". */
            if (res?.pendingApproval) {
              await s.refreshWrite();
              return;
            }
            reset();
            await s.refreshWrite();
            s.setLogSeg(from);
          } catch (e: any) {
            toast(e?.message || 'Delete failed', false);
          } finally {
            setDeleting(false);
          }
        }, s.needsApproval ? 'Send request' : 'Delete');
  };

  const editing = !!s.editB;
  const can = { add: s.can('booking.add'), upd: s.can('booking.update'), del: s.can('booking.delete') };
  /* A delete is already waiting on this record. The screen still said
     "Edit Booking" with a gold "Submit for approval" under it — the biggest
     button on the page would have replaced the delete with a change, which is
     the opposite of what had just been asked for. It stays available (that IS
     how you take a delete back) but it stops looking like the thing to do. */
  const liveT = editing && s.editB ? s.ticketFor('booking', s.editB.row) : null;
  const pendingDel = !!liveT && liveT.op === 'delete' && liveT.status === 'pending';
  const L = writeLabels(s.needsApproval, resub);
  if (!editing && !can.add) return <NoAdd what="bookings" canChange={can.upd || can.del} />;
  /* The other flat we own, offered as the Stay unit's one-tap choice. Written
     as the bare unit number ('2212'), which is what every existing row holds
     and what the strict matcher reads; the chip is LABELLED with the full
     property name so there is no doubt which flat was picked.

     The unit already on the booking is not offered at all: a tap that says
     "they stayed where they booked" is the same as leaving the box empty, and a
     greyed-out chip is a control that invites a tap and then does nothing.
     Written as a list so a third flat, if one is ever added, is offered too. */
  /* A flat named 'Spira 2212' is written as the bare '2212', which is what
     every existing row holds. One named '685, Sector 45, Ggn' has no trailing
     number to write, so the chip writes its full name — which the matcher
     accepts exactly. Filtering those out instead would silently deny a one-tap
     choice to precisely the properties whose number is hardest to type. */
  const otherUnits = s.props
    .filter((p) => p.name !== f.property)
    .map((p) => ({ name: p.name, no: unitNumberOf(p.name) || p.name }));
  const stayMode: 'same' | 'owned' | 'partner' = partner || (deal && deal.unitId) ? 'partner'
    : !f.stayUnit.trim() ? 'same' : otherUnits.some((u) => u.no === f.stayUnit.trim()) ? 'owned' : 'partner';
  const dealHost = deal ? hostById(hostsData, deal.hostId) : null;
  const dealUnit = deal && deal.unitId ? unitById(hostsData, deal.unitId) : null;
  /* Live, from the money boxes: what this booking will leave on the host's ledger. */
  const dealLine = (() => {
    if (!deal || !dealHost) return '';
    const first = dealHost.name.split(' ')[0];
    if (deal.collectedBy === 'host') return isMoneyText(f.net) && f.net !== '' ? first + ' will owe you ' + inr(moneyNum(f.net)) + ' (your net)' : first + ' will owe you your net — fill in Net earned';
    return hostShare !== '' && isMoneyText(hostShare) ? 'You’ll owe ' + first + ' ' + inr(moneyNum(hostShare)) + ' (their share)' : 'You’ll owe ' + first + ' their share — enter it below';
  })();
  /* Choosing one of OUR flats: a host picked under "Came from" stays (their
     guest, our flat); a host flat picked under Stay alone is dropped. */
  /* A host chosen in the Booking card — "Resold to" or "Came from: From host".
     Choosing our flat under Stay keeps them (their guest, our flat). */
  /* Resold and Pass both hand the guest to a host: that host is asked for
     right in the Booking card, so the money lands on their ledger. */
  const toHost = f.type === 'Resold' || f.type === 'Pass';
  const hostInBooking = toHost || f.channel === 'From host';
  const toOurUnit = () => {
    setPartner(false);
    if (deal && deal.unitId) setDeal(hostInBooking ? { ...deal, unitId: 0 } : null);
  };
  const isOta = OTA_CHANNELS.indexOf(f.channel) >= 0;
  const hostUnitsOf = (id: number) => (hostsData?.units || []).filter((u) => u.host_id === id);
  const pickHostUnit = (u: HostUnit) => {
    setDeal({ hostId: u.host_id, unitId: u.id, collectedBy: deal?.collectedBy || defaultCollector(f.channel) });
    set('stayUnit')(u.unit); setPartner(false);
  };
  /* The host picker used in the Booking card — under "Came from: From host",
     or as the "Resold to" field. */
  const hostBlock = (

            deal && dealHost ? (
              <View style={[st.picked, { marginTop: -4 }]}>
                <Text style={st.pickedT}>{dealHost.name}</Text>
                <Text style={st.pickedS}>{dealHost.phone || 'No mobile saved'}</Text>
                <TouchableOpacity onPress={() => { setDeal(null); if (toHost) set('referrer')(''); if (dealUnit) { set('stayUnit')(''); setPartner(false); } }} hitSlop={8} style={st.pickedX}><Text style={st.link}>Change</Text></TouchableOpacity>
              </View>
            ) : (
              <FromHostPick data={hostsData} askUnit={f.type === 'Resold'} resold={toHost} onPick={(h) => {
                const us = hostUnitsOf(h.id);
                if (toHost) set('referrer')(h.name);
                /* A Stay is in our flat — never auto-pick the host's unit for it. */
                if (f.type === 'Resold' && us.length === 1) pickHostUnit(us[0]);
                else {
                  setDeal({ hostId: h.id, unitId: 0, collectedBy: defaultCollector(f.channel) });
                  /* Resold: the guest sleeps in one of their flats — open that choice under Stay. */
                  if (f.type === 'Resold' && us.length) { setPartner(true); set('stayUnit')(''); }
                }
              }} onCreated={async (hostId, unitId, unit, name) => {
                await s.reloadLogs();
                if (toHost) set('referrer')(name);
                const pass = f.type === 'Pass';
                setDeal({ hostId, unitId: pass ? 0 : unitId, collectedBy: pass ? 'host' : defaultCollector(f.channel) });
                if (unitId && !pass) { set('stayUnit')(unit); setPartner(false); }
              }} />
            )
  );
  /* Live, like the auto-commission line: what each unit ends up with, on the
     figures currently in the boxes. Preview only — the Worker resolves and
     freezes the real split at save time, using the same rule. */
  const splitNet = isMoneyText(f.net) ? moneyNum(f.net) : null;
  const split = splitPreview(s.props, f.property, f.stayUnit, splitNet);
  const splitPend = split && isMoneyText(f.pending) && moneyNum(f.pending) > 0
    ? splitPreview(s.props, f.property, f.stayUnit, moneyNum(f.pending)) : null;

  /* Shown under the dates so a typo'd year is obvious immediately, rather than
     surfacing later as a 366-night stay on the calendar. */
  const nights = (() => {
    if (!f.checkinDate || !f.checkoutDate) return null;
    const a = new Date(f.checkinDate).getTime(), b = new Date(f.checkoutDate).getTime();
    if (isNaN(a) || isNaN(b)) return null;
    return Math.round((b - a) / 86400000);
  })();

  const guestAt = (i: number): ExtraGuest =>
    i === 0 ? { name: f.guest, birthYr: f.leadBirthYr }
      : i === 1 ? { name: f.coGuest, birthYr: f.coGuestBirthYr }
      : extras[i - 2] || { name: '', birthYr: '' };
  const setGuest = (i: number, g: Partial<ExtraGuest>) => {
    if (i === 0) setF((p) => ({ ...p, ...(g.name !== undefined && { guest: g.name }), ...(g.birthYr !== undefined && { leadBirthYr: g.birthYr }) }));
    else if (i === 1) setF((p) => ({ ...p, ...(g.name !== undefined && { coGuest: g.name }), ...(g.birthYr !== undefined && { coGuestBirthYr: g.birthYr }) }));
    else setExtras((x) => { const y = [...x]; while (y.length < i - 1) y.push({ name: '', birthYr: '' }); y[i - 2] = { ...y[i - 2], ...g }; return y; });
  };
  /* Picking a past guest brings back what we know: their details, and — when
     they led their last booking and this is the primary guest — the people who
     came with them, plus the ID documents already on file for each. */
  const docsOf = (row: number) => new Set(((s.idDocs || {})[String(row)] || []).map((d: any) => String(d.slot)));
  const pick = (i: number, k: KnownGuest) => {
    const snap = i === 0 ? {
      f: { guest: f.guest, leadBirthYr: f.leadBirthYr, phone: f.phone, repeat: f.repeat, coGuest: f.coGuest, coGuestBirthYr: f.coGuestBirthYr },
      extras: [...extras], nGuests, idCopies: { ...idCopies },
    } : null;
    setGuest(i, { name: k.name, birthYr: k.birthYr });
    if (i === 0) setF((p) => ({ ...p, phone: k.phone || p.phone, repeat: 'Yes' }));
    const have = k.lastRow ? docsOf(k.lastRow) : new Set<string>();
    const when = k.lastKey ? fmtKey(k.lastKey) : 'last';
    const copies: Record<string, { fromRow: number; fromFront: string; when: string }> = {};
    const queue = (toPos: number, fromPos: number) => {
      const from = frontForGuest(fromPos);
      if (have.has(from)) copies[frontForGuest(toPos)] = { fromRow: k.lastRow, fromFront: from, when };
    };
    queue(i + 1, k.lastPos || 1);
    const names = [k.name];
    if (i === 0 && k.lastPos === 1 && k.party.length) {
      /* Fill the party into empty guest slots only — never over a typed name. */
      const party = k.party.slice(0, 11);
      party.forEach((g, j) => {
        const pos = j + 2;
        if (guestAt(pos - 1).name.trim()) return;
        setGuest(pos - 1, { name: g.name, birthYr: g.birthYr });
        queue(pos, pos);
        names.push(g.name);
      });
      const need = Math.min(12, 1 + party.length);
      if (need > nGuests) {
        setExtras((x) => { const y = [...x]; while (y.length < need - 2) y.push({ name: '', birthYr: '' }); party.slice(1).forEach((g, j) => { if (!y[j].name) y[j] = { name: g.name, birthYr: g.birthYr }; }); return y; });
        setNGuests(need);
      }
    }
    setIdCopies((x) => ({ ...x, ...copies }));
    if (snap) setFilledFrom({ name: k.name, when, prop: k.lastUnit ? 'Unit ' + String(k.lastUnit).trim() : k.lastProp, row: k.lastRow, names, snap });
    const nIds = Object.keys(copies).length;
    toast(names.join(' + ') + ' — from the ' + when + ' stay' + (nIds ? ' · ' + nIds + ' ID' + (nIds === 1 ? '' : 's') + ' attach on save' : ''), true);
  };
  const undoFill = () => {
    if (!filledFrom) return;
    const sn = filledFrom.snap;
    setF((p) => ({ ...p, ...sn.f })); setExtras(sn.extras); setNGuests(sn.nGuests); setIdCopies(sn.idCopies);
    setFilledFrom(null);
  };
  /* The documents behind a queued copy: front and back of one guest on the past booking. */
  const docsFor = (row: number, front: string) =>
    (((s.idDocs || {})[String(row)] || []) as { id: number; slot: string; type: string }[]).filter((d) => d.slot === front || d.slot === front + '-back')
      .sort((a, b) => (a.slot === front ? -1 : 1) - (b.slot === front ? -1 : 1));
  const addGuest = () => {
    if (nGuests >= 12) return;
    if (nGuests >= 2) setExtras((x) => { const y = [...x]; while (y.length < nGuests - 1) y.push({ name: '', birthYr: '' }); return y; });
    setNGuests(nGuests + 1);
  };
  /* Only the last guest can be removed, so every other guest keeps the ID
     slot their documents were filed under. */
  const removeLast = () => {
    const i = nGuests - 1;
    if (i < 1) return;
    setGuest(i, { name: '', birthYr: '' });
    const fr = frontForGuest(i + 1);
    setStaged((x) => { const y = { ...x }; delete y[fr]; delete y[(fr + '-back') as IdSlot]; return y; });
    setIdCopies((x) => { const y = { ...x }; delete y[fr]; return y; });
    setNGuests(i);
  };
  const namesOnBooking = Array.from({ length: nGuests }, (_, i) => guestAt(i).name).filter(Boolean);
  const onStage = (k: IdSlot, file: StagedFile | null) =>
    setStaged((x) => { const y = { ...x }; if (file) y[k] = file; else delete y[k]; return y; });

  return (
    <FormScroll
      sticky ref={scroller} onSubmit={submit}
      onLayout={(e) => { view.current.h = e.nativeEvent.layout.height; }}
      onScroll={(e) => { view.current.y = e.nativeEvent.contentOffset.y; }}
      scrollEventThrottle={16}
    >
      <FormHeader
        title={editing ? 'Edit Booking' : resub ? 'Edit Request' : 'Add Booking'}
        sub={editing ? (s.editB?.bookingId || '') + (pendingDel ? ' · delete requested' : '') : resub ? 'Request #' + resub : undefined}
        showSave={editing ? can.upd : can.add}
        saveTitle={saving ? L.saving : pendingDel ? 'Submit a change instead' : editing ? L.save : (L.add || 'Save booking')}
        onSave={submit} saveDisabled={saving} saveKind={pendingDel ? 'ghost' : 'primary'}
        clearTitle={editing ? 'Cancel edit' : 'Clear'}
        onClear={() => { const from = s.editB?.from; reset(); if (from) s.setLogSeg(from); }}
      />
      <TicketBanner
        kind="booking" target={s.editB?.row} editing={editing} resubmit={resubTicket}
        note={editing ? `Editing ${s.editB?.bookingId || 'booking'} — “${L.save}” to update, or “Cancel edit” to start fresh.` : undefined}
      />

        <View onLayout={onCard('booking')}>
        {/* 1 · The booking: what it is, where it came from, which of our units it was booked for. */}
        <FormCard title="Booking" step={1} i={1}>
          {/* Which of our units the booking came in for — first, with its photo. */}
          <Field label="Booked for" req err={errs.property}>
            <PropertyPicker value={f.property} options={s.props} onChange={set('property')} />
          </Field>
          <Field label="Booking type" req>
            <ChoiceChips value={f.type} options={['Stay', 'Resold', 'Pass']}
              onChange={(v) => {
                setF((p) => ({ ...p, type: v, channel: v === 'Pass' ? 'Pass' : p.channel === 'Pass' ? 'Airbnb' : p.channel,
                  ...(v === 'Pass' ? { stayUnit: '', guestPaid: '', commission: '', pending: '' } : {}) }));
                if (v === 'Pass') {
                  setPartner(false); setHostShare('');
                  if (deal) setDeal({ ...deal, unitId: 0, collectedBy: 'host' });
                }
              }} />
          </Field>
          {f.type !== 'Pass' ? (
            <Field label="Came from">
              <ChoiceChips value={f.channel} options={f.channel && CHANNELS.indexOf(f.channel) < 0 ? [...CHANNELS, f.channel] : CHANNELS}
                onChange={(v) => {
                  set('channel')(v);
                  if (deal) setDeal({ ...deal, collectedBy: defaultCollector(v) });
                }} />
            </Field>
          ) : null}
          {/* From host: which host — picked from the list, or added right here.
              Their flat (if the guest sleeps there) is chosen under Stay. */}
          {f.channel === 'From host' && f.type !== 'Pass' && f.type !== 'Resold' ? hostBlock : null}
          <Field label="Booking date" req err={errs.date}>
            <DateField value={f.date} onChange={set('date')} />
          </Field>
          {/* The same column means different things by booking type, so the
              label follows the type instead of staying vague. */}
          {toHost ? (
            <Field label={f.type === 'Pass' ? 'Passed to' : 'Resold to'} req={f.type === 'Pass'} err={errs.referrer}
              hint={f.type === 'Pass' ? 'The host you sent this guest to — what they owe you goes on their ledger.' : 'The host whose flat your guest gets.'}>
              {hostBlock}
              {/* A pre-ledger "Resold to" name with no host linked yet. */}
              {!deal && f.referrer ? <Text style={st.hitNote}>{'Saved as “' + f.referrer + '” — pick or add the host to track the money.'}</Text> : null}
            </Field>
          ) : isOta || f.channel === 'From host' ? null : (
          /* A platform booking has no referrer, and From host already names the
             host — the box is only for Direct/Referral. A value already saved
             on the booking is kept as it is. */
          <Field
            label="Referrer / source"
            hint={f.type === 'Resold' ? 'Who the night went to — shown on the check-in card.' : undefined}
          >
            <TxtInput value={f.referrer} onChange={set('referrer')}
              placeholder={f.type === 'Resold' ? 'e.g. Sudhir Badhana' : 'e.g. GVL Spira · Airbnb - Harsh'} />
          </Field>
          )}
        </FormCard>
        </View>

        {/* 2 · The stay: where the guest actually sleeps, and when. */}
        <FormCard title="Stay" step={2} i={2}>
          {/* A Pass hands the guest to a host; where they sleep is the host's
              business, so only the dates are asked. */}
          {f.type !== 'Pass' ? (<>
          <Field label="Guest stays in">
            <View style={st.unitChips}>
              <TouchableOpacity accessibilityRole="radio" accessibilityState={{ selected: stayMode === 'same' }}
                style={[st.unitChip, stayMode === 'same' && st.unitChipOn]}
                onPress={() => { toOurUnit(); set('stayUnit')(''); }}>
                <Text style={[st.unitChipTxt, stayMode === 'same' && st.unitChipTxtOn]}>{'Same unit' + (unitNo(f.property) ? ' · ' + unitNo(f.property) : '')}</Text>
              </TouchableOpacity>
              {otherUnits.map((u) => {
                const on = stayMode === 'owned' && f.stayUnit.trim() === u.no;
                return (
                  <TouchableOpacity key={u.no} accessibilityRole="radio" accessibilityState={{ selected: on }}
                    style={[st.unitChip, on && st.unitChipOn]}
                    onPress={() => { toOurUnit(); set('stayUnit')(on ? '' : u.no); }}>
                    <Text style={[st.unitChipTxt, on && st.unitChipTxtOn]}>{unitNo(u.name) ? 'Unit ' + unitNo(u.name) : u.name}</Text>
                  </TouchableOpacity>
                );
              })}
              <TouchableOpacity accessibilityRole="radio" accessibilityState={{ selected: stayMode === 'partner' }}
                style={[st.unitChip, stayMode === 'partner' && st.unitChipOn]}
                onPress={() => {
                  if (stayMode === 'partner') return;
                  setPartner(true); set('stayUnit')('');
                  /* Keep a host picked under "Came from" — offer their flats first. */
                  if (!(hostInBooking && deal)) setDeal(null);
                }}>
                <Text style={[st.unitChipTxt, stayMode === 'partner' && st.unitChipTxtOn]}>Host’s flat…</Text>
              </TouchableOpacity>
            </View>
            {stayMode === 'partner' && dealUnit ? (
              <View style={st.picked}>
                <Text style={st.pickedT}>{'Unit ' + dealUnit.unit + (dealUnit.building ? ' · ' + dealUnit.building : '')}</Text>
                <Text style={st.pickedS}>{'Host: ' + (dealHost?.name || '')}</Text>
                <TouchableOpacity onPress={() => { setDeal(hostInBooking && deal ? { ...deal, unitId: 0 } : null); setPartner(true); set('stayUnit')(''); }} hitSlop={8} style={st.pickedX}><Text style={st.link}>Change</Text></TouchableOpacity>
              </View>
            ) : stayMode === 'partner' && dealHost && hostUnitsOf(dealHost.id).length ? (
              <View style={[st.unitChips, { marginTop: 10 }]}>
                {hostUnitsOf(dealHost.id).map((u) => (
                  <TouchableOpacity key={u.id} style={st.unitChip} onPress={() => pickHostUnit(u)}>
                    <Text style={st.unitChipTxt}>{dealHost.name.split(' ')[0] + '’s ' + u.unit}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            ) : stayMode === 'partner' ? (
              <HostUnitPick data={hostsData} typed={f.stayUnit} onPick={pickHostUnit} onType={set('stayUnit')} />
            ) : null}
          </Field>
          {/* Their guest → our flat, when the booking didn't come in as "From host". */}
          {stayMode !== 'partner' && !hostInBooking ? (
            deal && dealHost ? (
              <View style={st.picked}>
                <Text style={st.pickedT}>{'Guest came from ' + dealHost.name}</Text>
                <Text style={st.pickedS}>Their guest, in our flat</Text>
                <TouchableOpacity onPress={() => setDeal(null)} hitSlop={8} style={st.pickedX}><Text style={st.link}>Remove</Text></TouchableOpacity>
              </View>
            ) : fromHost ? (
              <HostPick data={hostsData} onPick={(h) => { setDeal({ hostId: h.id, unitId: 0, collectedBy: defaultCollector(f.channel) }); setFromHost(false); }} onCancel={() => setFromHost(false)} />
            ) : (
              <TouchableOpacity onPress={() => setFromHost(true)} hitSlop={6} style={{ alignSelf: 'flex-start', marginTop: -2, marginBottom: 10 }}>
                <Text style={st.link}>+ Guest came from another host</Text>
              </TouchableOpacity>
            )
          ) : null}
          </>) : null}
          <Two>
            <View style={{ flex: 1 }}>
              <Field label="Check-in date"><DateField value={f.checkinDate} onChange={set('checkinDate')} allowClear /></Field>
            </View>
            <View style={{ flex: 1 }}>
              <Field label="Check-in time"><TimeField title="Check-in Time" value={f.checkinTime} onChange={set('checkinTime')} /></Field>
            </View>
          </Two>
          <Two>
            <View style={{ flex: 1 }}>
              <Field label="Check-out date"><DateField value={f.checkoutDate} onChange={set('checkoutDate')} allowClear /></Field>
            </View>
            <View style={{ flex: 1 }}>
              <Field label="Check-out time"><TimeField title="Check-out Time" value={f.checkoutTime} onChange={set('checkoutTime')} /></Field>
            </View>
          </Two>
          {nights !== null ? (
            <Text style={st.calc}>{nights} night{nights === 1 ? '' : 's'}</Text>
          ) : null}
        </FormCard>

        <FormCard title="Guests" step={3} i={3}>
          {filledFrom ? (
            <View style={st.filled}>
              <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <Text style={st.filledT}>{'Filled from ' + filledFrom.name.split(' ')[0] + '’s stay'}</Text>
                  <Text style={st.filledS}>{[filledFrom.when, filledFrom.prop].filter(Boolean).join(' · ')}</Text>
                </View>
                <TouchableOpacity onPress={undoFill} hitSlop={8}><Text style={st.link}>Undo</Text></TouchableOpacity>
              </View>
              <Text style={st.filledNames}>{filledFrom.names.join(' · ')}</Text>
              {((s.idDocs || {})[String(filledFrom.row)] || []).length ? (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                  {(((s.idDocs || {})[String(filledFrom.row)] || []) as { id: number; slot: string; type: string }[]).map((d) => (
                    <View key={d.id} style={{ alignItems: 'center', gap: 2 }}>
                      <IdThumb d={d} pin={s.pin} size={60} />
                      <Text style={st.thumbLbl}>{guestLabel(frontOf(d.slot as IdSlot)).replace('Lead guest', 'Primary') + (/-back$/.test(d.slot) ? ' · back' : '')}</Text>
                    </View>
                  ))}
                </View>
              ) : <Text style={st.filledS}>No IDs on file from that stay — upload them below.</Text>}
            </View>
          ) : null}
          {Array.from({ length: nGuests }, (_, i) => {
            const g = guestAt(i);
            const last = i === nGuests - 1 && i > 0;
            const front = frontForGuest(i + 1);
            const copy = idCopies[front] && !staged[front as IdSlot] ? idCopies[front] : null;
            return (
              <View key={i} style={[st.guest, i === 0 && st.guestLead]}>
                <View style={st.guestHead}>
                  <Text style={st.gTitle}>{i === 0 ? 'Primary guest' : 'Guest ' + (i + 1)}</Text>
                  <View style={{ flex: 1 }} />
                  {i === 0 ? (
                    <TouchableOpacity onPress={() => set('repeat')(f.repeat === 'Yes' ? 'No' : 'Yes')} hitSlop={6}
                      accessibilityRole="switch" accessibilityState={{ checked: f.repeat === 'Yes' }}
                      style={[st.retPill, f.repeat === 'Yes' && st.retPillOn]}>
                      <Text style={[st.retPillT, f.repeat === 'Yes' && st.retPillTOn]}>{f.repeat === 'Yes' ? '✓ Returning guest' : 'Returning guest?'}</Text>
                    </TouchableOpacity>
                  ) : last ? (
                    <TouchableOpacity onPress={removeLast} hitSlop={8} accessibilityLabel={`Remove guest ${i + 1}`}>
                      <Text style={st.gRemove}>Remove</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
                <View style={st.two}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <GuestNameInput
                      value={g.name}
                      onChange={(v) => setGuest(i, { name: v })}
                      onPick={(k) => pick(i, k)}
                      dir={dir}
                      exclude={namesOnBooking}
                      placeholder={i === 0 ? 'Name — type to find a past guest' : 'Name'}
                    />
                  </View>
                  {i > 0 ? (
                    <View style={{ width: 96 }}>
                      <TxtInput value={g.birthYr} onChange={(v) => setGuest(i, { birthYr: v })} placeholder="Birth yr" keyboardType="numeric" />
                    </View>
                  ) : null}
                </View>
                {i === 0 ? (
                  <View style={[st.two, { marginTop: 10 }]}>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <TxtInput value={f.phone} onChange={set('phone')} keyboardType="phone-pad" placeholder="Mobile" />
                    </View>
                    <View style={{ width: 96 }}>
                      <TxtInput value={g.birthYr} onChange={(v) => setGuest(i, { birthYr: v })} placeholder="Birth yr" keyboardType="numeric" />
                    </View>
                  </View>
                ) : null}
                {copy ? (
                  <View style={st.copyRow}>
                    <View style={{ flexDirection: 'row', gap: 6 }}>
                      {docsFor(copy.fromRow, copy.fromFront).map((d) => <IdThumb key={d.id} d={d} pin={s.pin} />)}
                    </View>
                    <Text style={st.copyT}>{'✓ ID from the ' + copy.when + ' stay — attaches on save'}</Text>
                    <TouchableOpacity onPress={() => { setIdCopies((x) => { const y = { ...x }; delete y[front]; return y; }); setIdOpen((x) => ({ ...x, [front]: true })); }} hitSlop={8}>
                      <Text style={st.link}>Use a different ID</Text>
                    </TouchableOpacity>
                  </View>
                ) : idOpen[front] || staged[front as IdSlot] || staged[(front + '-back') as IdSlot] || (editing && onFile(front)) ? (
                  <IdUploader
                    row={editing ? s.editB!.row : 0}
                    guest="" coGuest="" needsCo={false}
                    only={front} compact
                    {...(editing ? {} : { staged, onStage })}
                  />
                ) : (
                  <TouchableOpacity style={st.idLine} onPress={() => setIdOpen((x) => ({ ...x, [front]: true }))} activeOpacity={0.7}>
                    <Text style={st.idLineT}>ID document</Text>
                    <Text style={st.idMissing}>Missing</Text>
                    <View style={{ flex: 1 }} />
                    <Text style={st.link}>+ Add ID</Text>
                  </TouchableOpacity>
                )}
              </View>
            );
          })}
          {/* Documents already on file for a guest this booking no longer lists —
              uploading into a second guest's block and then removing the guest
              leaves the file saved but with no block to show it in. Shown here
              so it can be seen and removed instead of lingering unseen. */}
          {editing ? (
            <IdUploader
              row={s.editB!.row}
              guest="" coGuest="" needsCo={false}
              orphansBeyond={Array.from({ length: nGuests }, (_, i) => frontForGuest(i + 1))}
            />
          ) : null}
          {nGuests < 12 ? (
            <TouchableOpacity style={st.addGuest} onPress={addGuest} activeOpacity={0.75}>
              <Text style={st.addGuestTxt}>+ Add guest</Text>
            </TouchableOpacity>
          ) : null}
        </FormCard>

        <View onLayout={onCard('money')}>
        <FormCard title="Money" step={4} i={4}>
          {f.type === 'Pass' ? (
            /* A Pass is one number: what the host pays us for the guest. That
               is our net, and it is what the host owes on their ledger. */
            <>
              <Field label="Host paid for the pass (₹)" req err={errs.net}
                hint={dealHost ? 'What ' + dealHost.name.split(' ')[0] + ' pays you — your net earning.' : 'What the host pays you — your net earning.'}>
                <TxtInput value={f.net} onChange={set('net')} money onFocus={() => revealCard('money')} />
              </Field>
              <Field label="Pending amount (₹)"
                hint={'Part of the pass amount ' + (dealHost ? dealHost.name.split(' ')[0] : 'the host') + ' hasn’t paid yet.'}>
                <TxtInput value={f.pending} onChange={set('pending')} money onFocus={() => revealCard('money')} />
              </Field>
              {isMoneyText(f.net) && f.net !== '' ? (
                <View style={st.moneySum}>
                  <Text style={st.moneySumT}>{'You earn ' + inr(moneyNum(f.net))}</Text>
                  {dealHost ? <Text style={st.moneySumS}>{'Added to ' + dealHost.name.split(' ')[0] + '’s ledger as owed to you'}</Text> : null}
                  {isMoneyText(f.pending) && moneyNum(f.pending) > 0
                    ? <Text style={st.moneySumS}>{inr(moneyNum(f.pending)) + ' still pending'}</Text> : null}
                </View>
              ) : null}
            </>
          ) : (<>
          {deal && dealHost ? (
            <Field label="Who collected the guest’s money?">
              <ChoiceChips value={deal.collectedBy === 'host' ? dealHost.name.split(' ')[0] : 'We did'}
                options={[dealHost.name.split(' ')[0], 'We did']}
                onChange={(v) => setDeal({ ...deal, collectedBy: v === 'We did' ? 'us' : 'host' })} />
              <Text style={st.dealLine}>{dealLine}</Text>
            </Field>
          ) : null}
          {/* List price and discount are no longer asked for; values already on
              a booking are still carried through on save untouched. */}
          <Two>
            <View style={{ flex: 1 }}>
              <Field label="Guest paid (₹)">
                <TxtInput value={f.guestPaid} onChange={(v) => { set('guestPaid')(v); autoComm(v, f.net); }} money
                  onFocus={() => revealCard('money')} />
              </Field>
            </View>
            <View style={{ flex: 1 }}>
              <Field label="Net earned (₹)" req hint="What you keep. Negative for a loss — tap ± or type a minus." err={errs.net}>
                <TxtInput value={f.net} onChange={(v) => { set('net')(v); autoComm(f.guestPaid, v); }} money signed
                  onFocus={() => revealCard('money')} />
              </Field>
            </View>
          </Two>
          <SplitNote split={split} pend={splitPend} prop={f.property} />
          <Two>
            <View style={{ flex: 1 }}>
              {/* Platform channels take a fee; everything else may pay a referral commission. */}
              <Field label={isOta ? 'Platform commission (₹)' : 'Commission (₹)'}
                hint={deal ? 'Auto = paid − net − host’s share.' : 'Auto = paid − net.'}>
                <TxtInput value={f.commission} onChange={set('commission')} money onFocus={() => revealCard('money')} />
              </Field>
            </View>
            {deal && dealHost ? (
              <View style={{ flex: 1 }}>
                <Field label="Host’s share (₹)" hint={'What ' + dealHost.name.split(' ')[0] + ' gets from this booking.'}>
                  <TxtInput value={hostShare} onChange={(v) => { setHostShare(v); autoComm(f.guestPaid, f.net, v); }} money onFocus={() => revealCard('money')} />
                </Field>
              </View>
            ) : (
              <View style={{ flex: 1 }}>
                <Field label="Pending (₹)" hint="Still to be received.">
                  <TxtInput value={f.pending} onChange={set('pending')} money onFocus={() => revealCard('money')} />
                </Field>
              </View>
            )}
          </Two>
          {deal && dealHost ? (
            <Two>
              <View style={{ flex: 1 }}>
                <Field label="Pending (₹)" hint="Still to be received.">
                  <TxtInput value={f.pending} onChange={set('pending')} money onFocus={() => revealCard('money')} />
                </Field>
              </View>
              <View style={{ flex: 1 }} />
            </Two>
          ) : null}
          {/* The answer to "what do I make, and what do I owe" in one line. */}
          {isMoneyText(f.net) && f.net !== '' ? (
            <View style={st.moneySum}>
              <Text style={st.moneySumT}>{'You earn ' + inr(moneyNum(f.net))}</Text>
              {deal && dealHost && hostShare !== '' && isMoneyText(hostShare) ? (
                <Text style={st.moneySumS}>{deal.collectedBy === 'us'
                  ? 'You owe ' + dealHost.name.split(' ')[0] + ' ' + inr(moneyNum(hostShare))
                  : dealHost.name.split(' ')[0] + ' collected — they owe you ' + inr(moneyNum(f.net))}</Text>
              ) : null}
            </View>
          ) : null}
          </>)}
        </FormCard>
        </View>

        <FormCard title="Notes" step={5} i={5}>
          <Field label="Notes"><TxtInput value={f.notes} onChange={set('notes')} placeholder="Anything worth remembering" /></Field>
        </FormCard>

        {/* Checklist. A new booking previews its property's steps (the flat
            the guest stays in, as the checklist itself uses) and can carry
            one-off steps; an existing one shows the live checklist, which
            saves tick by tick rather than with this form's Save. */}
        {s.logs?.checklist ? (
          <FormCard title="Checklist" step={6} i={6}
            note={editing ? 'Saved as you tick — not part of “Save changes”.' : undefined}>
            {editing && s.editB
              ? <BookingChecklist row={s.editB.row} bare />
              : <NewBookingSteps property={ownedPropertyName(s.props, f.stayUnit) || f.property} extras={steps} onChange={setSteps} />}
          </FormCard>
        ) : null}

      <FormFooter
        title={editing ? 'Edit Booking' : resub ? 'Edit Request' : 'Add Booking'}
        sub={editing ? (s.editB?.bookingId || '') + (pendingDel ? ' · delete requested' : '') : resub ? 'Request #' + resub : undefined}
        showSave={editing ? can.upd : can.add}
        saveTitle={saving ? L.saving : pendingDel ? 'Submit a change instead' : editing ? L.save : (L.add || 'Save booking')}
        onSave={submit} saveDisabled={saving} saveKind={pendingDel ? 'ghost' : 'primary'}
        clearTitle={editing ? 'Cancel edit' : 'Clear'}
        onClear={() => { const from = s.editB?.from; reset(); if (from) s.setLogSeg(from); }}
        onDelete={editing && can.del ? del : undefined}
        deleteTitle={deleting ? L.deleting : L.del} deleteDisabled={deleting}
      />
    </FormScroll>
  );
}

/* Search-as-you-type over every host unit ("3103", "Arbaz"). Not listed?
   Type the flat number — the booking saves without a ledger link, as before. */
function HostUnitPick({ data, typed, onPick, onType }: { data?: HostsData; typed: string; onPick: (u: HostUnit) => void; onType: (v: string) => void }) {
  const [q, setQ] = useState(typed);
  const units = data?.units || [];
  const name = (id: number) => (data?.hosts || []).find((h) => h.id === id)?.name || '';
  const t = q.trim().toLowerCase();
  const hits = units.filter((u) => !t || (u.unit + ' ' + u.building + ' ' + name(u.host_id)).toLowerCase().includes(t)).slice(0, 6);
  return (
    <View style={{ marginTop: 8, gap: 6 }}>
      <TxtInput value={q} onChange={(v) => { setQ(v); onType(v); }} placeholder={units.length ? 'Search unit or host — e.g. 3103' : 'Flat number, e.g. 2121'} />
      {hits.map((u) => (
        <TouchableOpacity key={u.id} style={st.hit} onPress={() => onPick(u)} activeOpacity={0.7}>
          <Text style={st.hitT}>{'Unit ' + u.unit}</Text>
          <Text style={st.hitS} numberOfLines={1}>{name(u.host_id) + (u.building ? ' · ' + u.building : '')}</Text>
        </TouchableOpacity>
      ))}
      <Text style={st.hitNote}>{units.length ? 'Not listed? The typed number saves as before, without a ledger link — add the host under Setup → Hosts.' : 'No host units yet — add hosts under Setup → Hosts to track what you owe them.'}</Text>
    </View>
  );
}
/* Channel "From host": search the hosts we know, or add one in place —
   name, mobile and the unit the guest gets (blank = they're in our flat). */
/* One ID document as a tappable thumbnail (PDFs as a labelled tile). */
function IdThumb({ d, pin, size = 44 }: { d: { id: number; type: string }; pin: string; size?: number }) {
  const open = () => Linking.openURL(api.attachmentUrl(pin, d.id)).catch(() => {});
  return (
    <TouchableOpacity onPress={open} activeOpacity={0.8} accessibilityLabel="Open ID document">
      {/^image\//.test(d.type)
        ? <Image source={{ uri: api.attachmentUrl(pin, d.id) }} style={{ width: size, height: size, borderRadius: 8, backgroundColor: C.line }} />
        : <View style={{ width: size, height: size, borderRadius: 8, backgroundColor: C.bone, alignItems: 'center', justifyContent: 'center' }}><Text style={{ fontFamily: F.bold, fontSize: 11, color: C.bark }}>PDF</Text></View>}
    </TouchableOpacity>
  );
}

function FromHostPick({ data, askUnit, resold, onPick, onCreated }: {
  data?: HostsData; askUnit: boolean; resold?: boolean; onPick: (h: Host) => void; onCreated: (hostId: number, unitId: number, unit: string, name: string) => void;
}) {
  const s = useStore();
  const toast = useToast();
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);
  const [n, setN] = useState({ name: '', phone: '', unit: '' });
  const [busy, setBusy] = useState(false);
  const t = q.trim().toLowerCase();
  const units = data?.units || [];
  const hits = (data?.hosts || []).filter((h) => !t || (h.name + ' ' + h.phone + ' ' + units.filter((u) => u.host_id === h.id).map((u) => u.unit).join(' ')).toLowerCase().includes(t)).slice(0, 6);
  const save = async () => {
    if (!n.name.trim()) { toast('Enter the host’s name', false); return; }
    setBusy(true);
    try {
      const r = await api.quickAddHost(s.pin, askUnit ? n : { ...n, unit: '' });
      toast(r.message, true);
      onCreated(r.hostId, r.unitId, askUnit ? n.unit.trim() : '', n.name.trim());
    } catch (e: any) { toast(String(e?.message || e), false); } finally { setBusy(false); }
  };
  if (adding) {
    return (
      <View style={st.newHost}>
        <Text style={st.newHostT}>New host</Text>
        <Field label="Host name" req><TxtInput value={n.name} onChange={(v) => setN({ ...n, name: v })} placeholder="e.g. Chandra Prakash" autoFocus /></Field>
        <Field label="Host mobile"><TxtInput value={n.phone} onChange={(v) => setN({ ...n, phone: v })} placeholder="+91 …" keyboardType="phone-pad" /></Field>
        {/* A Stay is in our flat, so the host's unit isn't asked; Resold/Pass may be in theirs. */}
        {askUnit ? (
          <Field label="Host unit number" hint={resold ? 'The host’s flat your guest will stay in.' : 'The flat your guest gets. Leave blank if the guest stays in your flat.'}>
            <TxtInput value={n.unit} onChange={(v) => setN({ ...n, unit: v })} placeholder="e.g. 3103" />
          </Field>
        ) : null}
        <View style={{ flexDirection: 'row', gap: 14, alignItems: 'center' }}>
          <TouchableOpacity onPress={save} disabled={busy} style={st.newHostBtn}><Text style={st.newHostBtnT}>{busy ? 'Adding…' : 'Add host'}</Text></TouchableOpacity>
          <TouchableOpacity onPress={() => setAdding(false)} hitSlop={8}><Text style={[st.link, { color: C.bark }]}>Cancel</Text></TouchableOpacity>
        </View>
      </View>
    );
  }
  return (
    <View style={{ gap: 6, marginBottom: 10, marginTop: -4 }}>
      <TxtInput value={q} onChange={setQ} placeholder={resold ? 'Search host name, mobile or unit' : 'Which host? Search name, mobile or unit'} />
      {hits.map((h) => {
        const us = units.filter((u) => u.host_id === h.id).map((u) => u.unit);
        return (
          <TouchableOpacity key={h.id} style={st.hit} onPress={() => onPick(h)} activeOpacity={0.7}>
            <Text style={st.hitT}>{h.name}</Text>
            <Text style={st.hitS} numberOfLines={1}>{[h.phone, us.length ? 'Units ' + us.join(', ') : ''].filter(Boolean).join(' · ')}</Text>
          </TouchableOpacity>
        );
      })}
      <TouchableOpacity onPress={() => { setAdding(true); setN({ name: q.trim() && !hits.length ? q.trim() : '', phone: '', unit: '' }); }} hitSlop={6} style={{ alignSelf: 'flex-start', marginTop: 2 }}>
        <Text style={st.link}>{'+ New host' + (q.trim() && !hits.length ? ' “' + q.trim() + '”' : '')}</Text>
      </TouchableOpacity>
    </View>
  );
}
function HostPick({ data, onPick, onCancel }: { data?: HostsData; onPick: (h: Host) => void; onCancel: () => void }) {
  const [q, setQ] = useState('');
  const t = q.trim().toLowerCase();
  const hits = (data?.hosts || []).filter((h) => !t || (h.name + ' ' + h.phone).toLowerCase().includes(t)).slice(0, 6);
  return (
    <View style={{ gap: 6, marginBottom: 8 }}>
      <TxtInput value={q} onChange={setQ} placeholder="Which host sent them?" autoFocus />
      {hits.map((h) => (
        <TouchableOpacity key={h.id} style={st.hit} onPress={() => onPick(h)} activeOpacity={0.7}>
          <Text style={st.hitT}>{h.name}</Text>
          {h.phone ? <Text style={st.hitS}>{h.phone}</Text> : null}
        </TouchableOpacity>
      ))}
      {!(data?.hosts || []).length ? <Text style={st.hitNote}>No hosts yet — add them under Setup → Hosts.</Text> : null}
      <TouchableOpacity onPress={onCancel} hitSlop={6}><Text style={[st.link, { color: C.bark }]}>Cancel</Text></TouchableOpacity>
    </View>
  );
}

const st = StyleSheet.create({
  section: { borderTopWidth: 1, borderTopColor: C.hair, paddingTop: 15, marginTop: 6, marginBottom: 4 },
  sTitle: { fontFamily: F.xbold, fontSize: 13, color: C.ink, letterSpacing: 0.3, textTransform: 'uppercase' },
  sNote: { fontFamily: F.med, fontSize: 11.5, color: C.muted, marginTop: 3, lineHeight: 16 },
  two: { flexDirection: 'row', gap: 10 },
  calc: { fontFamily: F.semi, fontSize: 12, color: C.blue2, marginTop: -4, marginBottom: 6 },
  unitChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  link: { fontFamily: F.bold, fontSize: 13, color: C.blue2 },
  picked: { marginTop: 8, marginBottom: 8, padding: 12, borderRadius: 14, backgroundColor: C.amberbg, borderWidth: 1, borderColor: '#EAD9B8' },
  pickedT: { fontFamily: F.bold, fontSize: 14, color: C.ink, paddingRight: 70 },
  pickedS: { fontFamily: F.med, fontSize: 12, color: C.bark, marginTop: 2 },
  pickedX: { position: 'absolute', right: 12, top: 12 },
  hit: { flexDirection: 'row', alignItems: 'baseline', gap: 8, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 12, backgroundColor: '#fff', borderWidth: 1, borderColor: C.line },
  hitT: { fontFamily: F.bold, fontSize: 14, color: C.ink },
  hitS: { fontFamily: F.med, fontSize: 12, color: C.bark, flex: 1 },
  hitNote: { fontFamily: F.med, fontSize: 11.5, color: C.muted, lineHeight: 16 },
  newHost: { marginTop: -4, marginBottom: 10, padding: 12, borderRadius: 14, backgroundColor: C.warm2, borderWidth: 1, borderColor: C.hair },
  newHostT: { fontFamily: F.xbold, fontSize: 14, color: C.ink, marginBottom: 8 },
  newHostBtn: { backgroundColor: C.navy, borderRadius: 999, paddingVertical: 9, paddingHorizontal: 18 },
  newHostBtnT: { fontFamily: F.bold, fontSize: 13.5, color: '#fff' },
  dealLine: { fontFamily: F.semi, fontSize: 12.5, color: C.blue2, marginTop: 8 },
  unitChip: {
    borderWidth: 1, borderColor: C.line, borderRadius: 20,
    paddingHorizontal: 10, paddingVertical: 4, backgroundColor: '#fff',
  },
  unitChipOn: { borderColor: C.blue2, backgroundColor: 'rgba(43,90,143,0.08)' },
  unitChipTxt: { fontFamily: F.semi, fontSize: 11.5, color: C.muted },
  unitChipTxtOn: { color: C.blue2 },
  split: {
    borderWidth: 1, borderColor: C.hair, borderRadius: 12, padding: 10,
    marginTop: -2, marginBottom: 10, backgroundColor: 'rgba(43,90,143,0.05)',
  },
  splitHead: {
    fontFamily: F.xbold, fontSize: 10.5, color: C.muted,
    letterSpacing: 0.4, textTransform: 'uppercase', marginBottom: 3,
  },
  splitTxt: { fontFamily: F.semi, fontSize: 12.5, color: C.blue2, lineHeight: 18 },
  guest: { borderWidth: 1, borderColor: C.hair, borderRadius: 16, padding: 12, marginBottom: 12, backgroundColor: 'rgba(255,255,255,0.6)' },
  guestHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  guestLead: { backgroundColor: '#fff' },
  retPill: { borderRadius: 999, borderWidth: 1, borderColor: C.line, paddingVertical: 4, paddingHorizontal: 10 },
  retPillOn: { backgroundColor: C.greenbg, borderColor: C.greenbg },
  retPillT: { fontFamily: F.semi, fontSize: 11.5, color: C.muted },
  retPillTOn: { color: C.green, fontFamily: F.bold },
  copyRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10, padding: 10, borderRadius: 12, backgroundColor: C.greenbg },
  idLine: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: C.hair, backgroundColor: '#fff' },
  idLineT: { fontFamily: F.semi, fontSize: 13, color: C.bark },
  idMissing: { fontFamily: F.bold, fontSize: 11, color: C.red, backgroundColor: C.redbg, paddingVertical: 2, paddingHorizontal: 8, borderRadius: 999, overflow: 'hidden' },
  moneySum: { marginTop: 4, padding: 12, borderRadius: 14, backgroundColor: C.greenbg, gap: 2 },
  moneySumT: { fontFamily: F.xbold, fontSize: 15, color: C.green },
  moneySumS: { fontFamily: F.semi, fontSize: 12.5, color: C.ink },
  filled: { padding: 12, borderRadius: 14, backgroundColor: C.greenbg, marginBottom: 12 },
  filledT: { fontFamily: F.xbold, fontSize: 14, color: C.ink },
  filledS: { fontFamily: F.med, fontSize: 12, color: C.bark, marginTop: 2 },
  filledNames: { fontFamily: F.semi, fontSize: 13, color: C.green, marginTop: 6 },
  thumbLbl: { fontFamily: F.med, fontSize: 10, color: C.bark },
  copyT: { flex: 1, fontFamily: F.semi, fontSize: 12.5, color: C.green },
  gNum: { width: 22, height: 22, borderRadius: 11, backgroundColor: C.navy, alignItems: 'center', justifyContent: 'center' },
  gNumTxt: { color: '#fff', fontFamily: F.bold, fontSize: 11 },
  gTitle: { fontFamily: F.bold, fontSize: 14, color: C.ink },
  gRemove: { fontFamily: F.semi, fontSize: 12.5, color: C.red },
  addGuest: {
    borderWidth: 1.5, borderStyle: 'dashed', borderColor: 'rgba(185,128,54,0.45)', borderRadius: 14,
    paddingVertical: 13, alignItems: 'center', backgroundColor: 'rgba(233,185,110,0.08)',
  },
  addGuestTxt: { fontFamily: F.bold, fontSize: 14, color: C.blue2 },
  idHint: { fontFamily: F.med, fontSize: 12, color: C.muted, lineHeight: 18 },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 8 },
  h2: { fontSize: 25, color: C.ink, fontFamily: F.xbold, letterSpacing: -0.6 },
  editMsg: {
    backgroundColor: C.amberbg, borderWidth: 1, borderColor: '#e9d2a3', borderRadius: 10,
    paddingVertical: 9, paddingHorizontal: 13, marginTop: 8,
  },
});
