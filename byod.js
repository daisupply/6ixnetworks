'use strict';
/*
 * byod.js — BYOD (Build Your Own Domain) for 6ixNetworks.
 *
 * Standalone, dependency-free CommonJS module (Node 20, global fetch).
 * Three independent pieces:
 *
 *   validateHostname(h)      — pure hostname validation / normalization rules.
 *   createByodClient({...})  — Cloudflare for SaaS Custom Hostnames API client.
 *   createRegistry({...})    — pure bookkeeping of who claimed which hostname.
 *
 * The registry NEVER talks to Cloudflare and the client NEVER persists
 * anything. The API layer in server.js (see SPLICE.md) composes the two:
 * call the client, then record the result in the registry.
 *
 * Credentials: the client takes its token/zoneId from its caller (server.js
 * reads them from process.env). Nothing is read from disk here and the token
 * is never included in any returned object, error, or log line.
 */

// ---------------------------------------------------------------------------
// Hostname validation
// ---------------------------------------------------------------------------

function normalizeHostname(h) {
  if (typeof h !== 'string') return '';
  let s = h.trim().toLowerCase();
  if (s.endsWith('.')) s = s.slice(0, -1); // one optional root dot
  return s;
}

const LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const IPV4_RE = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;

function validateHostname(h) {
  if (typeof h !== 'string') return false;
  const s = normalizeHostname(h);
  if (!s) return false;
  if (s.length > 253) return false;
  // No scheme, port, path, query, userinfo, wildcard, underscore, whitespace.
  // (The per-label regex below would reject all of these anyway; this makes
  // the intent explicit and catches them before label splitting.)
  if (/[\s/:?#@*\\_]/.test(s)) return false;
  // IP literals are not hostnames for BYOD purposes.
  if (IPV4_RE.test(s)) return false;
  if (s.indexOf(':') !== -1) return false; // IPv6 literal / port
  const labels = s.split('.');
  if (labels.length < 2) return false;
  for (const label of labels) {
    if (!label || label.length > 63) return false;
    if (!LABEL_RE.test(label)) return false; // alnum+hyphen, no lead/trail hyphen
  }
  // An all-numeric TLD means it was an IP-shaped string, not a name.
  if (/^\d+$/.test(labels[labels.length - 1])) return false;
  // usareme.site names are 6ix Sites slugs, never BYOD.
  if (s === 'usareme.site' || s.endsWith('.usareme.site')) return false;
  // Local / internal names can never resolve publicly.
  if (s === 'localhost' || s.endsWith('.localhost')) return false;
  if (s.endsWith('.local') || s.endsWith('.internal')) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Cloudflare for SaaS — Custom Hostnames client
// ---------------------------------------------------------------------------

function createByodClient(opts) {
  const o = opts || {};
  const token = o.token || '';
  const zoneId = o.zoneId || '';
  const doFetch = o.fetchImpl || (typeof fetch === 'function' ? fetch : null);
  const base = 'https://api.cloudflare.com/client/v4/zones/' +
    encodeURIComponent(zoneId) + '/custom_hostnames';

  function cfErr(data, status) {
    const msgs = [];
    if (data && Array.isArray(data.errors)) {
      for (const e of data.errors) {
        if (e && e.message) msgs.push(String(e.message));
      }
    }
    if (!msgs.length && data && data.error) msgs.push(String(data.error));
    // Deliberately generic fallback: never echo headers/auth into errors.
    return msgs.length ? msgs.join('; ') : ('cloudflare request failed (http ' + status + ')');
  }

  function pushRecord(out, seen, type, name, value) {
    if (!name || !value) return;
    const rec = { type: String(type || 'TXT').toUpperCase(), name: String(name), value: String(value) };
    const key = rec.type + '|' + rec.name + '|' + rec.value;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(rec);
  }

  // Normalize one Cloudflare custom-hostname object into our flat shape.
  // DNS records a user must add come from TWO places in the CF response:
  // ownership_verification (hostname ownership TXT) and
  // ssl.validation_records (domain-control validation for the cert).
  function normalize(r) {
    const records = [];
    const seen = new Set();
    if (r && r.ownership_verification) {
      const ov = r.ownership_verification;
      pushRecord(records, seen, ov.type || 'TXT', ov.name, ov.value);
    }
    const ssl = (r && r.ssl) || {};
    const vrs = Array.isArray(ssl.validation_records) ? ssl.validation_records : [];
    for (const vr of vrs) {
      if (!vr) continue;
      if (vr.txt_name || vr.txt_value) pushRecord(records, seen, 'TXT', vr.txt_name, vr.txt_value);
      if (vr.cname_name || vr.cname_target) pushRecord(records, seen, 'CNAME', vr.cname_name, vr.cname_target);
      if (vr.http_url || vr.http_body) pushRecord(records, seen, 'HTTP', vr.http_url, vr.http_body);
    }
    return {
      ok: true,
      id: r && r.id ? String(r.id) : '',
      hostname: r && r.hostname ? String(r.hostname) : '',
      status: r && r.status ? String(r.status) : '',
      sslStatus: ssl.status ? String(ssl.status) : '',
      records,
    };
  }

  async function request(method, suffix, body) {
    if (!token || !zoneId) return { ok: false, err: 'byod not set up yet' };
    if (!doFetch) return { ok: false, err: 'fetch unavailable' };
    let resp;
    let data;
    try {
      resp = await doFetch(base + (suffix || ''), {
        method,
        headers: {
          'authorization': 'Bearer ' + token,
          'content-type': 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      data = await resp.json();
    } catch (e) {
      return { ok: false, err: 'cloudflare unreachable: ' + (e && e.message ? e.message : 'network error') };
    }
    const status = resp && typeof resp.status === 'number' ? resp.status : 0;
    if (!resp || resp.ok === false || !data || data.success !== true) {
      return { ok: false, err: cfErr(data, status) };
    }
    return { ok: true, result: data.result };
  }

  return {
    async createHostname(h) {
      const hostname = normalizeHostname(h);
      if (!validateHostname(hostname)) return { ok: false, err: 'bad hostname' };
      const r = await request('POST', '', {
        hostname,
        ssl: {
          method: 'txt',
          type: 'dv',
          settings: { http2: 'on', min_tls_version: '1.2' },
        },
      });
      if (!r.ok) return r;
      return normalize(r.result || {});
    },

    async getHostname(id) {
      if (!id) return { ok: false, err: 'missing id' };
      const r = await request('GET', '/' + encodeURIComponent(String(id)));
      if (!r.ok) return r;
      return normalize(r.result || {});
    },

    async listHostnames() {
      const r = await request('GET', '?per_page=100');
      if (!r.ok) return r;
      const arr = Array.isArray(r.result) ? r.result : [];
      return { ok: true, hostnames: arr.map((x) => normalize(x || {})) };
    },

    async deleteHostname(id) {
      if (!id) return { ok: false, err: 'missing id' };
      const r = await request('DELETE', '/' + encodeURIComponent(String(id)));
      if (!r.ok) return r;
      const rid = r.result && r.result.id ? String(r.result.id) : String(id);
      return { ok: true, id: rid };
    },
  };
}

// ---------------------------------------------------------------------------
// Registry — pure bookkeeping (no Cloudflare calls in here, ever)
// ---------------------------------------------------------------------------
//
// Entry shape, keyed by lowercase hostname in a Map:
//   { user, hostname, cfId, status, sslStatus, records, at, updatedAt }
//
// Persistence is injected: load() returns a previously-saved parsed object
// (the toJSON() shape: { "<hostname>": <entry>, ... }) or null; save(obj)
// is awaited after EVERY mutation with that same shape.

function createRegistry(opts) {
  const o = opts || {};
  const load = typeof o.load === 'function' ? o.load : async () => null;
  const save = typeof o.save === 'function' ? o.save : async () => {};
  const capPerUser = typeof o.capPerUser === 'number' && o.capPerUser > 0 ? o.capPerUser : 5;
  const entries = new Map();
  let ready = false;

  function clone(e) {
    return e ? JSON.parse(JSON.stringify(e)) : null;
  }

  function toJSON() {
    const out = {};
    for (const [k, v] of entries) out[k] = clone(v);
    return out;
  }

  async function persist() {
    await save(toJSON());
  }

  async function init() {
    if (ready) return;
    ready = true;
    let data = null;
    try { data = await load(); } catch (e) { data = null; }
    if (!data) return;
    // Accept the toJSON() object shape; tolerate {entries:{...}} and arrays.
    let src = data;
    if (Array.isArray(data)) {
      src = {};
      for (const e of data) if (e && e.hostname) src[normalizeHostname(e.hostname)] = e;
    } else if (data.entries && typeof data.entries === 'object') {
      src = data.entries;
    }
    if (src && typeof src === 'object') {
      for (const k of Object.keys(src)) {
        const e = src[k];
        const host = normalizeHostname((e && e.hostname) || k);
        if (!host || !e || !e.user) continue;
        entries.set(host, {
          user: String(e.user),
          hostname: host,
          cfId: e.cfId || '',
          status: e.status || '',
          sslStatus: e.sslStatus || '',
          records: Array.isArray(e.records) ? e.records : [],
          at: e.at || 0,
          updatedAt: e.updatedAt || e.at || 0,
        });
      }
    }
  }

  // patch may carry { cfId, status, sslStatus, records } from a CF call the
  // API layer just made; register() records them in the same save.
  async function register(user, hostname, patch) {
    await init();
    const u = String(user || '');
    const host = normalizeHostname(hostname);
    if (!u) return { ok: false, err: 'login first' };
    if (!validateHostname(host)) return { ok: false, err: 'bad hostname' };
    if (entries.has(host)) return { ok: false, err: 'hostname already claimed' };
    let mine = 0;
    for (const e of entries.values()) if (e.user === u) mine++;
    if (mine >= capPerUser) return { ok: false, err: 'byod limit is ' + capPerUser + ' per user' };
    const now = Date.now();
    const p = patch || {};
    const entry = {
      user: u,
      hostname: host,
      cfId: p.cfId || '',
      status: p.status || 'pending',
      sslStatus: p.sslStatus || '',
      records: Array.isArray(p.records) ? p.records : [],
      at: now,
      updatedAt: now,
    };
    entries.set(host, entry);
    await persist();
    return { ok: true, entry: clone(entry) };
  }

  // Merge fresh Cloudflare state into an existing entry (status refresh).
  async function update(hostname, patch) {
    await init();
    const host = normalizeHostname(hostname);
    const e = entries.get(host);
    if (!e) return { ok: false, err: 'not found' };
    const p = patch || {};
    if (p.cfId !== undefined) e.cfId = p.cfId || '';
    if (p.status !== undefined) e.status = p.status || '';
    if (p.sslStatus !== undefined) e.sslStatus = p.sslStatus || '';
    if (p.records !== undefined) e.records = Array.isArray(p.records) ? p.records : [];
    e.updatedAt = Date.now();
    await persist();
    return { ok: true, entry: clone(e) };
  }

  async function unregister(user, hostname) {
    await init();
    const u = String(user || '');
    const host = normalizeHostname(hostname);
    const e = entries.get(host);
    if (!e) return { ok: false, err: 'not found' };
    if (e.user !== u && u !== 'deion') return { ok: false, err: 'not yours' };
    entries.delete(host);
    await persist();
    return { ok: true, hostname: host };
  }

  function get(hostname) {
    return clone(entries.get(normalizeHostname(hostname)) || null);
  }

  function listForUser(user) {
    const u = String(user || '');
    return [...entries.values()].filter((e) => e.user === u).map(clone);
  }

  function listAll() {
    return [...entries.values()].map(clone);
  }

  return { init, register, update, unregister, get, listForUser, listAll, toJSON };
}

module.exports = { validateHostname, normalizeHostname, createByodClient, createRegistry };
