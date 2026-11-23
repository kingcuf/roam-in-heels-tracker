import React, { useState } from 'react';
import { View, Text, LayoutChangeEvent, Pressable } from 'react-native';
import Svg, { Rect, Path, Line, Text as SvgText, Circle } from 'react-native-svg';
import { C, F, groupINR } from './theme';
import { CI_MON, DayRev } from './logic';

const H = 220;
const PAD = { l: 44, r: 8, t: 10, b: 26 };

function niceMax(v: number) {
  if (v <= 0) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / mag;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * mag;
}
const kFmt = (v: number) => '₹' + (Math.abs(v) >= 1000 ? Math.round(v / 1000) + 'k' : String(Math.round(v)));

function useWidth(): [number, (e: LayoutChangeEvent) => void] {
  const [w, setW] = useState(0);
  return [w, (e) => setW(e.nativeEvent.layout.width)];
}

/* ── Daily Earnings: stacked bars (Stay + Commission) ── */
export function DailyChart({ data }: { data: { date: string; stay: number; commission: number }[] }) {
  const [w, onLayout] = useWidth();
  const plotW = Math.max(0, w - PAD.l - PAD.r);
  const plotH = H - PAD.t - PAD.b;
  const max = niceMax(Math.max(1, ...data.map((d) => d.stay + d.commission)));
  const n = data.length || 1;
  const slot = plotW / n;
  const bw = Math.max(2, Math.min(22, slot * 0.7));
  const labelEvery = Math.max(1, Math.ceil(n / 8));
  return (
    <View onLayout={onLayout}>
      {w > 0 && (
        <Svg width={w} height={H}>
          {[0, 0.25, 0.5, 0.75, 1].map((f, i) => {
            const y = PAD.t + plotH * (1 - f);
            return (
              <React.Fragment key={i}>
                <Line x1={PAD.l} y1={y} x2={w - PAD.r} y2={y} stroke={C.hair} strokeWidth={1} />
                <SvgText x={PAD.l - 6} y={y + 3.5} fontSize={9} fill={C.muted} textAnchor="end">
                  {kFmt(max * f)}
                </SvgText>
              </React.Fragment>
            );
          })}
          {data.map((d, i) => {
            const x = PAD.l + slot * i + (slot - bw) / 2;
            const hStay = (d.stay / max) * plotH;
            const hComm = (d.commission / max) * plotH;
            const yStay = PAD.t + plotH - hStay;
            const yComm = yStay - hComm;
            return (
              <React.Fragment key={i}>
                {d.stay > 0 && <Rect x={x} y={yStay} width={bw} height={hStay} fill={C.navy} rx={1.5} />}
                {d.commission > 0 && <Rect x={x} y={yComm} width={bw} height={hComm} fill="#E3A857" rx={1.5} />}
                {i % labelEvery === 0 && (
                  <SvgText x={x + bw / 2} y={H - 8} fontSize={9} fill={C.muted} textAnchor="middle">
                    {d.date}
                  </SvgText>
                )}
              </React.Fragment>
            );
          })}
        </Svg>
      )}
      <View style={{ flexDirection: 'row', gap: 16, justifyContent: 'center', marginTop: 4 }}>
        <LegendDot color={C.navy} label="Stay" />
        <LegendDot color="#E3A857" label="Commission" />
      </View>
      {data.length === 0 && <Text style={{ color: '#999', textAlign: 'center', padding: 8 }}>No data</Text>}
    </View>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
      <View style={{ width: 12, height: 12, borderRadius: 3, backgroundColor: color }} />
      <Text style={{ fontSize: 11, color: C.bark }}>{label}</Text>
    </View>
  );
}

