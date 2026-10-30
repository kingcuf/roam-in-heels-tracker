/* Shared layout for the Add-tab forms.

   FormHeader — the title on the left, every action on the right (Log · Clear ·
   Delete · Save), so saving never means scrolling to the bottom.
   FormCard   — one card per group of fields (Booking, Stay dates, Guests …)
   instead of one long container.
   LogCtx     — lets a form open its record log, which now lives behind a
   button rather than under the form. */
import React, { createContext, useContext } from 'react';
import { Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { C, F, G } from './theme';
import { Btn, Panel } from './ui';
import { Rise } from './motion';
import { SubmitCtx } from './formctx';

export const LogCtx = createContext<{ open: () => void; label: string } | null>(null);

export { SubmitCtx } from './formctx';

/* ── The scroller every form sits in ──
   Sign-in was the only screen in the app that knew the keyboard existed
   (Login.tsx's KeyboardAvoidingView). On a real iPhone, tapping the guest-name
   field on Add Booking raised the keyboard straight over the field and the form
   did not move — the owner's own screenshots show the focused field off-screen
   entirely with the form scrolled back to the top.

   `automaticallyAdjustKeyboardInsets` is UIScrollView's own behaviour: iOS
   grows the scroller's bottom inset by however much of it the keyboard covers
   and scrolls the first responder into what is left. It is a ScrollView prop in
   RN 0.86 (Libraries/Components/ScrollView/ScrollView.js:190), iOS-only, and
   react-native-web drops it — so the web build QA measures is unchanged. It is
   also the only option that does not fight the existing layout: a
   KeyboardAvoidingView around a tab that stays mounted would resize every
   inactive form too, and drafts surviving tab switches is the reason they stay
   mounted.

   app.json now sets softwareKeyboardLayoutMode "resize" explicitly rather than
   relying on an SDK default staying put — but a native Android pass measured
   that under RN 0.86 / Android 15 edge-to-edge the window is NOT resized even
   so (app frame stays [0,0][1080,2400] with the IME over it), so Android must
   consume the IME insets itself and this prop alone will not fix it. That work
   is NOT done, and it also has to cover the sign-in screen, where the PIN box
   and Unlock both sit under the keypad. Recorded as open, not fixed. */
export const FormScroll = React.forwardRef<React.ComponentRef<typeof ScrollView>, React.ComponentProps<typeof ScrollView> & { onSubmit?: () => void }>(
  function FormScroll({ onSubmit, children, contentContainerStyle, ...rest }, ref) {
  return (
    <SubmitCtx.Provider value={onSubmit || null}>
      <ScrollView
        ref={ref}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
        contentContainerStyle={[{ padding: 14, paddingBottom: 60 }, contentContainerStyle]}
        {...rest}
      >
        {children}
      </ScrollView>
    </SubmitCtx.Provider>
  );
});

/* No delete up here, deliberately. Four buttons on a 390 px line wrapped the
   destructive one onto the row directly above the primary one, so "Request
   delete" sat where the thumb goes for "Submit for approval". Delete is never
   the thing being done in a hurry: it lives at the foot of the form, on its own
   line, below everything else. */
export function FormHeader({ title, sub, onSave, saveTitle, saveDisabled, saveKind, showSave = true, onClear, clearTitle = 'Clear' }: {
  title: string; sub?: string;
  onSave: () => void; saveTitle: string; saveDisabled?: boolean; showSave?: boolean;
  /* Demotes the primary button out of gold. Used when the record already has a
     delete waiting on it: the biggest, most-pressed button on the page would
     otherwise replace that delete with a change. */
  saveKind?: 'primary' | 'ghost';
  onClear: () => void; clearTitle?: string;
}) {
  const log = useContext(LogCtx);
  return (
    <View style={st.head}>
      <View style={{ flexShrink: 1, minWidth: 160 }}>
        <Text style={st.h2}>{title}</Text>
        {sub ? <Text style={st.sub}>{sub}</Text> : null}
      </View>
      <View style={st.actions}>
        {log ? <Btn title={'☰ ' + log.label} kind="ghost" onPress={log.open} style={st.btn} /> : null}
        <Btn title={clearTitle} kind="ghost" onPress={onClear} style={st.btn} />
        {showSave ? <Btn title={saveTitle} kind={saveKind || 'primary'} onPress={onSave} disabled={saveDisabled} style={[st.btn, st.save]} /> : null}
      </View>
    </View>
  );
}

/* The same actions again at the end of the form, so a long form can be saved
   from where you finish filling it. No Log button here — that one belongs up top. */
export function FormFooter({ onSave, saveTitle, saveDisabled, saveKind, showSave = true, onClear, clearTitle = 'Clear', onDelete, deleteTitle, deleteDisabled }: {
  title?: string; sub?: string;
  onSave: () => void; saveTitle: string; saveDisabled?: boolean; showSave?: boolean;
  saveKind?: 'primary' | 'ghost';
  onClear: () => void; clearTitle?: string;
  onDelete?: () => void; deleteTitle?: string; deleteDisabled?: boolean;
}) {
  return (
    <>
      <View style={[st.actions, st.foot]}>
        <Btn title={clearTitle} kind="ghost" onPress={onClear} style={st.btn} />
        {showSave ? <Btn title={saveTitle} kind={saveKind || 'primary'} onPress={onSave} disabled={saveDisabled} style={[st.btn, st.save]} /> : null}
      </View>
      {/* Below the rule, left-aligned, opposite corner to the primary button. */}
      {onDelete ? (
        <View style={st.danger}>
          <Btn title={deleteTitle || 'Delete'} kind="danger" onPress={onDelete} disabled={deleteDisabled} style={st.btn} />
        </View>
      ) : null}
    </>
  );
}

export function FormCard({ title, note, step, children, i = 0 }: {
  title: string; note?: string; step?: number; children: React.ReactNode; i?: number;
}) {
  return (
    <Rise i={i}>
      <Panel>
        <View style={st.cardHead}>
          {step ? <View style={st.step}><Text style={st.stepTxt}>{step}</Text></View> : null}
          <View style={{ flex: 1 }}>
            <Text style={st.cTitle}>{title}</Text>
            {note ? <Text style={st.cNote}>{note}</Text> : null}
          </View>
        </View>
        {children}
      </Panel>
    </Rise>
  );
}

/* Two fields side by side; stacks on a narrow phone. */
export function Two({ children }: { children: React.ReactNode }) {
  return <View style={st.two}>{children}</View>;
}
export function Col({ children }: { children: React.ReactNode }) {
  return <View style={st.col}>{children}</View>;
}

const st = StyleSheet.create({
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 10 },
  h2: { fontSize: 25, color: C.ink, fontFamily: F.xbold, letterSpacing: -0.6 },
  sub: { fontFamily: F.med, fontSize: 12, color: C.bark, marginTop: 2 },
  /* maxWidth clamps this to the line. In the footer `actions` IS the outer
     container, so it inherits the page width and its flexWrap works — the four
     buttons wrap and Submit stays on screen. In the header it is a flex ITEM
     inside `head`, so it was sized to max-content (measured 488 px inside a
     390 px page) and its own flexWrap never had a narrower line to wrap onto;
     the row was simply clipped by an ancestor, which is why it caused no
     page-level overflow and measured clean. */
  actions: {
    flexDirection: 'row', gap: 8, alignItems: 'center', flexWrap: 'wrap',
    justifyContent: 'flex-end', marginLeft: 'auto', maxWidth: '100%',
  },
  /* flexShrink:0 so the row WRAPS instead of squeezing. react-native-web resets
     flex items to min-width:0, so four buttons (☰ Log · Cancel edit · Request
     delete · Submit for approval) on a 390 px phone were compressed past their
     text rather than wrapping, and the primary action showed as "S…" half off
     the right edge. Nothing overflows the page, which is why this measured
     clean — the clipping is inside the row. */
  btn: { paddingVertical: 10, paddingHorizontal: 16, flexShrink: 0 },
  foot: { marginTop: 4, marginBottom: 8 },
  danger: {
    flexDirection: 'row', justifyContent: 'flex-start',
    borderTopWidth: 1, borderTopColor: C.line, paddingTop: 14, marginTop: 10, marginBottom: 8,
  },
  save: { paddingHorizontal: 22 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  step: {
    width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(233,185,110,0.22)', borderWidth: 1, borderColor: 'rgba(185,128,54,0.3)',
  },
  stepTxt: { fontFamily: F.xbold, fontSize: 12, color: G.gold3 },
  cTitle: { fontFamily: F.xbold, fontSize: 15, color: C.ink, letterSpacing: -0.2 },
  cNote: { fontFamily: F.med, fontSize: 11.5, color: C.muted, marginTop: 2, lineHeight: 16 },
  two: { flexDirection: 'row', gap: 12, flexWrap: 'wrap' },
  col: { flexGrow: 1, flexBasis: 240 },
});
