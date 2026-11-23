import React, { useEffect, useRef, useState } from 'react';
import { LayoutChangeEvent, ScrollView, StyleSheet, Text, View } from 'react-native';
import { C, F, inr } from '../theme';
import { useStore } from '../store';
import { confirmDestructive, useToast } from '../ui';
import { Field, TxtInput, SelectField, DateField, TimeField } from '../fields';
import { api } from '../api';
import IdUploader, { StagedFile } from './IdUploader';
import { ExtraGuest, IdSlot, frontForGuest, ownedPropertyName, parseExtraGuests, splitPreview, todayIso, unitNumberOf } from '../logic';
import { BookingChecklist, ExtraStep, NewBookingSteps } from '../checklist';
import { isMoneyText, moneyNum, moneyRule } from '../money';
import { GuestNameInput, KnownGuest, useGuestDirectory } from '../guests';
import { TouchableOpacity } from 'react-native';
import { FormCard, FormFooter, FormHeader, FormScroll } from '../formkit';
import TicketBanner, { NoAdd, writeLabels } from './TicketBanner';

const CHANNELS = ['Airbnb', 'Booking.com', 'MMT', 'Agoda', 'Offline', 'Direct/Referral', 'Pass'];

/* Field names as the person reads them, for "Still needed: …". */
const LABEL: Record<string, string> = { property: 'Property', date: 'Booking date', net: 'Net earned' };

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
      const ex = parseExtraGuests(c[27]);
      const n = Math.max(1, base.coGuest.trim() ? 2 : 1, ex.length ? 2 + ex.length : 1, Number(base.guests) || 1);
      setNGuests(Math.min(12, n));
      setExtras([...ex, ...Array.from({ length: Math.max(0, n - 2 - ex.length) }, () => ({ name: '', birthYr: '' }))]);
    } else {
      setNGuests(1); setExtras([]);
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
  const autoComm = (gp: string, net: string) => {
    if (!isMoneyText(gp) || !isMoneyText(net)) return;
    setF((p) => ({ ...p, commission: String(Math.round((moneyNum(gp) - moneyNum(net)) * 100) / 100) }));
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
    };
    const e: Errs = {};
    if (!d.property) e.property = 'Pick the property this booking is for.';
    if (!d.date) e.date = 'Pick the booking date.';
    /* Negative is allowed (a loss), but a lone '-' from the ± button is not a
       number — the API's num() would silently coerce it to 0. */
    if (d.net === '') e.net = 'Enter what you keep from this booking.';
    else if (!isMoneyText(d.net)) e.net = moneyRule('Net earned');
    setErrs(e);
    const missing = (Object.keys(e) as (keyof typeof EMPTY)[]).map((k) => LABEL[k]);
    if (missing.length) {
      toast('Still needed: ' + missing.join(', '), false);
      /* To the card the FIRST complaint is in, not to the top: Property and
         Booking date are in card 1, but Net earned is in the Money card near
         the foot, and going to the top for that one put the red outline two
         screens away from the bar naming it. */
      revealCard(e.property || e.date ? 'booking' : 'money', true);
      return;
    }
    setSaving(true);
    try {
      let res;
      if (s.editB) {
        res = await api.updateBooking(s.pin, s.editB.row, { ...d, bookingId: s.editB.bookingId });
      } else {
        res = await api.addBooking(s.pin, steps.length ? { ...d, checklistExtra: steps } : d, resub);
        /* Guest IDs picked before the booking existed go up now. */
        const slots = Object.keys(staged) as IdSlot[];
        if (slots.length && res?.row) {
          let failed = 0;
          for (const k of slots) {
            try { await api.uploadAttachment(s.pin, res.row, k, staged[k]!); } catch { failed++; }
          }
          if (failed) toast(`Booking saved, but ${failed} ID upload${failed > 1 ? 's' : ''} failed — reopen it to retry`, false);
        }
      }
      toast(res?.message || 'Saved', true);
      /* A new record that became a request has nowhere to be seen yet —
         remember which one, so the form can point at it. */
      if (!s.editB && res?.pendingApproval && res?.ticket) s.setLastSubmit(res.ticket);
      const from = s.editB?.from;
      reset();
      await s.refreshWrite();
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
  const pick = (i: number, k: KnownGuest) => {
    setGuest(i, { name: k.name, birthYr: k.birthYr });
    if (i === 0) setF((p) => ({ ...p, phone: k.phone || p.phone, repeat: 'Yes' }));
    toast(`${k.name} — details filled from ${k.stays} past stay${k.stays === 1 ? '' : 's'}`, true);
  };
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
    setNGuests(i);
  };
  const namesOnBooking = Array.from({ length: nGuests }, (_, i) => guestAt(i).name).filter(Boolean);
  const onStage = (k: IdSlot, file: StagedFile | null) =>
    setStaged((x) => { const y = { ...x }; if (file) y[k] = file; else delete y[k]; return y; });

  return (
    <FormScroll
      ref={scroller} onSubmit={submit}
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
        <FormCard title="Booking" step={1} i={1}>
          <Two>
            <View style={{ flex: 1 }}>
              <Field label="Property" req err={errs.property}>
                <SelectField title="Property" value={f.property} options={s.props.map((p) => p.name)} onChange={set('property')} />
              </Field>
            </View>
            <View style={{ flex: 1 }}>
              <Field label="Stay unit" hint="The flat they actually get.">
                <TxtInput value={f.stayUnit} onChange={set('stayUnit')} placeholder="e.g. 3028" />
                {/* One tap for the OTHER flat we own — the only value a quick
                    choice can save you typing, and the one the ₹500 split turns
                    on. The box stays plain free text: a third-party flat (2121,
                    3130, 4217) is typed exactly as before, and 2121 is a real
                    flat, not a slip of 2212, so nothing here corrects it. */}
                {otherUnits.length ? (
                  <View style={st.unitChips}>
                    {otherUnits.map((u) => {
                      const on = f.stayUnit.trim() === u.no;
                      return (
                        <TouchableOpacity key={u.no} accessibilityRole="button"
                          style={[st.unitChip, on && st.unitChipOn]}
                          onPress={() => set('stayUnit')(on ? '' : u.no)}>
                          <Text style={[st.unitChipTxt, on && st.unitChipTxtOn]}>{u.name}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                ) : null}
              </Field>
            </View>
          </Two>
          <Two>
            <View style={{ flex: 1 }}>
              <Field label="Booking date" req err={errs.date}>
                <DateField value={f.date} onChange={set('date')} />
              </Field>
            </View>
            <View style={{ flex: 1 }}>
              <Field label="Booking type" req>
                <SelectField title="Booking Type" value={f.type} options={['Stay', 'Resold', 'Pass']}
                  onChange={(v) => setF((p) => ({ ...p, type: v, channel: v === 'Pass' ? 'Pass' : p.channel }))} />
              </Field>
            </View>
          </Two>
          <Field label="Channel">
            <SelectField title="Channel" value={f.channel} options={CHANNELS} onChange={set('channel')} />
          </Field>
          {/* The same column means different things by booking type, so the
              label follows the type instead of staying vague. */}
          <Field
            label={f.type === 'Resold' ? 'Resold to' : 'Referrer / source'}
            hint={f.type === 'Resold' ? 'Who the night went to — shown on the check-in card.' : undefined}
          >
            <TxtInput value={f.referrer} onChange={set('referrer')}
              placeholder={f.type === 'Resold' ? 'e.g. Sudhir Badhana' : 'e.g. GVL Spira · Airbnb - Harsh'} />
          </Field>
        </FormCard>
        </View>

        <FormCard title="Stay dates" step={2} i={2}>
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

        <FormCard title="Guests" step={3} i={3}
          note={`${nGuests} guest${nGuests === 1 ? '' : 's'} · type a name to pick from past stays · ` +
            (editing ? 'ID front is required, back optional' : 'IDs upload when the booking is saved')}>
          {Array.from({ length: nGuests }, (_, i) => {
            const g = guestAt(i);
            const last = i === nGuests - 1 && i > 0;
            return (
              <View key={i} style={st.guest}>
                <View style={st.guestHead}>
                  <View style={st.gNum}><Text style={st.gNumTxt}>{i + 1}</Text></View>
                  <Text style={st.gTitle}>{i === 0 ? 'Primary guest' : `Guest ${i + 1}`}</Text>
                  <View style={{ flex: 1 }} />
                  {last ? (
                    <TouchableOpacity onPress={removeLast} hitSlop={8} accessibilityLabel={`Remove guest ${i + 1}`}>
                      <Text style={st.gRemove}>Remove</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
                <Two>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Field label="Name">
                      <GuestNameInput
                        value={g.name}
                        onChange={(v) => setGuest(i, { name: v })}
                        onPick={(k) => pick(i, k)}
                        dir={dir}
                        exclude={namesOnBooking}
                        placeholder={i === 0 ? 'Primary guest name' : 'Guest name'}
                      />
                    </Field>
                  </View>
                  <View style={{ width: 92 }}>
                    <Field label="Birth yr">
                      <TxtInput value={g.birthYr} onChange={(v) => setGuest(i, { birthYr: v })} placeholder="1998" keyboardType="numeric" />
                    </Field>
                  </View>
                </Two>
                {i === 0 ? (
                  <Two>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Field label="Phone"><TxtInput value={f.phone} onChange={set('phone')} keyboardType="phone-pad" /></Field>
                    </View>
                    <View style={{ width: 118 }}>
                      <Field label="Repeat guest">
                        <SelectField title="Repeat Customer" value={f.repeat || 'No'} options={['No', 'Yes']} onChange={set('repeat')} />
                      </Field>
                    </View>
                  </Two>
                ) : null}
                <IdUploader
                  row={editing ? s.editB!.row : 0}
                  guest="" coGuest="" needsCo={false}
                  only={frontForGuest(i + 1)} compact
                  {...(editing ? {} : { staged, onStage })}
                />
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
              <Field label="Commission (₹)" hint="Auto = paid − net.">
                <TxtInput value={f.commission} onChange={set('commission')} money onFocus={() => revealCard('money')} />
              </Field>
            </View>
            <View style={{ flex: 1 }}>
              <Field label="Pending (₹)" hint="Still to be received.">
                <TxtInput value={f.pending} onChange={set('pending')} money onFocus={() => revealCard('money')} />
              </Field>
            </View>
          </Two>
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
            note={editing ? 'Saved as you tick — not part of “Save changes”.' : 'Steps the property manager will work through for this booking.'}>
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

const st = StyleSheet.create({
  section: { borderTopWidth: 1, borderTopColor: C.hair, paddingTop: 15, marginTop: 6, marginBottom: 4 },
  sTitle: { fontFamily: F.xbold, fontSize: 13, color: C.ink, letterSpacing: 0.3, textTransform: 'uppercase' },
  sNote: { fontFamily: F.med, fontSize: 11.5, color: C.muted, marginTop: 3, lineHeight: 16 },
  two: { flexDirection: 'row', gap: 10 },
  calc: { fontFamily: F.semi, fontSize: 12, color: C.blue2, marginTop: -4, marginBottom: 6 },
  unitChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
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
  guestHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
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
