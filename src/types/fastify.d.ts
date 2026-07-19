import type { AppServices } from "./app.js";

declare module "fastify" {
  interface FastifyInstance {
    services: AppServices;
  }

  interface FastifyRequest {
    requestId: string;
  }
}

export {};
