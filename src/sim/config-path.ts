/** Read a value from a config by dotted path, e.g. 'food.regrowRate'. */
export function getPath(obj: object, path: string): unknown {
  let node: unknown = obj;
  for (const key of path.split('.')) {
    if (typeof node !== 'object' || node === null || !(key in node)) {
      throw new RangeError(`unknown config path: ${path}`);
    }
    node = (node as Record<string, unknown>)[key];
  }
  return node;
}

/** Set a value in a config by dotted path. The path must already exist, and the type must match. */
export function setPath(obj: object, path: string, value: number | boolean | string): void {
  const keys = path.split('.');
  const last = keys.pop()!;
  const parent = keys.length ? getPath(obj, keys.join('.')) : obj;
  if (typeof parent !== 'object' || parent === null || !(last in parent)) {
    throw new RangeError(`unknown config path: ${path}`);
  }
  const record = parent as Record<string, unknown>;
  if (typeof record[last] !== typeof value) {
    throw new TypeError(`config ${path} is a ${typeof record[last]}, not a ${typeof value}`);
  }
  record[last] = value;
}
