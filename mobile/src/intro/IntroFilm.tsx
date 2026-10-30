/* Plays the "Roam in Heels" intro film (see scene.ts) once per app launch.

   Rendering: a JS clock re-renders one SVG from scene(t). The film is 8.6 s
   and the tree is small, so this is simpler and more predictable than
   animating dozens of SVG props natively — and the exact same scene renders
   headless for review (scripts/render-intro.mjs).

   Sound: a heel click at each footstep. assets/sfx/heel1-3.wav are three
   single steps cut from "sound of woman's footsteps in heels" (YouTube
   L_57qXTmLlQ, "royalty free sound effects" channel, credit: davidgreck),
   chosen by the owner. CC0 fallback if ever needed: Freesound #753292
   (Vrymaa, "Footsteps High Heels - Hardwood"). Respects the iPhone silent switch and
   never stops the user's music. Browsers block audio until the page has been
   interacted with, so on the web the film starts muted with a "Tap for
   sound" chip. Reduce-motion users skip the film entirely. */
import React, { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg from 'react-native-svg';
import { SceneDefs, drawNodes, useSvgPrefix } from './svgnodes';
import { useAudioPlayer, setAudioModeAsync } from 'expo-audio';
import { useReducedMotion } from 'react-native-reanimated';
import { C, F, G as GT } from '../theme';
import { CARD_CUE, DURATION, STRIKES, filmOpacity, scene, titleOpacity, titleRise } from './scene';
import { introCue } from './cue';
import { filmViewBox } from './HeelsArt';

/* NOT called here any more. This ran at module scope, so merely importing
   IntroFilm held the login card back — and when the film does not play, the
   cue that releases it never fires and the sign-in screen never appears at
   all. App.tsx now holds the card only when it is actually going to render a
   film, which is the only case that needs holding. */

export default function IntroFilm({ onDone }: { onDone: () => void }) {
  const reduce = useReducedMotion();
  const px = useSvgPrefix();
  const [t, setT] = useState(0);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [muted, setMuted] = useState(Platform.OS === 'web');
  const mutedRef = useRef(muted);
  mutedRef.current = muted;
  const done = useRef(false);
  const clicks = [
    useAudioPlayer(require('../../assets/sfx/heel1.wav')),
    useAudioPlayer(require('../../assets/sfx/heel2.wav')),
    useAudioPlayer(require('../../assets/sfx/heel3.wav')),
  ];

  const finish = () => {
    if (done.current) return;
    done.current = true;
    introCue();
    onDone();
  };

  useEffect(() => {
    if (reduce) { finish(); return; }
    setAudioModeAsync({ playsInSilentMode: false, interruptionMode: 'mixWithOthers' }).catch(() => {});
    clicks.forEach((p) => { try { p.seekTo(0); } catch {} });
    const start = Date.now();
    let next = 0;                     // index into STRIKES
    let raf: any;
    let lastPaint = 0;
    const tick = () => {
      const now = (Date.now() - start) / 1000;
      /* Fire a touch early for output latency. Players are rewound right
         after they play (below), so play() starts instantly on the beat. */
      while (next < STRIKES.length && STRIKES[next] <= now + 0.03) {
        if (!mutedRef.current && now - STRIKES[next] < 0.15) {
          const p = clicks[next % clicks.length];
          try {
            p.volume = next === STRIKES.length - 1 ? 0.9 : 0.6 + 0.1 * (next % 2);
            p.play();
            setTimeout(() => { try { p.pause(); p.seekTo(0); } catch {} }, 420);
          } catch {}
        }
        next++;
      }
      // Each paint re-renders the whole SVG on the JS thread: ~45 fps in the
      // browser, ~30 on phones so the walk stays smooth instead of stuttering.
      if (now - lastPaint > (Platform.OS === 'web' ? 1 / 45 : 1 / 30)) { lastPaint = now; setT(now); }
      if (now >= CARD_CUE) introCue();
      if (now >= DURATION) { finish(); return; }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [reduce]);

  if (reduce) return null;

  const to = titleOpacity(t);
  /* Portrait phones see the authored 390×844 frame. Wider screens widen the
     camera instead of cropping into it (the scenery extends sideways). */
  const viewBox = filmViewBox(size.w, size.h);
  return (
    <View
      style={[StyleSheet.absoluteFill, st.wrap, { opacity: filmOpacity(t) }]}
      onLayout={(e) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
    >
      <Svg width="100%" height="100%" viewBox={viewBox} preserveAspectRatio="xMidYMid slice">
        <SceneDefs px={px} />
        {drawNodes(scene(t), px)}
      </Svg>

      {to > 0 ? (
        <View pointerEvents="none" style={[st.titleWrap, { opacity: to, transform: [{ translateY: 18 * titleRise(t) }] }]}>
          <Text style={st.script}>step into your stay</Text>
          <Text style={st.title}>Roam in Heels</Text>
          <View style={st.rule} />
        </View>
      ) : null}

      <View style={st.controls}>
        <Pressable
          onPress={() => setMuted((m) => !m)} style={st.chip} hitSlop={8}
          accessibilityLabel={muted ? 'Turn sound on' : 'Turn sound off'}
        >
          <Text style={st.chipTxt}>{muted ? (Platform.OS === 'web' ? '🔈 Tap for sound' : '🔇') : '🔊'}</Text>
        </Pressable>
        <Pressable onPress={finish} style={st.chip} hitSlop={8} accessibilityLabel="Skip intro">
          <Text style={st.chipTxt}>Skip ›</Text>
        </Pressable>
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  wrap: { backgroundColor: '#F4C9B2', zIndex: 1000, elevation: 50 },
  titleWrap: { position: 'absolute', left: 0, right: 0, top: '14%', alignItems: 'center' },
  script: {
    fontFamily: Platform.select({ ios: 'Snell Roundhand', android: 'cursive', default: 'cursive' }),
    fontSize: 26, color: GT.gold3,
  },
  title: { fontFamily: F.xbold, fontSize: 42, letterSpacing: -1.4, color: C.ink, marginTop: 2 },
  rule: { width: 56, height: 3, borderRadius: 2, backgroundColor: GT.gold2, marginTop: 12 },
  controls: { position: 'absolute', top: 52, right: 16, flexDirection: 'row', gap: 8 },
  chip: {
    paddingVertical: 8, paddingHorizontal: 14, borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.55)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.8)',
  },
  chipTxt: { fontFamily: F.semi, fontSize: 13, color: C.ink },
});
