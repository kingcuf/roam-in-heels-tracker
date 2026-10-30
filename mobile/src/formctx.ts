import { createContext } from 'react';

/* The form's own submit, published to every field inside it, so Enter on a
   single-line box does what the gold button does.

   It lives in a leaf module of its own, not in formkit.tsx, because fields.tsx
   and formkit.tsx both need it: fields → formkit → ui → … is a cycle, and under
   Metro the native bundle evaluated fields.tsx while formkit.tsx was still
   half-initialised, so the context read as undefined and the first <Field>
   render died with "Cannot read property '$$typeof' of undefined". This file
   imports nothing but React, so it can never be the half-built half of a cycle. */
export const SubmitCtx = createContext<(() => void) | null>(null);
