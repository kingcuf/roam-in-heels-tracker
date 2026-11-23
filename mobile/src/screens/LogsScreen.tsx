import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { C, F } from '../theme';
import { useStore } from '../store';
import { Btn, Panel, SearchInput, Sheet, useToast } from '../ui';
import { LogBlock, parseExtraGuests } from '../logic';
import { BookingChecklist } from '../checklist';

const PER_PAGE = 50;
const COL_W = 110;
const ID_W = 52;   // the row id — narrow, it is only ever a few digits
/* The preview sheet's exit is ~220 ms; the form must not swap the log out from
   under a Modal that is still animating (same wait as CalendarScreen.editStay). */
const SHEET_DISMISS_MS = 320;
type LogRow = { r: number; cells: any[] };

/* `embedded` = rendered beneath a form inside the Add tab rather than as a
   standalone screen, so it must not claim flex:1 or scroll independently. */
export default function LogsScreen({ which, embedded }: { which: 'blog' | 'elog' | 'slog'; embedded?: boolean }) {
  const s = useStore();
  const toast = useToast();
  const block: LogBlock | null =
    which === 'blog' ? s.logs?.bookings || null :
    which === 'elog' ? s.logs?.expenses || null :
    s.logs?.savings || null;
  const kind = which === 'blog' ? 'booking' : which === 'elog' ? 'expense' : 'saving';
  const pendingNew = s.myLive.filter((t) => t.kind === kind && t.op === 'create');
  const [search, setSearch] = useState('');
  const [colf, setColf] = useState<Record<number, string>>({});
  const [page, setPage] = useState(1);

  const sorted = useMemo(() => {
    if (!block?.rows) return [];
    const rows = [...block.rows];
    rows.sort((a, b) => {
      const ka = which === 'elog' ? String(a.cells[0] || a.cells[1] || '') : String(a.cells[0] || '');
      const kb = which === 'elog' ? String(b.cells[0] || b.cells[1] || '') : String(b.cells[0] || '');
      return ka < kb ? 1 : ka > kb ? -1 : 0; // newest first
    });
    return rows;
  }, [block, which]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return sorted.filter((o) => {
      const idTxt = String(o.r);
      /* The row id is the only handle on an expense or saving — those grids
         carry no identifier of their own (bookings at least have Booking ID),
         so a row could be seen but not named when something needed correcting. */
      const idF = (colf[-1] || '').toLowerCase();
      if (idF && idTxt.indexOf(idF) < 0) return false;
      let all = ' ' + idTxt;
      for (let i = 0; i < o.cells.length; i++) {
        const txt = String(o.cells[i] ?? '').toLowerCase();
        all += ' ' + txt;
        const f = (colf[i] || '').toLowerCase();
        if (f && txt.indexOf(f) < 0) return false;
      }
      if (q && all.indexOf(q) < 0) return false;
      return true;
    });
  }, [sorted, search, colf]);

  const pages = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
  const pg = Math.min(Math.max(1, page), pages);
  const pageRows = filtered.slice((pg - 1) * PER_PAGE, pg * PER_PAGE);
  const headers = block?.headers || [];
  /* Columns the log does not show. Hidden here rather than dropped from the
     API: every screen reads booking cells POSITIONALLY (c[9] is net earned,
     c[20] check-in…), so removing a column upstream would silently shift every
     figure after it. Matched on the header text, not an index, so the list
     survives a column being added before them. What is off: list price and
     discount, which the owner reads off the channel, not off this log. */
  const HIDDEN: Record<string, string[]> = { blog: ['list price', 'discount'] };
  const hidden = HIDDEN[which] || [];
  const shown = headers
    .map((_, i) => i)
    .filter((i) => hidden.indexOf(String(headers[i] ?? '').trim().toLowerCase()) < 0);

  /* A row tap opens a read-only preview first: most taps are "what was this
     booking again?", not "change it" — landing straight in the edit form made
     every look-up risk an accidental edit. Edit is one more tap from there. */
  const [preview, setPreview] = useState<LogRow | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const navTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (navTimer.current) clearTimeout(navTimer.current); }, []);
  const openPreview = (o: LogRow) => { setPreview(o); setSheetOpen(true); };
  const canChange = s.can(kind + '.update') || s.can(kind + '.delete');
  const editFromPreview = () => {
    const o = preview;
    if (!o) return;
    setSheetOpen(false);
    if (navTimer.current) clearTimeout(navTimer.current);
    navTimer.current = setTimeout(() => { navTimer.current = null; setPreview(null); openEdit(o); }, SHEET_DISMISS_MS);
  };

  // T8/T9/T15: Edit (from the preview) → Add tab, matching segment, edit prefilled
  const openEdit = (o: LogRow) => {
    if (which === 'blog') {
      s.setEditB({ row: o.r, bookingId: o.cells[18], from: 'blog', cells: o.cells });
      s.setAddSeg('book');
    } else if (which === 'elog') {
      s.setEditE({ row: o.r, from: 'elog', cells: o.cells });
      s.setAddSeg('exp');
    } else {
      s.setEditS({ row: o.r, from: 'slog', cells: o.cells });
      s.setAddSeg('sav');
    }
    s.setTab('add');
  };

  return (
    <View style={{ flex: 1, padding: 14 }}>
      <View style={st.head}>
        <Text style={st.h2}>{which === 'blog' ? 'Booking Logs' : which === 'elog' ? 'Expense Logs' : 'Savings Logs'}</Text>
        <Btn title="↻" kind="mini" onPress={() => s.reloadLogs()} />
      </View>
      <View style={{ marginBottom: 10 }}>
        <SearchInput value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Search all columns…" />
      </View>
      {/* A record you submitted but that is not approved yet does not exist, so
          it cannot be in this table — searching for it and finding nothing read
          as "the app ate it". Say where it is instead. */}
      {pendingNew.length ? (
        <Pressable onPress={() => s.openMyRequests(pendingNew[0].id)} style={st.waitBar}>
          <Text style={st.waitTxt}>
            {pendingNew.length} {pendingNew.length === 1 ? 'record you sent is' : 'records you sent are'} waiting for
            approval — not in this log until approved.
          </Text>
          <Text style={st.waitLink}>View requests ›</Text>
        </Pressable>
      ) : null}
      <Panel style={{ flex: 1, padding: 8 }}>
        {!block && <Text style={{ color: C.muted, padding: 8 }}>Loading…</Text>}
        {block && !sorted.length && <Text style={{ color: C.muted, padding: 8 }}>No rows yet.</Text>}
        {block && sorted.length > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator>
            <View>
              {/* header + column filters */}
              <View style={{ flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: C.line }}>
                <View style={{ width: ID_W, padding: 5 }}>
                  <Text style={st.th} numberOfLines={2}>ID</Text>
                  <TextInput
                    value={colf[-1] || ''}
                    onChangeText={(v) => { setColf((p) => ({ ...p, [-1]: v })); setPage(1); }}
                    placeholder="filter" placeholderTextColor="#C0BFC6"
                    style={st.colf} autoCapitalize="none" autoCorrect={false}
                    keyboardType="number-pad"
                  />
                </View>
                {shown.map((i) => (
                  <View key={i} style={{ width: COL_W, padding: 5 }}>
                    <Text style={st.th} numberOfLines={2}>{String(headers[i])}</Text>
                    <TextInput
                      value={colf[i] || ''}
                      onChangeText={(v) => { setColf((p) => ({ ...p, [i]: v })); setPage(1); }}
                      placeholder="filter" placeholderTextColor="#C0BFC6"
                      style={st.colf} autoCapitalize="none" autoCorrect={false}
                    />
                  </View>
                ))}
              </View>
              {/* rows */}
              <ScrollView style={{ maxHeight: 520 }} nestedScrollEnabled>
                {pageRows.map((o) => (
                  <Pressable
                    key={o.r}
                    onPress={() => openPreview(o)}
                    style={({ pressed }) => [
                      { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: C.hair },
                      pressed && { backgroundColor: '#F5F1E8' },
                    ]}
                  >
                    <View style={{ width: ID_W, paddingVertical: 8, paddingHorizontal: 5 }}>
                      <Text style={{ fontSize: 12, color: C.muted, fontFamily: F.semi }} numberOfLines={1}>{o.r}</Text>
                    </View>
                    {shown.map((i) => (
                      <View key={i} style={{ width: COL_W, paddingVertical: 8, paddingHorizontal: 5 }}>
                        <Text style={{ fontSize: 12, color: C.ink }} numberOfLines={2}>
                          {String(o.cells[i] ?? '')}
                        </Text>
                      </View>
                    ))}
                  </Pressable>
                ))}
              </ScrollView>
            </View>
          </ScrollView>
        )}
        {/* pager */}
        {block && filtered.length > 0 && (
          <View style={st.pager}>
            {filtered.length > PER_PAGE ? (
              <>
                <Btn title="‹ Prev" kind="mini" disabled={pg <= 1} onPress={() => setPage(pg - 1)} />
                <Text style={st.pginfo}>
                  {(pg - 1) * PER_PAGE + 1}–{Math.min(pg * PER_PAGE, filtered.length)} of {filtered.length} · page {pg}/{pages}
                </Text>
                <Btn title="Next ›" kind="mini" disabled={pg >= pages} onPress={() => setPage(pg + 1)} />
              </>
            ) : (
              <Text style={st.pginfo}>{filtered.length} row{filtered.length === 1 ? '' : 's'}</Text>
            )}
          </View>
        )}
      </Panel>
      <Text style={{ color: C.muted, fontSize: 11, textAlign: 'center', marginTop: 4 }}>
        {(() => {
          const ent = which === 'blog' ? 'booking' : which === 'elog' ? 'expense' : 'saving';
          if (!s.can(ent + '.update') && !s.can(ent + '.delete')) return 'Tap a row to view it';
          return 'Tap a row to view it · ' + (s.needsApproval ? 'request a change' : 'edit') + ' from there';
        })()}
      </Text>
      <Sheet
        visible={sheetOpen}
        title={preview ? previewSub(which, preview) : ''}
        value={preview ? previewTitle(which, preview) : ''}
        onClose={() => setSheetOpen(false)}
      >
        {preview ? (
          <View>
            {groupFields(which, headers, preview.cells).map((g) => (
              <View key={g.title} style={{ marginTop: 14 }}>
                <Text style={st.pSec}>{g.title}</Text>
                {g.rows.map((f) => (
                  <View key={f.i} style={st.pRow}>
                    <Text style={st.pLbl}>{f.label}</Text>
                    <Text style={st.pVal} selectable>{f.v}</Text>
                  </View>
                ))}
              </View>
            ))}
            <View style={[st.pRow, { marginTop: 10 }]}>
              <Text style={st.pLbl}>Row ID</Text>
              <Text style={[st.pVal, { color: C.muted }]}>{preview.r}</Text>
            </View>
            {which === 'blog' ? <BookingChecklist row={preview.r} /> : null}
            {canChange ? (
              <Btn
                title={s.needsApproval ? 'Request a change' : 'Edit this ' + kind}
                onPress={editFromPreview}
                style={{ marginTop: 16 }}
              />
            ) : null}
          </View>
        ) : null}
      </Sheet>
    </View>
  );
}

