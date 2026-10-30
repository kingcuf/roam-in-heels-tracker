import React from 'react';
import Svg, { Rect, Path, Circle, Line } from 'react-native-svg';

const INACTIVE = '#A8A7AE';
const TEAL = '#16161A';
const TEAL_LIGHT = '#E3A857';

type IconProps = { active: boolean; size?: number };

/* Dashboard: 4-tile grid, top-right tile accented when active */
export function DashboardIcon({ active, size = 24 }: IconProps) {
  if (active) {
    return (
      <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
        <Rect x={3.5} y={3.5} width={7.5} height={7.5} rx={2} fill={TEAL} />
        <Rect x={13} y={3.5} width={7.5} height={7.5} rx={2} fill={TEAL_LIGHT} />
        <Rect x={3.5} y={13} width={7.5} height={7.5} rx={2} fill={TEAL} />
        <Rect x={13} y={13} width={7.5} height={7.5} rx={2} fill={TEAL} />
      </Svg>
    );
  }
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x={4} y={4} width={6.5} height={6.5} rx={1.8} stroke={INACTIVE} strokeWidth={1.8} strokeLinejoin="round" />
      <Rect x={13.5} y={4} width={6.5} height={6.5} rx={1.8} stroke={INACTIVE} strokeWidth={1.8} strokeLinejoin="round" />
      <Rect x={4} y={13.5} width={6.5} height={6.5} rx={1.8} stroke={INACTIVE} strokeWidth={1.8} strokeLinejoin="round" />
      <Rect x={13.5} y={13.5} width={6.5} height={6.5} rx={1.8} stroke={INACTIVE} strokeWidth={1.8} strokeLinejoin="round" />
    </Svg>
  );
}

/* Add: circle with plus, emphasized central action */
export function AddIcon({ active, size = 24 }: IconProps) {
  if (active) {
    return (
      <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
        <Circle cx={12} cy={12} r={9.5} fill={TEAL} />
        <Circle cx={12} cy={12} r={9.5} stroke={TEAL_LIGHT} strokeWidth={1.5} />
        <Line x1={12} y1={7.6} x2={12} y2={16.4} stroke="#FFFFFF" strokeWidth={2.1} strokeLinecap="round" />
        <Line x1={7.6} y1={12} x2={16.4} y2={12} stroke="#FFFFFF" strokeWidth={2.1} strokeLinecap="round" />
      </Svg>
    );
  }
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={12} cy={12} r={8.8} stroke={INACTIVE} strokeWidth={1.8} />
      <Line x1={12} y1={8} x2={12} y2={16} stroke={INACTIVE} strokeWidth={1.8} strokeLinecap="round" />
      <Line x1={8} y1={12} x2={16} y2={12} stroke={INACTIVE} strokeWidth={1.8} strokeLinecap="round" />
    </Svg>
  );
}

/* Logs: ledger document with entry lines */
export function LogsIcon({ active, size = 24 }: IconProps) {
  if (active) {
    return (
      <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
        <Path
          d="M6.5 2.75h8.1c.48 0 .94.19 1.28.53l3.09 3.09c.34.34.53.8.53 1.28V19.5a1.75 1.75 0 0 1-1.75 1.75H6.5a1.75 1.75 0 0 1-1.75-1.75v-15c0-.97.78-1.75 1.75-1.75Z"
          fill={TEAL}
        />
        <Line x1={8.4} y1={9.2} x2={15.6} y2={9.2} stroke={TEAL_LIGHT} strokeWidth={1.7} strokeLinecap="round" />
        <Line x1={8.4} y1={12.8} x2={15.6} y2={12.8} stroke={TEAL_LIGHT} strokeWidth={1.7} strokeLinecap="round" />
        <Line x1={8.4} y1={16.4} x2={12.8} y2={16.4} stroke={TEAL_LIGHT} strokeWidth={1.7} strokeLinecap="round" />
      </Svg>
    );
  }
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M6.75 3.4h7.7c.35 0 .68.14.92.38l2.85 2.85c.24.24.38.57.38.92V19.3c0 .72-.58 1.3-1.3 1.3H6.75c-.72 0-1.3-.58-1.3-1.3V4.7c0-.72.58-1.3 1.3-1.3Z"
        stroke={INACTIVE}
        strokeWidth={1.8}
        strokeLinejoin="round"
      />
      <Line x1={8.6} y1={9.4} x2={15.4} y2={9.4} stroke={INACTIVE} strokeWidth={1.8} strokeLinecap="round" />
      <Line x1={8.6} y1={12.9} x2={15.4} y2={12.9} stroke={INACTIVE} strokeWidth={1.8} strokeLinecap="round" />
      <Line x1={8.6} y1={16.4} x2={12.6} y2={16.4} stroke={INACTIVE} strokeWidth={1.8} strokeLinecap="round" />
    </Svg>
  );
}

