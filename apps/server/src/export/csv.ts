/**
 * CSV for Excel in Switzerland: semicolon separated, CRLF, UTF-8 with BOM (so umlauts survive).
 * Cells starting with = + - @ (or tab/CR) are prefixed with ' to prevent formula injection
 * from user-entered notes.
 */
export function toCsv(header: readonly string[], rows: readonly (readonly (string | number | null | undefined)[])[]): string {
  const lines = [header, ...rows].map((row) => row.map(cell).join(';'));
  return `﻿${lines.join('\r\n')}\r\n`;
}

function cell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  let text = String(value);
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[;"\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
