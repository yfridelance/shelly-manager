import type { NetworkSettings, PlanItem, TemplateSettings, WifiInterface } from './api.types';
import { t, translate, type TranslationKey } from './i18n/i18n';

export type FieldType = 'bool' | 'text' | 'number' | 'code';

/** Keys with a label in the locale files (`templateFields.<key>`), e.g. "mqtt.server". */
export type FieldKey = TranslationKey extends infer K ? (K extends `templateFields.${infer F}` ? F : never) : never;

export interface TemplateField {
  /** Same keys as the server planner, e.g. "mqtt.server". Label: `templateFields.<key>`. */
  key: FieldKey;
  type: FieldType;
  placeholder?: string;
  /** Has a hint text `templateHints.<key>`. */
  hint?: true;
  min?: number;
  max?: number;
  step?: number;
}

export type GroupId = keyof TemplateSettings;

export interface TemplateGroup {
  /** Title, generations and hint: `templateGroups.<id>.title|gens|hint`. */
  id: GroupId;
  hint?: true;
  fields: TemplateField[];
}

export const TEMPLATE_GROUPS: TemplateGroup[] = [
  {
    id: 'mqtt',
    hint: true,
    fields: [
      { key: 'mqtt.enable', type: 'bool' },
      { key: 'mqtt.server', type: 'text', placeholder: 'mqtt.home:1883' },
      { key: 'mqtt.user', type: 'text' },
      { key: 'mqtt.clientId', type: 'text', placeholder: '{id}', hint: true },
      { key: 'mqtt.topicPrefix', type: 'text', placeholder: 'haus/{id}', hint: true },
    ],
  },
  {
    id: 'cloud',
    fields: [{ key: 'cloud.enable', type: 'bool' }],
  },
  {
    id: 'device',
    hint: true,
    fields: [{ key: 'device.name', type: 'text', placeholder: '{floor} {location} {kind}', hint: true }],
  },
  {
    id: 'time',
    hint: true,
    fields: [
      { key: 'time.sntpServer', type: 'text', placeholder: 'ch.pool.ntp.org' },
      { key: 'time.timezone', type: 'text', placeholder: 'Europe/Zurich' },
      { key: 'time.lat', type: 'number', min: -90, max: 90, step: 0.0001 },
      { key: 'time.lon', type: 'number', min: -180, max: 180, step: 0.0001 },
    ],
  },
  {
    id: 'eco',
    hint: true,
    fields: [
      { key: 'eco.ecoMode', type: 'bool' },
      { key: 'eco.ledStatusDisable', type: 'bool' },
    ],
  },
  {
    id: 'bluetooth',
    hint: true,
    fields: [
      { key: 'bluetooth.enable', type: 'bool' },
      { key: 'bluetooth.rpc', type: 'bool' },
      { key: 'bluetooth.observer', type: 'bool' },
    ],
  },
  {
    id: 'wifiAp',
    hint: true,
    fields: [{ key: 'wifiAp.enable', type: 'bool' }],
  },
  {
    id: 'apRoaming',
    fields: [
      { key: 'apRoaming.enable', type: 'bool' },
      { key: 'apRoaming.threshold', type: 'number', min: -100, max: -30, step: 1, placeholder: '-70' },
    ],
  },
  {
    id: 'coiot',
    fields: [
      { key: 'coiot.enable', type: 'bool' },
      { key: 'coiot.updatePeriod', type: 'number', min: 1, max: 3600, step: 1 },
      { key: 'coiot.peer', type: 'text', placeholder: '192.168.1.10:5683' },
    ],
  },
];

/** Script is edited as one unit (name and code are required together). */
export const SCRIPT_FIELDS: TemplateField[] = [
  { key: 'script.name', type: 'text', placeholder: 'heizung' },
  { key: 'script.code', type: 'code' },
  { key: 'script.enable', type: 'bool' },
  { key: 'script.start', type: 'bool' },
];

export function groupTitle(id: GroupId): string {
  return t(`templateGroups.${id}.title`);
}

export function groupGens(id: GroupId): string {
  return t(`templateGroups.${id}.gens`);
}

export function groupHint(g: TemplateGroup): string | null {
  return g.hint ? translate(`templateGroups.${g.id}.hint`) : null;
}

export function fieldText(key: FieldKey): string {
  return t(`templateFields.${key}`);
}

export function fieldHint(f: TemplateField): string | null {
  return f.hint ? translate(`templateHints.${f.key}`) : null;
}

