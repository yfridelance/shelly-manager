/** Normalizes a MAC to 12 uppercase hex digits without separators. Throws on anything else. */
export function normalizeMac(input: string): string {
  const mac = input.replace(/[:\-.\s]/g, '').toUpperCase();
  if (!/^[0-9A-F]{12}$/.test(mac)) {
    throw new Error(`Invalid MAC address: ${input}`);
  }
  return mac;
}
