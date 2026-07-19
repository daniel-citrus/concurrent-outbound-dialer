import type { FastifyPluginAsync } from "fastify";
import { registerServiceApiKey } from "./register.js";

export const serviceApiKeyPlugin: FastifyPluginAsync = async (app) => {
  registerServiceApiKey(app);
};
