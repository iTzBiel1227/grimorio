(function (root) {
  'use strict';
  const copy = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const object = value => value && typeof value === 'object' && !Array.isArray(value);
  // Three-way merging preserves unrelated live edits. Arrays are atomic because
  // collection indices are not stable identities; conflicting edits need consent.
  function merge(base, local, remote, path = '') {
    if (equal(local, base)) return { value: copy(remote), conflicts: [] };
    if (equal(remote, base) || equal(local, remote)) return { value: copy(local), conflicts: [] };
    if (object(base) && object(local) && object(remote)) {
      const value = {}, conflicts = [];
      for (const key of new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(remote)])) {
        if (['__proto__', 'constructor', 'prototype'].includes(key)) continue;
        const result = merge(base[key], local[key], remote[key], path ? `${path}.${key}` : key);
        if (result.value !== undefined) value[key] = result.value;
        conflicts.push(...result.conflicts);
      }
      return { value, conflicts };
    }
    return { value: copy(local), conflicts: [path || 'ficha'] };
  }
  function folderPath(folder, folders) {
    const parts = [], seen = new Set();
    while (folder && !seen.has(folder.id)) {
      seen.add(folder.id); parts.unshift(folder.name);
      folder = folders.find(row => row.id === folder.parentId);
    }
    return parts.join(' / ');
  }
  function damage(expression) {
    const match = String(expression || '').trim().match(/^(?:(\d{1,2})\s*)?d(4|6|8|10|12|20|100)(?:\s*([+-])\s*(\d{1,3}))?$/i);
    if (!match) return null;
    const count = Number(match[1] || 1);
    if (count < 1 || count > 20) return null;
    return { count, sides: Number(match[2]), modifier: Number(match[4] || 0) * (match[3] === '-' ? -1 : 1) };
  }
  root.GrimorioSheetTools = { merge, folderPath, damage, copy };
})(window);