/* ── Cumulative Bank Balance: area line over sorted day keys ── */
export function BankChart({ dayMap }: { dayMap: Record<string, number> }) {
  const [w, onLayout] = useWidth();
  const days = Object.keys(dayMap).sort();
  let run = 0;
  const pts = days.map((k) => {
    run += dayMap[k];
    const p = k.split('-');
    return { label: parseInt(p[2], 10) + ' ' + CI_MON[parseInt(p[1], 10) - 1], v: Math.round(run) };
  });
  const plotW = Math.max(0, w - PAD.l - PAD.r);
  const plotH = H - PAD.t - PAD.b;
  const vMax = niceMax(Math.max(1, ...pts.map((p) => p.v)));
  const vMin = Math.min(0, ...pts.map((p) => p.v));
  const range = vMax - vMin || 1;
  const X = (i: number) => PAD.l + (pts.length <= 1 ? 0 : (plotW * i) / (pts.length - 1));
  const Y = (v: number) => PAD.t + plotH * (1 - (v - vMin) / range);
  let path = '', area = '';
  pts.forEach((p, i) => {
    path += (i === 0 ? 'M' : 'L') + X(i).toFixed(1) + ' ' + Y(p.v).toFixed(1) + ' ';
  });
  if (pts.length) {
    area = path + 'L' + X(pts.length - 1).toFixed(1) + ' ' + (PAD.t + plotH) + ' L' + PAD.l + ' ' + (PAD.t + plotH) + ' Z';
  }
  const labelEvery = Math.max(1, Math.ceil(pts.length / 8));
  return (
    <View onLayout={onLayout}>
      {w > 0 && pts.length > 0 && (
        <Svg width={w} height={H}>
          {[0, 0.25, 0.5, 0.75, 1].map((f, i) => {
            const v = vMin + range * f;
            const y = Y(v);
            return (
              <React.Fragment key={i}>
                <Line x1={PAD.l} y1={y} x2={w - PAD.r} y2={y} stroke={C.hair} strokeWidth={1} />
                <SvgText x={PAD.l - 6} y={y + 3.5} fontSize={9} fill={C.muted} textAnchor="end">
                  {kFmt(v)}
                </SvgText>
              </React.Fragment>
            );
          })}
          <Path d={area} fill="rgba(185,128,54,.12)" />
          <Path d={path} stroke={C.blue} strokeWidth={2} fill="none" />
          {pts.map((p, i) => (
            <React.Fragment key={i}>
              <Circle cx={X(i)} cy={Y(p.v)} r={2} fill={C.blue} />
              {i % labelEvery === 0 && (
                <SvgText x={X(i)} y={H - 8} fontSize={9} fill={C.muted} textAnchor="middle">
                  {p.label}
                </SvgText>
              )}
            </React.Fragment>
          ))}
        </Svg>
      )}
      {pts.length === 0 && <Text style={{ color: '#999', textAlign: 'center', padding: 8 }}>No data</Text>}
      {pts.length > 0 && (
        <Text style={{ fontSize: 11, color: C.muted, textAlign: 'center' }}>
          Latest: ₹{groupINR(pts[pts.length - 1].v)}
        </Text>
      )}
    </View>
  );
}

/* ── Daily revenue vs target ─────────────────────────────────────────────────
   Bars are days, the dashed line is the target, the dotted line the average.
   Built to be READ on a phone, not admired:
     * a bar is green when the day met the target and gold when it fell short,
       so the verdict is legible before any number is;
     * the target and average values sit ON THE AXIS, in the margin, as tags —
       a label inside the plot always ends up covering somebody's bar;
     * up to 10 bars carry their value on top; at 30 the labels would collide,
       so only the tapped bar does;
     * every bar's whole column is the tap target (not the bar, which can be a
       2 px sliver on a slow day). Nothing is dimmed until a bar is tapped, and
       the tapped day is reported below the chart by the caller rather than in
       a floating tooltip a thumb covers;
     * today is drawn faded and outlined: it is not over yet. */
export const kShort = (v: number) => {
  const a = Math.abs(v), sg = v < 0 ? '-' : '';
  if (a >= 100000) return sg + '₹' + (a / 100000).toFixed(a >= 1000000 ? 0 : 1).replace(/\.0$/, '') + 'L';
  if (a >= 1000) return sg + '₹' + (a / 1000).toFixed(a >= 10000 ? 0 : 1).replace(/\.0$/, '') + 'k';
  return sg + '₹' + Math.round(a);
};
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const keyDate = (k: string) => { const p = k.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); };
/* SVG text does not inherit the app font; on the web it fell back to Times. */
const SF = F.semi, SFB = F.xbold;

