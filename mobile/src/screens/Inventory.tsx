import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { FormScroll } from '../formkit';
import { C, F, inr } from '../theme';
import { useStore } from '../store';
import { Btn, CountBadge, KpiCard, Panel, PanelTitle, SearchInput, Segmented, confirmDestructive, useToast } from '../ui';
import { Field, TxtInput, SelectField, DateField } from '../fields';
import { api } from '../api';
import TicketBanner, { writeLabels } from './TicketBanner';

import { InvData, InvItem, InvLists, InvMove, todayIso } from '../logic';

type Seg = 'items' | 'move' | 'item' | 'hist';

const NEG = /Consumption|Damage|Transfer Out|Adjustment -/;
const EMPTY_ITEM = {
  item: '', property: '', category: '', type: 'Asset', requiredQty: '', reorderLevel: '',
  unitPrice: '', vendor: '', openingQty: '', remarks: '',
};
const EMPTY_MOVE = { date: '', itemKey: '', movement: 'Purchase', qty: '', unitCost: '', vendor: '', remarks: '', loggedBy: '' };

export default function Inventory() {
  const s = useStore();
  const toast = useToast();
  const data = s.inv;                       // shared with the Action tab's low-stock section
  const [loading, setLoading] = useState(false);
  const [seg, setSeg] = useState<Seg>('items');
  const [fProp, setFProp] = useState('All');
  const [fCat, setFCat] = useState('All');
  const [lowOnly, setLowOnly] = useState(false);
  const [q, setQ] = useState('');
  const [hq, setHq] = useState('');
  const [fi, setFi] = useState({ ...EMPTY_ITEM });
  const [editI, setEditI] = useState<InvItem | null>(null);
  const [fm, setFm] = useState({ ...EMPTY_MOVE, date: todayIso() });
  const [editM, setEditM] = useState<InvMove | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const canAdd = s.can('inventory.add'), canUpd = s.can('inventory.update'), canDel = s.can('inventory.delete');
  const WL = writeLabels(s.needsApproval);

  const setI = (k: keyof typeof EMPTY_ITEM) => (v: string) => setFi((p) => ({ ...p, [k]: v }));
  const setM = (k: keyof typeof EMPTY_MOVE) => (v: string) => setFm((p) => ({ ...p, [k]: v }));

  const load = async () => {
    setLoading(true);
    try { await s.reloadInv(); }
    finally { setLoading(false); }
  };
  // Only fetch if the store has nothing yet — loadAll() already pulls inventory
  // on login/refresh so the Action tab can show low stock immediately.
  useEffect(() => { if (!s.inv) load(); }, []);

  /* "Add stock" on an Action-tab low-stock row lands here: open the movement
     form prefilled for that item as a Purchase. Waits for `data` so the item's
     usual vendor can be prefilled too, then clears the target so re-entering
     the tab later does not reopen the form. */
  useEffect(() => {
    if (!s.invTarget || !data) return;
    const it = data.items.find((i) => i.key === s.invTarget);
    setEditM(null);
    setFm({
      ...EMPTY_MOVE, date: todayIso(), movement: 'Purchase',
      itemKey: s.invTarget, vendor: it?.vendor || '',
    });
    setSeg('move');
    s.setInvTarget(null);
  }, [s.invTarget, data]);

  /* Same, for a sent-back request to CREATE an item or stock entry: there is no
     record to open, so the Add form is filled in and the request id kept. */
  const [resubI, setResubI] = useState(0);
  const [resubM, setResubM] = useState(0);
  const myTicket = (id: number) => (id ? (s.tickets?.mine || []).find((t) => t.id === id) || null : null);
  useEffect(() => {
    const nd = s.newDraft;
    if (!nd || (nd.kind !== 'inventory' && nd.kind !== 'stock')) return;
    s.setNewDraft(null);
    const item = nd.kind === 'inventory';
    const EMPTY_F: any = item ? EMPTY_ITEM : EMPTY_MOVE;
    const apply = (p: any) => {
      const n: any = { ...p };
      for (const k of Object.keys(EMPTY_F)) {
        const v = (nd.payload || {})[k];
        if (v !== undefined && v !== null) n[k] = String(v);
      }
      return n;
    };
    if (item) { setEditI(null); setFi(apply); setResubI(nd.ticket); }
    else { setEditM(null); setFm(apply); setResubM(nd.ticket); }
    setSeg(item ? 'item' : 'move');
  }, [s.newDraft]);

  /* "Edit & resubmit" on a sent-back request (Team tab): open the item or stock
     entry, then lay the requested values over it. */
  useEffect(() => {
    if (!s.invEdit || !data) return;
    const { kind, r, draft } = s.invEdit;
    s.setInvEdit(null);
    if (kind === 'item') {
      const it = data.items.find((i) => i.r === r);
      if (!it) { toast('That item no longer exists', false); return; }
      startEditItem(it);
      if (draft) setFi((p) => {
        const n: any = { ...p };
        for (const k of Object.keys(EMPTY_ITEM)) if (draft[k] != null && k !== 'openingQty') n[k] = String(draft[k]);
        return n;
      });
    } else {
      const m = data.movements.find((x) => x.r === r);
      if (!m) { toast('That stock entry no longer exists', false); return; }
      startEditMove(m);
      if (draft) setFm((p) => {
        const n: any = { ...p };
        for (const k of Object.keys(EMPTY_MOVE)) if (draft[k] != null) n[k] = String(draft[k]);
        return n;
      });
    }
  }, [s.invEdit, data]);

  const L: InvLists = data?.lists || { properties: [], categories: [], types: [], movements: [], vendors: [] };
  const items = data?.items || [];
  const moves = data?.movements || [];
  const propNames = Array.from(new Set([...(L.properties || []), ...items.map((i) => i.property).filter(Boolean)]));

  /* ── filters + KPIs ── */
  const scoped = items.filter((it) => fProp === 'All' || it.property === fProp);
  const list = scoped.filter((it) => {
    if (fCat !== 'All' && it.category !== fCat) return false;
    if (lowOnly && !it.low) return false;
    const hay = (it.id + ' ' + it.item + ' ' + it.vendor + ' ' + it.remarks).toLowerCase();
    if (q && hay.indexOf(q.toLowerCase()) < 0) return false;
    return true;
  });
  const lowN = scoped.filter((it) => it.low).length;
  const pendN = scoped.reduce((a, it) => a + (it.pending || 0), 0);
  const keySet = new Set(scoped.map((it) => it.key));
  const spend = moves.reduce(
    (a, m) => a + (m.movement === 'Purchase' && (fProp === 'All' || keySet.has(m.key)) ? m.totalCost || 0 : 0), 0);
  const histAll = moves.filter((m) => fProp === 'All' || keySet.has(m.key)).slice().reverse();
  const hist = histAll.filter((m) => {
    const hay = (m.date + ' ' + m.key + ' ' + m.movement + ' ' + m.vendor + ' ' + m.remarks).toLowerCase();
    return !hq || hay.indexOf(hq.toLowerCase()) >= 0;
  });

  /* ── item form ── */
  const resetItem = () => { setEditI(null); setResubI(0); setFi({ ...EMPTY_ITEM, property: fProp !== 'All' ? fProp : propNames[0] || '' }); };
  const startEditItem = (it: InvItem) => {
    setEditI(it);
    setFi({
      item: it.item, property: it.property, category: it.category, type: it.type || 'Asset',
      requiredQty: String(it.required || ''), reorderLevel: String(it.reorder ?? ''),
      unitPrice: String(it.unitPrice ?? ''), vendor: it.vendor, openingQty: '', remarks: it.remarks,
    });
    setSeg('item');
  };
  const submitItem = async () => {
    if (!fi.item) { toast('Item name is required', false); return; }
    if (!fi.property) { toast('Property is required', false); return; }
    if (!fi.category) { toast('Category is required', false); return; }
    setSaving(true);
    try {
      const res = editI
        ? await api.invUpdateItem(s.pin, editI.r, { ...fi, id: editI.id })
        : await api.invAddItem(s.pin, { ...fi, loggedBy: 'App' }, resubI);
      toast(res?.message || 'Saved', true);
      if (res?.pendingApproval) { if (!editI && res?.ticket) s.setLastSubmit(res.ticket); s.reloadTickets(); }
      resetItem(); await load(); setSeg('items');
    } catch (e: any) { toast(e?.message || 'Save failed', false); }
    finally { setSaving(false); }
  };
  const delItem = () => {
    if (!editI) return;
    confirmDestructive('Delete item', 'Delete ' + editI.id + ' permanently? Its stock-log entries remain but will point at a removed item.', async () => {
          setDeleting(true);
          try {
            const res = await api.invDeleteItem(s.pin, editI.r);
            toast(res?.message || 'Deleted', true);
            if (res?.pendingApproval) s.reloadTickets();
            resetItem(); await load(); setSeg('items');
          } catch (e: any) { toast(e?.message || 'Delete failed', false); }
          finally { setDeleting(false); }
        });
  };

  /* ── movement form ── */
  const resetMove = () => { setEditM(null); setResubM(0); setFm({ ...EMPTY_MOVE, date: todayIso() }); };
  const quickLog = (it: InvItem) => { setEditM(null); setFm({ ...EMPTY_MOVE, date: todayIso(), itemKey: it.key, vendor: it.vendor || '' }); setSeg('move'); };
  const startEditMove = (m: InvMove) => {
    setEditM(m);
    setFm({ date: m.date, itemKey: m.key, movement: m.movement, qty: String(m.qty || ''),
      unitCost: String(m.unitCost ?? ''), vendor: m.vendor, remarks: m.remarks,
      /* Carried through the edit: the worker rewrites logged_by on every update,
         so omitting it here relabelled whoever originally logged the movement. */
      loggedBy: String(m.by ?? '') });
    setSeg('move');
  };
  const submitMove = async () => {
    if (!fm.itemKey) { toast('Pick an item', false); return; }
    if (!fm.movement) { toast('Pick a movement type', false); return; }
    if (!fm.qty || Number(fm.qty) <= 0) { toast('Qty must be greater than 0', false); return; }
    setSaving(true);
    try {
      const d = { ...fm, loggedBy: fm.loggedBy || 'App' };
      const res = editM
        ? await api.invUpdateMovement(s.pin, editM.r, d)
        : await api.invAddMovement(s.pin, d, resubM);
      toast(res?.message || 'Saved', true);
      if (res?.pendingApproval) { if (!editM && res?.ticket) s.setLastSubmit(res.ticket); s.reloadTickets(); }
      resetMove(); await load(); setSeg(editM ? 'hist' : 'items');
    } catch (e: any) { toast(e?.message || 'Save failed', false); }
    finally { setSaving(false); }
  };
  const delMove = () => {
    if (!editM) return;
    confirmDestructive('Delete entry', 'Delete this stock-log entry? Stock levels recalculate automatically.', async () => {
          setDeleting(true);
          try {
            const res = await api.invDeleteMovement(s.pin, editM.r);
            toast(res?.message || 'Deleted', true);
            if (res?.pendingApproval) s.reloadTickets();
            resetMove(); await load(); setSeg('hist');
          } catch (e: any) { toast(e?.message || 'Delete failed', false); }
          finally { setDeleting(false); }
        });
  };

  /* ── render ── */
  return (
    <View style={{ flex: 1 }}>
      <Segmented
        segments={[
          { key: 'items', label: 'Items' },
          { key: 'move', label: 'Move', dot: !!editM },
          { key: 'item', label: 'Item', dot: !!editI },
          { key: 'hist', label: 'History' },
        ]}
        value={seg}
        onChange={(k) => setSeg(k as Seg)}
      />

      {/* ITEMS */}
      {seg === 'items' && (
        <FormScroll contentContainerStyle={st.body}>
          <View style={st.head}>
            <Text style={st.h2}>Inventory</Text>
            <Btn title={loading ? 'Loading…' : '↻ Reload'} kind="ghost" onPress={load} disabled={loading} />
          </View>
          <View style={st.kpis}>
            <KpiCard kind="bkg" label="Items" value={scoped.length} />
            <KpiCard kind="pnl" label="Low Stock" value={lowN} onPress={() => { setLowOnly(true); }} />
            <KpiCard kind="exp" label="Units To Buy" value={Math.round(pendN)} />
            <KpiCard kind="rev" label="Purchases" value={inr(spend)} />
          </View>
          <View style={{ flexDirection: 'row', gap: 8, marginBottom: 10 }}>
            <View style={{ flex: 1 }}>
              <SelectField title="Property" value={fProp} options={['All', ...propNames]} onChange={setFProp} />
            </View>
            <View style={{ flex: 1 }}>
              <SelectField title="Category" value={fCat} options={['All', ...L.categories]} onChange={setFCat} />
            </View>
          </View>
          <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12, alignItems: 'center' }}>
            <View style={{ flex: 1 }}>
              <SearchInput value={q} onChange={setQ} placeholder="Search items…" />
            </View>
            <TouchableOpacity style={[st.chip, lowOnly && st.chipOn]} onPress={() => setLowOnly(!lowOnly)} activeOpacity={0.7}>
              <Text style={[st.chipTxt, lowOnly && { color: '#fff' }]}>LOW</Text>
            </TouchableOpacity>
          </View>
          <Panel>
            <PanelTitle right={<CountBadge n={list.length} />}>Items — tap to edit</PanelTitle>
            {!data && <Text style={st.empty}>{loading ? 'Loading…' : 'Pull ↻ to load.'}</Text>}
            {data && list.length === 0 && <Text style={st.empty}>No items match.</Text>}
            {list.map((it) => (
              <View key={it.r} style={[st.row, it.low && { backgroundColor: C.redbg, borderRadius: 10 }]}>
                <TouchableOpacity style={{ flex: 1 }} onPress={() => startEditItem(it)} activeOpacity={0.7}>
                  <Text style={st.rowName} numberOfLines={1}>
                    {it.item}{it.low ? <Text style={{ color: C.red, fontFamily: F.bold }}>  LOW</Text> : null}
                  </Text>
                  <Text style={st.rowSub} numberOfLines={1}>
                    {it.id} · {it.category} · {it.type}{it.vendor ? ' · ' + it.vendor : ''}
                  </Text>
                </TouchableOpacity>
                <View style={{ alignItems: 'flex-end', marginRight: 10 }}>
                  <Text style={st.rowStock}>{it.inStock}</Text>
                  <Text style={st.rowSub2}>{it.pending ? 'buy ' + it.pending : 'in stock'}</Text>
                </View>
                {canAdd ? <Btn title="Log" kind="mini" onPress={() => quickLog(it)} /> : null}
              </View>
            ))}
          </Panel>
        </FormScroll>
      )}

      {/* MOVE (log / edit a stock movement) */}
      {seg === 'move' && (
        <FormScroll contentContainerStyle={st.body} onSubmit={submitMove}>
          <View style={st.head}>
            <Text style={st.h2}>{editM ? 'Edit Entry' : 'Log Movement'}</Text>
            {editM ? <Btn title="← History" kind="ghost" onPress={() => { resetMove(); setSeg('hist'); }} /> : null}
          </View>
          <Panel>
            <Field label="Item" req>
              <SelectField title="Item" value={fm.itemKey} options={items.map((i) => i.key)} onChange={setM('itemKey')} />
            </Field>
            <Field label="Movement" req hint="Purchase / Transfer In / Adjustment + add stock; Consumption / Damage / Transfer Out / Adjustment − reduce it.">
              <SelectField title="Movement" value={fm.movement} options={L.movements} onChange={setM('movement')} />
            </Field>
            <Field label="Qty" req hint="Always positive — the movement type decides + or −.">
              <TxtInput value={fm.qty} onChange={setM('qty')} money />
            </Field>
            <Field label="Date"><DateField value={fm.date} onChange={setM('date')} /></Field>
            <Field label="Unit Cost (₹)" hint="For purchases — total cost auto-calculates.">
              <TxtInput value={fm.unitCost} onChange={setM('unitCost')} money />
            </Field>
            <Field label="Vendor">
              <SelectField title="Vendor" value={fm.vendor} options={L.vendors} onChange={setM('vendor')} allowEmpty />
            </Field>
            <Field label="Remarks"><TxtInput value={fm.remarks} onChange={setM('remarks')} /></Field>
            {editM && (
              <View style={st.editMsg}>
                <Text style={{ color: C.amber, fontFamily: F.semi, fontSize: 13 }}>
                  Editing a stock-log entry — Save to update, Delete to remove, or Clear to cancel.
                </Text>
              </View>
            )}
            <TicketBanner kind="stock" target={editM?.r} editing={!!editM} resubmit={myTicket(resubM)} />
            <View style={st.actions}>
              {(editM ? canUpd : canAdd) && (
                <Btn title={saving ? WL.saving : editM ? WL.save : (WL.add || 'Log Movement')} onPress={submitMove} disabled={saving} />
              )}
              <Btn title="Clear" kind="ghost" onPress={resetMove} />
              {editM && canDel && <Btn title={deleting ? WL.deleting : WL.del} kind="danger" onPress={delMove} disabled={deleting} />}
            </View>
          </Panel>
        </FormScroll>
      )}

      {/* ITEM (add / edit an item) */}
      {seg === 'item' && (
        <FormScroll contentContainerStyle={st.body} onSubmit={submitItem}>
          <View style={st.head}>
            <Text style={st.h2}>{editI ? 'Edit ' + editI.id : 'Add Item'}</Text>
            {editI ? <Btn title="← Items" kind="ghost" onPress={() => { resetItem(); setSeg('items'); }} /> : null}
          </View>
          <Panel>
            <Field label="Item Name" req>
              <TxtInput value={fi.item} onChange={setI('item')} placeholder="e.g. Toilet Rolls" />
            </Field>
            <Field label="Property" req>
              <SelectField title="Property" value={fi.property} options={propNames} onChange={setI('property')} />
            </Field>
            <Field label="Category" req>
              <SelectField title="Category" value={fi.category} options={L.categories} onChange={setI('category')} />
            </Field>
            <Field label="Type" hint="Consumables get low-stock alerts.">
              <SelectField title="Type" value={fi.type} options={L.types.length ? L.types : ['Asset', 'Consumable']} onChange={setI('type')} />
            </Field>
            <Field label="Required Qty"><TxtInput value={fi.requiredQty} onChange={setI('requiredQty')} money /></Field>
            <Field label="Reorder Level" hint="Alert when stock ≤ this (consumables).">
              <TxtInput value={fi.reorderLevel} onChange={setI('reorderLevel')} money />
            </Field>
            <Field label="Unit Price (₹)"><TxtInput value={fi.unitPrice} onChange={setI('unitPrice')} money /></Field>
            <Field label="Vendor">
              <SelectField title="Vendor" value={fi.vendor} options={L.vendors} onChange={setI('vendor')} allowEmpty />
            </Field>
            {!editI && (
              <Field label="Opening Stock" hint="Qty already in hand (logged as Opening Balance).">
                <TxtInput value={fi.openingQty} onChange={setI('openingQty')} money />
              </Field>
            )}
            <Field label="Remarks"><TxtInput value={fi.remarks} onChange={setI('remarks')} /></Field>
            {editI && (
              <View style={st.editMsg}>
                <Text style={{ color: C.amber, fontFamily: F.semi, fontSize: 13 }}>
                  Editing {editI.id} · {editI.item} — Save to update, Delete to remove, or Clear to cancel.
                </Text>
              </View>
            )}
            <TicketBanner kind="inventory" target={editI?.r} editing={!!editI} resubmit={myTicket(resubI)} />
            <View style={st.actions}>
              {(editI ? canUpd : canAdd) && (
                <Btn title={saving ? WL.saving : editI ? WL.save : (WL.add || 'Add Item')} onPress={submitItem} disabled={saving} />
              )}
              <Btn title="Clear" kind="ghost" onPress={resetItem} />
              {editI && canDel && <Btn title={deleting ? WL.deleting : WL.del} kind="danger" onPress={delItem} disabled={deleting} />}
            </View>
          </Panel>
        </FormScroll>
      )}

      {/* HISTORY (stock log) */}
      {seg === 'hist' && (
        <FormScroll contentContainerStyle={st.body}>
          <View style={st.head}>
            <Text style={st.h2}>Stock Log</Text>
            <Btn title={loading ? 'Loading…' : '↻ Reload'} kind="ghost" onPress={load} disabled={loading} />
          </View>
          <View style={{ marginBottom: 12 }}>
            <SearchInput value={hq} onChange={setHq} placeholder="Search movements…" />
          </View>
          <Panel>
            <PanelTitle right={<CountBadge n={hist.length} />}>Movements — tap to edit</PanelTitle>
            {hist.length === 0 && <Text style={st.empty}>No movements yet.</Text>}
            {hist.slice(0, 200).map((m) => {
              const neg = NEG.test(m.movement);
              return (
                <TouchableOpacity key={m.r} style={st.row} onPress={() => startEditMove(m)} activeOpacity={0.7}>
                  <View style={{ flex: 1 }}>
                    <Text style={st.rowName} numberOfLines={1}>{m.key.split(' · ')[1] || m.key}</Text>
                    <Text style={st.rowSub} numberOfLines={1}>
                      {m.date} · {m.movement}{m.vendor ? ' · ' + m.vendor : ''}{m.by ? ' · ' + m.by : ''}
                    </Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={[st.rowStock, { color: neg ? C.red : C.green }]}>{(neg ? '−' : '+') + m.qty}</Text>
                    {m.totalCost ? <Text style={st.rowSub2}>{inr(m.totalCost)}</Text> : null}
                  </View>
                </TouchableOpacity>
              );
            })}
            {hist.length > 200 && <Text style={st.empty}>Showing latest 200 of {hist.length}</Text>}
          </Panel>
        </FormScroll>
      )}
    </View>
  );
}

