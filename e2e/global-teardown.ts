import { API_URL } from "./helpers/constants";

async function globalTeardown() {
  // Clean up test data created during E2E runs
  try {
    await fetch(`${API_URL}/setup/reset`, { method: "POST" });
    console.log("E2E teardown: test data cleaned up");
  } catch (err) {
    console.warn("E2E teardown: cleanup request failed (server may already be stopped)", err);
  }
  console.log("E2E tests complete");
}

export default globalTeardown;
