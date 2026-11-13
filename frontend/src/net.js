import { WS_URL } from '../config.js';

export class Net {
  constructor() { this.h = {}; this.id = null; this.ws = null; this.joined = null; }
  on(t, f) { (this.h[t] ||= []).push(f); }
  connect(name, character) {
    this.joined = { name, character };
    const ws = new WebSocket(WS_URL);
    this.ws = ws;
    ws.onopen = () => this.send({ t: 'join', name, character });
    ws.onmessage = (e) => {
      let m; try { m = JSON.parse(e.data); } catch { return; }
      if (m.t === 'welcome') this.id = m.id;
      (this.h[m.t] || []).forEach((f) => f(m));
    };
    ws.onclose = () => setTimeout(() => this.joined && this.connect(this.joined.name, this.joined.character), 2000);
  }
  send(o) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(o)); }
}
