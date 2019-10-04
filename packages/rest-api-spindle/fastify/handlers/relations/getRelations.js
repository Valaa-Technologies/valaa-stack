// @flow

import type RestAPIServer, { Route } from "~/rest-api-spindle/fastify/RestAPIServer";
import { dumpObject, thenChainEagerly } from "~/tools";

import { _addToRelationsSourceSteps } from "../_handlerOps";

export default function createRouteHandler (server: RestAPIServer, route: Route) {
  return {
    category: "relations", method: "GET", fastifyRoute: route,
    requiredRuntimeRules: ["resourceId"],
    builtinRules: {},
    prepare (/* fastify */) {
      this.scopeRules = server.prepareScopeRules(this);
      this.toRelationsFields = ["§->"];
      _addToRelationsSourceSteps(server, route.config.resourceSchema, route.config.relationName,
          this.toRelationsFields);
      server.buildKuery(route.schema.response[200], this.toRelationsFields);
    },
    preload () {
      return server.preloadScopeRules(this.scopeRules);
    },
    handleRequest (request, reply) {
      const scope = server.buildScope(request, this.scopeRules);
      server.infoEvent(1, () => [
        `${this.name}:`, scope.resourceId,
        "\n\trequest.query:", request.query,
      ]);
      scope.resource = server._engine.tryVrapper([scope.resourceId]);
      if (!scope.resource) {
        reply.code(404);
        reply.send(`No such ${route.config.resourceTypeName} route resource: ${scope.resourceId}`);
        return true;
      }
      const { fields } = request.query;
      return thenChainEagerly(scope.resource, [
        vResource => vResource.get(this.toRelationsFields, { scope, verbosity: 0 }),
        (fields)
            && (results => server._pickResultFields(results, fields, route.schema.response[200])),
        results => {
          reply.code(200);
          reply.send(JSON.stringify(results, null, 2));
          server.infoEvent(2, () => [
            `${this.name}:`,
            "\n\tresults:", ...dumpObject(results),
          ]);
          return true;
        }
      ]);
    },
  };
}