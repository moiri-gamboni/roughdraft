import net from "node:net";

export async function findAvailablePort(
  preferredPort: number,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();

    server.unref();

    server.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "EADDRINUSE") {
        resolve(findAvailablePort(preferredPort + 1));
        return;
      }

      reject(error);
    });

    server.listen(preferredPort, () => {
      const address = server.address();
      const port =
        typeof address === "object" && address ? address.port : preferredPort;

      server.close((closeError) => {
        if (closeError) {
          reject(closeError);
          return;
        }

        resolve(port);
      });
    });
  });
}