export function TargetChart({ days, today, target, avg, selected, onSelect }: {
  days: DayRev[]; today: DayRev | null; target: number | null; avg: number | null;
  selected: string | null; onSelect: (key: string) => void;
}) {
  const [w, onLayout] = useWidth();
  const all = today ? [...days, today] : days;
  const N = all.length || 1;
  const dense = N > 10;
  const CH = 236;
  const P = { l: 48, r: 6, t: 20, b: dense ? 22 : 34 };
  const plotW = Math.max(0, w - P.l - P.r);
  const plotH = CH - P.t - P.b;
  const t = target && target > 0 ? target : null;
  const max = niceMax(Math.max(1, ...all.map((d) => d.rev), t ? t * 1.12 : 0, avg || 0));
  const Y = (v: number) => P.t + plotH * (1 - Math.max(0, v) / max);
  const slot = plotW / N;
  const bw = Math.max(3, Math.min(34, slot * 0.62));
  const colorOf = (d: DayRev) => (t === null ? C.navy : d.rev >= t ? C.green : C.copper);
  const selIdx = selected === null ? -1 : all.findIndex((d) => d.key === selected);

  const yT = t !== null ? Y(t) : null;
  const yA = avg !== null && avg > 0 ? Y(avg) : null;
  /* Axis tags: the target wins its spot; the average moves off it when the two
     would overlap, and any grid value they would cover is hidden. */
  let yATag = yA;
  if (yT !== null && yA !== null && Math.abs(yT - yA) < 16) yATag = yA >= yT ? yT + 16 : yT - 16;
  const tagged = [yT, yATag].filter((v): v is number => v !== null);
  const gridHidden = (y: number) => tagged.some((ty) => Math.abs(ty - y) < 12);

  /* X labels. Dense: every few days, plus today; a tapped day takes its
     neighbours' places so two labels never print over each other. */
  const every = dense ? Math.ceil(N / 6) : 1;
  let labelled = new Set<number>();
  all.forEach((_, i) => { if (i % every === 0) labelled.add(i); });
  if (today) labelled.add(N - 1);
  if (dense) {
    /* the last periodic label must not crowd today's */
    if (today) for (let i = N - 2; i >= N - 3; i--) labelled.delete(i);
    if (selIdx >= 0) {
      labelled = new Set([...labelled].filter((i) => Math.abs(i - selIdx) > 2));
      labelled.add(selIdx);
    }
  }

  const Tag = ({ y, txt, fill, fg }: { y: number; txt: string; fill: string; fg: string }) => (
    <>
      <Rect x={1} y={y - 8} width={P.l - 5} height={16} rx={8} fill={fill} />
      <SvgText x={1 + (P.l - 5) / 2} y={y + 3.5} fontSize={9.5} fontFamily={SFB} fill={fg} textAnchor="middle">{txt}</SvgText>
    </>
  );

  return (
    <View onLayout={onLayout}>
      {w > 0 && (
        <View style={{ width: w, height: CH }}>
          <Svg width={w} height={CH}>
            {[0, 0.25, 0.5, 0.75, 1].map((f, i) => {
              const y = P.t + plotH * (1 - f);
              return (
                <React.Fragment key={i}>
                  <Line x1={P.l} y1={y} x2={w - P.r} y2={y} stroke={C.hair} strokeWidth={1} />
                  {!gridHidden(y) && (
                    <SvgText x={P.l - 7} y={y + 3.5} fontSize={9.5} fontFamily={SF} fill={C.muted} textAnchor="end">{kShort(max * f)}</SvgText>
                  )}
                </React.Fragment>
              );
            })}
            {all.map((d, i) => {
              const isToday = !!today && i === N - 1;
              const x = P.l + slot * i + (slot - bw) / 2;
              const h = Math.max(0, (Math.max(0, d.rev) / max) * plotH);
              const isSel = i === selIdx;
              const dim = selIdx >= 0 && !isSel;
              const showVal = d.rev > 0 && (!dense || isSel);
              const dt = keyDate(d.key);
              const lblColor = isSel ? C.ink : C.muted, lblFont = isSel ? SFB : SF;
              return (
                <React.Fragment key={d.key}>
                  {h > 0 && (
                    <Rect
                      x={x} y={P.t + plotH - h} width={bw} height={h} rx={Math.min(5, bw / 3)}
                      fill={colorOf(d)} opacity={(isToday ? 0.4 : 1) * (dim ? 0.5 : 1)}
                      stroke={isToday || isSel ? (isSel ? C.ink : colorOf(d)) : 'none'}
                      strokeWidth={isSel ? 1.5 : isToday ? 1.2 : 0}
                      strokeDasharray={isToday && !isSel ? '3,2' : undefined}
                    />
                  )}
                  {/* a zero day still shows where it is when tapped */}
                  {h === 0 && isSel && <Rect x={x} y={P.t + plotH - 2} width={bw} height={2} fill={C.ink} />}
                  {showVal && (
                    <SvgText
                      x={x + bw / 2} y={P.t + plotH - h - 5} fontSize={dense ? 10.5 : 9.5} fontFamily={SFB}
                      fill={dim ? C.muted : C.ink} textAnchor="middle"
                    >{kShort(d.rev)}</SvgText>
                  )}
                  {labelled.has(i) && (
                    dense ? (
                      <SvgText x={x + bw / 2} y={CH - 7} fontSize={9.5} fontFamily={lblFont} fill={lblColor}
                        textAnchor={i === N - 1 ? 'end' : i === 0 ? 'start' : 'middle'}>
                        {isToday ? 'Today' : dt.getDate() + ' ' + CI_MON[dt.getMonth()]}
                      </SvgText>
                    ) : (
                      <>
                        <SvgText x={x + bw / 2} y={CH - 20} fontSize={9.5} fontFamily={lblFont} fill={lblColor} textAnchor="middle">
                          {isToday ? 'Today' : WD[dt.getDay()]}
                        </SvgText>
                        <SvgText x={x + bw / 2} y={CH - 7} fontSize={9.5} fontFamily={lblFont} fill={lblColor} textAnchor="middle">
                          {dt.getDate() + ' ' + CI_MON[dt.getMonth()]}
                        </SvgText>
                      </>
                    )
                  )}
                </React.Fragment>
              );
            })}
            {yA !== null && <Line x1={P.l} y1={yA} x2={w - P.r} y2={yA} stroke={C.blue} strokeWidth={1.5} strokeDasharray="2,3" />}
            {yT !== null && <Line x1={P.l} y1={yT} x2={w - P.r} y2={yT} stroke={C.ink} strokeWidth={1.6} strokeDasharray="6,4" />}
            {yATag !== null && <Tag y={yATag} txt={kShort(avg as number)} fill={C.amberbg} fg={C.blue2} />}
            {yT !== null && <Tag y={yT} txt={kShort(t as number)} fill={C.ink} fg="#fff" />}
          </Svg>
          {all.map((d, i) => (
            <Pressable
              key={d.key} onPress={() => onSelect(d.key)}
              accessibilityRole="button"
              accessibilityLabel={(today && i === N - 1 ? 'Today, so far' : d.key) + ': ' + kShort(d.rev)}
              style={{ position: 'absolute', left: P.l + slot * i, top: 0, width: slot, height: CH }}
            />
          ))}
        </View>
      )}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: 14, rowGap: 6, justifyContent: 'center', marginTop: 8 }}>
        {t !== null ? (
          <>
            <LegendDot color={C.green} label="Met target" />
            <LegendDot color={C.copper} label="Below target" />
            <LegendLine color={C.ink} dash label="Target" />
          </>
        ) : <LegendDot color={C.navy} label="Revenue" />}
        {yA !== null ? <LegendLine color={C.blue} label="Average" /> : null}
      </View>
    </View>
  );
}

function LegendLine({ color, label, dash }: { color: string; label: string; dash?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
      <Svg width={16} height={6}>
        <Line x1={0} y1={3} x2={16} y2={3} stroke={color} strokeWidth={2} strokeDasharray={dash ? '5,3' : '2,2.5'} />
      </Svg>
      <Text style={{ fontSize: 11, color: C.bark }}>{label}</Text>
    </View>
  );
}
