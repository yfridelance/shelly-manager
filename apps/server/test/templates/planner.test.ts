import { describe, expect, it } from 'vitest';
import { SECRET_MASK, planTemplate } from '../../src/templates/planner.js';

const GEN2_CONFIG = {
  ble: { enable: true, rpc: { enable: true }, observer: { enable: false } },
  cloud: { enable: true, server: 'shelly-103-eu.shelly.cloud:6022/jrpc' },
  mqtt: { enable: false, server: null, client_id: 'plus1pm-a8032ab12345', user: null, topic_prefix: 'plus1pm-a8032ab12345' },
  sys: {
    device: { name: 'Boiler', eco_mode: false },
    location: { tz: 'Europe/Zurich', lat: 47.3769, lon: 8.5417 },
    sntp: { server: 'time.google.com' },
  },
  wifi: { ap: { enable: true, is_open: true }, roam: { rssi_thr: -80, interval: 60 } },
  'script:1': { id: 1, name: 'heizung', enable: true },
};

const GEN1_SETTINGS = {
  device: { hostname: 'shelly1-A1B2C3' },
  mqtt: { enable: false, server: '192.168.33.3:1883', user: '', id: 'shelly1-A1B2C3' },
  coiot: { enabled: true, update_period: 15, peer: '' },
  sntp: { server: 'time.google.com', enabled: true },
  cloud: { enabled: true, connected: false },
  timezone: 'Europe/Zurich',
  lat: 47.3769,
  lng: 8.5417,
  tzautodetect: true,
  led_status_disable: false,
  ap_roaming: { enabled: false, threshold: -70 },
};

const ctx2 = { deviceId: 'plus1pm-a8032ab12345', mac: 'A8032AB12345' };
const ctx1 = { deviceId: 'shelly1-A1B2C3', mac: 'E868E7A1B2C3' };

describe('planTemplate for Gen2+', () => {
  it('groups changes into one SetConfig per component and skips equal values', () => {
    const plan = planTemplate(
      2,
      GEN2_CONFIG,
      {
        mqtt: { enable: true, server: 'mqtt.home:1883', clientId: '{id}' },
        cloud: { enable: false },
        time: { timezone: 'Europe/Zurich', sntpServer: 'ch.pool.ntp.org' },
        eco: { ecoMode: true },
        bluetooth: { rpc: false },
      },
      ctx2,
    );
    expect(plan.steps).toEqual([
      { kind: 'rpc', method: 'MQTT.SetConfig', params: { config: { enable: true, server: 'mqtt.home:1883' } } },
      { kind: 'rpc', method: 'Cloud.SetConfig', params: { config: { enable: false } } },
      { kind: 'rpc', method: 'Sys.SetConfig', params: { config: { sntp: { server: 'ch.pool.ntp.org' }, device: { eco_mode: true } } } },
      { kind: 'rpc', method: 'BLE.SetConfig', params: { config: { rpc: { enable: false } } } },
    ]);
    const status = Object.fromEntries(plan.items.map((i) => [i.key, i.status]));
    expect(status).toMatchObject({ 'mqtt.clientId': 'same', 'time.timezone': 'same', 'mqtt.enable': 'change', 'cloud.enable': 'change' });
    expect(plan.items.find((i) => i.key === 'mqtt.server')).toEqual({ key: 'mqtt.server', status: 'change', current: null, target: 'mqtt.home:1883' });
  });

  it('reports Gen1-only settings and fields missing in this firmware as unsupported', () => {
    const { ble, ...noBle } = GEN2_CONFIG;
    const plan = planTemplate(2, { ...noBle, ble: { rpc: ble.rpc } }, { coiot: { enable: false }, eco: { ledStatusDisable: true }, bluetooth: { enable: false } }, ctx2);
    expect(plan.items).toEqual([
      { key: 'eco.ledStatusDisable', status: 'unsupported', target: true, reason: 'generation' },
      { key: 'bluetooth.enable', status: 'unsupported', target: false, reason: 'firmware' },
      { key: 'coiot.enable', status: 'unsupported', target: false, reason: 'generation' },
    ]);
    expect(plan.steps).toEqual([]);
  });

  it('maps AP roaming to the scan interval', () => {
    expect(planTemplate(2, GEN2_CONFIG, { apRoaming: { enable: false, threshold: -75 } }, ctx2).steps).toEqual([
      { kind: 'rpc', method: 'WiFi.SetConfig', params: { config: { roam: { interval: 0, rssi_thr: -75 } } } },
    ]);
    const off = { ...GEN2_CONFIG, wifi: { ...GEN2_CONFIG.wifi, roam: { rssi_thr: -80, interval: 0 } } };
    expect(planTemplate(2, off, { apRoaming: { enable: true } }, ctx2).steps).toEqual([
      { kind: 'rpc', method: 'WiFi.SetConfig', params: { config: { roam: { interval: 60 } } } },
    ]);
  });

  it('adds secrets to the calls but masks them in the items', () => {
    const plan = planTemplate(2, GEN2_CONFIG, { mqtt: { user: 'shelly' }, wifiAp: { enable: true } }, ctx2, {
      mqttPassword: 'mqtt-geheim',
      apPassword: 'ap-geheim-123',
    });
    expect(plan.steps).toEqual([
      { kind: 'rpc', method: 'MQTT.SetConfig', params: { config: { user: 'shelly', pass: 'mqtt-geheim' } } },
      { kind: 'rpc', method: 'WiFi.SetConfig', params: { config: { ap: { pass: 'ap-geheim-123' } } } },
    ]);
    expect(JSON.stringify(plan.items)).not.toMatch(/geheim/);
    expect(plan.items.find((i) => i.key === 'mqtt.password')).toEqual({ key: 'mqtt.password', status: 'change', current: SECRET_MASK, target: SECRET_MASK });
  });

  it('enables the AP only together with a password (firmware >= 2.0 requires it)', () => {
    const apOff = { ...GEN2_CONFIG, wifi: { ...GEN2_CONFIG.wifi, ap: { enable: false, is_open: true } } };
    const without = planTemplate(2, apOff, { wifiAp: { enable: true }, apRoaming: { threshold: -70 } }, ctx2);
    expect(without.items[0]).toEqual({ key: 'wifiAp.enable', status: 'unsupported', current: false, target: true, reason: 'password' });
    // The rest of the template still applies.
    expect(without.steps).toEqual([{ kind: 'rpc', method: 'WiFi.SetConfig', params: { config: { roam: { rssi_thr: -70 } } } }]);

    const withPw = planTemplate(2, apOff, { wifiAp: { enable: true } }, ctx2, { apPassword: 'ap-geheim-123' });
    expect(withPw.steps).toEqual([{ kind: 'rpc', method: 'WiFi.SetConfig', params: { config: { ap: { enable: true, pass: 'ap-geheim-123' } } } }]);

    // Disabling needs no password.
    expect(planTemplate(2, GEN2_CONFIG, { wifiAp: { enable: false } }, ctx2).steps).toEqual([
      { kind: 'rpc', method: 'WiFi.SetConfig', params: { config: { ap: { enable: false } } } },
    ]);
  });

  it('plans a script deployment by name', () => {
    const plan = planTemplate(2, GEN2_CONFIG, { script: { name: 'heizung', code: 'print(1)', enable: true, start: true } }, ctx2);
    expect(plan.script).toEqual({ name: 'heizung', code: 'print(1)', enable: true, start: true });
    expect(plan.items).toEqual([
      { key: 'script', status: 'change', current: { name: 'heizung', enable: true }, target: { name: 'heizung', enable: true, start: true } },
    ]);
  });
});

