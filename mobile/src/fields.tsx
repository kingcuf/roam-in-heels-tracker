import React, { useContext, useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, Text, TextInput, TouchableOpacity, View, Modal, Pressable } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { C, F } from './theme';
import { PickerModal, Btn, SheetShell } from './ui';
import { CI_MON } from './logic';
import { moneyFilter } from './money';
import { SubmitCtx } from './formctx';

/* `err` is the complaint about THIS field, shown under it and echoed as a red
   border on the control inside. The red bar at the foot of the screen named the
   field correctly but sat two thirds of a page away from it, so reading the
   complaint and finding the box were separate jobs. */
export function Field({ label, req, hint, err, children }: {
  label: string; req?: boolean; hint?: string; err?: string; children: React.ReactNode;
}) {
  return (
    <View style={{ marginBottom: 13 }}>
      <Text style={st.lbl}>
        {label}{req ? <Text style={{ color: C.red }}> *</Text> : null}
      </Text>
      <ErrCtx.Provider value={!!err}>{children}</ErrCtx.Provider>
      {err ? <Text style={st.err}>{err}</Text> : hint ? <Text style={st.hint}>{hint}</Text> : null}
    </View>
  );
}
/* Set by Field so the control inside can turn red without every caller having
   to thread the flag through. */
const ErrCtx = React.createContext(false);

export function TxtInput({ value, onChange, placeholder, keyboardType, onBlur, onFocus, signed, multiline, money, autoFocus, autoCapitalize }: {
  value: string; onChange: (s: string) => void; placeholder?: string;
  keyboardType?: 'default' | 'numeric' | 'phone-pad'; onBlur?: () => void; onFocus?: () => void; signed?: boolean;
  multiline?: boolean;
  /* An amount of money. Filters what may be typed through the one shared
     grammar in money.ts, and asks for a keypad that HAS a decimal point —
     'numeric' gives the iOS keypad without one, so 1250.50 was untypable. */
  money?: boolean;
  autoFocus?: boolean;
  autoCapitalize?: 'none' | 'sentences' | 'words';
}) {
  /* `signed` = this amount may legitimately be negative (a loss-making booking).
     Typing the minus is the hard part, not storing it: iOS's 'numeric' pad has no
     minus key at all, and on the web build keyboardType 'numeric' becomes
     inputMode="numeric", which is the same minus-less keypad in a phone browser.
     So iOS gets the punctuation keyboard, and every platform gets a ± button —
     the only entry route that works on a bare numeric keypad. */
  const iosSigned = signed && Platform.OS === 'ios';
  const bad = useContext(ErrCtx);
  const submit = useContext(SubmitCtx);
  /* What the money filter last refused, said under the box. Without it the
     filter quietly turned a typo into a different, perfectly valid figure —
     '12ab34' into 1234 — and the only person who could have caught it was
     never told anything had happened. */
  const [note, setNote] = useState('');
  const noteT = useRef<any>(null);
  /* The form clearing itself after a save does not unmount this box, so a note
     from the last entry would otherwise sit under an empty field. */
  useEffect(() => { if (!value) setNote(''); }, [value]);
  useEffect(() => () => { if (noteT.current) clearTimeout(noteT.current); }, []);
  const onMoney = (v: string) => {
    const r = moneyFilter(v, signed);
    /* It stays for a few seconds rather than until the next keystroke. Typing
       "12ab34" refuses the 'a' and the 'b' and then takes 3 and 4 quite
       happily, so a note that cleared on the next good character would have
       flashed for two keystrokes of a six-keystroke typo and been gone by the
       time anyone looked down. Same few seconds as a toast. */
    if (r.note) {
      setNote(r.note);
      if (noteT.current) clearTimeout(noteT.current);
      noteT.current = setTimeout(() => setNote(''), 4000);
    }
    onChange(r.text);
  };
  const input = (
    <TextInput
      value={value}
      onChangeText={money ? onMoney : onChange}
      placeholder={placeholder} placeholderTextColor="#C0BFC6"
      keyboardType={iosSigned ? 'numbers-and-punctuation' : money ? 'decimal-pad' : (keyboardType || 'default')}
      multiline={multiline}
      /* iOS already top-aligns a multiline field; Android centres it, which
         leaves a one-line note floating in the middle of the box. */
      style={[st.input, bad ? st.inputErr : null,
        /* `minWidth: 0` is load-bearing, not tidying: RN Web's `flex: 1` leaves
           `min-width: auto`, so this input kept its ~178px intrinsic width in a
           160px row and shoved the ± button off screen — 4px of it left on a
           390px phone. On iOS that button is the only way to type a negative,
           so a loss-making booking was unenterable. */
        signed ? { flex: 1, minWidth: 0 } : null, multiline ? st.multi : null]}
      onBlur={onBlur}
      onFocus={onFocus}
      autoCapitalize={autoCapitalize || (keyboardType || money ? 'none' : 'sentences')} autoCorrect={false}
      autoFocus={autoFocus}
      /* Enter did nothing on every form, so submitting always needed a pointer.
         The form publishes its own submit through SubmitCtx; a single-line box
         says "Done" and uses it. A notes box keeps its newline. */
      enterKeyHint={multiline ? 'enter' : submit ? 'done' : 'next'}
      blurOnSubmit={!multiline}
      onSubmitEditing={multiline || !submit ? undefined : submit}
    />
  );
  /* Amber, not red: nothing is broken and nothing has to be fixed — the box
     simply did not take that character, and this says which. It sits where the
     field's own hint sits, under the box, so it is read in the same place as
     every other thing a field says about itself.

     The wrapper is ALWAYS rendered, never only when there is something to say:
     switching the returned element between an input and a view around it makes
     React throw the input away and build a new one, which drops the keyboard
     and the caret on the very keystroke the note is about. */
  const withNote = (ctl: React.ReactNode) => (
    <View>{ctl}{note ? <Text style={st.note}>{note}</Text> : null}</View>
  );
  if (!signed) return withNote(input);

  const neg = value.trim().startsWith('-');
  const flip = () => {
    const v = value.trim();
    /* Nothing to negate. Pressing ± on an empty box used to leave a lone '-',
       which is not a number: submit then failed validation and, on Android, the
       form jumped to the top with the complaint off-screen, so nothing appeared
       to happen at all. */
    if (!v || v === '-') { onChange(''); return; }
    onChange(neg ? v.replace(/^-\s*/, '') : '-' + v);
  };
  return withNote(
    <View style={{ flexDirection: 'row', gap: 8 }}>
      {input}
      <TouchableOpacity
        style={[st.clearBtn, neg ? { backgroundColor: C.redbg, borderColor: C.red } : null]}
        onPress={flip} activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel={neg ? 'Make positive' : 'Make negative'}
      >
        <Text style={{ fontSize: 17, fontFamily: F.bold, color: neg ? C.red : C.bark }}>±</Text>
      </TouchableOpacity>
    </View>
  );
}

