/* Near-upgrade controller for wild vegetation chunks — pure
 * state machine, no THREE imports, unit-tested in
 * tests/horizon.test.mjs. The client supplies hooks:
 *   load(name)          -> Promise<parts|null>  (null = failed)
 *   create(name, parts) -> build the near meshes for a species
 *   setLodVisible(name, bool)
 *   setGroupVisible(bool)
 *
 * The v593 failure this fixes: buildNearVeg counted a species
 * as done even when its full model failed to load, then hid
 * EVERY LOD tree mesh in the chunk — a failed species left no
 * visible trees at all. Here, fallback is per species:
 * - a species' LOD is hidden ONLY after its near meshes were
 *   actually created (it is in `built`);
 * - a failed species keeps its LOD and does not block others;
 * - `built` persists across downgrade/upgrade cycles, so
 *   re-crossing the thresholds never re-creates meshes
 *   (no duplicates) and re-shows instantly;
 * - a sequence counter bumped by downgrade()/invalidate()
 *   makes any in-flight upgrade abort silently, so an evicted
 *   (or departed) chunk can never receive stale meshes. */
export class NearUpgrader {
  constructor(hooks) {
    this.hooks = hooks;
    this.state = 'lod'; // 'lod' | 'building' | 'near'
    this.built = new Set();
    this.seq = 0;
  }

  /* Should this species' LOD instances be visible right now?
   * (Used when LOD meshes finish loading after an upgrade.) */
  lodShouldShow(name) {
    return !(this.state === 'near' && this.built.has(name));
  }

  async upgrade(species) {
    if (this.state !== 'lod') return;
    const missing = species.filter((n) => !this.built.has(n));
    if (!missing.length) { this.apply(species); return; }
    this.state = 'building';
    const seq = this.seq;
    const results = await Promise.all(missing.map(async (n) => {
      let parts = null;
      try { parts = await this.hooks.load(n); } catch (e) { parts = null; }
      return [n, parts];
    }));
    if (seq !== this.seq || this.state !== 'building') return; // downgraded or evicted mid-load
    for (const [n, parts] of results) {
      if (parts) { this.hooks.create(n, parts); this.built.add(n); }
    }
    this.apply(species);
  }

  apply(species) {
    for (const n of species) this.hooks.setLodVisible(n, !this.built.has(n));
    this.hooks.setGroupVisible(this.built.size > 0);
    this.state = this.built.size ? 'near' : 'lod';
  }

  downgrade(species) {
    if (this.state === 'lod') return;
    this.seq++;
    this.state = 'lod';
    this.hooks.setGroupVisible(false);
    if (species) for (const n of species) this.hooks.setLodVisible(n, true);
  }

  /* Chunk evicted: forget everything; in-flight loads abort. */
  invalidate() {
    this.seq++;
    this.state = 'lod';
    this.built.clear();
  }
}