const st = StyleSheet.create({
  body: { padding: 14, paddingBottom: 60 },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 8 },
  h2: { fontSize: 25, color: C.ink, fontFamily: F.xbold, letterSpacing: -0.6 },
  kpis: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 12 },
  chip: {
    borderWidth: 1, borderColor: C.red, borderRadius: 999, paddingVertical: 9, paddingHorizontal: 14,
    backgroundColor: '#fff',
  },
  chipOn: { backgroundColor: C.red },
  chipTxt: { color: C.red, fontFamily: F.bold, fontSize: 12 },
  row: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 9, paddingHorizontal: 4,
    borderBottomWidth: 1, borderBottomColor: C.hair, gap: 4,
  },
  rowName: { fontSize: 14, color: C.ink, fontFamily: F.semi },
  rowSub: { fontSize: 11, color: C.muted, marginTop: 2, fontFamily: F.med },
  rowStock: { fontSize: 16, color: C.navy, fontFamily: F.xbold, fontVariant: ['tabular-nums'] },
  rowSub2: { fontSize: 10.5, color: C.muted, marginTop: 1, fontFamily: F.med },
  empty: { color: '#999', paddingVertical: 8, fontSize: 13 },
  editMsg: {
    backgroundColor: C.amberbg, borderWidth: 1, borderColor: '#e9d2a3', borderRadius: 10,
    paddingVertical: 9, paddingHorizontal: 13, marginTop: 8,
  },
  actions: { flexDirection: 'row', gap: 10, marginTop: 18, flexWrap: 'wrap' },
});