/* Inventory: isometric box, lid seam accented when active */
export function InventoryIcon({ active, size = 24 }: IconProps) {
  if (active) {
    return (
      <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
        <Path d="M12 2.5 20.5 7v10L12 21.5 3.5 17V7L12 2.5Z" fill={TEAL} />
        <Path d="M3.5 7 12 11.5 20.5 7" stroke={TEAL_LIGHT} strokeWidth={1.6} strokeLinejoin="round" />
        <Line x1={12} y1={11.5} x2={12} y2={21.5} stroke={TEAL_LIGHT} strokeWidth={1.6} />
      </Svg>
    );
  }
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M12 3 20 7.5v9L12 21 4 16.5v-9L12 3Z" stroke={INACTIVE} strokeWidth={1.8} strokeLinejoin="round" />
      <Path d="M4 7.5 12 12l8-4.5" stroke={INACTIVE} strokeWidth={1.8} strokeLinejoin="round" />
      <Line x1={12} y1={12} x2={12} y2={21} stroke={INACTIVE} strokeWidth={1.8} />
    </Svg>
  );
}


/* Action: checklist — a ticked line above two pending lines */
export function ActionIcon({ active, size = 24 }: IconProps) {
  if (active) {
    return (
      <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
        <Path d="M3.5 7.2l2 2 3.2-3.4" stroke={TEAL_LIGHT} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
        <Rect x={11} y={6.1} width={9.5} height={2.1} rx={1.05} fill={TEAL} />
        <Rect x={3.5} y={12.2} width={17} height={2.1} rx={1.05} fill={TEAL} />
        <Rect x={3.5} y={17.2} width={12} height={2.1} rx={1.05} fill={TEAL} />
      </Svg>
    );
  }
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M3.5 7.2l2 2 3.2-3.4" stroke={INACTIVE} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
      <Line x1={11.5} y1={7.2} x2={20.5} y2={7.2} stroke={INACTIVE} strokeWidth={1.8} strokeLinecap="round" />
      <Line x1={3.5} y1={13.2} x2={20.5} y2={13.2} stroke={INACTIVE} strokeWidth={1.8} strokeLinecap="round" />
      <Line x1={3.5} y1={18.2} x2={15.5} y2={18.2} stroke={INACTIVE} strokeWidth={1.8} strokeLinecap="round" />
    </Svg>
  );
}

/* Calendar: a month grid with a booked stay running across it */
export function CalendarIcon({ active, size = 24 }: IconProps) {
  if (active) {
    return (
      <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
        <Rect x={3} y={5} width={18} height={16} rx={3} fill={TEAL} />
        <Line x1={7.5} y1={2.8} x2={7.5} y2={6} stroke={TEAL} strokeWidth={2} strokeLinecap="round" />
        <Line x1={16.5} y1={2.8} x2={16.5} y2={6} stroke={TEAL} strokeWidth={2} strokeLinecap="round" />
        <Rect x={6} y={11.4} width={9} height={2.6} rx={1.3} fill={TEAL_LIGHT} />
        <Rect x={6} y={16} width={5.5} height={2.6} rx={1.3} fill="#FFFFFF" opacity={0.55} />
      </Svg>
    );
  }
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x={3.6} y={5.6} width={16.8} height={14.8} rx={2.8} stroke={INACTIVE} strokeWidth={1.8} />
      <Line x1={3.6} y1={9.6} x2={20.4} y2={9.6} stroke={INACTIVE} strokeWidth={1.8} />
      <Line x1={7.8} y1={3.4} x2={7.8} y2={6.2} stroke={INACTIVE} strokeWidth={1.8} strokeLinecap="round" />
      <Line x1={16.2} y1={3.4} x2={16.2} y2={6.2} stroke={INACTIVE} strokeWidth={1.8} strokeLinecap="round" />
      <Rect x={6.6} y={12.6} width={8} height={2.2} rx={1.1} fill={INACTIVE} />
    </Svg>
  );
}

/* Team: two people, the one in front accented when active */
export function TeamIcon({ active, size = 24 }: IconProps) {
  if (active) {
    return (
      <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
        <Circle cx={16.2} cy={7.6} r={2.9} fill={TEAL_LIGHT} />
        <Path d="M11.6 19.5c.3-3.2 2.2-5.3 4.6-5.3s4.3 2.1 4.6 5.3H11.6Z" fill={TEAL_LIGHT} />
        <Circle cx={9} cy={8} r={3.5} fill={TEAL} />
        <Path d="M2.8 20.5c.3-4 2.9-6.6 6.2-6.6s5.9 2.6 6.2 6.6H2.8Z" fill={TEAL} />
      </Svg>
    );
  }
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={9} cy={8} r={3.3} stroke={INACTIVE} strokeWidth={1.8} />
      <Path d="M3.4 20c.4-3.6 2.7-5.9 5.6-5.9s5.2 2.3 5.6 5.9" stroke={INACTIVE} strokeWidth={1.8} strokeLinecap="round" />
      <Circle cx={16.4} cy={8.4} r={2.6} stroke={INACTIVE} strokeWidth={1.8} />
      <Path d="M17.2 14.3c2.1.4 3.4 2.4 3.6 5.2" stroke={INACTIVE} strokeWidth={1.8} strokeLinecap="round" />
    </Svg>
  );
}

export const TAB_ICONS = {
  action: ActionIcon, cal: CalendarIcon, dash: DashboardIcon, add: AddIcon, team: TeamIcon,
  logs: LogsIcon, inv: InventoryIcon,
};
