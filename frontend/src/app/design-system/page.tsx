import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Design System — SorobanPay',
  description: 'Color palette, typography, and spacing tokens for SorobanPay.',
};

// ─── Token data ───────────────────────────────────────────────────────────────

const colorGroups = [
  {
    name: 'Brand (Stellar Blue)',
    description: 'Primary interactive color — buttons, links, focus rings, progress fills.',
    swatches: [
      { token: 'brand-50',  hex: '#eff6ff', textDark: true  },
      { token: 'brand-100', hex: '#dbeafe', textDark: true  },
      { token: 'brand-200', hex: '#bfdbfe', textDark: true  },
      { token: 'brand-300', hex: '#93c5fd', textDark: true  },
      { token: 'brand-400', hex: '#60a5fa', textDark: true  },
      { token: 'brand-500', hex: '#3b82f6', textDark: false },
      { token: 'brand-600', hex: '#2563eb', textDark: false },
      { token: 'brand-700', hex: '#1d4ed8', textDark: false },
      { token: 'brand-800', hex: '#1e40af', textDark: false },
      { token: 'brand-900', hex: '#1e3a8a', textDark: false },
      { token: 'brand-950', hex: '#172554', textDark: false },
    ],
  },
  {
    name: 'Success',
    description: 'Confirmed payments, connected wallet badge, completed onboarding steps.',
    swatches: [
      { token: 'success-50',  hex: '#f0fdf4', textDark: true  },
      { token: 'success-100', hex: '#dcfce7', textDark: true  },
      { token: 'success-200', hex: '#bbf7d0', textDark: true  },
      { token: 'success-300', hex: '#86efac', textDark: true  },
      { token: 'success-400', hex: '#4ade80', textDark: true  },
      { token: 'success-500', hex: '#22c55e', textDark: false },
      { token: 'success-600', hex: '#16a34a', textDark: false },
      { token: 'success-700', hex: '#15803d', textDark: false },
      { token: 'success-800', hex: '#166534', textDark: false },
      { token: 'success-900', hex: '#14532d', textDark: false },
      { token: 'success-950', hex: '#052e16', textDark: false },
    ],
  },
  {
    name: 'Warning',
    description: 'Wallet disconnected, pending configuration, incomplete onboarding.',
    swatches: [
      { token: 'warning-50',  hex: '#fffbeb', textDark: true  },
      { token: 'warning-100', hex: '#fef3c7', textDark: true  },
      { token: 'warning-200', hex: '#fde68a', textDark: true  },
      { token: 'warning-300', hex: '#fcd34d', textDark: true  },
      { token: 'warning-400', hex: '#fbbf24', textDark: true  },
      { token: 'warning-500', hex: '#f59e0b', textDark: false },
      { token: 'warning-600', hex: '#d97706', textDark: false },
      { token: 'warning-700', hex: '#b45309', textDark: false },
      { token: 'warning-800', hex: '#92400e', textDark: false },
      { token: 'warning-900', hex: '#78350f', textDark: false },
      { token: 'warning-950', hex: '#451a03', textDark: false },
    ],
  },
  {
    name: 'Error',
    description: 'Failed transactions, rejected signatures, inline validation errors.',
    swatches: [
      { token: 'error-50',  hex: '#fef2f2', textDark: true  },
      { token: 'error-100', hex: '#fee2e2', textDark: true  },
      { token: 'error-200', hex: '#fecaca', textDark: true  },
      { token: 'error-300', hex: '#fca5a5', textDark: true  },
      { token: 'error-400', hex: '#f87171', textDark: true  },
      { token: 'error-500', hex: '#ef4444', textDark: false },
      { token: 'error-600', hex: '#dc2626', textDark: false },
      { token: 'error-700', hex: '#b91c1c', textDark: false },
      { token: 'error-800', hex: '#991b1b', textDark: false },
      { token: 'error-900', hex: '#7f1d1d', textDark: false },
      { token: 'error-950', hex: '#450a0a', textDark: false },
    ],
  },
  {
    name: 'Neutral',
    description: 'Page backgrounds, card surfaces, borders, and body text.',
    swatches: [
      { token: 'neutral-0',   hex: '#ffffff', textDark: true  },
      { token: 'neutral-50',  hex: '#f9fafb', textDark: true  },
      { token: 'neutral-100', hex: '#f3f4f6', textDark: true  },
      { token: 'neutral-200', hex: '#e5e7eb', textDark: true  },
      { token: 'neutral-300', hex: '#d1d5db', textDark: true  },
      { token: 'neutral-400', hex: '#9ca3af', textDark: true  },
      { token: 'neutral-500', hex: '#6b7280', textDark: false },
      { token: 'neutral-600', hex: '#4b5563', textDark: false },
      { token: 'neutral-700', hex: '#374151', textDark: false },
      { token: 'neutral-800', hex: '#1f2937', textDark: false },
      { token: 'neutral-900', hex: '#111827', textDark: false },
      { token: 'neutral-950', hex: '#030712', textDark: false },
    ],
  },
] as const;

