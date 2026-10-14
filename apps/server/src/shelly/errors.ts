/** Base class for all errors talking to a single device. `host` is "ip" or "ip:port". */
export class ShellyError extends Error {
  constructor(
    readonly host: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = new.target.name;
  }
}

export class ShellyTimeoutError extends ShellyError {
  constructor(host: string, readonly timeoutMs: number) {
    super(host, `No answer from ${host} within ${timeoutMs} ms`);
  }
}

/** Connection refused, host unreachable, socket reset, ... */
export class ShellyNetworkError extends ShellyError {}

/** `/shelly` did not answer with something that looks like a Shelly device. */
export class NotAShellyError extends ShellyError {}

/** Unexpected HTTP status or a response body that cannot be parsed. */
export class ShellyHttpError extends ShellyError {
  constructor(host: string, readonly status: number, message: string) {
    super(host, message);
  }
}

/** `required`: the device is protected and no credentials were given. `invalid`: the credentials were rejected. */
export class ShellyAuthError extends ShellyError {
  constructor(host: string, readonly reason: 'required' | 'invalid') {
    super(host, reason === 'required' ? `${host} requires credentials` : `${host} rejected the credentials`);
  }
}

/** JSON-RPC error object returned by a Gen2+ device. */
export class ShellyRpcError extends ShellyError {
  constructor(host: string, readonly method: string, readonly code: number, message: string) {
    super(host, `${method} failed on ${host}: ${message} (code ${code})`);
  }
}
