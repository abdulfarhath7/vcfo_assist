// Tiny structural checks used by the loader and the Suite validator. No schema
// library: the shapes are small and the error messages must name keys.

/**
 * @param {unknown} v
 * @returns {v is Record<string, unknown>}
 */
export function isRecord(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * @param {unknown} v
 * @returns {v is string}
 */
export function isString(v) {
  return typeof v === 'string';
}

/**
 * @param {unknown} v
 * @returns {v is string}
 */
export function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

/**
 * @param {unknown} v
 * @returns {v is number}
 */
export function isInt(v) {
  return typeof v === 'number' && Number.isInteger(v);
}

/**
 * @param {unknown} v
 * @returns {v is boolean}
 */
export function isBool(v) {
  return typeof v === 'boolean';
}

/**
 * @param {unknown} v
 * @returns {v is string[]}
 */
export function isStringArray(v) {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

/**
 * Collects problems for one object. Each check appends a message naming the
 * path when it fails and returns the typed value when it passes.
 */
export class Problems {
  /** @param {string} root */
  constructor(root) {
    /** @type {string[]} */
    this.list = [];
    this.root = root;
  }

  /** @param {string} path @param {string} what */
  add(path, what) {
    this.list.push(`${this.root}.${path} ${what}`);
  }

  /**
   * @param {Record<string, unknown>} obj
   * @param {string} key
   * @param {string} [path]
   * @returns {string | undefined}
   */
  string(obj, key, path = key) {
    const v = obj[key];
    if (!isNonEmptyString(v)) {
      this.add(path, 'must be a non-empty string');
      return undefined;
    }
    return v;
  }

  /**
   * @param {Record<string, unknown>} obj
   * @param {string} key
   * @param {string} [path]
   * @returns {number | undefined}
   */
  int(obj, key, path = key) {
    const v = obj[key];
    if (!isInt(v)) {
      this.add(path, 'must be an integer');
      return undefined;
    }
    return v;
  }

  /**
   * @param {Record<string, unknown>} obj
   * @param {string} key
   * @param {string} [path]
   * @returns {boolean | undefined}
   */
  bool(obj, key, path = key) {
    const v = obj[key];
    if (!isBool(v)) {
      this.add(path, 'must be true or false');
      return undefined;
    }
    return v;
  }

  /**
   * @param {Record<string, unknown>} obj
   * @param {string} key
   * @param {readonly string[]} allowed
   * @param {string} [path]
   * @returns {string | undefined}
   */
  oneOf(obj, key, allowed, path = key) {
    const v = obj[key];
    if (!isString(v) || !allowed.includes(v)) {
      this.add(path, `must be one of ${allowed.join(', ')}`);
      return undefined;
    }
    return v;
  }

  /**
   * @param {Record<string, unknown>} obj
   * @param {string} key
   * @param {string} [path]
   * @returns {string[] | undefined}
   */
  stringArray(obj, key, path = key) {
    const v = obj[key];
    if (!isStringArray(v)) {
      this.add(path, 'must be an array of strings');
      return undefined;
    }
    return v;
  }

  /**
   * @param {Record<string, unknown>} obj
   * @param {string} key
   * @param {string} [path]
   * @returns {Record<string, unknown> | undefined}
   */
  record(obj, key, path = key) {
    const v = obj[key];
    if (!isRecord(v)) {
      this.add(path, 'must be an object');
      return undefined;
    }
    return v;
  }

  /**
   * @param {Record<string, unknown>} obj
   * @param {string} key
   * @param {string} [path]
   * @returns {unknown[] | undefined}
   */
  array(obj, key, path = key) {
    const v = obj[key];
    if (!Array.isArray(v)) {
      this.add(path, 'must be an array');
      return undefined;
    }
    return v;
  }

  /**
   * Validate a RegExp source at load time so a bad pattern is a load error,
   * not a fill-time throw.
   * @param {Record<string, unknown>} obj
   * @param {string} key
   * @param {string} [path]
   * @returns {string | undefined}
   */
  regex(obj, key, path = key) {
    const v = this.string(obj, key, path);
    if (v === undefined) return undefined;
    try {
      new RegExp(v);
      return v;
    } catch {
      this.add(path, 'must be a valid regular expression');
      return undefined;
    }
  }

  get any() {
    return this.list.length > 0;
  }
}
