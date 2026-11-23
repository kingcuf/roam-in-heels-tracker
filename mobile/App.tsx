import React from 'react';
import {
  ActivityIndicator, Image, ScrollView, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  useFonts, Manrope_400Regular, Manrope_500Medium, Manrope_600SemiBold,
  Manrope_700Bold, Manrope_800ExtraBold,
} from '@expo-google-fonts/manrope';
import { C, F, G } from './src/theme';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { Backdrop, Glass, TabStage } from './src/motion';
import { ToastProvider, ConfirmHost, Loader, Segmented, Sheet, Btn } from './src/ui';
import { StoreProvider, useStore, Tab, AddSeg } from './src/store';
import { TAB_ICONS } from './src/icons';
import Login from './src/screens/Login';
import ActionScreen from './src/screens/ActionScreen';
import CalendarScreen from './src/screens/CalendarScreen';
import Dashboard from './src/screens/Dashboard';
import BookingForm from './src/screens/BookingForm';
import ExpenseForm from './src/screens/ExpenseForm';
import SavingForm from './src/screens/SavingForm';
import PropertyForm from './src/screens/PropertyForm';
import LogsScreen from './src/screens/LogsScreen';
import Properties from './src/screens/Properties';
import Inventory from './src/screens/Inventory';
import IdSheet from './src/screens/IdSheet';
import BookingPage from './src/screens/BookingPage';
import MessageLibrary from './src/screens/MessageLibrary';
import UnitGallery from './src/screens/UnitGallery';
import Hosts from './src/screens/Hosts';
import { hostTotals } from './src/logic';
import { inr } from './src/theme';
import TeamScreen from './src/screens/TeamScreen';
import IntroFilm from './src/intro/IntroFilm';
import { markIntroPlayed, shouldPlayIntro } from './src/intro/policy';
import { introStarted } from './src/intro/cue';
import { LogCtx } from './src/formkit';
import { api } from './src/api';

// Action is the default landing tab: the app opens on what needs doing.
// Each tab only renders if the signed-in role's rights allow it (store.tabs).
const TABS: { key: Tab; label: string }[] = [
  { key: 'action', label: 'Action' },
  { key: 'cal', label: 'Calendar' },
  { key: 'dash', label: 'Report' },
  { key: 'add', label: 'Add' },
  { key: 'team', label: 'Team' },
];

/* Add = Booking | Expense | Saving | Property | Inventory.
   Each segment pairs its form with that record's log directly beneath, which is
   what removed the separate Logs and Inventory tabs. All segments stay mounted
   so switching never loses a typed draft. */
const ADD_SEGMENTS: { key: AddSeg; label: string }[] = [
  { key: 'book', label: 'Booking' },
  { key: 'exp', label: 'Expense' },
  { key: 'sav', label: 'Saving' },
  { key: 'prop', label: 'Property' },
  { key: 'inv', label: 'Inventory' },
  { key: 'msg', label: 'Messages' },
  { key: 'host', label: 'Hosts' },
];

/* One Add segment: the form, with its record log a tap away behind the
   header's Log button (it used to hang under the form and pushed Save out of
   reach). Opening a record for editing from the log returns to the form. */
function FormPane({ form, log, label, editing }: {
  form: React.ReactNode; log: React.ReactNode; label: string; editing: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => { if (editing) setOpen(false); }, [editing]);
  return (
    <LogCtx.Provider value={{ open: () => setOpen(true), label: 'Log' }}>
      <View style={[{ flex: 1 }, open && st.hidden]}>{form}</View>
      {open ? (
        <View style={{ flex: 1 }}>
          <View style={st.logBar}>
            <TouchableOpacity onPress={() => setOpen(false)} style={st.logBack} activeOpacity={0.7}>
              <Text style={st.logBackTxt}>‹  Back to form</Text>
            </TouchableOpacity>
            <Text style={st.logLabel}>{label} log</Text>
          </View>
          <View style={{ flex: 1 }}>{log}</View>
        </View>
      ) : null}
    </LogCtx.Provider>
  );
}

/* Setup = the catalog behind the daily forms: units, stock, message library.
   Each opens from a hub card and returns to it, so the top bar carries only
   the three things recorded every day. */
