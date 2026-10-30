import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { C, F } from '../theme';
import { useStore } from '../store';
import { Btn, confirmDestructive, useToast } from '../ui';
import { FormCard, FormFooter, FormHeader, FormScroll } from '../formkit';
import { Field, TxtInput, SelectField, DateField } from '../fields';
import { api } from '../api';
import { todayIso } from '../logic';
import TicketBanner, { NoAdd, writeLabels } from './TicketBanner';

const SCHEMES = ['FDs', 'Mutual Funds', 'Stocks', 'Bonds', 'Other'];
const PLATFORMS = ['Slice', 'Groww', 'ET Money', 'Grip Invest', 'Others'];
const STATUSES = ['Active', 'Matured', 'Withdrawn'];

const EMPTY = {
  date: '', amount: '', scheme: 'FDs', platform: 'Groww', status: 'Active',
  returns: '', notes: '', exitDate: '',
};

export default function SavingForm() {
  const s = useStore();
  const toast = useToast();
  const [f, setF] = useState({ ...EMPTY });
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const set = (k: keyof typeof EMPTY) => (v: string) => setF((p) => ({ ...p, [k]: v }));

  // Savings cells: 0 Date · 1 Amount · 2 Scheme · 3 Platform · 4 Status · 5 Amount Received · 6 Notes · 7 Created At · 8 Exit Date
  useEffect(() => {
    if (s.editS) {
      const c = s.editS.cells;
      const base: any = {
        date: c[0] || '', amount: String(c[1] ?? ''), scheme: c[2] || 'FDs',
        platform: c[3] || 'Groww', status: c[4] || 'Active',
        returns: String(c[5] ?? ''), notes: c[6] || '', exitDate: c[8] || '',
      };
      /* A sent-back request being edited again: its values over the record. */
      const dr = s.editS.draft;
      if (dr) for (const k of Object.keys(EMPTY)) if (dr[k] !== undefined && dr[k] !== null) base[k] = String(dr[k]);
      setF(base);
    } else {
      setF({ ...EMPTY, date: todayIso() });
    }
  }, [s.editS]);


  /* A sent-back request to create a saving, opened again from the Team tab:
     fill the Add form in with what was asked for and keep the request id, so
     submitting revises that request instead of raising a second one. */
  const [resub, setResub] = useState(0);
  const resubTicket = resub ? (s.tickets?.mine || []).find((t) => t.id === resub) || null : null;
  useEffect(() => {
    const nd = s.newDraft;
    if (!nd || nd.kind !== 'saving') return;
    s.setNewDraft(null);
    setF((p) => {
      const n: any = { ...p };
      for (const k of Object.keys(EMPTY)) {
        const v = (nd.payload || {})[k];
        if (v !== undefined && v !== null) n[k] = String(v);
      }
      return n;
    });
    setResub(nd.ticket);
  }, [s.newDraft]);

  const reset = () => {
    s.setEditS(null);
    setResub(0);
    setF({ ...EMPTY, date: todayIso() });
  };

  const submit = async () => {
    /* The receipt for the LAST request is not a report on this one. After a
       failed submit the top of the screen still read "Request #167 sent" while
       the red complaint sat at the foot — one screen saying sent and not-sent
       at once, which was read as "the form keeps my values after sending".
       A new attempt clears the old receipt before it starts. */
    s.setLastSubmit(null);
    const d = { ...f };
    if (d.status === 'Active') { d.returns = ''; d.exitDate = ''; }
    if (!d.date) { toast('Created date is required', false); return; }
    if (d.amount === '' || !(Number(d.amount) > 0)) { toast('Amount must be greater than 0', false); return; }
    if (d.status !== 'Active') {
      if (!d.exitDate) { toast('Exit date is required', false); return; }
      if (d.exitDate < d.date) { toast('Exit date cannot be before the investment date', false); return; }
      if (d.returns === '' || !(Number(d.returns) >= 0)) { toast('Enter the amount received back', false); return; }
    }
    setSaving(true);
    try {
      const res = s.editS
        ? await api.updateSaving(s.pin, s.editS.row, d)
        : await api.addSaving(s.pin, d, resub);
      toast(res?.message || 'Saved', true);
      /* A new record that became a request has nowhere to be seen yet —
         remember which one, so the form can point at it. */
      if (!s.editS && res?.pendingApproval && res?.ticket) s.setLastSubmit(res.ticket);
      const from = s.editS?.from;
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
    if (!s.editS) return;
    confirmDestructive('Delete saving', s.needsApproval
      ? 'Send a request to delete this saving? It is removed only once approved.'
      : 'Delete this saving permanently? This cannot be undone.', async () => {
          setDeleting(true);
          s.setLastSubmit(null);
          try {
            const res = await api.deleteSaving(s.pin, s.editS!.row);
            toast(res?.message || 'Deleted', true);
            const from = s.editS!.from;
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

  const editing = !!s.editS;
  /* Exiting is the common change to an investment, so it gets a button rather
     than hiding behind the Status picker: FDs mature, everything else is
     withdrawn. Prefills today and the principal — the user corrects the amount
     to what actually landed in the bank. */
  const startExit = () => setF((p) => ({
    ...p, status: p.scheme === 'FDs' ? 'Matured' : 'Withdrawn',
    exitDate: p.exitDate || todayIso(), returns: p.returns || p.amount,
  }));
  const gain = f.status !== 'Active' && f.returns !== '' && f.amount !== ''
    ? Number(f.returns) - Number(f.amount) : null;
  const can = { add: s.can('saving.add'), upd: s.can('saving.update'), del: s.can('saving.delete') };
  /* A delete is already waiting on this record. The screen still said
     "Edit Saving" with a gold "Submit for approval" under it — the biggest
     button on the page would have replaced the delete with a change, which is
     the opposite of what had just been asked for. It stays available (that IS
     how you take a delete back) but it stops looking like the thing to do. */
  const liveT = editing && s.editS ? s.ticketFor('saving', s.editS.row) : null;
  const pendingDel = !!liveT && liveT.op === 'delete' && liveT.status === 'pending';
  const L = writeLabels(s.needsApproval, resub);
  if (!editing && !can.add) return <NoAdd what="savings" canChange={can.upd || can.del} />;

  return (
    <FormScroll onSubmit={submit}>
      <FormHeader
        title={editing ? 'Edit Saving' : resub ? 'Edit Request' : 'Add Saving'}
        showSave={editing ? can.upd : can.add}
        saveTitle={saving ? L.saving : pendingDel ? 'Submit a change instead' : editing ? L.save : (L.add || 'Save saving')}
        onSave={submit} saveDisabled={saving} saveKind={pendingDel ? 'ghost' : 'primary'}
        clearTitle={editing ? 'Cancel edit' : 'Clear'}
        onClear={() => { const from = s.editS?.from; reset(); if (from) s.setLogSeg(from); }}
      />
      <TicketBanner
        kind="saving" target={s.editS?.row} editing={editing} resubmit={resubTicket}
        note={editing ? `Editing this saving — “${L.save}” to update, or “Cancel edit” to start fresh.` : undefined}
      />
        <FormCard title="Investment" step={1} i={1}>
        <Field label="Created Date" req>
          <DateField value={f.date} onChange={set('date')} />
        </Field>
        <Field label="Total Amount (₹)" req>
          <TxtInput value={f.amount} onChange={set('amount')} money />
        </Field>
        <Field label="Saving Scheme">
          <SelectField title="Saving Scheme" value={f.scheme} options={SCHEMES} onChange={set('scheme')} />
        </Field>
        <Field label="Platform">
          <SelectField title="Platform" value={f.platform} options={PLATFORMS} onChange={set('platform')} />
        </Field>
        </FormCard>
        <FormCard title="Status" step={2} i={2}>
        {editing && f.status === 'Active' && (
          <Btn title="Exit investment" kind="ghost" onPress={startExit} style={{ marginBottom: 12 }} />
        )}
        <Field label="Status">
          <SelectField title="Status" value={f.status} options={STATUSES}
            onChange={(v) => setF((p) => v === 'Active'
              ? { ...p, status: v, returns: '', exitDate: '' }
              : { ...p, status: v, exitDate: p.exitDate || todayIso(), returns: p.returns || p.amount })} />
        </Field>
        {f.status !== 'Active' && (
          <>
            <Field label="Exit Date" req hint="The day the money came back to the bank.">
              <DateField value={f.exitDate} onChange={set('exitDate')} />
            </Field>
            <Field label="Amount Received (₹)" req
              hint={'Total credited back to the bank — principal plus gain (or less, on a loss). It is added to the bank balance.'
                + (gain === null || isNaN(gain) ? '' : gain >= 0 ? `  Gain: ₹${gain.toLocaleString('en-IN')}` : `  Loss: ₹${(-gain).toLocaleString('en-IN')}`)}>
              <TxtInput value={f.returns} onChange={set('returns')} money />
            </Field>
          </>
        )}
        </FormCard>
        <FormCard title="Notes" step={3} i={3}>
        <Field label="Notes / Ref No"><TxtInput value={f.notes} onChange={set('notes')} /></Field>
        </FormCard>
      <FormFooter
        title={editing ? 'Edit Saving' : resub ? 'Edit Request' : 'Add Saving'}
        showSave={editing ? can.upd : can.add}
        saveTitle={saving ? L.saving : pendingDel ? 'Submit a change instead' : editing ? L.save : (L.add || 'Save saving')}
        onSave={submit} saveDisabled={saving} saveKind={pendingDel ? 'ghost' : 'primary'}
        clearTitle={editing ? 'Cancel edit' : 'Clear'}
        onClear={() => { const from = s.editS?.from; reset(); if (from) s.setLogSeg(from); }}
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
