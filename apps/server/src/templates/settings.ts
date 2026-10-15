import { Type, type Static } from 'typebox';

const Bool = Type.Optional(Type.Boolean());
const Text = (maxLength: number) => Type.Optional(Type.String({ minLength: 1, maxLength }));

/**
 * Curated, generation independent settings. Every field is optional: only fields that are set
 * are enforced on the devices. Secrets (MQTT password, AP password) are deliberately not part of
 * a template; they are entered when applying and never stored.
 */
export const TemplateSettingsSchema = Type.Object(
  {
    mqtt: Type.Optional(
      Type.Object(
        {
          enable: Bool,
          /** host[:port] */
          server: Text(200),
          user: Text(100),
          /** Placeholders {id} and {mac}. Gen1: mqtt_id (also the topic id), Gen2+: client_id. */
          clientId: Text(200),
          /** Gen2+ only. Placeholders {id} and {mac}. */
          topicPrefix: Type.Optional(Type.String({ minLength: 1, maxLength: 300, pattern: '^[^$#+%?]*$' })),
        },
        { additionalProperties: false },
      ),
    ),
    cloud: Type.Optional(Type.Object({ enable: Bool }, { additionalProperties: false })),
    time: Type.Optional(
      Type.Object(
        {
          sntpServer: Text(200),
          /** IANA zone, e.g. "Europe/Zurich". */
          timezone: Type.Optional(Type.String({ minLength: 1, maxLength: 64, pattern: '^[A-Za-z_]+(/[A-Za-z0-9_+-]+)*$' })),
          lat: Type.Optional(Type.Number({ minimum: -90, maximum: 90 })),
          lon: Type.Optional(Type.Number({ minimum: -180, maximum: 180 })),
        },
        { additionalProperties: false },
      ),
    ),
    eco: Type.Optional(
      Type.Object(
        {
          /** Gen2+ only (Gen1 eco mode is not in the official docs). */
          ecoMode: Bool,
          /** Gen1 only, and only on models that have it. */
          ledStatusDisable: Bool,
        },
        { additionalProperties: false },
      ),
    ),
    /** Gen2+ only. `enable`/`observer` only where the firmware still has them. */
    bluetooth: Type.Optional(Type.Object({ enable: Bool, rpc: Bool, observer: Bool }, { additionalProperties: false })),
    /** Gen2+ only: on Gen1, AP and WLAN client exclude each other. */
    wifiAp: Type.Optional(Type.Object({ enable: Bool }, { additionalProperties: false })),
    apRoaming: Type.Optional(
      Type.Object(
        { enable: Bool, threshold: Type.Optional(Type.Integer({ minimum: -100, maximum: -30 })) },
        { additionalProperties: false },
      ),
    ),
    /** Gen1 only. */
    coiot: Type.Optional(
      Type.Object(
        {
          enable: Bool,
          updatePeriod: Type.Optional(Type.Integer({ minimum: 1, maximum: 3600 })),
          peer: Type.Optional(Type.String({ maxLength: 100 })),
        },
        { additionalProperties: false },
      ),
    ),
    /** Gen2+ only: create or update a script by name. */
    script: Type.Optional(
      Type.Object(
        {
          name: Type.String({ minLength: 1, maxLength: 64 }),
          code: Type.String({ minLength: 1, maxLength: 64_000 }),
          /** Run on boot. */
          enable: Bool,
          /** (Re)start right after deploying. */
          start: Bool,
        },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);

export type TemplateSettings = Static<typeof TemplateSettingsSchema>;

/** Entered when applying, never stored or logged. */
export interface TemplateSecrets {
  mqttPassword?: string | undefined;
  apPassword?: string | undefined;
}