const SETUP: { key: AddSeg; label: string; icon: string; desc: string }[] = [
  { key: 'prop', label: 'Properties', icon: '⌂', desc: 'Units, rent, guest info for messages' },
  { key: 'inv', label: 'Inventory', icon: '▤', desc: 'Linen, toiletries and stock per unit' },
  { key: 'msg', label: 'Messages', icon: '✉', desc: 'WhatsApp templates for guests and hosts' },
  { key: 'host', label: 'Hosts', icon: '⇄', desc: 'Partner hosts, their units, and who owes whom' },
];
const hostSub = (s: ReturnType<typeof useStore>) => {
  const t = hostTotals(s.logs?.hosts, s.logs?.bookings?.rows || []);
  return t.weOwe < 1 && t.owedToUs < 1 ? 'All settled with every host'
    : [t.weOwe >= 1 ? 'You owe ' + inr(t.weOwe) : '', t.owedToUs >= 1 ? 'Owed to you ' + inr(t.owedToUs) : ''].filter(Boolean).join(' · ');
};
const SETUP_KEYS: AddSeg[] = ['prop', 'inv', 'msg', 'host'];

function AddContainer() {
  const s = useStore();
  const [hub, setHub] = React.useState(false);
  const setup = SETUP.filter((x) => s.addSegs.includes(x.key));
  const inSetup = SETUP_KEYS.includes(s.addSeg);
  /* Something outside opened a Setup pane (e.g. "Edit property"): show it. */
  React.useEffect(() => { if (!inSetup) setHub(false); }, [inSetup]);
  React.useEffect(() => { if (s.editP && s.addSeg === 'prop') setHub(false); }, [s.editP]);
  const segs = [
    ...ADD_SEGMENTS.filter((g) => !SETUP_KEYS.includes(g.key) && s.addSegs.includes(g.key)).map((g) => ({
      key: g.key as string, label: g.label,
      dot: (g.key === 'book' && !!s.editB) || (g.key === 'exp' && !!s.editE) || (g.key === 'sav' && !!s.editS),
    })),
    ...(setup.length ? [{ key: 'setup', label: 'Setup', dot: !!s.editP || !!s.invEdit }] : []),
  ];
  const value = inSetup ? 'setup' : s.addSeg;
  const showHub = inSetup ? hub : false;
  const pane = (k: AddSeg) => s.addSeg !== k || (SETUP_KEYS.includes(k) && showHub);
  const back = setup.length > 1 ? (
    <TouchableOpacity onPress={() => setHub(true)} style={st.setupBack} activeOpacity={0.7} hitSlop={6}>
      <Text style={st.logBackTxt}>‹  Setup</Text>
    </TouchableOpacity>
  ) : null;
  return (
    <View style={{ flex: 1 }}>
      <Segmented
        segments={segs}
        value={value}
        onChange={(k) => {
          if (k !== 'setup') { s.setAddSeg(k as AddSeg); return; }
          if (setup.length === 1) { s.setAddSeg(setup[0].key); setHub(false); return; }
          if (!inSetup) s.setAddSeg(setup[0].key);
          setHub(true);
        }}
      />
      {/* A segment the role has no rights on is not mounted at all. */}
      {s.addSegs.includes('book') && (
        <View style={[{ flex: 1 }, pane('book') && st.hidden]}>
          <FormPane form={<BookingForm />} log={<LogsScreen which="blog" />} label="Booking" editing={!!s.editB} />
        </View>
      )}
      {s.addSegs.includes('exp') && (
        <View style={[{ flex: 1 }, pane('exp') && st.hidden]}>
          <FormPane form={<ExpenseForm />} log={<LogsScreen which="elog" />} label="Expense" editing={!!s.editE} />
        </View>
      )}
      {s.addSegs.includes('sav') && (
        <View style={[{ flex: 1 }, pane('sav') && st.hidden]}>
          <FormPane form={<SavingForm />} log={<LogsScreen which="slog" />} label="Saving" editing={!!s.editS} />
        </View>
      )}
      {showHub ? (
        <ScrollView contentContainerStyle={{ padding: 14, gap: 10, paddingBottom: 120 }}>
          <Text style={st.hubH}>Setup</Text>
          <Text style={st.hubSub}>The details every booking draws on. Changed now and then, not every day.</Text>
          <TouchableOpacity style={st.hubCard} activeOpacity={0.8} onPress={() => s.openGallery('')}>
            <View style={st.hubIcon}><Text style={st.hubIconT}>▦</Text></View>
            <View style={{ flex: 1 }}>
              <Text style={st.hubT}>Unit photos</Text>
              <Text style={st.hubD}>Each unit’s album — send photos or a link on WhatsApp</Text>
            </View>
            <Text style={st.hubChev}>›</Text>
          </TouchableOpacity>
          {setup.map((x) => (
            <TouchableOpacity key={x.key} style={st.hubCard} activeOpacity={0.8}
              onPress={() => { s.setAddSeg(x.key); setHub(false); }}>
              <View style={st.hubIcon}><Text style={st.hubIconT}>{x.icon}</Text></View>
              <View style={{ flex: 1 }}>
                <Text style={st.hubT}>{x.label}</Text>
                <Text style={st.hubD}>{x.key === 'host' && s.logs?.hosts?.hosts.length ? hostSub(s) : x.desc}</Text>
              </View>
              {(x.key === 'prop' && s.editP) || (x.key === 'inv' && s.invEdit) ? <View style={st.hubDot} /> : null}
              <Text style={st.hubChev}>›</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      ) : null}
      {s.addSegs.includes('prop') && (
        <View style={[{ flex: 1 }, pane('prop') && st.hidden]}>
          {back}
          <FormPane form={<PropertyForm />} log={<Properties />} label="Property" editing={!!s.editP} />
        </View>
      )}
      {/* Inventory keeps its own items/movements handling internally. */}
      {s.addSegs.includes('inv') && (
        <View style={[{ flex: 1 }, pane('inv') && st.hidden]}>{back}<Inventory /></View>
      )}
      {s.addSegs.includes('host') && (
        <View style={[{ flex: 1 }, pane('host') && st.hidden]}>{s.hostFocus ? null : back}<Hosts /></View>
      )}
      {/* The message library (Admin only — see store.addSegs). */}
      {s.addSegs.includes('msg') && (
        <View style={[{ flex: 1 }, pane('msg') && st.hidden]}>{back}<MessageLibrary /></View>
      )}
    </View>
  );
}

function Root() {
  const s = useStore();
  const insets = useSafeAreaInsets();

  if (s.booting) {
    return (
      <View style={st.boot}>
        <StatusBar style="dark" />
        <ActivityIndicator color={C.navy} size="large" />
      </View>
    );
  }
  if (!s.loggedIn) {
    return (
      <>
        <StatusBar style="dark" />
        <Login />
      </>
    );
  }

  const onTab = (t: Tab) => {
    if (t === s.tab) { s.retap(); return; }                    // re-tap → scroll to top
    if (t === 'add') {
      if (s.editB) s.setAddSeg('book');                        // land on the editing segment
      else if (s.editE) s.setAddSeg('exp');
      else if (s.editS) s.setAddSeg('sav');
      else if (s.editP) s.setAddSeg('prop');
      s.maybeReloadLogs();                                     // logs now live here
    }
    if (t === 'action' || t === 'cal') s.maybeReloadLogs();    // both are entirely log-derived
    if (t === 'team') s.maybeReloadTickets();
    s.setTab(t);
  };
  /* Team badge: requests waiting for me + my requests that were sent back. */
  const teamBadge =
    (s.tickets?.review || []).filter((x) => x.status === 'pending').length +
    (s.tickets?.mine || []).filter((x) => x.status === 'open').length;

  return (
    <View style={[st.safe, { paddingTop: insets.top }]}>
      <StatusBar style="dark" />
      <Backdrop />
      {/* The brand header belongs to the home (Action) tab only; the other
          tabs give that height to their own content. Sign out lives in
          Team → Account. */}
      {s.tab === 'action' && !s.actionDeep && <Glass style={st.header} radius={26} strong>
        <View style={st.headerRow}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 }}>
            {/* Your own photo once you have one; the brand mark until then. */}
            <Image
              source={s.me?.avatarAt ? { uri: api.avatarUrl(s.pin, s.me.id, s.me.avatarAt) } : require('./assets/logo.png')}
              style={st.logo}
            />
            <View style={{ flex: 1 }}>
              <Text style={st.title} numberOfLines={1}>Roam in Heels</Text>
            </View>
          </View>
          {/* Unit photos, one tap from home: "send me pictures of 3028". */}
          <TouchableOpacity style={st.photosBtn} onPress={() => s.openGallery('')} activeOpacity={0.7} accessibilityLabel="Unit photos">
            <Text style={st.photosBtnT}>Photos</Text>
          </TouchableOpacity>
          <TouchableOpacity style={st.refresh} onPress={() => s.refresh()} activeOpacity={0.7} accessibilityLabel="Refresh">
            <Text style={{ color: '#fff', fontFamily: F.bold, fontSize: 15 }}>↻</Text>
          </TouchableOpacity>
        </View>
      </Glass>}

      {/* all containers stay mounted so drafts survive tab switches */}
      <View style={{ flex: 1 }}>
        <TabStage active={s.tab === 'action'}><ActionScreen /></TabStage>
        <TabStage active={s.tab === 'cal'}><CalendarScreen /></TabStage>
        <TabStage active={s.tab === 'dash'}><Dashboard /></TabStage>
        {s.tabs.includes('add') && <TabStage active={s.tab === 'add'}><AddContainer /></TabStage>}
        <TabStage active={s.tab === 'team'}><TeamScreen /></TabStage>
      </View>

      <TabBar
        tabs={TABS.filter((t) => s.tabs.includes(t.key))}
        active={s.tab} onTab={onTab} badge={teamBadge} bottom={Math.max(insets.bottom, 10)}
      />


      {/* full-screen booking page, over the tabs and the tab bar */}
      <BookingPage />
      <UnitGallery />
      {/* guest-ID upload, opened from the Action tab's IDs pending list */}
      <IdSheet />
      <Loader visible={s.busy} />
    </View>
  );
}

/* Floating glass pill with a sliding gold highlight under the active tab. */
function TabBar({ tabs, active, onTab, badge, bottom }: {
  tabs: { key: Tab; label: string }[]; active: Tab; onTab: (t: Tab) => void; badge: number; bottom: number;
}) {
  const [w, setW] = React.useState(0);
  const idx = Math.max(0, tabs.findIndex((t) => t.key === active));
  const slot = tabs.length ? (w - 12) / tabs.length : 0;
  const x = useSharedValue(0);
  React.useEffect(() => { x.value = withSpring(idx * slot, { damping: 17, stiffness: 190, mass: 0.7 }); }, [idx, slot]);
  const hl = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));
  return (
    <View style={{ paddingHorizontal: 14, paddingBottom: bottom, paddingTop: 6 }}>
      <Glass radius={30} strong>
        <View style={st.tabbar} onLayout={(e) => setW(e.nativeEvent.layout.width)}>
          {w > 0 ? <Animated.View style={[st.tabHl, { width: slot }, hl]} /> : null}
          {tabs.map((t) => {
            const on = active === t.key;
            const Icon = TAB_ICONS[t.key];
            return (
              <TouchableOpacity key={t.key} style={st.tab} onPress={() => onTab(t.key)} activeOpacity={0.7}>
                <View>
                  <Icon active={on} size={t.key === 'add' ? 26 : 23} />
                  {t.key === 'team' && badge > 0 ? (
                    <View style={st.badge}><Text style={st.badgeTxt}>{badge > 9 ? '9+' : badge}</Text></View>
                  ) : null}
                </View>
                <Text style={[st.tabLbl, on && { color: C.ink, fontFamily: F.bold }]}>{t.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </Glass>
    </View>
  );
}

export default function App() {
  /* When the film plays is decided in src/intro/policy.ts — the owner's
     branding, one constant, revertible on its own. The login card is held
     back ONLY when a film is actually going to play, and this initialiser
     runs before Login renders, so it still wins that race. Holding it
     unconditionally (which is what importing IntroFilm used to do) left the
     sign-in screen waiting forever for a cue that was never coming. */
  const [intro, setIntro] = React.useState(() => {
    const play = shouldPlayIntro();
    if (play) introStarted();
    return play;
  });
  const [fontsLoaded] = useFonts({
    Manrope_400Regular, Manrope_500Medium, Manrope_600SemiBold, Manrope_700Bold, Manrope_800ExtraBold,
  });
  if (!fontsLoaded) {
    return (
      <View style={st.boot}>
        <ActivityIndicator color={C.navy} size="large" />
      </View>
    );
  }
  return (
    <SafeAreaProvider>
      <ToastProvider>
        <StoreProvider>
          <Root />
          {/* The app's own answer to "are you sure?", in place of the phone's. */}
          <ConfirmHost />
          {intro ? <IntroFilm onDone={() => { markIntroPlayed(); setIntro(false); }} /> : null}
        </StoreProvider>
      </ToastProvider>
    </SafeAreaProvider>
  );
}

const st = StyleSheet.create({
  photosBtn: { borderRadius: 999, paddingVertical: 8, paddingHorizontal: 13, backgroundColor: 'rgba(255,255,255,0.85)', borderWidth: 1, borderColor: C.line, marginRight: 8 },
  photosBtnT: { fontFamily: F.bold, fontSize: 12.5, color: C.ink },
  setupBack: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 2 },
  hubH: { fontFamily: F.xbold, fontSize: 22, color: C.ink, letterSpacing: -0.5, marginTop: 4 },
  hubSub: { fontFamily: F.med, fontSize: 13, color: C.bark, lineHeight: 19, marginBottom: 4 },
  hubCard: {
    flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16, borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.82)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.9)',
  },
  hubIcon: { width: 44, height: 44, borderRadius: 14, backgroundColor: C.amberbg, alignItems: 'center', justifyContent: 'center' },
  hubIconT: { fontSize: 20, color: C.blue2 },
  hubT: { fontFamily: F.xbold, fontSize: 15.5, color: C.ink },
  hubD: { fontFamily: F.med, fontSize: 12.5, color: C.muted, marginTop: 2 },
  hubDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: C.blue },
  hubChev: { fontFamily: F.bold, fontSize: 22, color: C.muted },
  boot: { flex: 1, backgroundColor: G.bgMid, alignItems: 'center', justifyContent: 'center' },
  safe: { flex: 1, backgroundColor: G.bgMid },
  hidden: { display: 'none' },
  header: { marginHorizontal: 14, marginTop: 8, marginBottom: 4 },
  headerRow: { paddingHorizontal: 14, paddingVertical: 10, flexDirection: 'row', alignItems: 'center' },
  logo: { width: 42, height: 42, borderRadius: 21, borderWidth: 2, borderColor: '#fff' },
  title: { color: C.ink, fontSize: 19, letterSpacing: -0.4, fontFamily: F.xbold },
  sub: { fontSize: 11, color: C.bark, marginTop: 1, fontFamily: F.med },
  signout: {
    backgroundColor: 'rgba(255,255,255,0.8)', borderRadius: 999, paddingVertical: 8, paddingHorizontal: 13,
    borderWidth: 1, borderColor: G.glassLine, marginLeft: 8,
  },
  refresh: {
    backgroundColor: C.navy, borderRadius: 999, width: 36, height: 36, alignItems: 'center', justifyContent: 'center',
  },
  tabbar: { flexDirection: 'row', padding: 6 },
  tabHl: {
    position: 'absolute', top: 6, bottom: 6, left: 6, borderRadius: 24,
    backgroundColor: 'rgba(233,185,110,0.28)', borderWidth: 1, borderColor: 'rgba(185,128,54,0.25)',
  },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 7, gap: 3 },
  tabLbl: { fontSize: 11, color: C.muted, fontFamily: F.semi },
  badge: {
    position: 'absolute', top: -4, right: -10, minWidth: 17, height: 17, borderRadius: 9, paddingHorizontal: 4,
    backgroundColor: C.red, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: '#fff',
  },
  badgeTxt: { color: '#fff', fontSize: 9.5, fontFamily: F.bold },
  logBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingTop: 6, paddingBottom: 4 },
  logBack: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.8)', borderWidth: 1, borderColor: G.glassLine },
  logBackTxt: { fontFamily: F.bold, fontSize: 13, color: C.ink },
  logLabel: {
    fontFamily: F.xbold, fontSize: 11.5, color: C.muted, letterSpacing: 1.1,
    textTransform: 'uppercase',
  },
});
