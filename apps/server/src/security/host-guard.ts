import type { FastifyInstance } from 'fastify';

/**
 * Protection against DNS rebinding and cross-site requests.
 *
 * The app has no login and can factory-reset devices. A foreign web page could
 * rebind its own domain to 127.0.0.1 and then call the API from the browser;
 * such requests carry the foreign name in the Host header. Browsers also send
 * an Origin header on cross-site POST/PUT/PATCH/DELETE, so a foreign Origin on
 * a writing request is rejected as well (CSRF via simple form posts).
 */

/** Always allowed: loopback names. `*.` matches any subdomain. */
export const DEFAULT_ALLOWED_HOSTS: readonly string[] = ['localhost', '*.localhost', '127.0.0.1', '::1'];

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Normalises a host name: lower case, without brackets around IPv6 and without a trailing dot. */
function normalizeHostname(name: string): string {
  let host = name.trim().toLowerCase();
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
  if (host.endsWith('.')) host = host.slice(0, -1);
  return host;
}

/** Host header value (`name[:port]`, IPv6 in brackets) → normalised host name, or undefined if malformed. */
export function hostnameFromHostHeader(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const value = header.trim();
  if (value.startsWith('[')) {
    const end = value.indexOf(']');
    if (end < 0) return undefined;
    const rest = value.slice(end + 1);
    if (rest !== '' && !/^:\d+$/.test(rest)) return undefined;
    return normalizeHostname(value.slice(0, end + 1));
  }
  const colons = value.split(':').length - 1;
  if (colons > 1) return undefined; // unbracketed IPv6 is not a valid Host header
  const [name, port] = value.split(':');
  if (port !== undefined && !/^\d+$/.test(port)) return undefined;
  return name ? normalizeHostname(name) : undefined;
}

/** Origin header → normalised host name; undefined for `null` and anything that is no URL. */
export function hostnameFromOrigin(origin: string): string | undefined {
  try {
    const url = new URL(origin);
    return url.hostname ? normalizeHostname(url.hostname) : undefined;
  } catch {
    return undefined;
  }
}

export function isHostAllowed(hostname: string | undefined, allowed: readonly string[]): boolean {
  if (!hostname) return false;
  return allowed.some((entry) => {
    const pattern = normalizeHostname(entry);
    if (pattern.startsWith('*.')) return hostname.endsWith(pattern.slice(1)) && hostname.length > pattern.length - 1;
    return hostname === pattern;
  });
}

/** Registers the guard for all `/api` requests (including unknown API paths). The SPA itself stays reachable. */
export function registerHostGuard(app: FastifyInstance, extraHosts: readonly string[] = []): void {
  const allowed = [...DEFAULT_ALLOWED_HOSTS, ...extraHosts];

  app.addHook('onRequest', async (request, reply) => {
    const url = request.url.split('?')[0] ?? '';
    if (url !== '/api' && !url.startsWith('/api/')) return;

    if (!isHostAllowed(hostnameFromHostHeader(request.headers.host), allowed)) {
      request.log.warn({ host: request.headers.host }, 'rejected request with foreign Host header');
      return reply.code(403).send({
        error: 'host_not_allowed',
        message: 'Zugriff über diesen Hostnamen ist nicht erlaubt. Weitere Namen über ALLOWED_HOSTS freigeben.',
      });
    }

    const origin = request.headers.origin;
    if (origin !== undefined && WRITE_METHODS.has(request.method) && !isHostAllowed(hostnameFromOrigin(origin), allowed)) {
      request.log.warn({ origin }, 'rejected writing request from foreign Origin');
      return reply.code(403).send({
        error: 'origin_not_allowed',
        message: 'Schreibende Anfragen von fremden Webseiten sind nicht erlaubt.',
      });
    }
  });
}
