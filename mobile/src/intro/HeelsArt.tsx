/* A still from the intro's close-up — the gold stilettos on sand — used as the
   hero art on the login screen and the dashboard, so the app keeps the film's
   look after it ends. Static: no clock, nothing to repaint. */
import React, { useState } from 'react';
import { StyleProp, View, ViewStyle } from 'react-native';
import Svg from 'react-native-svg';
import { SceneDefs, drawNodes, useSvgPrefix } from './svgnodes';
import { H, REST_T, W, closeUp } from './scene';

const ART = closeUp(REST_T);
const REST = closeUp(REST_T, 1);

/* The film's camera: portrait screens see the authored 390×844 frame, wider
   ones see more scenery sideways rather than a crop. Shared with IntroFilm so
   the login backdrop lines up with the film's last frame exactly. */
export function filmViewBox(w: number, h: number) {
  const vbW = w && h ? Math.max(W, (H * w) / h) : W;
  return `${(W - vbW) / 2} 0 ${vbW} ${H}`;
}

export default function HeelsArt({ style, viewBox = '10 330 380 320', rest }: {
  style?: StyleProp<ViewStyle>; viewBox?: string;
  /* rest: full-bleed, framed exactly like the intro film's final frame. */
  rest?: boolean;
}) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  const px = useSvgPrefix();
  return (
    <View style={style} pointerEvents="none"
      onLayout={rest ? (e) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height }) : undefined}>
      <Svg width="100%" height="100%" viewBox={rest ? filmViewBox(size.w, size.h) : viewBox} preserveAspectRatio="xMidYMid slice">
        <SceneDefs px={px} />
        {drawNodes(rest ? REST : ART, px)}
      </Svg>
    </View>
  );
}
