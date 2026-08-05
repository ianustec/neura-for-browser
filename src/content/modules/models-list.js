(function (Neura) {
  /**
   * Shared helpers for Open WebUI model lists (header select, settings, @mention).
   * OWUI can return the same logical model more than once (same id, or same
   * display name with different ids) — UI must show each only once.
   */

  function normalizeModelsPayload(payload) {
    if (!payload) return [];
    if (Array.isArray(payload)) return payload;
    if (Array.isArray(payload.data)) return payload.data;
    if (Array.isArray(payload.models)) return payload.models;
    return [];
  }

  /**
   * @param {unknown} name
   * @returns {string}
   */
  function normalizeDisplayName(name) {
    return String(name || '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ');
  }

  /**
   * OWUI stores the parent model logo in meta.profile_image_url (list or detail).
   * @param {object} m
   * @returns {string|null}
   */
  function extractProfileImageUrl(m) {
    if (!m || typeof m !== 'object') return null;
    const candidates = [
      m.meta?.profile_image_url,
      m.info?.meta?.profile_image_url,
      m.profile_image_url,
      m.meta?.profileImageUrl,
      m.info?.meta?.profileImageUrl,
    ];
    for (const c of candidates) {
      if (c != null && String(c).trim()) return String(c).trim();
    }
    return null;
  }

  /**
   * @param {unknown[]} list raw OWUI model objects
   * @param {string} [preferId] if set, prefer this id when names collide
   * @returns {{ id: string, name: string, profileImageUrl: string|null }[]}
   */
  function dedupeModelsList(list, preferId) {
    const prefer = preferId != null ? String(preferId) : '';
    /** @type {Map<string, { id: string, name: string, profileImageUrl: string|null }>} */
    const byId = new Map();
    /** @type {Map<string, string>} nameKey → id */
    const nameToId = new Map();

    for (const m of Array.isArray(list) ? list : []) {
      if (!m || typeof m !== 'object') continue;
      const id = m.id != null ? String(m.id) : m.name != null ? String(m.name) : '';
      if (!id) continue;
      const name = m.name != null ? String(m.name) : id;
      const nameKey = normalizeDisplayName(name) || normalizeDisplayName(id);
      if (!nameKey) continue;
      const profileImageUrl = extractProfileImageUrl(m);
      const entry = { id, name, profileImageUrl };

      if (byId.has(id)) continue;

      const existingId = nameToId.get(nameKey);
      if (existingId) {
        if (prefer && id === prefer && existingId !== prefer) {
          byId.delete(existingId);
          byId.set(id, entry);
          nameToId.set(nameKey, id);
        }
        continue;
      }

      byId.set(id, entry);
      nameToId.set(nameKey, id);
    }

    return Array.from(byId.values());
  }

  /**
   * @param {unknown} payload
   * @param {string} [preferId]
   * @returns {{ id: string, name: string, profileImageUrl: string|null }[]}
   */
  function modelsFromPayload(payload, preferId) {
    return dedupeModelsList(normalizeModelsPayload(payload), preferId);
  }

  Neura.modelsList = {
    normalizeModelsPayload,
    normalizeDisplayName,
    extractProfileImageUrl,
    dedupeModelsList,
    modelsFromPayload,
  };
})(window.Neura);
