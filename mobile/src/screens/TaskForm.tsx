import React, { useState } from 'react';
import { BackHandler, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { FormScroll } from '../formkit';
import { C, F } from '../theme';
import { Btn, Panel, confirmDestructive, useToast } from '../ui';
import { DateField, Field, TxtInput } from '../fields';
import { api } from '../api';
import { useStore } from '../store';
import { writeLabels } from './TicketBanner';
import { TaskItem, todayIso } from '../logic';

/* Add / edit one action.
   Lives inside the Action tab as a page rather than as a sixth segment of the
   Add tab: the + that opens it is on the Action tab, and an entry form that
   throws you into a different tab loses the list you were working through.

   Only three fields, and only two of them required. An action nobody can be
   bothered to file is an action that never gets filed. */

export default function TaskForm({ task, pin, onClose, onSaved }: {
  task: TaskItem | null;            // null = new action
  pin: string;
  onClose: () => void;
  /* The raw response, not just "something happened": for a Manager this write
     is a request, and the caller is the one that keeps the receipt on screen
     after this page closes. */
  onSaved: (res: any) => Promise<void> | void;
}) {
  const s = useStore();
  const toast = useToast();
  /* An action is written through the same approval gate as everything else
     now, so the buttons say what pressing them will actually do. */
  const L = writeLabels(s.needsApproval);
  const editing = !!task;
  const [name, setName] = useState(task?.name || '');
  const [end, setEnd] = useState(task?.endIso || todayIso());
  const [desc, setDesc] = useState(task?.desc || '');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  /* Same contract as the detail pages: Android back leaves the page, it does
     not leave the app. */
  React.useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { onClose(); return true; });
    return () => sub.remove();
  }, [onClose]);

  const submit = async () => {
    const d = { name: name.trim(), endDate: end, description: desc };
    if (!d.name) { toast('Action name is required', false); return; }
    if (!d.endDate) { toast('End date is required', false); return; }
    setSaving(true);
    try {
      const res = task
        ? await api.updateTask(pin, task.row, d)
        : await api.addTask(pin, d);
      await onSaved(res);
      onClose();
    } catch (e: any) {
      toast(e?.message || 'Save failed', false);
    } finally {
      setSaving(false);
    }
  };

  const doDelete = async () => {
    if (!task) return;
    setDeleting(true);
    try {
      const res = await api.deleteTask(pin, task.row);
      await onSaved(res);
      onClose();
    } catch (e: any) {
      toast(e?.message || 'Delete failed', false);
    } finally {
      setDeleting(false);
    }
  };

  const del = () => {
    if (!task) return;
    confirmDestructive('Delete action', s.needsApproval
      ? 'Send a request to delete this action? It is removed only once approved.'
      : 'Delete this action permanently? This cannot be undone.',
      doDelete, s.needsApproval ? 'Send request' : 'Delete');
  };

  return (
    <View style={{ flex: 1 }}>
      <View style={st.head}>
        <TouchableOpacity onPress={onClose} style={st.back} activeOpacity={0.6} hitSlop={10}>
          <Text style={st.backTxt}>‹</Text>
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={st.headTitle} numberOfLines={1}>{editing ? 'Edit action' : 'New action'}</Text>
          <Text style={st.headSub}>{editing ? 'Change the wording, the date, or the detail' : 'What needs doing, and by when'}</Text>
        </View>
      </View>
      <FormScroll onSubmit={submit}>
        <Panel>
          <Field label="Action name" req>
            <TxtInput value={name} onChange={setName} placeholder="e.g. Renew the WiFi plan" />
          </Field>
          <Field label="End date" req hint="When it needs to be done by — this is what puts it on the Action tab.">
            <DateField value={end} onChange={setEnd} />
          </Field>
          <Field label="Description" hint="Optional. Editable any time.">
            <TxtInput value={desc} onChange={setDesc} multiline placeholder="Any detail worth remembering…" />
          </Field>

          <View style={{ flexDirection: 'row', gap: 10, marginTop: 18, flexWrap: 'wrap' }}>
            <Btn title={saving ? L.saving : editing ? L.save : (L.add || 'Add action')} onPress={submit} disabled={saving} />
            <Btn title="Cancel" kind="ghost" onPress={onClose} />
            {editing && <Btn title={deleting ? L.deleting : L.del} kind="danger" onPress={del} disabled={deleting} />}
          </View>
        </Panel>
      </FormScroll>
    </View>
  );
}

const st = StyleSheet.create({
  head: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 12, paddingTop: 10, paddingBottom: 12,
    backgroundColor: C.card, borderBottomWidth: 1, borderBottomColor: C.line,
  },
  back: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
  backTxt: { fontSize: 30, lineHeight: 32, color: C.ink, fontFamily: F.med },
  headTitle: { fontFamily: F.xbold, fontSize: 17, color: C.ink },
  headSub: { fontFamily: F.semi, fontSize: 12, marginTop: 1, color: C.muted },
});
