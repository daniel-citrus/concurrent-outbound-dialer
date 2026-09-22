import type { FastifyPluginAsync } from "fastify";

export const prospectsRoutes: FastifyPluginAsync = async (app) => {
  app.get("/prospects/agents", async () => {
    const agents = await app.services.prospectProvider.listAgents();
    return { agents };
  });

  app.get<{ Params: { agentId: string } }>(
    "/prospects/agents/:agentId/lists",
    async (request) => {
      const lists = await app.services.prospectProvider.listProspectLists(
        request.params.agentId,
      );
      return { lists };
    },
  );

  app.get<{ Params: { listId: string } }>(
    "/prospects/lists/:listId/contacts",
    async (request) => {
      const result = await app.services.prospectProvider.listProspectListContacts(
        request.params.listId,
      );
      return result;
    },
  );
};
