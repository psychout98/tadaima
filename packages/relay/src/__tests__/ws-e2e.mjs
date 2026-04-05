// Quick E2E WebSocket test script
// Run with: node --experimental-modules packages/relay/src/__tests__/ws-e2e.mjs
import WebSocket from "ws";

const RELAY = "http://localhost:3000";

async function api(path, opts = {}) {
  const res = await fetch(`${RELAY}${path}`, {
    headers: { "Content-Type": "application/json", ...opts.headers },
    ...opts,
  });
  return res.json();
}

async function main() {
  // Login
  const { accessToken } = await api("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ username: "admin", password: "password123" }),
  });

  // Select profile
  const profiles = await api("/api/profiles");
  const { token: profileToken } = await api(
    `/api/profiles/${profiles[0].id}/select`,
    { method: "POST", body: JSON.stringify({}) },
  );

  // Pair a device
  const { code } = await api("/api/devices/pair/request", {
    method: "POST",
    headers: { Authorization: `Bearer ${profileToken}` },
  });
  const { deviceToken, deviceId } = await api("/api/devices/pair/claim", {
    method: "POST",
    body: JSON.stringify({ code, name: "ws-e2e-test", platform: "macos" }),
  });

  console.log("Setup complete. Testing WebSocket...\n");

  // Test 1: Connect client and listen for device:status
  const clientMsgs = [];
  const client = new WebSocket(`ws://localhost:3000/ws?token=${profileToken}`);

  await new Promise((resolve) => {
    client.on("open", () => {
      console.log("[PASS] Client WebSocket connected");
      resolve();
    });
    client.on("error", (e) => {
      console.log("[FAIL] Client error:", e.message);
      process.exit(1);
    });
  });

  client.on("message", (data) => {
    const msg = JSON.parse(data.toString());
    clientMsgs.push(msg);
  });

  // Test 2: Connect agent
  const agent = new WebSocket(
    `ws://localhost:3000/ws/agent?token=${deviceToken}`,
  );

  await new Promise((resolve) => {
    agent.on("open", () => {
      console.log("[PASS] Agent WebSocket connected");
      agent.send(
        JSON.stringify({
          id: "hello-1",
          type: "agent:hello",
          timestamp: Date.now(),
          payload: {
            version: "0.0.0",
            platform: "macos",
            activeJobs: 0,
            diskFreeBytes: 500e9,
          },
        }),
      );
      resolve();
    });
  });

  // Wait for device:status broadcast
  await new Promise((r) => setTimeout(r, 500));

  const onlineMsg = clientMsgs.find(
    (m) => m.type === "device:status" && m.payload.isOnline === true,
  );
  if (onlineMsg) {
    console.log("[PASS] Client received device:status (online=true)");
  } else {
    console.log("[FAIL] No device:status online message received");
  }

  // Test 3: Check device is online in DB
  const devicesList = await api("/api/devices", {
    headers: { Authorization: `Bearer ${profileToken}` },
  });
  const testDevice = devicesList.find((d) => d.id === deviceId);
  if (testDevice?.isOnline) {
    console.log("[PASS] Device marked online in DB");
  } else {
    console.log("[FAIL] Device not online in DB");
  }

  // Test 4: Send heartbeat
  agent.send(
    JSON.stringify({
      id: "hb-1",
      type: "agent:heartbeat",
      timestamp: Date.now(),
      payload: { activeJobs: 0, diskFreeBytes: 400e9, uptimeSeconds: 60 },
    }),
  );
  await new Promise((r) => setTimeout(r, 300));

  // Heartbeat should NOT be forwarded to client
  const heartbeatForwarded = clientMsgs.find(
    (m) => m.type === "agent:heartbeat",
  );
  if (!heartbeatForwarded) {
    console.log("[PASS] Heartbeat NOT forwarded to client (correct)");
  } else {
    console.log("[FAIL] Heartbeat was forwarded to client");
  }

  // Test 5: Disconnect agent and check offline status
  agent.close();
  await new Promise((r) => setTimeout(r, 500));

  const offlineMsg = clientMsgs.find(
    (m) => m.type === "device:status" && m.payload.isOnline === false,
  );
  if (offlineMsg) {
    console.log("[PASS] Client received device:status (online=false)");
  } else {
    console.log("[FAIL] No device:status offline message received");
  }

  // Test 6: Reject invalid token
  const bad = new WebSocket("ws://localhost:3000/ws/agent?token=invalid");
  await new Promise((resolve) => {
    bad.on("error", () => {
      console.log("[PASS] Invalid token rejected");
      resolve();
    });
    bad.on("open", () => {
      console.log("[FAIL] Invalid token accepted!");
      resolve();
    });
  });

  client.close();
  console.log("\nAll WebSocket tests complete.");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
