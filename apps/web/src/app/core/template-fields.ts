import type { PlanItem, TemplateSettings } from './api.types';

export type FieldType = 'bool' | 'text' | 'number' | 'code';

export interface TemplateField {
  /** Same keys as the server planner, e.g. "mqtt.server". */
  key: string;
  label: string;
  type: FieldType;
  placeholder?: string;
  hint?: string;
  min?: number;
  max?: number;
  step?: number;
}

export interface TemplateGroup {
  id: keyof TemplateSettings;
  title: string;
  /** Which generations the group applies to. */
  gens: string;
  hint?: string;
  fields: TemplateField[];
}

export const TEMPLATE_GROUPS: TemplateGroup[] = [
  {
    id: 'mqtt',
    title: 'MQTT',
    gens: 'Gen1 und Gen2+',
    hint: 'Das MQTT-Passwort wird nicht gespeichert, sondern beim Anwenden eingegeben. Gen2+ braucht nach MQTT-Änderungen einen Neustart.',
    fields: [
      { key: 'mqtt.enable', label: 'MQTT aktiv', type: 'bool' },
      { key: 'mqtt.server', label: 'Server', type: 'text', placeholder: 'mqtt.home:1883' },
      { key: 'mqtt.user', label: 'Benutzer', type: 'text' },
      { key: 'mqtt.clientId', label: 'Client-ID', type: 'text', placeholder: '{id}', hint: 'Gen1: auch Topic-ID («shellies/<id>/…»). Platzhalter {id}, {mac}.' },
      { key: 'mqtt.topicPrefix', label: 'Topic-Präfix', type: 'text', placeholder: 'haus/{id}', hint: 'Nur Gen2+. Platzhalter {id}, {mac}.' },
    ],
  },
  {
    id: 'cloud',
    title: 'Shelly Cloud',
    gens: 'Gen1 und Gen2+',
    fields: [{ key: 'cloud.enable', label: 'Cloud-Verbindung', type: 'bool' }],
  },
  {
    id: 'time',
    title: 'Zeit und Standort',
    gens: 'Gen1 und Gen2+',
    hint: 'Koordinaten werden für Sonnenauf- und -untergang verwendet. Gen1: feste Zeitzone schaltet die automatische Erkennung aus.',
    fields: [
      { key: 'time.sntpServer', label: 'SNTP-Server', type: 'text', placeholder: 'ch.pool.ntp.org' },
      { key: 'time.timezone', label: 'Zeitzone', type: 'text', placeholder: 'Europe/Zurich' },
      { key: 'time.lat', label: 'Breitengrad', type: 'number', min: -90, max: 90, step: 0.0001 },
      { key: 'time.lon', label: 'Längengrad', type: 'number', min: -180, max: 180, step: 0.0001 },
    ],
  },
  {
    id: 'eco',
    title: 'Eco-Modus und LED',
    gens: 'Eco: Gen2+, LED: Gen1',
    hint: 'Für Gen1 ist der Eco-Modus nicht offiziell dokumentiert und wird deshalb nicht gesetzt. Die LED-Option gibt es nur bei einigen Gen1-Modellen.',
    fields: [
      { key: 'eco.ecoMode', label: 'Eco-Modus', type: 'bool' },
      { key: 'eco.ledStatusDisable', label: 'LED-Statusanzeige ausschalten', type: 'bool' },
    ],
  },
  {
    id: 'bluetooth',
    title: 'Bluetooth',
    gens: 'Gen2+',
    hint: '«Bluetooth an/aus» und «Observer» gibt es nur bei älterer Firmware; neuere steuert das automatisch.',
    fields: [
      { key: 'bluetooth.enable', label: 'Bluetooth an', type: 'bool' },
      { key: 'bluetooth.rpc', label: 'RPC über Bluetooth (BLE-RPC)', type: 'bool' },
      { key: 'bluetooth.observer', label: 'BLE-Observer', type: 'bool' },
    ],
  },
  {
    id: 'wifiAp',
    title: 'WLAN-Access-Point des Geräts',
    gens: 'Gen2+',
    hint: 'Nicht für Gen1: Dort schliessen sich AP und WLAN-Client aus. Ein AP-Passwort kann beim Anwenden gesetzt werden.',
    fields: [{ key: 'wifiAp.enable', label: 'Access-Point an', type: 'bool' }],
  },
  {
    id: 'apRoaming',
    title: 'AP-Roaming',
    gens: 'Gen1 und Gen2+',
    fields: [
      { key: 'apRoaming.enable', label: 'Roaming an', type: 'bool' },
      { key: 'apRoaming.threshold', label: 'Schwelle (dBm)', type: 'number', min: -100, max: -30, step: 1, placeholder: '-70' },
    ],
  },
  {
    id: 'coiot',
    title: 'CoIoT',
    gens: 'Gen1',
    fields: [
      { key: 'coiot.enable', label: 'CoIoT an', type: 'bool' },
      { key: 'coiot.updatePeriod', label: 'Update-Intervall (s)', type: 'number', min: 1, max: 3600, step: 1 },
      { key: 'coiot.peer', label: 'Peer (Unicast)', type: 'text', placeholder: '192.168.1.10:5683' },
    ],
  },
];