const previewTitle = (which: string, o: LogRow) => {
  const c = o.cells;
  if (which === 'blog') return String(c[2] || 'Booking');
  if (which === 'elog') return String(c[2] || 'Expense');
  return String(c[2] || 'Saving');
};
const previewSub = (which: string, o: LogRow) => {
  const c = o.cells;
  const parts = which === 'blog' ? [c[1], c[0], c[18]] : which === 'elog' ? [c[3], c[0] || c[1], c[6]] : [c[3], c[0], c[1]];
  return parts.map((x) => String(x ?? '').trim()).filter(Boolean).join(' · ');
};
/* The preview is grouped into the same cards the form uses (BookingForm /
   ExpenseForm / SavingForm FormCard titles), so a record reads the way it was
   entered. Matched on header text, not index. Anything not on a form (Month,
   Review status, Created At…) lands in "Other" rather than disappearing. */
const SECTIONS: Record<string, [string, string[]][]> = {
  blog: [
    ['Booking', ['booking date', 'property', 'stay unit', 'stay property', 'booking type', 'channel', 'referrer / source', 'booking id']],
    ['Stay dates', ['check-in date', 'check-in time', 'check-out date', 'check-out time']],
    ['Guests', ['guests', 'lead guest', 'lead birth yr', 'phone', 'co-guest', 'co-guest birth yr', 'extra guests', 'repeat flag']],
    ['Money', ['list price', 'discount', 'guest paid', 'net earned', 'commission paid', 'pending amount', 'split fee']],
    ['Notes', ['notes']],
  ],
  elog: [
    ['Expense', ['property', 'category', 'item / description', 'amount', 'type']],
    ['When', ['expense month', 'date']],
    ['Details', ['refundable', 'quantity', 'vendor', 'status', 'initial investment flag']],
    ['Notes', ['notes']],
  ],
  slog: [
    ['Investment', ['date', 'amount', 'scheme', 'platform']],
    ['Status', ['status', 'returns received']],
    ['Notes', ['notes / ref no']],
  ],
};
/* Form wording where the sheet header differs. */
const LABELS: Record<string, string> = {
  'repeat flag': 'Repeat guest', 'initial investment flag': 'Initial investment',
  'date': 'Transaction date', 'referrer / source': 'Referrer / source',
};
type Field = { i: number; label: string; v: string };
function groupFields(which: string, headers: any[], cells: any[]) {
  const key = (i: number) => String(headers[i] ?? '').trim().toLowerCase();
  const field = (i: number): Field | null => {
    const v = fmtCell(String(headers[i] ?? ''), cells[i]);
    if (!v) return null;
    const k = key(i);
    const label = which === 'slog' && k === 'date' ? 'Created date' : LABELS[k] || String(headers[i]);
    return { i, label, v };
  };
  const used = new Set<number>();
  const out: { title: string; rows: Field[] }[] = [];
  for (const [title, names] of SECTIONS[which] || []) {
    const rows: Field[] = [];
    for (const n of names) {
      const i = headers.findIndex((_, j) => key(j) === n);
      if (i < 0) continue;
      used.add(i);
      const f = field(i);
      if (f) rows.push(f);
    }
    if (rows.length) out.push({ title, rows });
  }
  const rest = headers.map((_, i) => i).filter((i) => !used.has(i)).map(field).filter(Boolean) as Field[];
  if (rest.length) out.push({ title: 'Other', rows: rest });
  return out;
}