describe('planTemplate for Gen1', () => {
  it('merges /settings parameters into one call and keeps cloud separate', () => {
    const plan = planTemplate(
      1,
      GEN1_SETTINGS,
      {
        mqtt: { enable: true, server: 'mqtt.home:1883', clientId: 'haus-{mac}', topicPrefix: 'x' },
        cloud: { enable: false },
        time: { timezone: 'Europe/Berlin', lat: 47.3769 },
        coiot: { enable: false },
        apRoaming: { enable: true, threshold: -70 },
        eco: { ecoMode: true, ledStatusDisable: true },
      },
      ctx1,
    );
    expect(plan.steps).toEqual([
      {
        kind: 'gen1',
        path: '/settings',
        params: {
          mqtt_enable: 'true',
          mqtt_server: 'mqtt.home:1883',
          mqtt_id: 'haus-E868E7A1B2C3',
          timezone: 'Europe/Berlin',
          tzautodetect: 'false',
          led_status_disable: 'true',
          ap_roaming_enabled: 'true',
          coiot_enable: 'false',
        },
      },
      { kind: 'gen1', path: '/settings/cloud', params: { enabled: 'false' } },
    ]);
    const byKey = Object.fromEntries(plan.items.map((i) => [i.key, i]));
    expect(byKey['mqtt.topicPrefix']).toMatchObject({ status: 'unsupported', reason: 'generation' });
    expect(byKey['eco.ecoMode']).toMatchObject({ status: 'unsupported', reason: 'generation' });
    expect(byKey['time.lat']).toMatchObject({ status: 'same' });
    expect(byKey['apRoaming.threshold']).toMatchObject({ status: 'same' });
  });

  it('never enables the AP or deploys scripts on Gen1', () => {
    const plan = planTemplate(1, GEN1_SETTINGS, { wifiAp: { enable: true }, script: { name: 'x', code: 'y' } }, ctx1, { apPassword: 'ap-geheim-123' });
    expect(plan.steps).toEqual([]);
    expect(plan.items.map((i) => [i.key, i.status, i.reason])).toEqual([
      ['wifiAp.enable', 'unsupported', 'generation'],
      ['wifiAp.password', 'unsupported', 'generation'],
      ['script', 'unsupported', 'generation'],
    ]);
  });

  it('sends the MQTT password as mqtt_pass', () => {
    const plan = planTemplate(1, GEN1_SETTINGS, { mqtt: { enable: true } }, ctx1, { mqttPassword: 'mqtt-geheim' });
    expect(plan.steps).toEqual([{ kind: 'gen1', path: '/settings', params: { mqtt_enable: 'true', mqtt_pass: 'mqtt-geheim' } }]);
  });
});