/** Script is edited as one unit (name and code are required together). */
export const SCRIPT_FIELDS: TemplateField[] = [
  { key: 'script.name', label: 'Name', type: 'text', placeholder: 'heizung' },
  { key: 'script.code', label: 'Code', type: 'code' },
  { key: 'script.enable', label: 'Beim Start ausführen', type: 'bool' },
  { key: 'script.start', label: 'Nach dem Verteilen (neu) starten', type: 'bool' },
];

const EXTRA_LABELS: Record<string, string> = {
  'mqtt.password': 'MQTT-Passwort',
  'wifiAp.password': 'AP-Passwort',
  script: 'Script',
};

export function fieldLabel(key: string): string {
  for (const g of TEMPLATE_GROUPS) {
    const f = g.fields.find((x) => x.key === key);
    if (f) return `${g.title}: ${f.label}`;
  }
  return EXTRA_LABELS[key] ?? key;
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
      if (v !== undefined) lines.push(`${g.title}: ${f.label} = ${formatValue(v)}`);
    }
  }
  if (settings.script) lines.push(`Script «${settings.script.name}» verteilen`);
  return lines;
}

export function groupTitles(settings: TemplateSettings): string[] {
  const titles = TEMPLATE_GROUPS.filter((g) => settings[g.id] && Object.keys(settings[g.id] as object).length > 0).map((g) => g.title);
  return settings.script ? [...titles, 'Script'] : titles;
}

export function formatValue(v: unknown): string {
  if (v === true) return 'Ein';
  if (v === false) return 'Aus';
  if (v === null || v === undefined || v === '') return '–';
  if (typeof v === 'object') {
    const s = v as { name?: string; enable?: boolean; start?: boolean };
    if (s.name !== undefined) {
      const parts = [`«${s.name}»`];
      if (s.enable !== undefined) parts.push(`Autostart ${s.enable ? 'an' : 'aus'}`);
      if (s.start) parts.push('starten');
      return parts.join(', ');
    }
    return JSON.stringify(v);
  }
  return String(v);
}

/** One line per plan item for previews and results. */
export function itemText(item: PlanItem): string {
  const label = fieldLabel(item.key);
  if (item.status === 'unsupported') {
    return `${label}: ${item.reason === 'generation' ? 'für diese Generation nicht verfügbar' : 'von Modell/Firmware nicht unterstützt'}`;
  }
  if (item.status === 'same') return `${label}: bereits ${formatValue(item.target)}`;
  if (item.key === 'script') return `${label}: ${item.current ? 'aktualisieren' : 'anlegen'} ${formatValue(item.target)}`;
  return `${label}: ${formatValue(item.current)} → ${formatValue(item.target)}`;
}
