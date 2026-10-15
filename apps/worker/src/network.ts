import { lookup } from "node:dns/promises";

export function isPrivateAddress(address: string) {
  const value = address.toLowerCase();

  if (
    value === "::1" ||
    value === "0.0.0.0" ||
    value.startsWith("127.") ||
    value.startsWith("10.") ||
    value.startsWith("192.168.") ||
    value.startsWith("169.254.") ||
    value.startsWith("fc") ||
    value.startsWith("fd") ||
    value.startsWith("fe8") ||
    value.startsWith("fe9") ||
    value.startsWith("fea") ||
    value.startsWith("feb") ||
    value.startsWith("::ffff:127.") ||
    value.startsWith("::ffff:10.") ||
    value.startsWith("::ffff:192.168.")
  ) {
    return true;
  }

  if (value.startsWith("172.")) {
    const secondOctet = Number(value.split(".")[1] ?? -1);
    if (secondOctet >= 16 && secondOctet <= 31) return true;
  }

  if (value.startsWith("100.")) {
    const secondOctet = Number(value.split(".")[1] ?? -1);
    if (secondOctet >= 64 && secondOctet <= 127) return true;
  }

  return false;
}

export async function assertPublicMonitorTarget(rawUrl: string) {
  const target = new URL(rawUrl);
  if (target.protocol !== "http:" && target.protocol !== "https:") {
    throw new Error("Monitor target must use http or https");
  }

  if (target.username || target.password) {
    throw new Error("Monitor target must not contain credentials");
  }

  const addresses = await lookup(target.hostname, { all: true, verbatim: true });
  if (addresses.length === 0) throw new Error("Monitor target did not resolve");

  if (addresses.some(({ address }) => isPrivateAddress(address))) {
    throw new Error("Monitor target resolves to a private or reserved network");
  }
}
