import net from "node:net";
import { ROUGHDRAFT_BIND_HOST, ROUGHDRAFT_LOOPBACK_HOSTS } from "./network.js";

async function canListenOnPort(port: number, host: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();

    server.unref();

    server.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "EAFNOSUPPORT" || error.code === "EADDRNOTAVAIL") {
        resolve(false);
        return;
      }

      if (error.code === "EADDRINUSE") {
        reject(error);
        return;
      }

      reject(error);
    });

    server.listen(port, host, () => {
      server.close((closeError) => {
        if (closeError) {
          reject(closeError);
          return;
        }

        resolve(true);
      });
    });
  });
}

export async function findAvailablePort(
  preferredPort: number,
  host = ROUGHDRAFT_BIND_HOST,
): Promise<number> {
  try {
    const hostsToCheck = Array.from(
      new Set([host, ...ROUGHDRAFT_LOOPBACK_HOSTS]),
    );
    const results = await Promise.all(
      hostsToCheck.map((nextHost) => canListenOnPort(preferredPort, nextHost)),
    );

    if (results.some(Boolean)) {
      return preferredPort;
    }
  } catch (error) {
    const errorCode = (error as NodeJS.ErrnoException).code;
    if (errorCode !== "EADDRINUSE") {
      throw error;
    }
  }

  return findAvailablePort(preferredPort + 1, host);
}
