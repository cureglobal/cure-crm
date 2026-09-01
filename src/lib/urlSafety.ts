import { promises as dns } from "dns";
import net from "net";

// SSRF-vern: blokkerer at en bruker-oppgitt URL (nettside å skanne,
// e-postdomene å berike) får serveren til å hente noe internt — bl.a.
// skyleverandørers metadata-endepunkt på 169.254.169.254, eller adresser på
// vårt eget nettverk. Sjekker både IP-literaler i selve URL-en og hva
// hostnavnet faktisk løses til via DNS, siden et hostnavn fritt kan pekes
// mot en intern adresse.
function isBlockedIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    if (a === 127) return true; // loopback
    if (a === 10) return true; // 10.0.0.0/8
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 192 && b === 168) return true; // 192.168.0.0/16
    if (a === 169 && b === 254) return true; // link-local, inkl. skymetadata
    if (a === 0) return true; // 0.0.0.0/8
    return false;
  }
  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    if (lower === "::1") return true;
    if (lower.startsWith("fe80:") || lower.startsWith("fc") || lower.startsWith("fd")) return true;
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isBlockedIp(mapped[1]);
    return false;
  }
  return false;
}

export async function isSafeExternalUrl(rawUrl: string): Promise<boolean> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  const hostname = url.hostname;
  if (hostname === "localhost") return false;
  if (net.isIP(hostname)) return !isBlockedIp(hostname);

  try {
    const results = await dns.lookup(hostname, { all: true });
    return results.every((r) => !isBlockedIp(r.address));
  } catch {
    return false; // kan ikke slå opp — trygg standard er å avvise
  }
}
