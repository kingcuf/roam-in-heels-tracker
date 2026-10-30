import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { FormScroll } from '../formkit';
import { C, F, inr } from '../theme';
import { useStore, Prop } from '../store';
import { Btn, Panel, PanelTitle, Pill } from '../ui';

// List-only: the add/edit form lives on Add ▸ Property (PropertyForm.tsx).
export default function Properties({ embedded }: { embedded?: boolean } = {}) {
  const s = useStore();

  const openNew = () => {
    s.setEditP(null);
    s.setAddSeg('prop');
    s.setTab('add');
  };
  const openEdit = (p: Prop) => {
    s.setEditP({ origId: String(p.id), from: 'prop', prop: p });
    s.setAddSeg('prop');
    s.setTab('add');
  };

  return (
    <FormScroll>
      <View style={st.head}>
        <Text style={st.h2}>Properties</Text>
        {s.can('property.add') ? <Btn title="+ New property" kind="mini" onPress={openNew} /> : null}
      </View>

      <Panel>
        <PanelTitle>Your properties</PanelTitle>
        {s.props.length === 0 && (
          <Text style={{ color: '#999', fontSize: 13, paddingVertical: 6 }}>
            No properties yet — tap “+ New property” to add one.
          </Text>
        )}
        {s.props.map((p) => (
          <View key={String(p.id)} style={st.propRow}>
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <Text style={{ fontFamily: F.bold, color: C.ink, fontSize: 15 }}>{p.name}</Text>
                <Pill label={p.status === 'Inactive' ? 'Inactive' : 'Active'} />
              </View>
              <Text style={{ fontSize: 12, color: C.muted, marginTop: 3 }}>
                {[p.id, p.location, p.type].filter(Boolean).join(' · ')}
              </Text>
              <Text style={{ fontSize: 12, color: C.bark, marginTop: 2 }}>
                {p.rent ? 'Rent ' + inr(p.rent) : 'Rent —'}{p.onboarded ? ' · onboarded ' + p.onboarded : ''}
              </Text>
            </View>
            <Btn title={s.can('property.update') || s.can('property.delete') ? 'Edit' : 'View'} kind="mini" onPress={() => openEdit(p)} />
          </View>
        ))}
      </Panel>
    </FormScroll>
  );
}

const st = StyleSheet.create({
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 8 },
  h2: { fontSize: 25, color: C.ink, fontFamily: F.xbold, letterSpacing: -0.6 },
  propRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.hair,
  },
});
