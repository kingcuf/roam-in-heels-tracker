/* Motion + depth primitives for the "Glass & depth" redesign.

   Everything visual that moves lives here so screens stay declarative:
     Backdrop   – warm gradient field with slowly drifting light orbs
     Glass      – frosted card (real blur on iOS/web, bright translucent on Android)
     Tilt3D     – card that tilts toward the finger / mouse, with perspective
     Rise       – staggered spring entrance
     PressScale – springy press feedback for any tappable
     CountUp    – numbers that roll to their value
     TabStage   – 3D fold-in when a (kept-mounted) tab becomes active

   Reanimated honours the OS "reduce motion" setting by default; the few
   JS-driven effects here (CountUp, orb drift) check useReducedMotion too. */
import React, { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View, ViewStyle, TextStyle, StyleProp } from 'react-native';
import Animated, {
  FadeInDown, interpolate, useAnimatedStyle, useReducedMotion, useSharedValue, withSpring,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { G, groupINR } from './theme';

const WEB = Platform.OS === 'web';
const SPRING = { damping: 16, stiffness: 180, mass: 0.7 };

/* ── Backdrop ── */
/* Static on purpose: drifting blurred orbs under a dozen frosted cards made
   the browser repaint every frame, which read as the whole screen flickering. */
function Orb({ color, size, x, y }: { color: string; size: number; x: number | string; y: number | string }) {
  return (
    <View
      pointerEvents="none"
      style={[
        { position: 'absolute', left: x as any, top: y as any, width: size, height: size, borderRadius: size / 2, backgroundColor: color },
        WEB ? ({ filter: 'blur(48px)' } as any) : null,
      ]}
    />
  );
}

export function Backdrop() {
  return (
    /* overflow:hidden, and it matters far beyond the orbs: the middle orb is
       300 px wide at left 58 %, so on a 390 px phone it stuck 136 px past the
       right edge and made the DOCUMENT 526 px wide. The page could then be
       panned sideways, and a bottom sheet — laid out against the 390 px
       viewport — drew 136 px to the left of where it was read, which is how
       the category picker came to show "ATEGORY" with the first letter of
       every option shaved off. Nothing visible changes: the orbs are blurred
       decoration and were always meant to be clipped by the screen. */
    <View style={[StyleSheet.absoluteFill, { overflow: 'hidden' }]} pointerEvents="none">
      <LinearGradient colors={[G.bgTop, G.bgMid, G.bgBot]} locations={[0, 0.45, 1]} style={StyleSheet.absoluteFill} />
      <Orb color={G.orbA} size={340} x={-90} y={-60} />
      <Orb color={G.orbB} size={300} x="58%" y="34%" />
      <Orb color={G.orbC} size={280} x="-10%" y="72%" />
      {/* Native has no CSS filter. A plain veil softens the orbs — NOT a native
          BlurView: iOS blur layers flash dark while neighbouring views
          re-render or animate (seen in Expo Go as a dark band over the top of
          the screen on every tab switch). */}
      {!WEB ? <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(250,244,236,0.55)' }]} /> : null}
    </View>
  );
}

/* ── Glass ──
   Two layers: the outer one carries the shadow (a clipped view cannot cast
   one on iOS), the inner one clips the blur to the radius. */
export function Glass({ children, style, radius = 22, strong, padding }: {
  children?: React.ReactNode; style?: StyleProp<ViewStyle>; radius?: number; strong?: boolean; padding?: number;
}) {
  const fill = strong ? G.glassHi : G.glass;
  /* Layout props on `style` describe the content, so they belong on the inner
     view — otherwise e.g. Panel style={{ alignItems: 'center' }} does nothing. */
  const flat: any = StyleSheet.flatten(style) || {};
  const inner = {
    ...(padding !== undefined ? { padding } : null),
    ...(flat.alignItems ? { alignItems: flat.alignItems } : null),
    ...(flat.justifyContent ? { justifyContent: flat.justifyContent } : null),
    ...(flat.flexDirection ? { flexDirection: flat.flexDirection, flexWrap: flat.flexWrap, gap: flat.gap } : null),
  };
  return (
    <View style={[st.glassShadow, { borderRadius: radius }, style]}>
      <View
        style={[
          StyleSheet.absoluteFill,
          { borderRadius: radius, overflow: 'hidden', borderWidth: 1, borderColor: G.glassEdge },
          /* Real blur only on the few chrome surfaces (header, tab bar): on
             every card it multiplied repaint cost for no visible gain. */
          WEB && strong ? ({ backdropFilter: 'blur(18px) saturate(160%)', WebkitBackdropFilter: 'blur(18px) saturate(160%)' } as any) : null,
        ]}
        pointerEvents="none"
      >
        {/* Real blur is web-only (backdrop-filter above); native uses a
            brighter translucent fill — see Backdrop for why no BlurView. */}
        <View style={[StyleSheet.absoluteFill, { backgroundColor: WEB && strong ? fill : G.glassHi }]} />
        {/* top sheen */}
        <LinearGradient
          colors={['rgba(255,255,255,0.65)', 'rgba(255,255,255,0)']}
          start={{ x: 0, y: 0 }} end={{ x: 0, y: 0.6 }}
          style={StyleSheet.absoluteFill}
        />
      </View>
      <View style={inner}>{children}</View>
    </View>
  );
}

/* ── Tilt3D ── */
export function Tilt3D({ children, style, onPress, disabled, max = 10 }: {
  children: React.ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void; disabled?: boolean; max?: number;
}) {
  const reduce = useReducedMotion();
  const rx = useSharedValue(0);
  const ry = useSharedValue(0);
  const sc = useSharedValue(1);
  const size = useRef({ w: 1, h: 1 });

  const aim = (x: number, y: number, press: boolean) => {
    if (reduce) return;
    const nx = Math.max(-1, Math.min(1, (x / size.current.w) * 2 - 1));
    const ny = Math.max(-1, Math.min(1, (y / size.current.h) * 2 - 1));
    ry.value = withSpring(nx * max, SPRING);
    rx.value = withSpring(-ny * max, SPRING);
    sc.value = withSpring(press ? 0.97 : 1.02, SPRING);
  };
  const rest = () => {
    rx.value = withSpring(0, SPRING); ry.value = withSpring(0, SPRING); sc.value = withSpring(1, SPRING);
  };
  /* No transform at all while resting: a leftover perspective()/rotate(0) makes
     Chrome rasterise the card as a texture, which softens its edges and text. */
  const a = useAnimatedStyle(() => {
    const still = Math.abs(rx.value) < 0.05 && Math.abs(ry.value) < 0.05 && Math.abs(sc.value - 1) < 0.001;
    if (still) return { transform: [] };
    // Phones: press-in scale only. A 3D-rotated card joins iOS's depth sort and
    // can draw over sheets and overlays.
    return WEB
      ? { transform: [{ perspective: 800 }, { rotateX: rx.value + 'deg' }, { rotateY: ry.value + 'deg' }, { scale: sc.value }] }
      : { transform: [{ scale: sc.value }] };
  });

  const webHover: any = WEB
    ? {
        onPointerMove: (e: any) => {
          const r = e.currentTarget.getBoundingClientRect();
          aim(e.clientX - r.left, e.clientY - r.top, false);
        },
        onPointerLeave: rest,
      }
    : {};

  return (
    <Animated.View style={[style, a]} onLayout={(e) => { size.current = { w: e.nativeEvent.layout.width || 1, h: e.nativeEvent.layout.height || 1 }; }} {...webHover}>
      <Pressable
        disabled={disabled || !onPress}
        onPress={onPress}
        onPressIn={(e) => aim(e.nativeEvent.locationX, e.nativeEvent.locationY, true)}
        onPressOut={rest}
        style={{ flex: 1 }}
      >
        {children}
      </Pressable>
    </Animated.View>
  );
}

/* ── Rise (entrance) ── */
export function Rise({ children, i = 0, style }: { children: React.ReactNode; i?: number; style?: StyleProp<ViewStyle> }) {
  return (
    <Animated.View entering={FadeInDown.delay(Math.min(i, 12) * 55).springify().damping(18)} style={style}>
      {children}
    </Animated.View>
  );
}

/* ── PressScale ── */
export function PressScale({ children, onPress, disabled, style, scaleTo = 0.95, label }: {
  children: React.ReactNode; onPress?: () => void; disabled?: boolean; style?: StyleProp<ViewStyle>; scaleTo?: number;
  /* Pass a label to put this control in the keyboard's tab order. Sign-in's
     Unlock button was not reachable by Tab at all — Enter in the PIN box was
     the only keyboard route into the app. */
  label?: string;
}) {
  const s = useSharedValue(1);
  const a = useAnimatedStyle(() => ({ transform: [{ scale: s.value }] }));
  return (
    <Pressable
      onPress={onPress} disabled={disabled}
      accessibilityRole={label ? 'button' : undefined}
      accessibilityLabel={label}
      focusable={label ? !disabled : undefined}
      onPressIn={() => { s.value = withSpring(scaleTo, SPRING); }}
      onPressOut={() => { s.value = withSpring(1, SPRING); }}
    >
      <Animated.View style={[style, a, disabled && { opacity: 0.55 }]}>{children}</Animated.View>
    </Pressable>
  );
}

/* ── CountUp ──
   Understands the three shapes KPI values arrive in: "₹1,23,456", "42%", 42.
   Anything else is shown as-is. */
function parseVal(v: string | number): { n: number; fmt: (x: number) => string } | null {
  if (typeof v === 'number') return { n: v, fmt: (x) => String(Math.round(x)) };
  const m = /^(-?)₹(-?[\d,]+)$/.exec(v.trim());
  if (m) {
    const n = Number(m[2].replace(/,/g, '')) * (m[1] ? -1 : 1);
    return { n, fmt: (x) => (x < 0 ? '-₹' + groupINR(-x) : '₹' + groupINR(x)) };
  }
  const p = /^(-?\d+)%$/.exec(v.trim());
  if (p) return { n: Number(p[1]), fmt: (x) => Math.round(x) + '%' };
  return null;
}

export function CountUp({ value, style, duration = 900, ...rest }: {
  value: string | number; style?: StyleProp<TextStyle>; duration?: number;
  numberOfLines?: number; adjustsFontSizeToFit?: boolean;
}) {
  const reduce = useReducedMotion();
  const parsed = parseVal(value);
  const [shown, setShown] = useState<string>(parsed ? parsed.fmt(0) : String(value));
  const from = useRef(0);
  useEffect(() => {
    if (!parsed) { setShown(String(value)); return; }
    if (reduce) { setShown(parsed.fmt(parsed.n)); from.current = parsed.n; return; }
    const start = Date.now();
    const a = from.current, b = parsed.n;
    let raf: any;
    const step = () => {
      const t = Math.min(1, (Date.now() - start) / duration);
      const e = 1 - Math.pow(1 - t, 3);
      setShown(parsed.fmt(a + (b - a) * e));
      if (t < 1) raf = requestAnimationFrame(step);
      else from.current = b;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [String(value), reduce]);
  return <Text style={style} {...rest}>{shown}</Text>;
}

/* ── TabStage ──
   Tabs stay mounted (drafts survive) and are hidden with display:none; this
   plays a short 3D fold-in whenever one becomes the visible tab. */
export function TabStage({ active, children }: { active: boolean; children: React.ReactNode }) {
  /* Motion only — no opacity. Fading the whole screen from 0 on every tab
     switch was a large part of the "blinking". */
  const p = useSharedValue(1);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    if (active) { p.value = 0; p.value = withSpring(1, { damping: 20, stiffness: 220 }); }
  }, [active]);
  const a = useAnimatedStyle(() => (p.value > 0.999 ? { transform: [] } : WEB ? {
    transform: [
      { perspective: 1200 },
      { translateY: interpolate(p.value, [0, 1], [10, 0]) },
      { rotateX: interpolate(p.value, [0, 1], [3, 0]) + 'deg' },
    ],
  } : {
    // phones: a plain glide — no 3D layer on a whole screen
    transform: [{ translateY: interpolate(p.value, [0, 1], [10, 0]) }],
  }));
  return <Animated.View style={[{ flex: 1 }, !active && { display: 'none' }, a]}>{children}</Animated.View>;
}

/* Gold gradient pill — primary call-to-action surface. */
export function GoldFill({ style, radius = 999 }: { style?: StyleProp<ViewStyle>; radius?: number }) {
  return (
    <LinearGradient
      colors={[G.gold1, G.gold2, G.gold3]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
      style={[StyleSheet.absoluteFill, { borderRadius: radius }, style]}
    />
  );
}

const st = StyleSheet.create({
  glassShadow: {
    shadowColor: G.shadow, shadowOpacity: 0.08, shadowRadius: 10, shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
});
