import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { C, F } from '../theme';
import { Ticket, TicketKind, useStore } from '../store';
import { Btn } from '../ui';

/* Sits above the buttons of every edit form. Tells a non-Admin, before they
   press anything, that the change is a request — and if this record already
   has one of theirs, where it stands: still waiting, or sent back with the
   manager's comment to act on. */
const NEW_LABEL: Record<TicketKind, string> = {
  booking: 'New bookings', expense: 'New expenses', saving: 'New savings',
  property: 'New properties', inventory: 'New items', stock: 'New stock entries',
  payout: 'Payouts', review: 'Review follow-ups', task: 'New actions', taskdone: 'Actions being ticked off',
};
/* Where the record *would* be once it exists — named so the person stops
   looking for it there. */
const LOG_LABEL: Record<TicketKind, string> = {
  booking: 'booking log', expense: 'expense log', saving: 'savings log',
  property: 'property list', inventory: 'inventory', stock: 'stock log',
  payout: 'Action tab', review: 'booking log', task: 'Action tab', taskdone: 'Action tab',
};

/* The one pattern in this app nobody was ever unsure about is the amber panel
   on a record that has a request against it. A brand-new record has no record
   to open, so the same panel goes on the form that raised it: the request
   stays on screen after the fields blank, says where it is, and opens it. */
function SentPanel({ t }: { t: Ticket }) {
  const s = useStore();
  const who = t.approver || 'an admin';
  return (
    <View style={[st.box, st.pending]}>
      {/* `attempts` starts at 1 and goes up each time the request is revised.
          Saying "sent" after an update made the receipt disagree with the green
          bar, which said "updated", and that was enough to make the person
          check whether they had raised a second one. */}
      <Text style={[st.head, { color: C.amber }]}>
        Request #{t.id} {t.attempts > 1 ? 'updated' : 'sent'} — waiting for {who}
      </Text>
      {!!t.label && <Text style={st.comment} numberOfLines={2}>{t.label}</Text>}
      <Text style={st.body}>
        It is not in the {LOG_LABEL[t.kind] || 'log'} yet and will not be until {who} approves it.
      </Text>
      <View style={st.sentRow}>
        <Btn title={`View request #${t.id}`} kind="mini" onPress={() => s.openMyRequests(t.id)} />
        <Btn title="Dismiss" kind="mini" onPress={() => s.setLastSubmit(null)} />
      </View>
    </View>
  );
}

