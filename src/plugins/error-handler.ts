import type { FastifyPluginAsync } from "fastify";
import { registerErrorHandler } from "./register.js";

/** Encapsulated plugin variant — prefer registerErrorHandler on the root app. */
export const errorHandlerPlugin: FastifyPluginAsync = async (app) => {
  registerErrorHandler(app);
};
