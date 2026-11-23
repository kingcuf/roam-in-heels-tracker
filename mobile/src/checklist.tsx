import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { C, F } from './theme';
import { useStore } from './store';
import { api } from './api';
import {
  CHECKLIST_PRESETS, CHECKLIST_STAGES, ChecklistEntry, ChecklistStage, checklistFor, propertySteps, stayPropOf,
} from './logic';
import { Btn, confirmDestructive, useToast } from './ui';

/* ── Booking checklists (see checklistFor in logic.ts for the rules) ──
   Three surfaces, one look:
     * BookingChecklist — on the booking page: tick / untick, one-off steps.
     * PropertyChecklistEditor — Admin, on the property: the property's steps.
     * NewBookingSteps — on the new-booking form: preview + one-off steps,
       sent with the booking. */

const stageLabel = (k: string) => (CHECKLIST_STAGES.find((x) => x.key === k) || { label: k }).label;
const when = (iso: string) => {
  const d = iso ? new Date(iso) : null;
  if (!d || isNaN(d.getTime())) return '';
  const m = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()];
  let h = d.getHours(); const ap = h >= 12 ? 'pm' : 'am'; h = h % 12 || 12;
  return d.getDate() + ' ' + m + ', ' + h + ':' + String(d.getMinutes()).padStart(2, '0') + ' ' + ap;
};

