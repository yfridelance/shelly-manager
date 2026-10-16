import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

describe('loadConfig', () => {
  it('uses dev defaults', () => {
    const c = loadConfig({});
    expect(c).toMatchObject({ port: 3000, host: '127.0.0.1', staticDir: undefined, logLevel: 'info' });
    expect(c.dataDir).toBe(path.resolve('data'));
  });

  it('reads the container env', () => {
    const c = loadConfig({ PORT: '8080', HOST: '0.0.0.0', DATA_DIR: '/data', STATIC_DIR: '/app/web', LOG_LEVEL: 'warn' });
    expect(c).toEqual({ port: 8080, host: '0.0.0.0', dataDir: '/data', staticDir: '/app/web', logLevel: 'warn', shellyHostMap: undefined, allowedHosts: [] });
  });

  it('parses ALLOWED_HOSTS as a comma-separated list', () => {
    expect(loadConfig({}).allowedHosts).toEqual([]);
    expect(loadConfig({ ALLOWED_HOSTS: ' shelly.home.lan, *.Proxy.LAN ,,' }).allowedHosts).toEqual(['shelly.home.lan', '*.proxy.lan']);
  });

  it('rejects invalid values', () => {
    expect(() => loadConfig({ PORT: 'abc' })).toThrow(/PORT/);
    expect(() => loadConfig({ LOG_LEVEL: 'loud' })).toThrow(/LOG_LEVEL/);
  });
});
