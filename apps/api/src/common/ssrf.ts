import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';

/**
 * Guards for URLs the server fetches on a user's behalf (flow webhooks, §85 B). A member must not be able to point
 * the API at the database, object storage, the model server, the cloud metadata service or anything else that is
 * only reachable from inside the deployment.
 */
const BLOCKED_HOSTS = /^(localhost|.*\.localhost|.*\.local|.*\.internal|metadata\.google\.internal)$/i;

export function isPrivateAddress(ip: string): boolean {
  if (ip.startsWith('::ffff:')) ip = ip.slice(7);
  const v = isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  if (v === 6) {
    const s = ip.toLowerCase();
    return s === '::1' || s === '::' || s.startsWith('fc') || s.startsWith('fd') || s.startsWith('fe8') || s.startsWith('fe9') || s.startsWith('fea') || s.startsWith('feb') || s.startsWith('ff');
  }
  return true; // not an address at all
}

/**
 * Throws when the URL is not plain http(s) to a public host: blocks loopback, private, link-local, carrier-grade NAT
 * and multicast ranges, single-label names (Docker service names such as `postgres`, `s3`, `ollama`) and names that
 * resolve to such addresses. `FLOW_WEBHOOK_ALLOW_LOCAL=1` turns the check off for on-premise integrations.
 */
export async function assertPublicUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('The URL is not valid');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('The URL must start with http:// or https://');
  if (url.username || url.password) throw new Error('The URL must not carry credentials');
  if (process.env.FLOW_WEBHOOK_ALLOW_LOCAL === '1') return url;
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (BLOCKED_HOSTS.test(host) || (!host.includes('.') && !isIP(host))) throw new Error('Webhooks to local or internal addresses are off (FLOW_WEBHOOK_ALLOW_LOCAL=1 allows them)');
  if (isIP(host)) {
    if (isPrivateAddress(host)) throw new Error('Webhooks to local or private addresses are off (FLOW_WEBHOOK_ALLOW_LOCAL=1 allows them)');
    return url;
  }
  let addresses: { address: string }[];
  try {
    addresses = await lookup(host, { all: true });
  } catch {
    throw new Error(`The host ${host} could not be resolved`);
  }
  if (!addresses.length || addresses.some((a) => isPrivateAddress(a.address))) throw new Error(`The host ${host} points to a local or private address — webhooks there are off (FLOW_WEBHOOK_ALLOW_LOCAL=1 allows them)`);
  return url;
}