/* Blank cells are left out of the preview — a wall of empty labels hides the
   few that matter. Flags and the JSON guest list read as people would say them. */
function fmtCell(header: string, v: any): string {
  const h = header.trim().toLowerCase();
  const t = String(v ?? '').trim();
  if (h === 'extra guests') return parseExtraGuests(t).map((g) => g.name).filter((n) => n.trim()).join(', ');
  if (!t) return '';
  if (h === 'repeat flag' || h === 'initial investment flag') return t === '1' ? 'Yes' : t === '0' ? 'No' : t;
  return t;
}

const st = StyleSheet.create({
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  h2: { fontSize: 25, color: C.ink, fontFamily: F.xbold, letterSpacing: -0.6 },
  th: { fontSize: 10, textTransform: 'uppercase', color: C.muted, letterSpacing: 0.4, fontFamily: F.semi, minHeight: 26 },
  colf: {
    borderWidth: 1, borderColor: C.line, borderRadius: 6, paddingVertical: 4, paddingHorizontal: 6,
    fontSize: 12, marginTop: 3, backgroundColor: C.warm2, color: C.ink,
  },
  waitBar: {
    backgroundColor: C.amberbg, borderWidth: 1, borderColor: '#e9d2a3', borderRadius: 12,
    paddingVertical: 9, paddingHorizontal: 12, marginBottom: 10,
  },
  waitTxt: { fontFamily: F.semi, fontSize: 12, color: C.ink, lineHeight: 17 },
  waitLink: { fontFamily: F.bold, fontSize: 12, color: C.amber, marginTop: 4 },
  pager: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 14, paddingTop: 10 },
  pginfo: { fontSize: 12, color: C.muted, fontFamily: F.semi },
  pRow: {
    flexDirection: 'row', justifyContent: 'space-between', gap: 14,
    paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: C.hair,
  },
  pSec: {
    fontFamily: F.bold, fontSize: 11, color: C.blue2, textTransform: 'uppercase',
    letterSpacing: 0.8, marginBottom: 2,
  },
  pLbl: { fontFamily: F.semi, fontSize: 12, color: C.muted, flexShrink: 0, maxWidth: '45%' },
  pVal: { fontFamily: F.semi, fontSize: 13, color: C.ink, flex: 1, textAlign: 'right' },
});
