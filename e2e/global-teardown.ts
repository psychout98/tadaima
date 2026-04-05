async function globalTeardown() {
  // Cleanup happens automatically when the server stops
  console.log("E2E tests complete");
}

export default globalTeardown;
