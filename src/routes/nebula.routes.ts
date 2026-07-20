import type { FastifyPluginAsync } from "fastify";
import { isNebulaConfigured } from "../services/nebula-client.js";
import {
  listProspectListContacts,
  listProspectListsForAgent,
} from "../services/nebula-prospect-lists.js";
import { listNebulaUsers } from "../services/nebula-users.js";

export const nebulaRoutes: FastifyPluginAsync = async (app) => {
  app.get("/nebula/users", async () => {
    const configured = isNebulaConfigured(app.services.env);
    if (!configured) {
      return { configured: false as const, users: [] };
    }

    const users = await listNebulaUsers(app.services.env);
    return { configured: true as const, users };
  });

  app.get<{ Params: { agentId: string } }>(
    "/nebula/agents/:agentId/prospect-lists",
    async (request) => {
      const configured = isNebulaConfigured(app.services.env);
      if (!configured) {
        return { configured: false as const, lists: [] };
      }

      const lists = await listProspectListsForAgent(
        app.services.env,
        request.params.agentId,
      );
      return { configured: true as const, lists };
    },
  );

  app.get<{ Params: { listId: string } }>(
    "/nebula/prospect-lists/:listId/contacts",
    async (request) => {
      const configured = isNebulaConfigured(app.services.env);
      if (!configured) {
        return { configured: false as const, contacts: [], skippedWithoutPhone: 0 };
      }

      const result = await listProspectListContacts(
        app.services.env,
        request.params.listId,
      );
      return {
        configured: true as const,
        contacts: result.contacts,
        totalInList: result.totalInList,
        skippedWithoutPhone: result.skippedWithoutPhone,
      };
    },
  );
};
