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
      const commandLog: Array<{ command: string; params: any }> = [];

      server.ws.on("atelier:command", (data) => {
        if (data.command === "clearScene") {
          commandLog.length = 0;
        }
        commandLog.push(data);
        // Broadcast to ALL clients. The headless browser ignores relayed
        // commands (isHeadless check on client side), so no feedback loop.
        server.ws.send("atelier:command", data);
      });

      server.ws.on("atelier:sync-request", (_data, client) => {
        // Send accumulated commands to the requesting client
        for (const entry of commandLog) {
          client.send("atelier:command", entry);
        }
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
