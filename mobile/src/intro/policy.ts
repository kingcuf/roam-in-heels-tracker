/* WHEN the brand film plays. Nothing else.

   THIS IS THE OWNER'S CALL, NOT A UX ONE — it is her branding and the only
   reason to touch it is the measurement: 9 494 ms from opening the app to
   being able to touch the Username field if Skip is not pressed, on every
   single launch. The film itself, its timing and its art are untouched.

   To restore the original behaviour exactly, set MODE back to 'every-launch'.
   That is the whole revert — no other file needs changing.

     'every-launch' — as shipped: the full film every time the app opens.
     'once-a-day'   — the full film on the first open of each calendar day;
                      later opens the same day go straight to sign-in.

   Persistence is browser-only (localStorage). On the iOS/Android builds there
   is nothing to read, so `shouldPlayIntro()` returns true and the film plays
   every launch exactly as it does today, whatever MODE says. */

export type IntroMode = 'every-launch' | 'once-a-day';

/* The owner's decision (18-Sep-2026): the film plays every launch, as shipped.
   The 'once-a-day' path stays here, unused, so the choice can be revisited by
   changing this one word rather than rebuilding it. */
export const INTRO_MODE: IntroMode = 'every-launch';

const KEY = 'spira_intro_day';   // the day the film last played in full

const today = () => new Date().toDateString();

export function shouldPlayIntro(): boolean {
  if (INTRO_MODE === 'every-launch') return true;
  try {
    const seen = globalThis.localStorage?.getItem(KEY);
    return !seen || seen !== today();
  } catch {
    return true;   // no storage (native, private window) → behave as before
  }
}

export function markIntroPlayed() {
  if (INTRO_MODE === 'every-launch') return;
  try { globalThis.localStorage?.setItem(KEY, today()); } catch {}
}
