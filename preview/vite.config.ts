import { defineConfig, type Plugin } from "vite";

/**
 * Vite plugin that relays Atelier scene commands from the headless Playwright
 * browser to all other connected clients (the user's browser preview).
 *
 * Flow: headless page executes command → sends "atelier:command" via HMR →
 * this plugin broadcasts to all clients → user's browser executes locally.
 */
function atelierRelay(): Plugin {
  return {
    name: "atelier-relay",
    configureServer(server) {
      server.ws.on("atelier:command", (data) => {
        // Broadcast to ALL clients. The headless browser ignores relayed
        // commands (isHeadless check on client side), so no feedback loop.
        server.ws.send("atelier:command", data);
      });
    },
  };
}

export default defineConfig({
  root: __dirname,
  plugins: [atelierRelay()],
  server: {
    port: 5173,
    strictPort: true,
  },
});
