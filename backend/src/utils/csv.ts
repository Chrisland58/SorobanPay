/**
 * backend/src/utils/csv.ts
 *
 * RFC 4180-compliant CSV cell formatting with defense against Formula Injection
 * (CSV Injection / DDE Injection, CWE-1236).
 *
 * Policy:
 * - Leading characters '=', '+', '-', '@', '\t', '\r' are formula triggers in
 *   spreadsheet software (Excel, LibreOffice Calc, Google Sheets).
 * - Legitimate numeric strings (e.g. "-100", "+50.25", "1000") are preserved.
 * - Non-numeric formula triggers are neutralized by prepending a single quote (').
 * - Cells containing quotes, commas, or newlines are wrapped in double quotes
 *   with internal double quotes escaped as '""'.
 */

const FORMULA_TRIGGER_REGEX = /^[=+\-@\t\r]/;
const NUMERIC_REGEX = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/;

/**
 * Sanitize and escape a single CSV cell value.
 */
export function sanitizeCsvCell(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }

  let str = String(value);

  // Check for formula-like cells: begins with trigger char, but is not a valid number
  if (FORMULA_TRIGGER_REGEX.test(str) && !NUMERIC_REGEX.test(str.trim())) {
    str = `'${str}`;
  }

  // RFC 4180 escaping for quotes, commas, newlines
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }

  return str;
}

/**
 * Format an array of cell values into an RFC 4180 compliant CSV line terminated by CRLF.
 */
export function toCsvRow(cells: unknown[]): string {
  return cells.map(sanitizeCsvCell).join(',') + '\r\n';
}
