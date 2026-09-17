/**
 * FAZE design tokens.
 *
 * Visual direction is decided (master prompt AGENT 10): dark-first, high
 * contrast, "gaming without the neon soup." Cover art supplies the colour;
 * the chrome stays neutral so twenty game thumbnails do not fight the UI.
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
          DEFAULT: '#0B0D12', // page background
          raised: '#14171F', // cards, menus, modals
          overlay: '#1C202B', // hover / pressed states on raised surfaces
        },
        content: {
          primary: '#F2F4F8',
          muted: '#A7AEBF', // 7.3:1 on #0B0D12 — clears WCAG AA for body text
          faint: '#6B7285', // decorative only, never load-bearing text
        },
        accent: {
          DEFAULT: '#5B8CFF',
          hover: '#7BA1FF',
          muted: '#1E2A4A',
        },
        success: '#3FBF7F',
        warn: '#E0A33E',
        danger: '#E5484D',
        subtle: '#262B36', // borders and dividers
      },
      borderRadius: {
        DEFAULT: '12px',
        sm: '8px',
        lg: '16px',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
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
