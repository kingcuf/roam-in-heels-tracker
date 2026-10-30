import React, { useEffect, useRef, useState } from 'react';
import { Image, KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, View } from 'react-native';
import { C, F, G } from '../theme';
import { Glass, GoldFill, PressScale, Rise } from '../motion';
import HeelsArt from '../intro/HeelsArt';
import { useIntroCue } from '../intro/cue';
import { useStore } from '../store';

export default function Login() {
  const { doLogin } = useStore();
  const [user, setUser] = useState('');
  const [pin, setPin] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const pinRef = useRef<React.ComponentRef<typeof TextInput>>(null);
  const userRef = useRef<React.ComponentRef<typeof TextInput>>(null);
  const cue = useIntroCue();
  /* autoFocus was set on the box below and measured as doing nothing:
     react-native-web 0.21 does not put the attribute on the <input> at all, so
     activeElement stayed BODY on eight samples over four seconds. The card is
     also mounted late — it waits for the intro film to hand over — so the one
     moment that could have focused it has passed by then. Doing it here, on the
     cue, is the version that actually runs. */
  useEffect(() => { if (cue) { const t = setTimeout(() => userRef.current?.focus(), 60); return () => clearTimeout(t); } }, [cue]);

  const submit = async () => {
    if (busy) return;
    if (!user.trim()) { setErr('Enter your username.'); return; }
    if (!pin.trim()) { setErr('Enter your PIN.'); return; }
    setErr(''); setBusy(true);
    try {
      await doLogin(user, pin);
    } catch (e: any) {
      const m = e?.message || '';
      if (/pin/i.test(m)) { setErr('Wrong username or PIN, try again.'); setPin(''); }
      else if (/too many/i.test(m)) setErr(m);
      else setErr("Can't reach the API. Check your internet connection.");
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={st.wrap} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <HeelsArt style={StyleSheet.absoluteFill} rest />
      {cue && <Rise i={0} style={st.cardWrap}>
        <Glass radius={32} strong>
          <View style={st.card}>
            <Image source={require('../../assets/logo.png')} style={st.logo} />
            <Text style={st.script}>welcome back</Text>
            <Text style={st.h1}>Roam in Heels</Text>
            <Text style={st.sub}>Sign in with your username and PIN</Text>
            {/* Both required. The built-in owner account signs in as "owner". */}
            {/* The one screen where landing in a field is unambiguously right:
                there is nothing else to do here, and it saves a tap every time
                the app is opened. Deliberately NOT done on the forms — a
                keyboard that jumps up over a long form the moment it opens is
                the complaint this round is already fixing. */}
            <TextInput
              ref={userRef}
              value={user} onChangeText={setUser} placeholder="Username" placeholderTextColor="#B9B3AA"
              autoCapitalize="none" autoCorrect={false} style={st.user}
              autoFocus enterKeyHint="next" autoComplete="username" textContentType="username"
              onSubmitEditing={() => pinRef.current?.focus()}
            />
            {/* A PIN is digits. It carried autocapitalize/autocorrect/spellcheck
                from the platform default — harmless under a password field, but
                the only box in the app whose hints contradict its content, and
                enough to stop a password manager pairing it with the username
                above. */}
            <TextInput
              ref={pinRef}
              value={pin} onChangeText={setPin} placeholder="PIN" placeholderTextColor="#B9B3AA"
              secureTextEntry keyboardType="number-pad" style={st.pin}
              autoCapitalize="none" autoCorrect={false} spellCheck={false}
              autoComplete="current-password" textContentType="password"
              onSubmitEditing={submit} enterKeyHint="go"
            />
            {/* Disabled only while the request is in flight. Greying it out
                until both boxes have content ALSO took it out of the keyboard's
                tab ring (react-native-web gives a disabled Pressable
                tabIndex -1), so the ring measured Username → PIN → header and
                Unlock was never reachable — while submit() has said "Enter your
                username." all along, which is the more useful answer than a
                button that cannot be pressed. */}
            <PressScale onPress={submit} disabled={busy} style={st.btn} label="Unlock">
              <GoldFill />
              <Text style={{ color: '#fff', fontSize: 15.5, fontFamily: F.xbold, letterSpacing: 0.3 }}>{busy ? 'Checking…' : 'Unlock'}</Text>
            </PressScale>
            <Text style={st.err}>{err}</Text>
          </View>
        </Glass>
      </Rise>}
    </KeyboardAvoidingView>
  );
}

const st = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: '#E8C29B', alignItems: 'center', justifyContent: 'flex-end', paddingBottom: 36 },
  cardWrap: { width: 350, maxWidth: '92%' },
  card: { paddingTop: 30, paddingBottom: 18, paddingHorizontal: 26, alignItems: 'center' },
  logo: { width: 64, height: 64, borderRadius: 32, marginBottom: 10, borderWidth: 2, borderColor: '#fff' },
  script: {
    fontFamily: Platform.select({ ios: 'Snell Roundhand', android: 'cursive', default: 'cursive' }),
    fontSize: 22, color: G.gold2, marginBottom: 2,
  },
  h1: { fontFamily: F.xbold, fontSize: 32, color: C.ink, letterSpacing: -1, marginBottom: 4 },
  sub: { color: C.bark, fontSize: 13, marginBottom: 20, fontFamily: F.med },
  user: {
    width: '100%', padding: 14, borderWidth: 1, borderColor: G.glassEdge, borderRadius: 18, marginBottom: 10,
    fontSize: 15, textAlign: 'center', color: C.ink, backgroundColor: 'rgba(255,255,255,0.7)', fontFamily: F.semi,
  },
  pin: {
    width: '100%', padding: 14, borderWidth: 1, borderColor: G.glassEdge, borderRadius: 18,
    fontSize: 20, textAlign: 'center', letterSpacing: 10, color: C.ink, backgroundColor: 'rgba(255,255,255,0.7)',
  },
  btn: {
    marginTop: 18, width: 298, maxWidth: '100%', paddingVertical: 16, borderRadius: 999, alignItems: 'center', overflow: 'hidden',
    shadowColor: G.gold3, shadowOpacity: 0.4, shadowRadius: 16, shadowOffset: { width: 0, height: 8 }, elevation: 5,
  },
  err: { color: C.red, fontSize: 13, marginTop: 12, minHeight: 16, textAlign: 'center', fontFamily: F.med },
});
