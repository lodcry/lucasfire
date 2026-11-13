import { API } from '../config.js';

// Carrega mods "client" do servidor e troca ao vivo quando o servidor avisa.
export class ModClient {
  constructor(ctx) { this.ctx = ctx; this.mods = new Map(); }
  async loadAll() {
    const r = await fetch(API + '/api/mods/client');
    for (const m of await r.json()) await this.load(m);
  }
  async load(m) {
    this.unload(m.path);
    const frame = [], disposers = [];
    const entry = { frame, disposers, version: m.version };
    this.mods.set(m.path, entry);
    const ctx = { ...this.ctx, onFrame: (f) => frame.push(f), onDispose: (f) => disposers.push(f) };
    const url = URL.createObjectURL(new Blob([m.content], { type: 'text/javascript' }));
    try {
      const mod = await import(url);
      await mod.init?.(ctx);
      console.log('mod client carregado', m.path, 'v' + m.version);
    } catch (e) {
      console.error('mod client falhou', m.path, e);
      entry.frame.length = 0;
    } finally { URL.revokeObjectURL(url); }
  }
  unload(path) {
    const o = this.mods.get(path);
    if (!o) return;
    o.disposers.forEach((f) => { try { f(); } catch {} });
    this.mods.delete(path);
  }
  frame(dt, t) {
    for (const o of this.mods.values()) {
      for (const f of o.frame) {
        try { f(dt, t); } catch (e) { console.error('mod frame', e); o.frame.length = 0; break; }
      }
    }
  }
}