function StageChips({ value, onChange }: { value: ChecklistStage; onChange: (s: ChecklistStage) => void }) {
  return (
    <View style={st.chips}>
      {CHECKLIST_STAGES.map((sg) => (
        <TouchableOpacity key={sg.key} onPress={() => onChange(sg.key)} activeOpacity={0.7}
          style={[st.chip, value === sg.key && st.chipOn]} accessibilityState={{ selected: value === sg.key }}>
          <Text style={[st.chipTxt, value === sg.key && st.chipTxtOn]}>{sg.label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

/* A step name + stage + Add. Used for one-off and custom ("Other") steps. */
function AddStep({ onAdd, busy, placeholder }: {
  onAdd: (label: string, stage: ChecklistStage) => Promise<boolean> | boolean; busy?: boolean; placeholder: string;
}) {
  const [label, setLabel] = useState('');
  const [stage, setStage] = useState<ChecklistStage>('checkin');
  const ok = label.trim().length > 0 && !busy;
  const go = async () => { if (ok && (await onAdd(label.trim(), stage))) setLabel(''); };
  return (
    <View style={st.addBox}>
      <TextInput
        value={label} onChangeText={setLabel} placeholder={placeholder} placeholderTextColor={C.muted}
        style={st.input} maxLength={120} onSubmitEditing={go} returnKeyType="done"
      />
      <Text style={st.addLbl}>When</Text>
      <StageChips value={stage} onChange={setStage} />
      <Btn kind="mini" title={busy ? 'Adding…' : '+ Add step'} onPress={go} disabled={!ok} style={{ alignSelf: 'flex-start', marginTop: 8 }} />
    </View>
  );
}

function Check({ on, linked }: { on: boolean; linked?: boolean }) {
  return (
    <View style={[st.box, on && st.boxOn, linked && !on && st.boxLinked]}>
      {on ? <Text style={st.tick}>✓</Text> : null}
    </View>
  );
}

/* ── on the booking page ── */
export function BookingChecklist({ row, bare }: { row: number; bare?: boolean }) {
  const s = useStore();
  const toast = useToast();
  /* Optimistic ticks until the next logs load confirms them. */
  const [pending, setPending] = useState<Record<number, boolean>>({});
  const [adding, setAdding] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  useEffect(() => { setPending({}); }, [s.logs]);
  const o = (s.logs?.bookings?.rows || []).find((x) => x.r === row) || null;
  const data = s.logs?.checklist;
  const entries = useMemo(() => (o ? checklistFor(o, data, s.idMap as any) : []), [o, data, s.idMap]);
  if (!o || !data) return null;   // an API that predates checklists sends no block

  const canTick = s.can('action.manage');
  const canBook = s.can('booking.add') || s.can('booking.update');
  const isDone = (e: ChecklistEntry) => (e.id in pending ? pending[e.id] : e.done);
  const doneN = entries.filter(isDone).length;
  const prop = stayPropOf(o.cells);

  const toggle = async (e: ChecklistEntry) => {
    if (e.linked) { toast(e.linked, true); return; }
    if (!canTick) { toast('Your role can’t tick checklist steps', false); return; }
    const next = !isDone(e);
    setPending((p) => ({ ...p, [e.id]: next }));
    try {
      await api.tickChecklist(s.pin, row, e.id, next);
      s.reloadLogs();
    } catch (err: any) {
      setPending((p) => { const n = { ...p }; delete n[e.id]; return n; });
      toast(String(err?.message || err), false);
    }
  };
  const addOwn = async (label: string, stage: ChecklistStage) => {
    setAdding(true);
    try {
      await api.addChecklistItem(s.pin, { scope: 'booking', row, label, stage });
      await s.reloadLogs();
      return true;
    } catch (err: any) { toast(String(err?.message || err), false); return false; }
    finally { setAdding(false); }
  };
  const removeOwn = (e: ChecklistEntry) => confirmDestructive(
    'Remove this step?', '“' + e.label + '” will be removed from this booking’s checklist.',
    async () => {
      try { await api.removeChecklistItem(s.pin, e.id); s.reloadLogs(); }
      catch (err: any) { toast(String(err?.message || err), false); }
    }, 'Remove');

  return (
    <View style={bare ? null : st.wrap}>
      <View style={st.head}>
        <Text style={st.title}>{bare ? '' : 'Checklist'}</Text>
        {entries.length ? <Text style={[st.count, doneN === entries.length && { color: C.green }]}>{doneN + ' of ' + entries.length + ' done'}</Text> : null}
      </View>
      {entries.length ? (
        <View style={st.bar}><View style={[st.barFill, { width: ((doneN / entries.length) * 100 + '%') as any }, doneN === entries.length && { backgroundColor: C.green }]} /></View>
      ) : (
        <Text style={st.empty}>
          {'No checklist set up for ' + (prop || 'this property') + '.' + (s.me?.role === 'Admin' ? ' Add one under Add → Property.' : '')}
        </Text>
      )}

      {CHECKLIST_STAGES.map((sg) => {
        const list = entries.filter((e) => e.stage === sg.key);
        if (!list.length) return null;
        return (
          <View key={sg.key}>
            <Text style={st.stage}>{sg.label}</Text>
            {list.map((e) => {
              const on = isDone(e);
              const sub = e.linked
                ? e.note
                : on && e.doneBy && !(e.id in pending) ? 'Done by ' + e.doneBy + (e.doneAt ? ' · ' + when(e.doneAt) : '') : e.own ? 'Only for this booking' : '';
              return (
                <View key={e.id} style={st.item}>
                  <TouchableOpacity style={st.itemMain} onPress={() => toggle(e)} activeOpacity={0.6}
                    accessibilityRole="checkbox" accessibilityState={{ checked: on }}>
                    <Check on={on} linked={!!e.linked} />
                    <View style={{ flex: 1 }}>
                      <Text style={[st.label, on && st.labelDone]}>{e.label}</Text>
                      {sub ? <Text style={st.sub}>{sub}{e.linked ? '  ·  auto' : ''}</Text> : null}
                    </View>
                  </TouchableOpacity>
                  {e.own && canBook ? (
                    <TouchableOpacity onPress={() => removeOwn(e)} hitSlop={10} accessibilityLabel="Remove step">
                      <Text style={st.x}>×</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              );
            })}
          </View>
        );
      })}

      {canBook && (showAdd
        ? <AddStep onAdd={addOwn} busy={adding} placeholder="e.g. Arrange airport pickup" />
        : <TouchableOpacity onPress={() => setShowAdd(true)} style={{ paddingVertical: 10 }}>
            <Text style={st.link}>+ Add a step for this booking</Text>
          </TouchableOpacity>)}
    </View>
  );
}

/* ── on the property (Admin) ── */
export function PropertyChecklistEditor({ property }: { property: string }) {
  const s = useStore();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [other, setOther] = useState(false);
  const data = s.logs?.checklist;
  if (!data) return <Text style={st.empty}>Checklists need the latest server version.</Text>;
  const steps = propertySteps(data, property);
  const have = new Set(steps.map((x) => x.preset).filter(Boolean));

  const add = async (d: { preset?: string; label?: string; stage?: string }) => {
    setBusy(true);
    try {
      await api.addChecklistItem(s.pin, { scope: 'property', property, ...d });
      await s.reloadLogs();
      return true;
    } catch (err: any) { toast(String(err?.message || err), false); return false; }
    finally { setBusy(false); }
  };
  const remove = (id: number, label: string) => confirmDestructive(
    'Remove “' + label + '”?',
    'It comes off the checklist for upcoming bookings at ' + property + '. Bookings that have already checked out keep it.',
    async () => {
      try { await api.removeChecklistItem(s.pin, id); s.reloadLogs(); }
      catch (err: any) { toast(String(err?.message || err), false); }
    }, 'Remove');

  return (
    <View>
      {steps.length === 0 && <Text style={st.empty}>No steps yet. Pick from the list below.</Text>}
      {CHECKLIST_STAGES.map((sg) => {
        const list = steps.filter((x) => x.stage === sg.key);
        if (!list.length) return null;
        return (
          <View key={sg.key}>
            <Text style={st.stage}>{sg.label}</Text>
            {list.map((x) => (
              <View key={x.id} style={st.item}>
                <View style={st.itemMain}>
                  <View style={st.dot} />
                  <View style={{ flex: 1 }}>
                    <Text style={st.label}>{x.label}</Text>
                    {x.preset === 'ids' || x.preset === 'review' ? <Text style={st.sub}>Ticks itself</Text> : null}
                  </View>
                </View>
                <TouchableOpacity onPress={() => remove(x.id, x.label)} hitSlop={10} accessibilityLabel={'Remove ' + x.label}>
                  <Text style={st.x}>×</Text>
                </TouchableOpacity>
              </View>
            ))}
          </View>
        );
      })}

      <Text style={[st.stage, { marginTop: 14 }]}>Add a step</Text>
      <View style={st.presets}>
        {CHECKLIST_PRESETS.filter((p) => !have.has(p.key)).map((p) => (
          <TouchableOpacity key={p.key} style={st.preset} disabled={busy} activeOpacity={0.7}
            onPress={() => add({ preset: p.key })}>
            <Text style={st.presetTxt}>+ {p.label}</Text>
            <Text style={st.presetSub}>{stageLabel(p.stage)}</Text>
          </TouchableOpacity>
        ))}
        <TouchableOpacity style={[st.preset, other && st.presetOn]} onPress={() => setOther((v) => !v)} activeOpacity={0.7}>
          <Text style={st.presetTxt}>+ Other…</Text>
          <Text style={st.presetSub}>Your own step</Text>
        </TouchableOpacity>
      </View>
      {other && <AddStep placeholder="e.g. Hand over parking sticker" busy={busy}
        onAdd={(label, stage) => add({ label, stage })} />}
    </View>
  );
}

/* ── on the new-booking form ── */
export type ExtraStep = { label: string; stage: ChecklistStage };
export function NewBookingSteps({ property, extras, onChange }: {
  property: string; extras: ExtraStep[]; onChange: (x: ExtraStep[]) => void;
}) {
  const s = useStore();
  const [adding, setAdding] = useState(false);
  const steps = propertySteps(s.logs?.checklist, property);
  /* One plain list in the order the work happens; the stage is a quiet tag
     on the right, not a heading. Adding a one-off step stays folded away. */
  const rows = [
    ...steps.map((x) => ({ label: x.label, stage: x.stage, i: -1 })),
    ...extras.map((x, i) => ({ label: x.label, stage: x.stage, i })),
  ];
  const order = (k: string) => CHECKLIST_STAGES.findIndex((x) => x.key === k);
  rows.sort((a, b) => order(a.stage) - order(b.stage));
  return (
    <View>
      {!property ? <Text style={st.empty}>Pick a property to see its checklist.</Text>
        : !rows.length ? <Text style={st.empty}>{property + ' has no checklist set up.'}</Text> : null}
      {rows.map((x, k) => (
        <View key={k} style={[st.pvRow, k === rows.length - 1 && { borderBottomWidth: 0 }]}>
          <View style={st.pvBox} />
          <Text style={st.pvLabel} numberOfLines={2}>{x.label}</Text>
          <Text style={st.pvStage}>{stageLabel(x.stage)}</Text>
          {x.i >= 0 ? (
            <TouchableOpacity onPress={() => onChange(extras.filter((_, j) => j !== x.i))} hitSlop={10} accessibilityLabel="Remove step">
              <Text style={st.x}>×</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ))}
      {adding ? (
        <AddStep placeholder="Step just for this booking"
          onAdd={(label, stage) => { onChange([...extras, { label, stage }]); setAdding(false); return true; }} />
      ) : property ? (
        <TouchableOpacity onPress={() => setAdding(true)} hitSlop={8} style={{ marginTop: 10, alignSelf: 'flex-start' }}>
          <Text style={st.link}>+ Add a step for this booking</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const st = StyleSheet.create({
  wrap: { marginTop: 18, paddingTop: 14, borderTopWidth: 1, borderTopColor: C.line },
  head: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  title: { fontFamily: F.xbold, fontSize: 16, color: C.ink },
  count: { fontFamily: F.bold, fontSize: 12.5, color: C.bark },
  bar: { height: 6, borderRadius: 3, backgroundColor: C.bone, overflow: 'hidden', marginTop: 8, marginBottom: 2 },
  barFill: { height: 6, borderRadius: 3, backgroundColor: C.blue },
  empty: { fontFamily: F.med, fontSize: 12.5, color: C.muted, marginTop: 6, lineHeight: 18 },
  stage: { fontFamily: F.bold, fontSize: 11, letterSpacing: 0.8, color: C.blue2, textTransform: 'uppercase', marginTop: 12, marginBottom: 2 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: 1, borderBottomColor: C.hair },
  itemMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11, minHeight: 48 },
  box: {
    width: 24, height: 24, borderRadius: 7, borderWidth: 1.6, borderColor: C.line, backgroundColor: '#fff',
    alignItems: 'center', justifyContent: 'center',
  },
  boxOn: { backgroundColor: C.green, borderColor: C.green },
  boxLinked: { borderStyle: 'dashed', borderColor: C.muted },
  tick: { color: '#fff', fontFamily: F.xbold, fontSize: 14, marginTop: -1 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: C.blue, marginHorizontal: 8 },
  label: { fontFamily: F.semi, fontSize: 14.5, color: C.ink },
  labelDone: { color: C.bark },
  sub: { fontFamily: F.med, fontSize: 11.5, color: C.muted, marginTop: 2 },
  x: { fontFamily: F.bold, fontSize: 20, color: C.muted, paddingHorizontal: 6 },
  link: { fontFamily: F.bold, fontSize: 13.5, color: C.blue2 },
  addBox: { marginTop: 10, padding: 12, borderRadius: 14, backgroundColor: C.warm2, borderWidth: 1, borderColor: C.hair },
  input: {
    fontFamily: F.med, fontSize: 14.5, color: C.ink, backgroundColor: '#fff', borderRadius: 10,
    borderWidth: 1, borderColor: C.line, paddingHorizontal: 12, paddingVertical: 10,
  },
  addLbl: { fontFamily: F.semi, fontSize: 11.5, color: C.bark, marginTop: 10 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  chip: { paddingVertical: 6, paddingHorizontal: 10, borderRadius: 999, backgroundColor: C.bone, borderWidth: 1, borderColor: 'transparent' },
  chipOn: { backgroundColor: '#fff', borderColor: C.blue },
  chipTxt: { fontFamily: F.semi, fontSize: 12, color: C.bark },
  chipTxtOn: { color: C.blue2, fontFamily: F.bold },
  presets: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 },
  preset: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 12, backgroundColor: '#fff', borderWidth: 1, borderColor: C.line },
  presetOn: { borderColor: C.blue },
  presetTxt: { fontFamily: F.bold, fontSize: 13, color: C.ink },
  presetSub: { fontFamily: F.med, fontSize: 11, color: C.muted, marginTop: 1 },
  preview: { fontFamily: F.med, fontSize: 13, color: C.ink, marginTop: 6, lineHeight: 19 },
  previewStage: { fontFamily: F.bold, color: C.blue2 },
  pvRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.hair },
  pvBox: { width: 18, height: 18, borderRadius: 5, borderWidth: 1.5, borderColor: C.line, backgroundColor: '#fff' },
  pvLabel: { flex: 1, fontFamily: F.semi, fontSize: 14, color: C.ink },
  pvStage: { fontFamily: F.med, fontSize: 11.5, color: C.muted },
});
