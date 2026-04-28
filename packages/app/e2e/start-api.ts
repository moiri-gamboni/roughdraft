import { createServer } from "../../server/src/index";

await createServer(Number(process.env.API_PORT ?? 4317));
