import type { Config } from 'tailwindcss';

/**
 * SorobanPay Design System — Tailwind CSS tokens
 *
 * Issue #1427: Establish color palette, typography, and spacing tokens.
 *
 * ## Color palette
 * - `brand.*`   — Stellar-inspired blue, primary interactive color
 * - `success.*` — Green tones for confirmed/successful states
 * - `warning.*` — Amber tones for caution/pending states
 * - `error.*`   — Red tones for failures and destructive actions
 * - `neutral.*` — Gray scale used for backgrounds, borders, and body text
 *
 * ## Dark-mode
 * All semantic tokens follow the dark-first convention of the app.
 * Light-mode variants are provided via the `dark:` prefix where appropriate.
 *
 * ## Typography scale
 * Documented below but defers to Tailwind's built-in type scale (xs → 4xl).
 * Weights in use: normal (400), medium (500), semibold (600), bold (700), extrabold (800).
 *
 * ## Spacing
 * Tailwind's default scale (0 → 96) is used unchanged; no custom spacing is
 * needed. Guideline: prefer multiples of 4 (1rem = 16px) for layout padding
 * and multiples of 2 (0.5rem = 8px) for component internal gaps.
 *
 * ## Border radius
 * - `rounded-sm`  (2px)  — subtle; badges, code chips
 * - `rounded`     (4px)  — inputs, small buttons
 * - `rounded-lg`  (8px)  — standard buttons, alerts
 * - `rounded-xl`  (12px) — form sections
 * - `rounded-2xl` (16px) — cards, modals
 * - `rounded-full`       — pill badges, avatar dots
 *
 * ## Shadow scale
 * Tailwind defaults used: `shadow-sm`, `shadow`, `shadow-lg`, `shadow-xl`, `shadow-2xl`.
 */
const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      // ─── Color tokens ──────────────────────────────────────────────────────
      colors: {
        /**
         * brand — Stellar-inspired blue
         * Usage: primary buttons, links, focus rings, progress fills
         */
        brand: {
          50:  '#eff6ff',  // Very light blue — light-mode surface tint
          100: '#dbeafe',  // Light blue — hover backgrounds
          200: '#bfdbfe',  // Muted blue — disabled fills
          300: '#93c5fd',  // Soft blue — secondary labels, captions
          400: '#60a5fa',  // Focus ring blue — WCAG 3:1 on gray-900
          500: '#3b82f6',  // Base blue — standard buttons
          600: '#2563eb',  // Primary blue — primary CTA, active states
          700: '#1d4ed8',  // Dark blue — hover on primary
          800: '#1e40af',  // Deeper blue — pressed/active
          900: '#1e3a8a',  // Very dark blue — dark-mode text on light bg
          950: '#172554',  // Near-black blue — darkest surface
        },

        /**
         * success — Confirmed payments, connected wallet, completed steps
         */
        success: {
          50:  '#f0fdf4',
          100: '#dcfce7',
          200: '#bbf7d0',
          300: '#86efac',
          400: '#4ade80',  // Success indicator dot
          500: '#22c55e',  // Base success
          600: '#16a34a',  // Success button/badge
          700: '#15803d',
          800: '#166534',
          900: '#14532d',
          950: '#052e16',
        },

        /**
         * warning — Wallet disconnected, pending config, incomplete steps
         */
        warning: {
          50:  '#fffbeb',
          100: '#fef3c7',
          200: '#fde68a',
          300: '#fcd34d',
          400: '#fbbf24',  // Warning icon
          500: '#f59e0b',  // Base warning
          600: '#d97706',  // Warning badge
          700: '#b45309',
          800: '#92400e',
          900: '#78350f',
          950: '#451a03',
        },

        /**
         * error — Failed transactions, rejected signatures, validation errors
         */
        error: {
          50:  '#fef2f2',
          100: '#fee2e2',
          200: '#fecaca',
          300: '#fca5a5',
          400: '#f87171',  // Error icon
          500: '#ef4444',  // Base error
          600: '#dc2626',  // Error badge
          700: '#b91c1c',
          800: '#991b1b',
          900: '#7f1d1d',
          950: '#450a0a',
        },

        /**
         * neutral — Backgrounds, borders, surface containers, body text
         * Maps to Tailwind gray but aliased for semantic clarity.
         */
        neutral: {
          0:   '#ffffff',
          50:  '#f9fafb',  // Body text on dark bg — 16.7:1 on neutral-950
          100: '#f3f4f6',
          200: '#e5e7eb',
          300: '#d1d5db',
          400: '#9ca3af',  // Placeholder text
          500: '#6b7280',  // Secondary text, icons
          600: '#4b5563',  // Borders on mid-tone backgrounds
          700: '#374151',  // Strong borders
          800: '#1f2937',  // Card surfaces
          850: '#161e2e',  // Slightly darker card (custom)
          900: '#111827',  // Primary card background
          950: '#030712',  // Page background — exceeds WCAG AAA
        },
      },

      // ─── Typography ────────────────────────────────────────────────────────
      fontFamily: {
        /**
         * sans — System UI stack; matches what Next.js App Router loads by default.
         * Override by setting --font-sans in globals.css with next/font.
         */
        sans: [
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'BlinkMacSystemFont',
          '"Segoe UI"',
          'Roboto',
          '"Helvetica Neue"',
          'Arial',
          '"Noto Sans"',
          'sans-serif',
        ],
        /**
         * mono — Used for addresses, contract IDs, code snippets.
         */
        mono: [
          'ui-monospace',
          'SFMono-Regular',
          '"JetBrains Mono"',
          '"Cascadia Code"',
          'Menlo',
          'Monaco',
          '"Courier New"',
          'monospace',
        ],
      },

      /**
       * Font size scale — Tailwind defaults, documented for reference.
       *
       * | Token  | Size  | Line height | Usage                          |
       * |--------|-------|-------------|--------------------------------|
       * | xs     | 12px  | 16px        | Labels, badges, captions       |
       * | sm     | 14px  | 20px        | Form helper text, metadata     |
       * | base   | 16px  | 24px        | Body text, inputs              |
       * | lg     | 18px  | 28px        | Card subtitles                 |
       * | xl     | 20px  | 28px        | Section headings               |
       * | 2xl    | 24px  | 32px        | Page sub-headers               |
       * | 3xl    | 30px  | 36px        | Page titles on mobile          |
       * | 4xl    | 36px  | 40px        | Hero / main page title         |
       */

      // ─── Animations ────────────────────────────────────────────────────────
      keyframes: {
        progress: {
          '0%':   { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(400%)' },
        },
        /**
         * fadeIn — modal / wizard entrance
         */
        fadeIn: {
          '0%':   { opacity: '0', transform: 'scale(0.97)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        /**
         * slideUp — slide-in from bottom (toast / snackbar)
         */
        slideUp: {
          '0%':   { opacity: '0', transform: 'translateY(12px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        progress: 'progress 1.8s ease-in-out infinite',
        fadeIn:   'fadeIn 0.18s ease-out forwards',
        slideUp:  'slideUp 0.22s ease-out forwards',
      },
    },
  },
  plugins: [],
};

export default config;
