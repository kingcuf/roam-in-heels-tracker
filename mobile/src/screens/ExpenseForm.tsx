import React, { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { C, F } from '../theme';
import { useStore } from '../store';
import { confirmDestructive, useToast } from '../ui';
import { FormCard, FormFooter, FormHeader, FormScroll } from '../formkit';
import { Field, TxtInput, SelectField, DateField, MonthField } from '../fields';
import { api } from '../api';
import { thisMonthIso, todayIso } from '../logic';
import { isMoneyText, moneyRule } from '../money';
import TicketBanner, { NoAdd, writeLabels } from './TicketBanner';

const CATEGORIES = [
  'Rent', 'Caretaker', 'Police charge', 'Laundry', 'Wifi', 'Electricity bill', 'Re-stock',
  'Kitchen', 'Cleaning', 'Decor', 'Linen', 'Utilities', 'Subscription', 'Transportation',
  'Brokerage', 'Compliance', 'Setup', 'Booking Costs', 'Deposit', 'Other',
];
/* Field names as the person reads them, for "Still needed: …". */
const LABEL: Record<string, string> = {
  property: 'Property', category: 'Category', item: 'Item / Description',
  amount: 'Amount', expenseMonth: 'Expense Month',
};
const TYPES = ['One-time', 'Recurring', 'Operating', 'Deposit'];
const STATUSES = ['Bought', 'Ordered', 'Pending'];

/* Category starts EMPTY and is required.
   It used to default to 'Rent' — the first entry in the list — so anything
   filed without touching it (a gas-cylinder refill, for one) was recorded as
   rent, silently, with no second glance anywhere in the app. 'Other' would be
   just as wrong and harder to spot later, so nothing is pre-chosen: the form
   asks, once, and only when it has been left blank. */
const EMPTY = {
  property: '', expenseMonth: '', date: '', category: '', item: '', amount: '',
  type: 'One-time', refundable: 'No', quantity: '', vendor: '', status: 'Bought',
  notes: '', initInvest: 'No',
};

export default function ExpenseForm() {
  const s = useStore();
  const toast = useToast();
  const [f, setF] = useState({ ...EMPTY });
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  /* Which fields are complaining, by field. Round 2 put one complaint at a time
     in a red bar at the FOOT of the screen while the field it named sat at the
     top and stayed plain grey — so reading the complaint and finding the box
     were two separate jobs, and fixing one only revealed the next. Everything
     that is wrong is now said at once, on the fields themselves. */
  type Errs = Partial<Record<keyof typeof EMPTY, string>>;
  const [errs, setErrs] = useState<Errs>({});
  const scroller = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const set = (k: keyof typeof EMPTY) => (v: string) => {
    setF((p) => ({ ...p, [k]: v }));
    setErrs((e) => (e[k] ? { ...e, [k]: undefined } : e));
  };

  useEffect(() => {
    if (s.editE) {
      const c = s.editE.cells;
      const base = {
        /* String()-wrapped for the same reason as BookingForm: the worker sends
           numeric-looking text back as a number, and a raw number in a TextInput
           (or a later .trim()) breaks the form. */
        property: String(c[3] ?? ''), expenseMonth: String(c[1] ?? '').slice(0, 7), date: String(c[0] ?? ''),
        category: c[4] || 'Other', item: String(c[2] ?? ''), amount: String(c[6] ?? ''),
        type: c[7] || 'One-time', refundable: c[9] || 'No', quantity: String(c[5] ?? ''),
        vendor: String(c[10] ?? ''), status: c[8] || 'Bought', notes: String(c[11] ?? ''),
        initInvest: String(c[12] ?? '').trim() === '1' || String(c[12] ?? '').toLowerCase() === 'yes' ? 'Yes' : 'No',
      };
      /* A sent-back request being edited again: its values over the record. */
      const dr = s.editE.draft;
      if (dr) for (const k of Object.keys(EMPTY) as (keyof typeof EMPTY)[]) {
        if (dr[k] === undefined || dr[k] === null) continue;
        (base as any)[k] = k === 'initInvest' ? (String(dr[k]) === '1' || dr[k] === true ? 'Yes' : 'No')
          : k === 'expenseMonth' ? String(dr[k]).slice(0, 7) : String(dr[k]);
      }
      setF(base);
    } else {
      setF((p) => ({
        ...EMPTY,
        date: todayIso(),
        expenseMonth: thisMonthIso(),
        property: p.property || s.props[0]?.name || '',
      }));
    }
  }, [s.editE, s.props.length]);


  /* A sent-back request to create a expense, opened again from the Team tab:
     fill the Add form in with what was asked for and keep the request id, so
     submitting revises that request instead of raising a second one. */
  const [resub, setResub] = useState(0);
  const resubTicket = resub ? (s.tickets?.mine || []).find((t) => t.id === resub) || null : null;
  useEffect(() => {
    const nd = s.newDraft;
    if (!nd || nd.kind !== 'expense') return;
    s.setNewDraft(null);
    setF((p) => {
      const n: any = { ...p };
      for (const k of Object.keys(EMPTY)) {
        const v = (nd.payload || {})[k];
        if (v !== undefined && v !== null) n[k] = k === 'initInvest' ? (String(v) === '1' || v === true ? 'Yes' : 'No') : String(v);
      }
      return n;
    });
    setResub(nd.ticket);
  }, [s.newDraft]);

  const reset = () => {
    s.setEditE(null);
    setResub(0);
    setErrs({});
    setF({
      ...EMPTY, date: todayIso(), expenseMonth: thisMonthIso(),
      property: s.props[0]?.name || '',
    });
  };

  const submit = async () => {
    /* The receipt for the LAST request is not a report on this one. After a
       failed submit the top of the screen still read "Request #167 sent" while
       the red complaint sat at the foot — one screen saying sent and not-sent
       at once, which was read as "the form keeps my values after sending".
       A new attempt clears the old receipt before it starts. */
    s.setLastSubmit(null);
    const d = { ...f, initInvest: f.initInvest === 'Yes' ? '1' : '' };
    const e: Errs = {};
    if (!d.property) e.property = 'Pick the property this cost belongs to.';
    if (!d.category) e.category = 'Pick a category for this expense.';
    if (!d.item) e.item = 'Say what this was for.';
    if (d.amount === '') e.amount = 'Enter the amount.';
    else if (!isMoneyText(d.amount)) e.amount = moneyRule('Amount');
    if (!d.expenseMonth) e.expenseMonth = 'Pick the month this cost belongs to.';
    setErrs(e);
    const missing = (Object.keys(e) as (keyof typeof EMPTY)[]).map((k) => LABEL[k]);
    if (missing.length) {
      toast('Still needed: ' + missing.join(', '), false);
      /* Every required field is in the first card, so the top of the form is
         where the red is. Going there beats asking the person to find it. */
      scroller.current?.scrollTo({ y: 0, animated: true });
      return;
    }
    setSaving(true);
    try {
      const res = s.editE
        ? await api.updateExpense(s.pin, s.editE.row, d)
        : await api.addExpense(s.pin, d, resub);
      toast(res?.message || 'Saved', true);
      /* A new record that became a request has nowhere to be seen yet —
         remember which one, so the form can point at it. */
      if (!s.editE && res?.pendingApproval && res?.ticket) s.setLastSubmit(res.ticket);
      const from = s.editE?.from;
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
    if (!s.editE) return;
    confirmDestructive('Delete expense', s.needsApproval
      ? 'Send a request to delete this expense? It is removed only once approved.'
      : 'Delete this expense permanently? This cannot be undone.', async () => {
          setDeleting(true);
          s.setLastSubmit(null);
          try {
            const res = await api.deleteExpense(s.pin, s.editE!.row);
            toast(res?.message || 'Deleted', true);
            const from = s.editE!.from;
            /* A requested delete deletes nothing yet. Clearing the form and
               dropping the person on a blank Add expense left them with no way to
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

  const editing = !!s.editE;
  const can = { add: s.can('expense.add'), upd: s.can('expense.update'), del: s.can('expense.delete') };
  /* A delete is already waiting on this record. The screen still said
     "Edit Expense" with a gold "Submit for approval" under it — the biggest
     button on the page would have replaced the delete with a change, which is
     the opposite of what had just been asked for. It stays available (that IS
     how you take a delete back) but it stops looking like the thing to do. */
  const liveT = editing && s.editE ? s.ticketFor('expense', s.editE.row) : null;
  const pendingDel = !!liveT && liveT.op === 'delete' && liveT.status === 'pending';
  const L = writeLabels(s.needsApproval, resub);
  if (!editing && !can.add) return <NoAdd what="expenses" canChange={can.upd || can.del} />;

  return (
    <FormScroll ref={scroller} onSubmit={submit}>
      <FormHeader
        title={editing ? 'Edit Expense' : resub ? 'Edit Request' : 'Add Expense'}
        showSave={editing ? can.upd : can.add}
        saveTitle={saving ? L.saving : pendingDel ? 'Submit a change instead' : editing ? L.save : (L.add || 'Save expense')}
        onSave={submit} saveDisabled={saving} saveKind={pendingDel ? 'ghost' : 'primary'}
        clearTitle={editing ? 'Cancel edit' : 'Clear'}
        onClear={() => { const from = s.editE?.from; reset(); if (from) s.setLogSeg(from); }}
      />
      <TicketBanner
        kind="expense" target={s.editE?.row} editing={editing} resubmit={resubTicket}
        note={editing ? `Editing this expense — “${L.save}” to update, or “Cancel edit” to start fresh.` : undefined}
      />
        <FormCard title="Expense" step={1} i={1}>
        <Field label="Property" req err={errs.property}>
          <SelectField title="Property" value={f.property} options={s.props.map((p) => p.name)} onChange={set('property')} />
        </Field>
        <Field label="Category" req err={errs.category}>
          <SelectField title="Category" value={f.category} options={CATEGORIES} onChange={set('category')} />
        </Field>
        <Field label="Item / Description" req err={errs.item}>
          <TxtInput value={f.item} onChange={set('item')} placeholder="e.g. Monthly rent" />
        </Field>
        <Field label="Amount (₹)" req err={errs.amount}>
          <TxtInput value={f.amount} onChange={set('amount')} money />
        </Field>
        <Field label="Type" req>
          <SelectField title="Type" value={f.type} options={TYPES}
            onChange={(v) => setF((p) => ({ ...p, type: v, refundable: v === 'Deposit' ? 'Yes' : 'No' }))} />
        </Field>
        </FormCard>
        <FormCard title="When" step={2} i={2}>
        <Field label="Expense Month" req hint="Month this cost belongs to (accrual)." err={errs.expenseMonth}>
          <MonthField value={f.expenseMonth} onChange={set('expenseMonth')} />
        </Field>
        <Field label="Transaction Date" hint="When it's actually paid (optional).">
          <DateField value={f.date} onChange={set('date')} allowClear />
        </Field>
        </FormCard>
        <FormCard title="Details" step={3} i={3}>
        <Field label="Refundable" hint="Refundable = excluded from expense (memo).">
          <SelectField title="Refundable" value={f.refundable} options={['No', 'Yes']} onChange={set('refundable')} />
        </Field>
        <Field label="Quantity"><TxtInput value={f.quantity} onChange={set('quantity')} money /></Field>
        <Field label="Vendor"><TxtInput value={f.vendor} onChange={set('vendor')} /></Field>
        <Field label="Status">
          <SelectField title="Status" value={f.status} options={STATUSES} onChange={set('status')} />
        </Field>
        <Field label="Initial Investment" hint="Setup capital — excluded from bank balance.">
          <SelectField title="Initial Investment" value={f.initInvest} options={['No', 'Yes']} onChange={set('initInvest')} />
        </Field>
        </FormCard>
        <FormCard title="Notes" step={4} i={4}>
        <Field label="Notes"><TxtInput value={f.notes} onChange={set('notes')} /></Field>
        </FormCard>
      <FormFooter
        title={editing ? 'Edit Expense' : resub ? 'Edit Request' : 'Add Expense'}
        showSave={editing ? can.upd : can.add}
        saveTitle={saving ? L.saving : pendingDel ? 'Submit a change instead' : editing ? L.save : (L.add || 'Save expense')}
        onSave={submit} saveDisabled={saving} saveKind={pendingDel ? 'ghost' : 'primary'}
        clearTitle={editing ? 'Cancel edit' : 'Clear'}
        onClear={() => { const from = s.editE?.from; reset(); if (from) s.setLogSeg(from); }}
        onDelete={editing && can.del ? del : undefined}
        deleteTitle={deleting ? L.deleting : L.del} deleteDisabled={deleting}
      />
    </FormScroll>
  );
}

const st = StyleSheet.create({
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 8 },
  h2: { fontSize: 25, color: C.ink, fontFamily: F.xbold, letterSpacing: -0.6 },
  editMsg: {
    backgroundColor: C.amberbg, borderWidth: 1, borderColor: '#e9d2a3', borderRadius: 10,
    paddingVertical: 9, paddingHorizontal: 13, marginTop: 8,
  },
});
