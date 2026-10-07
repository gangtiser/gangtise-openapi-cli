import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    globalSetup: "tests/globalSetup.ts",
    // 5 s (the default) is too tight on a heavily loaded machine: a fully mocked download
    // test once took 8 s there and passed when its file ran alone.
    testTimeout: 20_000,
  },
})