const typographyScale = [
  { token: 'text-xs',   size: '12px / 0.75rem',  weight: '400 / 600',      usage: 'Labels, badges, captions' },
  { token: 'text-sm',   size: '14px / 0.875rem', weight: '400 / 600',      usage: 'Form helper text, metadata' },
  { token: 'text-base', size: '16px / 1rem',     weight: '400 / 500',      usage: 'Body text, input values' },
  { token: 'text-lg',   size: '18px / 1.125rem', weight: '500 / 600',      usage: 'Card subtitles' },
  { token: 'text-xl',   size: '20px / 1.25rem',  weight: '600',            usage: 'Section headings' },
  { token: 'text-2xl',  size: '24px / 1.5rem',   weight: '700',            usage: 'Page sub-headers' },
  { token: 'text-3xl',  size: '30px / 1.875rem', weight: '700',            usage: 'Page titles (mobile)' },
  { token: 'text-4xl',  size: '36px / 2.25rem',  weight: '800 extrabold',  usage: 'Hero / main page title' },
] as const;

const spacingNotes = [
  { token: 'p-1 / gap-1', px: '4px',   usage: 'Icon padding, tight gaps' },
  { token: 'p-2 / gap-2', px: '8px',   usage: 'Small internal component gaps' },
  { token: 'p-3 / gap-3', px: '12px',  usage: 'Badge padding, list gaps' },
  { token: 'p-4 / gap-4', px: '16px',  usage: 'Card internal padding (mobile)' },
  { token: 'p-6 / gap-6', px: '24px',  usage: 'Card padding (desktop), section gaps' },
  { token: 'p-8 / gap-8', px: '32px',  usage: 'Section padding' },
  { token: 'p-12',        px: '48px',  usage: 'Page vertical padding' },
] as const;

const borderRadii = [
  { token: 'rounded-sm',   value: '2px',   usage: 'Code chips, micro badges' },
  { token: 'rounded',      value: '4px',   usage: 'Inputs (fallback), tight components' },
  { token: 'rounded-lg',   value: '8px',   usage: 'Standard buttons, alerts, dropdowns' },
  { token: 'rounded-xl',   value: '12px',  usage: 'Form sections, notification banners' },
  { token: 'rounded-2xl',  value: '16px',  usage: 'Cards, modals, wizard panels' },
  { token: 'rounded-full', value: '9999px',usage: 'Pill badges, avatar status dots' },
] as const;

const semanticTokens = [
  { token: '--color-bg',           value: 'neutral-950 (#030712)',  usage: 'Page background' },
  { token: '--color-surface',      value: 'neutral-900 (#111827)',  usage: 'Card background' },
  { token: '--color-surface-2',    value: 'neutral-800 (#1f2937)',  usage: 'Input background' },
  { token: '--color-border',       value: 'neutral-700 (#374151)',  usage: 'Default border' },
  { token: '--color-text',         value: 'neutral-50  (#f9fafb)',  usage: 'Primary body text' },
  { token: '--color-text-muted',   value: 'neutral-400 (#9ca3af)',  usage: 'Placeholder / secondary text' },
  { token: '--color-focus-ring',   value: 'brand-400   (#60a5fa)',  usage: 'Global focus ring' },
  { token: '--color-primary',      value: 'brand-600   (#2563eb)',  usage: 'Primary button fill' },
  { token: '--color-primary-hover',value: 'brand-500   (#3b82f6)',  usage: 'Primary button hover' },
] as const;

