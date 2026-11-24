import { getRequestConfig } from 'next-intl/server';
import { notFound } from 'next/navigation';

/**
 * i18n.ts — next-intl server-side configuration (FE-35, Issue #1345)
 *
 * Defines supported locales, loads per-request message files, and provides
 * RTL support scaffolding.
 */

export const locales = ['en', 'es', 'fr', 'ar'] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = 'en';

export const rtlLocales: readonly Locale[] = ['ar'] as const;

export function isRtlLocale(locale: string): boolean {
  return rtlLocales.includes(locale as Locale);
}

export function getLocaleDirection(locale: string): 'ltr' | 'rtl' {
  return isRtlLocale(locale) ? 'rtl' : 'ltr';
}

export default getRequestConfig(async ({ locale }) => {
  // Validate that the locale is supported; fallback or 404 otherwise
  if (!locales.includes(locale as Locale)) notFound();

  return {
    messages: (
      await import(`../messages/${locale}.json`)
    ).default,
  };
});
