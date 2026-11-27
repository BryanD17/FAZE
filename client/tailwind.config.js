/**
 * FAZE design tokens.
 *
 * The FAZE look (issue #54), shared with the presentation deck: dark navy,
 * one violet accent, Space Grotesk for headings and DM Sans for text.
 *
 * Contrast (WCAG 2.1, checked against surface / raised):
 *   content.primary #F4F3EE   16.1 / 14.2 : 1
 *   content.muted   #BFC4DA   10.3 /  9.1 : 1
 *   content.faint   #8A90AD    5.7 /  5.0 : 1
 *   accent text     #A996FF    7.2 /  6.4 : 1
 *   danger          #F0686C    5.9 /  5.2 : 1
 *   primary text on the violet button #5B3FE0: 5.8 : 1 (6.9 on hover)
 *
 * The violet #5B3FE0 is only 2.8 : 1 on navy, too dark for text. So
 * `text-accent`, `border-accent` and `ring-accent` use the lighter #A996FF
 * (see textColor / borderColor / ringColor below), while `bg-accent` stays
 * violet. Same token names, so no page had to change.
 *
 * Feature code uses these semantic names only — a raw hex value in a feature
 * file is a review rejection (convention B.3).
 */
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        surface: {
          DEFAULT: '#12162B', // page background (navy)
          raised: '#1B2040', // cards, menus, modals: a step lighter
          overlay: '#262C52', // hover / pressed states on raised surfaces
        },
        content: {
          primary: '#F4F3EE',
          muted: '#BFC4DA',
          faint: '#8A90AD', // timestamps and hints; still 5:1 on raised
        },
        accent: {
          DEFAULT: '#5B3FE0', // violet, for filled buttons and bars
          hover: '#4E33D1',
          muted: '#2A2366',
        },
        success: '#3FBF7F',
        warn: '#E0A33E',
        danger: '#F0686C',
        subtle: '#2E3458', // borders and dividers
      },
      borderRadius: {
        DEFAULT: '12px',
        sm: '8px',
        lg: '16px',
      },
      // Lighter violet wherever the accent is text or a thin line on navy.
      textColor: { accent: { DEFAULT: '#A996FF', hover: '#C9BDFF', muted: '#A996FF' } },
      borderColor: { accent: { DEFAULT: '#A996FF', hover: '#C9BDFF' } },
      ringColor: { accent: { DEFAULT: '#A996FF', hover: '#C9BDFF' } },
      fontFamily: {
        sans: ['"DM Sans"', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        display: ['"Space Grotesk"', '"DM Sans"', 'system-ui', 'sans-serif'],
      },
      fontVariantNumeric: {
        // Match scores and member counts must not jitter as digits change.
        tabular: 'tabular-nums',
      },
      boxShadow: {
        // One shadow for the whole app; depth comes from surface colour.
        raised: '0 4px 16px rgba(0, 0, 0, 0.45)',
      },
      spacing: {
        // 4px scale; anything off-scale is a design bug.
        0.5: '2px',
        1.5: '6px',
        2.5: '10px',
        3.5: '14px',
      },
    },
  },
  plugins: [],
};
