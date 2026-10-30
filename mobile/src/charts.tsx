import React, { useState } from 'react';
import { View, Text, LayoutChangeEvent } from 'react-native';
import Svg, { Rect, Path, Line, Text as SvgText, Circle } from 'react-native-svg';
import { C, F, groupINR } from './theme';
import { CI_MON } from './logic';

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
