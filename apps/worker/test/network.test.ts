import assert from "node:assert/strict";
import test from "node:test";
import { assertPublicMonitorTarget, isPrivateAddress } from "../src/network.js";

test("isPrivateAddress blocks common private and reserved ranges", () => {
  const blocked = [
    "127.0.0.1",
    "10.10.0.4",
    "172.16.0.1",
    "172.31.255.254",
    "192.168.1.9",
    "169.254.1.1",
    "100.64.0.1",
    "100.127.255.254",
    "::1",
    "fc00::1",
    "fd12:3456::1",
    "fe80::1",
    "::ffff:127.0.0.1",
  ];

  for (const address of blocked) assert.equal(isPrivateAddress(address), true, address);
});

test("isPrivateAddress allows ordinary public addresses", () => {
  const publicAddresses = ["1.1.1.1", "8.8.8.8", "172.15.0.1", "172.32.0.1", "100.63.255.255", "2606:4700:4700::1111"];
  for (const address of publicAddresses) assert.equal(isPrivateAddress(address), false, address);
});

test("monitor targets reject unsupported protocols before DNS lookup", async () => {
  await assert.rejects(
    () => assertPublicMonitorTarget("ftp://example.com/health"),
    /must use http or https/,
  );
});

test("monitor targets reject embedded credentials before DNS lookup", async () => {
  await assert.rejects(
    () => assertPublicMonitorTarget("https://user:secret@example.com/health"),
    /must not contain credentials/,
  );
});
