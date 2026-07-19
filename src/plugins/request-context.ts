import type { FastifyPluginAsync } from "fastify";
import { registerRequestContext } from "./register.js";

export const requestContextPlugin: FastifyPluginAsync = async (app) => {
  registerRequestContext(app);
};