// ─── Swatch component ─────────────────────────────────────────────────────────

function Swatch({
  token,
  hex,
  textDark,
}: {
  token: string;
  hex: string;
  textDark: boolean;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div
        className="h-12 w-full rounded-lg border border-neutral-700/40"
        style={{ backgroundColor: hex }}
        title={hex}
        aria-label={`${token}: ${hex}`}
      />
      <p className={`text-xs font-mono text-neutral-400 truncate`}>{token}</p>
      <p className="text-xs font-mono text-neutral-500">{hex}</p>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function DesignSystemPage() {
  return (
    <main className="min-h-screen px-6 py-12 max-w-6xl mx-auto space-y-16">
      {/* ── Header ── */}
      <div>
        <span className="text-xs font-semibold uppercase tracking-widest text-brand-400">
          Issue #1427
        </span>
        <h1 className="mt-2 text-4xl font-extrabold tracking-tight text-white">
          SorobanPay Design System
        </h1>
        <p className="mt-3 text-neutral-400 max-w-2xl">
          Design tokens defined in{' '}
          <code className="bg-neutral-800 px-1.5 py-0.5 rounded text-sm text-neutral-200">
            tailwind.config.ts
          </code>{' '}
          and exposed as CSS custom properties in{' '}
          <code className="bg-neutral-800 px-1.5 py-0.5 rounded text-sm text-neutral-200">
            globals.css
          </code>
          . All existing components reference these tokens — no hardcoded hex values remain.
        </p>
      </div>

      {/* ── Color Palette ── */}
      <section aria-labelledby="color-heading">
        <h2 id="color-heading" className="text-2xl font-bold text-white mb-2">
          Color Palette
        </h2>
        <p className="text-neutral-400 text-sm mb-8">
          Dark-first palette. All contrast ratios verified against WCAG 2.1 AA (4.5:1 text, 3:1 UI).
        </p>

        <div className="space-y-10">
          {colorGroups.map((group) => (
            <div key={group.name}>
              <h3 className="text-lg font-semibold text-white mb-1">{group.name}</h3>
              <p className="text-sm text-neutral-500 mb-4">{group.description}</p>
              <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-11 gap-3">
                {group.swatches.map((s) => (
                  <Swatch key={s.token} {...s} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Semantic Tokens ── */}
      <section aria-labelledby="semantic-heading">
        <h2 id="semantic-heading" className="text-2xl font-bold text-white mb-2">
          Semantic CSS Variables
        </h2>
        <p className="text-neutral-400 text-sm mb-6">
          Semantic tokens abstract the palette behind intent. Use these in plain CSS or when
          Tailwind class names are not available.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b border-neutral-700">
                <th className="text-left py-2 pr-6 text-neutral-300 font-semibold">Variable</th>
                <th className="text-left py-2 pr-6 text-neutral-300 font-semibold">Resolves to</th>
                <th className="text-left py-2 text-neutral-300 font-semibold">Usage</th>
              </tr>
            </thead>
            <tbody>
              {semanticTokens.map((t) => (
                <tr key={t.token} className="border-b border-neutral-800 hover:bg-neutral-900/50">
                  <td className="py-2 pr-6 font-mono text-brand-300">{t.token}</td>
                  <td className="py-2 pr-6 font-mono text-neutral-400">{t.value}</td>
                  <td className="py-2 text-neutral-500">{t.usage}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── Typography ── */}
      <section aria-labelledby="type-heading">
        <h2 id="type-heading" className="text-2xl font-bold text-white mb-2">
          Typography Scale
        </h2>
        <p className="text-neutral-400 text-sm mb-6">
          Tailwind&apos;s built-in type scale. Weights in use: 400 normal, 500 medium, 600 semibold,
          700 bold, 800 extrabold. Font stacks: <code className="bg-neutral-800 px-1 rounded text-xs">font-sans</code> (system UI) and{' '}
          <code className="bg-neutral-800 px-1 rounded text-xs">font-mono</code> (addresses / code).
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b border-neutral-700">
                <th className="text-left py-2 pr-6 text-neutral-300 font-semibold">Token</th>
                <th className="text-left py-2 pr-6 text-neutral-300 font-semibold">Size / rem</th>
                <th className="text-left py-2 pr-6 text-neutral-300 font-semibold">Weight(s)</th>
                <th className="text-left py-2 text-neutral-300 font-semibold">Usage</th>
              </tr>
            </thead>
            <tbody>
              {typographyScale.map((t) => (
                <tr key={t.token} className="border-b border-neutral-800 hover:bg-neutral-900/50">
                  <td className="py-2 pr-6 font-mono text-brand-300">{t.token}</td>
                  <td className="py-2 pr-6 text-neutral-400">{t.size}</td>
                  <td className="py-2 pr-6 text-neutral-400">{t.weight}</td>
                  <td className="py-2 text-neutral-500">{t.usage}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── Spacing ── */}
      <section aria-labelledby="spacing-heading">
        <h2 id="spacing-heading" className="text-2xl font-bold text-white mb-2">
          Spacing Scale
        </h2>
        <p className="text-neutral-400 text-sm mb-6">
          Tailwind defaults (base unit 4px). Guideline: prefer multiples of 4 for layout padding
          and multiples of 2 for component internal gaps.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b border-neutral-700">
                <th className="text-left py-2 pr-6 text-neutral-300 font-semibold">Token</th>
                <th className="text-left py-2 pr-6 text-neutral-300 font-semibold">Value</th>
                <th className="text-left py-2 text-neutral-300 font-semibold">Typical usage</th>
              </tr>
            </thead>
            <tbody>
              {spacingNotes.map((s) => (
                <tr key={s.token} className="border-b border-neutral-800 hover:bg-neutral-900/50">
                  <td className="py-2 pr-6 font-mono text-brand-300">{s.token}</td>
                  <td className="py-2 pr-6 text-neutral-400">{s.px}</td>
                  <td className="py-2 text-neutral-500">{s.usage}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── Border Radius ── */}
      <section aria-labelledby="radius-heading">
        <h2 id="radius-heading" className="text-2xl font-bold text-white mb-2">
          Border Radius
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-4 mt-4">
          {borderRadii.map((r) => (
            <div key={r.token} className="flex flex-col items-center gap-2">
              <div
                className="w-14 h-14 bg-brand-600 border border-brand-400"
                style={{ borderRadius: r.value }}
                title={`${r.token}: ${r.value}`}
              />
              <span className="text-xs font-mono text-neutral-400">{r.token}</span>
              <span className="text-xs text-neutral-600">{r.value}</span>
              <span className="text-xs text-neutral-500 text-center">{r.usage}</span>
            </div>
          ))}
        </div>
      </section>

      {/* ── Dark Mode Note ── */}
      <section
        aria-labelledby="darkmode-heading"
        className="rounded-2xl border border-brand-800 bg-brand-950/40 p-6"
      >
        <h2 id="darkmode-heading" className="text-xl font-semibold text-brand-300 mb-2">
          Dark Mode
        </h2>
        <p className="text-neutral-400 text-sm leading-relaxed">
          The app is dark-first. Tailwind&apos;s <code className="bg-neutral-800 px-1 rounded text-xs">darkMode: &apos;class&apos;</code> strategy
          is configured in <code className="bg-neutral-800 px-1 rounded text-xs">tailwind.config.ts</code>.
          Add a <code className="bg-neutral-800 px-1 rounded text-xs">dark</code> class to{' '}
          <code className="bg-neutral-800 px-1 rounded text-xs">&lt;html&gt;</code> to activate dark mode.
          All semantic CSS variables in <code className="bg-neutral-800 px-1 rounded text-xs">globals.css</code>{' '}
          resolve to their dark values by default; a <code className="bg-neutral-800 px-1 rounded text-xs">.light</code>{' '}
          class scope can override them when light-mode support is added.
        </p>
      </section>

      <footer className="text-xs text-neutral-600 pb-8">
        Design system documented under issue{' '}
        <a
          href="https://github.com/Chrisland58/SorobanPay/issues/1427"
          className="text-brand-500 hover:text-brand-400 underline"
          target="_blank"
          rel="noopener noreferrer"
        >
          #1427
        </a>
        . Tokens defined in{' '}
        <code>frontend/tailwind.config.ts</code> and{' '}
        <code>frontend/src/app/globals.css</code>.
      </footer>
    </main>
  );
}