export function SelectField({ value, options, onChange, title, allowEmpty }: {
  value: string; options: string[]; onChange: (v: string) => void; title: string; allowEmpty?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const bad = useContext(ErrCtx);
  const opts = allowEmpty ? ['', ...options] : options;
  return (
    <>
      <TouchableOpacity style={[st.input, bad ? st.inputErr : null]} onPress={() => setOpen(true)} activeOpacity={0.7}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Text style={{ fontSize: 14, color: value ? C.ink : '#C0BFC6', flex: 1 }}>{value || 'Select…'}</Text>
          <Text style={{ color: C.muted }}>▾</Text>
        </View>
      </TouchableOpacity>
      <PickerModal visible={open} title={title} options={opts} value={value} onSelect={onChange} onClose={() => setOpen(false)} />
    </>
  );
}

/* ── Date field (YYYY-MM-DD) using the native picker ── */
export function DateField({ value, onChange, allowClear }: {
  value: string; onChange: (v: string) => void; allowClear?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const d = value ? new Date(value + 'T00:00:00') : new Date();
  const iso = (dt: Date) => {
    const z = (n: number) => (n < 10 ? '0' : '') + n;
    return dt.getFullYear() + '-' + z(dt.getMonth() + 1) + '-' + z(dt.getDate());
  };
  /* Web has no DateTimePicker: @react-native-community/datetimepicker ships no
     web implementation, so the android/ios branches below both compile out and
     the field became a button that opened nothing — dates were unenterable on
     dashboard.roam-in-heels.com. react-native-web renders to the DOM, so the
     browser's own date input is used here instead. Native never evaluates this
     branch, so <input> stays out of the native tree. */
  if (Platform.OS === 'web') {
    return (
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {React.createElement('input', {
          type: 'date',
          value: value || '',
          onChange: (e: any) => onChange(e.target.value || ''),
          style: {
            flex: 1, width: '100%', boxSizing: 'border-box', minHeight: 43,
            padding: '10px 11px', border: '1px solid ' + C.line, borderRadius: 10,
            fontSize: 14, fontFamily: 'inherit', backgroundColor: '#fff',
            color: value ? C.ink : '#C0BFC6', outline: 'none',
          },
        } as any)}
        {allowClear && !!value && (
          <TouchableOpacity style={st.clearBtn} onPress={() => onChange('')}>
            <Text style={{ color: C.muted, fontSize: 16 }}>×</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }
  return (
    <>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <TouchableOpacity style={[st.input, { flex: 1 }]} onPress={() => setOpen(true)} activeOpacity={0.7}>
          <Text style={{ fontSize: 14, color: value ? C.ink : '#C0BFC6' }}>{value || 'Pick a date…'}</Text>
        </TouchableOpacity>
        {allowClear && !!value && (
          <TouchableOpacity style={st.clearBtn} onPress={() => onChange('')}>
            <Text style={{ color: C.muted, fontSize: 16 }}>×</Text>
          </TouchableOpacity>
        )}
      </View>
      {open && Platform.OS === 'android' && (
        <DateTimePicker
          value={d} mode="date"
          onChange={(ev, dt) => { setOpen(false); if (ev.type === 'set' && dt) onChange(iso(dt)); }}
        />
      )}
      {Platform.OS === 'ios' && (
        <SheetShell visible={open} onClose={() => setOpen(false)}>
          <View style={st.iosPick}>
            <DateTimePicker value={d} mode="date" display="spinner" themeVariant="light"
              onChange={(_, dt) => { if (dt) onChange(iso(dt)); }} />
            <Btn title="Done" onPress={() => { if (!value) onChange(iso(d)); setOpen(false); }} />
          </View>
        </SheetShell>
      )}
    </>
  );
}

/* ── Month field (YYYY-MM) — custom grid, matches <input type=month> ── */
export function MonthField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const now = new Date();
  const initY = value ? parseInt(value.slice(0, 4), 10) : now.getFullYear();
  const [yr, setYr] = useState(initY);
  const selM = value ? parseInt(value.slice(5, 7), 10) : 0;
  const label = value
    ? CI_MON[parseInt(value.slice(5, 7), 10) - 1] + ' ' + value.slice(0, 4)
    : '';
  return (
    <>
      <TouchableOpacity style={st.input} onPress={() => { setYr(initY); setOpen(true); }} activeOpacity={0.7}>
        <Text style={{ fontSize: 14, color: value ? C.ink : '#C0BFC6' }}>{label || 'Pick a month…'}</Text>
      </TouchableOpacity>
      <SheetShell visible={open} onClose={() => setOpen(false)}>
        <View style={st.iosPick}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <TouchableOpacity onPress={() => setYr(yr - 1)} style={st.yrBtn}><Text style={st.yrTxt}>‹</Text></TouchableOpacity>
            <Text style={{ fontSize: 17, fontFamily: F.bold, color: C.navy }}>{yr}</Text>
            <TouchableOpacity onPress={() => setYr(yr + 1)} style={st.yrBtn}><Text style={st.yrTxt}>›</Text></TouchableOpacity>
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            {CI_MON.map((m, i) => {
              const sel = yr === initY && i + 1 === selM;
              return (
                <TouchableOpacity key={m} style={[st.mCell, sel && { backgroundColor: C.blue }]}
                  onPress={() => {
                    const z = (n: number) => (n < 10 ? '0' : '') + n;
                    onChange(yr + '-' + z(i + 1)); setOpen(false);
                  }}>
                  <Text style={{ color: sel ? '#fff' : C.ink, fontFamily: F.semi }}>{m}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      </SheetShell>
    </>
  );
}

/* ── Time field: same 48 half-hour options as the web ── */
export const TIME_OPTS = (() => {
  const o: string[] = [];
  for (let i = 0; i < 48; i++) {
    const hr = Math.floor(i / 2), mm = i % 2 ? '30' : '00', ap = hr < 12 ? 'AM' : 'PM', h12 = hr % 12 || 12;
    o.push(h12 + ':' + mm + ' ' + ap);
  }
  return o;
})();
export function TimeField({ value, onChange, title }: { value: string; onChange: (v: string) => void; title: string }) {
  return <SelectField value={value} options={TIME_OPTS} onChange={onChange} title={title} allowEmpty />;
}

const st = StyleSheet.create({
  lbl: { fontSize: 12, fontFamily: F.semi, color: C.bark, marginBottom: 5 },
  hint: { fontSize: 11, color: C.muted, marginTop: 4 },
  err: { fontSize: 11.5, color: C.red, marginTop: 4, fontFamily: F.semi },
  note: { fontSize: 11.5, color: C.amber, marginTop: 4, fontFamily: F.semi },
  inputErr: { borderColor: C.red, backgroundColor: C.redbg },
  input: {
    paddingVertical: 11, paddingHorizontal: 11, borderWidth: 1, borderColor: C.line,
    borderRadius: 10, fontSize: 14, backgroundColor: '#fff', color: C.ink, justifyContent: 'center',
  },
  multi: { minHeight: 96, paddingTop: 11, textAlignVertical: 'top' },
  clearBtn: {
    width: 42, borderWidth: 1, borderColor: C.line, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center', backgroundColor: C.bone,
  },
  ovl: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, backgroundColor: 'rgba(15,42,51,.42)' },
  iosPick: { padding: 18, paddingTop: 6, paddingBottom: 34 },
  yrBtn: { backgroundColor: C.bone, borderRadius: 8, width: 40, height: 36, alignItems: 'center', justifyContent: 'center' },
  yrTxt: { fontSize: 20, color: C.blue, fontFamily: F.bold },
  mCell: {
    width: '25%', paddingVertical: 14, alignItems: 'center', borderRadius: 10,
  },
});
