// Boardrift online room server — Cloudflare Worker + Durable Object (free plan compatible).
// One Durable Object per room code relays messages between the host's browser (which runs the game) and guests.
import { DurableObject } from 'cloudflare:workers';

const MAX_PLAYERS = 8;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const m = url.pathname.match(/^\/room\/([A-Za-z0-9]{4,8})$/);
    if (!m) return env.ASSETS ? env.ASSETS.fetch(request) : new Response('Boardrift game server is running.', { headers: { 'content-type': 'text/plain' } });
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket connection', { status: 426 });
    try {
      const stub = env.ROOMS.get(env.ROOMS.idFromName(m[1].toUpperCase()));
      return await stub.fetch(request);
    } catch (e) { console.error('room fetch failed', m[1], e && e.stack || String(e)); throw e; }
  }
};

export class Room extends DurableObject {
  constructor(ctx, env) { super(ctx, env); this.last = {}; this.rate = new Map(); }
  list(except) { return this.ctx.getWebSockets().filter((ws) => ws !== except).map((ws) => ({ ws, a: ws.deserializeAttachment() || {} })).filter((s) => s.a.cid); }
  hostCid(except) { const h = this.list(except).find((s) => s.a.host); return h ? h.a.cid : null; }
  async fetch(request) {
    const url = new URL(request.url);
    const cid = (url.searchParams.get('cid') || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 24) || crypto.randomUUID().slice(0, 12);
    const name = (url.searchParams.get('name') || 'Guest').replace(/[<>]/g, '').slice(0, 16);
    const wantHost = url.searchParams.get('host') === '1';
    const pair = new WebSocketPair(); const [client, server] = Object.values(pair);
    const reject = (msg) => { server.accept(); server.send(JSON.stringify({ type: 'error', msg })); server.close(1008, 'rejected'); return new Response(null, { status: 101, webSocket: client }); };
    try {
    const host = this.hostCid();
    if (wantHost && host && host !== cid) return reject('That room code is already in use — please try again.');
    if (!wantHost && !host) return reject('Room not found. Check the code with your friend.');
    for (const s of this.list()) if (s.a.cid === cid) { try { s.ws.close(1000, 'replaced'); } catch (e) {} }
    if (this.list().length >= MAX_PLAYERS) return reject('This room is full.');
    if (wantHost) this.last = {};
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ cid, name, host: wantHost });
    this.peers();
    if (!wantHost) { if (this.last.lobby) server.send(this.last.lobby); if (this.last.state) server.send(this.last.state); }
    return new Response(null, { status: 101, webSocket: client });
    } catch (e) { console.error('room accept failed', e && e.stack || String(e)); return reject('Server error: ' + (e && e.message || e)); }
  }
  webSocketMessage(ws, raw) {
    if (typeof raw !== 'string' || raw.length > 200000) return;
    const a = ws.deserializeAttachment() || {}; if (!a.cid) return;
    const now = Date.now(), r = this.rate.get(a.cid) || { t: now, n: 0 };
    if (now - r.t > 5000) { r.t = now; r.n = 0; } r.n++; this.rate.set(a.cid, r); if (r.n > 60) return;
    let msg; try { msg = JSON.parse(raw); } catch (e) { return; }
    const out = JSON.stringify({ type: 'relay', from: a.cid, data: msg.data });
    if (msg.type === 'broadcast' && a.host) {
      const k = msg.data && msg.data.k; if (k === 'lobby' || k === 'state') this.last[k] = out;
      for (const s of this.list(ws)) send(s.ws, out);
    } else if (msg.type === 'to_host') {
      const h = this.list(ws).find((s) => s.a.host); if (h) send(h.ws, out);
    } else if (msg.type === 'all') {
      const d = msg.data || {}; if (d.k !== 'taunt' || String(d.text || '').length > 80) return;
      for (const s of this.list(ws)) send(s.ws, out);
    }
  }
  webSocketClose(ws) { this.gone(ws); try { ws.close(1000, 'bye'); } catch (e) {} }
  webSocketError(ws) { this.gone(ws); }
  gone(ws) {
    const a = ws.deserializeAttachment() || {};
    if (a.host) { for (const s of this.list(ws)) { send(s.ws, JSON.stringify({ type: 'host_left' })); try { s.ws.close(1000, 'host left'); } catch (e) {} } this.last = {}; }
    else this.peers(ws);
  }
  peers(except) {
    const list = this.list(except).map((s) => ({ cid: s.a.cid, name: s.a.name, host: !!s.a.host }));
    const msg = JSON.stringify({ type: 'peers', peers: list });
    for (const s of this.list(except)) send(s.ws, msg);
  }
}
function send(ws, m) { try { ws.send(m); } catch (e) {} }