export function wifiLabel(iface: WifiInterface): string {
  return t(`wifi.${iface}`);
}

/** "Haupt-WLAN: statisch ab 192.168.10.50/255.255.255.0, Gateway 192.168.10.1" */
export function describeNetwork(iface: WifiInterface, n: NetworkSettings): string {
  if (n.mode === 'dhcp') return t('network.describeDhcp', { iface: wifiLabel(iface) });
  const parts = [t('network.describeStatic', { iface: wifiLabel(iface), ip: n.ipFrom, netmask: n.netmask })];
  if (n.gateway) parts.push(t('network.describeGateway', { gateway: n.gateway }));
  if (n.dns) parts.push(t('network.describeDns', { dns: n.dns }));
  return parts.join(', ');
}

const NETWORK_FIELDS = ['mode', 'ip', 'netmask', 'gateway', 'dns'] as const;

export function fieldLabel(key: string): string {
  const net = /^network\.(sta1?)\.(\w+)$/.exec(key);
  if (net) {
    const field = NETWORK_FIELDS.find((f) => f === net[2]);
    return `${wifiLabel(net[1] as WifiInterface)}: ${field ? t(`network.field.${field}`) : net[2]}`;
  }
  for (const g of TEMPLATE_GROUPS) {
    const f = g.fields.find((x) => x.key === key);
    if (f) return `${groupTitle(g.id)}: ${fieldText(f.key)}`;
  }
  if (key === 'mqtt.password') return t('templateFields.mqtt.password');
  if (key === 'wifiAp.password') return t('templateFields.wifiAp.password');
  if (key === 'script') return groupTitle('script');
  return key;
}

function getPath(obj: unknown, key: string): unknown {
  return key.split('.').reduce<unknown>((acc, k) => (acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[k] : undefined), obj);
}

/** "MQTT: Server = mqtt.home:1883" lines for a template overview. */
export function describeSettings(settings: TemplateSettings): string[] {
  const lines: string[] = [];
  for (const g of TEMPLATE_GROUPS) {
    for (const f of g.fields) {
      const v = getPath(settings, f.key);
      if (v !== undefined) lines.push(`${groupTitle(g.id)}: ${fieldText(f.key)} = ${formatValue(v)}`);
    }
  }
  if (settings.script) lines.push(t('templateValue.distributeScript', { name: settings.script.name }));
  for (const iface of ['sta', 'sta1'] as const) {
    const n = settings.network?.[iface];
    if (n) lines.push(`${groupTitle('network')}: ${describeNetwork(iface, n)}`);
  }
  return lines;
}

export function groupTitles(settings: TemplateSettings): string[] {
  const titles = TEMPLATE_GROUPS.filter((g) => settings[g.id] && Object.keys(settings[g.id] as object).length > 0).map((g) => groupTitle(g.id));
  const extra = [...(settings.script ? [groupTitle('script')] : []), ...(settings.network ? [groupTitle('network')] : [])];
  return [...titles, ...extra];
}

export function formatValue(v: unknown): string {
  if (v === 'dhcp') return 'DHCP';
  if (v === 'static') return t('templateValue.static');
  if (v === true) return t('templateValue.on');
  if (v === false) return t('templateValue.off');
  if (v === null || v === undefined || v === '') return '–';
  if (typeof v === 'object') {
    const s = v as { name?: string; enable?: boolean; start?: boolean };
    if (s.name !== undefined) {
      const parts = [`«${s.name}»`];
      if (s.enable !== undefined) parts.push(s.enable ? t('templateValue.autostartOn') : t('templateValue.autostartOff'));
      if (s.start) parts.push(t('templateValue.start'));
      return parts.join(', ');
    }
    return JSON.stringify(v);
  }
  return String(v);
}

/** One line per plan item for previews and results. */
export function itemText(item: PlanItem): string {
  const label = fieldLabel(item.key);
  if (item.status === 'unsupported') return `${label}: ${t(`unsupported.${item.reason ?? 'firmware'}`)}`;
  if (item.status === 'same') return t('plan.same', { label, value: formatValue(item.target) });
  if (item.key === 'script') {
    return t(item.current ? 'plan.scriptUpdate' : 'plan.scriptCreate', { label, value: formatValue(item.target) });
  }
  return `${label}: ${formatValue(item.current)} → ${formatValue(item.target)}`;
}