export default function TicketBanner({ kind, target, editing, resubmit, note }: {
  kind: TicketKind; target: string | number | null | undefined; editing: boolean;
  /* Set while an Add form is filling in a new-record request that was sent back. */
  resubmit?: Ticket | null;
  /* The "you are editing X" sentence. It used to be its own amber panel above
     this one, so an edit with a request against it showed TWO amber panels
     saying overlapping things. It belongs to this panel: when there is a
     request to report, that report is the better sentence and wins; when there
     is not, this is what the panel says. */
  note?: string;
}) {
  const s = useStore();
  const approverOf = (t?: Ticket | null) => (t && t.approver) || (s.me?.managerName && s.me.managerName !== 'Any admin' ? s.me.managerName : 'an admin');
  /* The request this form raised a moment ago, while it is still live. */
  const sent = s.lastSubmit
    ? s.myLive.find((t) => t.id === s.lastSubmit && t.kind === kind) || null
    : null;
  if (!editing) {
    /* Revising a request beats the receipt for the request being revised —
       otherwise the form says "sent" while you are editing it. */
    if (resubmit) {
      /* Still waiting, not sent back: the same words as the amber panel on a
         record that has a request against it, because it is the same
         situation — and it must be obvious that submitting revises this
         request rather than raising a second one. */
      if (resubmit.status === 'pending') {
        return (
          <View style={[st.box, st.pending]}>
            <Text style={[st.head, { color: C.amber }]}>You are editing request #{resubmit.id}, which is waiting for approval</Text>
            <Text style={st.body}>
              The form shows the values you asked for. Submitting updates request #{resubmit.id} — it does not
              raise a second one. Nothing is added until {approverOf(resubmit)} approves it.
            </Text>
          </View>
        );
      }
      return (
        <View style={[st.box, st.open]}>
          <Text style={[st.head, { color: C.red }]}>Request #{resubmit.id} was sent back{resubmit.reviewedBy ? ' by ' + resubmit.reviewedBy : ''}</Text>
          {!!resubmit.comment && <Text style={st.comment}>“{resubmit.comment}”</Text>}
          <Text style={st.body}>Fix the values below and submit again — it updates request #{resubmit.id} and goes back to {approverOf(resubmit)} for approval.</Text>
        </View>
      );
    }
    if (sent) return <SentPanel t={sent} />;
    if (s.needsApproval) {
      return <Text style={st.note}>{NEW_LABEL[kind]} are sent to {approverOf()} for approval — nothing is added until it is approved.</Text>;
    }
    return null;
  }
  if (target === null || target === undefined || target === '') return null;
  const t = s.ticketFor(kind, target);
  const approver = s.me?.managerName && s.me.managerName !== 'Any admin' ? s.me.managerName : 'an admin';

  if (t && t.status === 'open') {
    return (
      <View style={[st.box, st.open]}>
        <Text style={[st.head, { color: C.red }]}>Request #{t.id} was sent back{t.reviewedBy ? ' by ' + t.reviewedBy : ''}</Text>
        <Text style={st.comment}>“{t.comment}”</Text>
        <Text style={st.body}>Fix the values below and submit again — it goes back to {approver} for approval.</Text>
      </View>
    );
  }
  if (t && t.status === 'pending') {
    return (
      <View style={[st.box, st.pending]}>
        <Text style={[st.head, { color: C.amber }]}>Request #{t.id} is waiting for approval</Text>
        <Text style={st.body}>
          {t.op === 'delete'
            ? `Nothing is deleted until ${t.approver || approver} approves it. Submitting a change instead replaces the delete request.`
            : `The form shows the values you asked for. Nothing changes until ${t.approver || approver} approves — submit again to update the request.`}
        </Text>
      </View>
    );
  }
  if (note) {
    return (
      <View style={[st.box, st.pending]}>
        <Text style={[st.head, { color: C.amber }]}>{note}</Text>
        {s.needsApproval && (
          <Text style={st.body}>Changes and deletes here are sent to {approver} for approval before they apply.</Text>
        )}
      </View>
    );
  }
  if (s.needsApproval) {
    return (
      <Text style={st.note}>Changes and deletes here are sent to {approver} for approval before they apply.</Text>
    );
  }
  return null;
}

/* Shown in place of an Add form the role has no add right for. The log below
   it stays, so the records can still be opened. */
export function NoAdd({ what, canChange }: { what: string; canChange: boolean }) {
  return (
    <View style={{ padding: 14 }}>
      <View style={st.noAdd}>
        <Text style={st.head}>Your role can't add {what}</Text>
        <Text style={st.body}>
          {canChange
            ? `Tap a row in the log below to open it and request a change.`
            : `You can browse the log below. Ask an admin if you need to add ${what}.`}
        </Text>
      </View>
    </View>
  );
}

/* Button wording follows who is pressing it: an Admin saves, anyone else asks.
   `resub` = revising a request already raised for a record that does not exist
   yet. The button has to say so: "Submit for approval" on a form headed "Add
   Booking" reads as a second booking, and that is how one guest ended up
   requested twice at two different amounts. */
export function writeLabels(needsApproval: boolean, resub = 0) {
  if (needsApproval && resub) {
    return {
      save: 'Update request #' + resub, add: 'Update request #' + resub,
      saving: 'Updating…', del: 'Request delete', deleting: 'Sending…',
    };
  }
  return needsApproval
    ? { save: 'Submit for approval', add: 'Submit for approval', saving: 'Submitting…', del: 'Request delete', deleting: 'Sending…' }
    : { save: 'Save changes', add: '', saving: 'Saving…', del: 'Delete', deleting: 'Deleting…' };
}

const st = StyleSheet.create({
  box: { borderWidth: 1, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 13, marginTop: 10 },
  open: { backgroundColor: C.redbg, borderColor: '#e6c3bc' },
  pending: { backgroundColor: C.amberbg, borderColor: '#e9d2a3' },
  head: { fontFamily: F.bold, fontSize: 13 },
  comment: { fontFamily: F.semi, fontSize: 14, color: C.ink, marginTop: 6, lineHeight: 20 },
  body: { fontFamily: F.med, fontSize: 12, color: C.bark, marginTop: 5, lineHeight: 17 },
  note: { fontFamily: F.med, fontSize: 12, color: C.muted, marginTop: 10, lineHeight: 17 },
  sentRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
  noAdd: { backgroundColor: C.card, borderWidth: 1, borderColor: C.line, borderRadius: 20, padding: 16 },
});
