import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { C, F } from '../theme';
import { useStore } from '../store';
import { confirmDestructive, useToast } from '../ui';
import { FormCard, FormFooter, FormHeader, FormScroll } from '../formkit';
import { Field, TxtInput, SelectField, DateField } from '../fields';
import { api } from '../api';
import TicketBanner, { NoAdd, writeLabels } from './TicketBanner';
import { PropertyChecklistEditor } from '../checklist';

const EMPTY = { name: '', id: '', location: '', type: '', status: 'Active', onboarded: '', rent: '', notes: '' };

export default function PropertyForm() {
  const s = useStore();
  const toast = useToast();
  const [f, setF] = useState({ ...EMPTY });
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const set = (k: keyof typeof EMPTY) => (v: string) => setF((p) => ({ ...p, [k]: v }));

  useEffect(() => {
    if (s.editP) {
      /* A sent-back request being edited again lays its values over the record. */
      const p = s.editP.prop ? { ...s.editP.prop, ...(s.editP.draft || {}) } : { ...(s.editP.draft || {}) };
      if (!p.id) p.id = s.editP.origId;
      setF({
        name: p.name || '', id: String(p.id || ''), location: p.location || '', type: p.type || '',
        status: p.status || 'Active', onboarded: p.onboarded || '',
        // `p.rent ? …` turned a legitimate stored 0 into '', which saves back as NULL.
        rent: p.rent === '' || p.rent == null ? '' : String(p.rent),
        notes: p.notes || '',
      });
    } else {
      setF({ ...EMPTY });
    }
  }, [s.editP]);


  /* A sent-back request to create a property, opened again from the Team tab:
     fill the Add form in with what was asked for and keep the request id, so
     submitting revises that request instead of raising a second one. */
  const [resub, setResub] = useState(0);
  const resubTicket = resub ? (s.tickets?.mine || []).find((t) => t.id === resub) || null : null;
  useEffect(() => {
    const nd = s.newDraft;
    if (!nd || nd.kind !== 'property') return;
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
    s.setEditP(null);
    setResub(0);
    setF({ ...EMPTY });
  };

  const submit = async () => {
    /* The receipt for the LAST request is not a report on this one. After a
       failed submit the top of the screen still read "Request #167 sent" while
       the red complaint sat at the foot — one screen saying sent and not-sent
       at once, which was read as "the form keeps my values after sending".
       A new attempt clears the old receipt before it starts. */
    s.setLastSubmit(null);
    if (!f.name) { toast('Property name is required', false); return; }
    setSaving(true);
    try {
      const origId = s.editP?.origId || '';
      const res = origId
        ? await api.updateProperty(s.pin, { ...f, origId })
        : await api.addProperty(s.pin, f, resub);
      toast(res?.message || 'Saved', true);
      /* A new record that became a request has nowhere to be seen yet —
         remember which one, so the form can point at it. */
      if (!s.editP && res?.pendingApproval && res?.ticket) s.setLastSubmit(res.ticket);
      const editing = !!s.editP;
      reset();
      await s.refreshWrite();
      if (editing) s.setLogSeg('prop');
    } catch (e: any) {
      toast(e?.message || 'Save failed', false);
    } finally {
      setSaving(false);
    }
  };

  const del = () => {
    if (!s.editP) return;
    const origId = s.editP.origId;
    confirmDestructive('Delete property', s.needsApproval
      ? 'Send a request to delete this property? It is removed only once approved.'
      : 'Delete this property permanently? Only possible while no booking, expense or stock item uses it.', async () => {
      setDeleting(true);
      s.setLastSubmit(null);
      try {
        const res = await api.deleteProperty(s.pin, origId);
        toast(res?.message || 'Deleted', true);
        reset();
        await s.refreshWrite();
        s.setLogSeg('prop');
      } catch (e: any) {
        toast(e?.message || 'Delete failed', false);
      } finally {
        setDeleting(false);
      }
    }, s.needsApproval ? 'Send request' : 'Delete');
  };

  const editing = !!s.editP;
  const can = { add: s.can('property.add'), upd: s.can('property.update'), del: s.can('property.delete') };
  /* A delete is already waiting on this record. The screen still said
     "Edit Property" with a gold "Submit for approval" under it — the biggest
     button on the page would have replaced the delete with a change, which is
     the opposite of what had just been asked for. It stays available (that IS
     how you take a delete back) but it stops looking like the thing to do. */
  const liveT = editing && s.editP ? s.ticketFor('property', s.editP.origId) : null;
  const pendingDel = !!liveT && liveT.op === 'delete' && liveT.status === 'pending';
  const L = writeLabels(s.needsApproval, resub);
  if (!editing && !can.add) return <NoAdd what="properties" canChange={can.upd || can.del} />;

  return (
    <FormScroll onSubmit={submit}>
      <FormHeader
        title={editing ? 'Edit Property' : resub ? 'Edit Request' : 'Add Property'}
        showSave={editing ? can.upd : can.add}
        saveTitle={saving ? L.saving : pendingDel ? 'Submit a change instead' : editing ? L.save : (L.add || 'Save property')}
        onSave={submit} saveDisabled={saving} saveKind={pendingDel ? 'ghost' : 'primary'}
        clearTitle={editing ? 'Cancel edit' : 'Clear'}
        onClear={() => { reset(); s.setLogSeg('prop'); }}
      />
      <TicketBanner
        kind="property" target={s.editP?.origId} editing={editing} resubmit={resubTicket}
        note={editing ? `Editing this property — “${L.save}” to update, or “Cancel edit” to start fresh.` : undefined}
      />
        <FormCard title="Property" step={1} i={1}>
        <Field label="Property Name" req>
          <TxtInput value={f.name} onChange={set('name')} placeholder="e.g. Riverside 12B" />
        </Field>
        <Field label="Property ID" hint="Used as the unique key.">
          <TxtInput value={f.id} onChange={set('id')} placeholder="auto from name if blank" />
        </Field>
        <Field label="Location"><TxtInput value={f.location} onChange={set('location')} /></Field>
        <Field label="Type"><TxtInput value={f.type} onChange={set('type')} placeholder="e.g. 1BHK" /></Field>
        <Field label="Status">
          <SelectField title="Status" value={f.status} options={['Active', 'Inactive']} onChange={set('status')} />
        </Field>
        </FormCard>
        <FormCard title="Lease" step={2} i={2}>
        <Field label="Onboarded"><DateField value={f.onboarded} onChange={set('onboarded')} allowClear /></Field>
        <Field label="Monthly Rent (₹)"><TxtInput value={f.rent} onChange={set('rent')} money /></Field>
        </FormCard>
        <FormCard title="Notes" step={3} i={3}>
        <Field label="Notes"><TxtInput value={f.notes} onChange={set('notes')} /></Field>
        </FormCard>
        {/* The property's booking checklist. Saved step by step as it is
            edited (not with the form's Save), and keyed by the stored name, so
            it is only offered on a property that already exists. */}
        {editing && s.me?.role === 'Admin' && s.editP?.prop?.name ? (
          <FormCard title="Booking checklist" step={4} i={4}
            note="What the property manager works through for every booking here. Changes apply to upcoming bookings straight away.">
            <PropertyChecklistEditor property={String(s.editP.prop.name)} />
          </FormCard>
        ) : null}
      <FormFooter
        title={editing ? 'Edit Property' : resub ? 'Edit Request' : 'Add Property'}
        showSave={editing ? can.upd : can.add}
        saveTitle={saving ? L.saving : pendingDel ? 'Submit a change instead' : editing ? L.save : (L.add || 'Save property')}
        onSave={submit} saveDisabled={saving} saveKind={pendingDel ? 'ghost' : 'primary'}
        clearTitle={editing ? 'Cancel edit' : 'Clear'}
        onClear={() => { reset(); s.setLogSeg('prop'); }}
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
