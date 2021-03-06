// @flow

import type { PrefixRouter, Route } from "~/web-spindle/MapperService";
import { dumpObject, thenChainEagerly } from "~/tools";

import { _createToMapping, _presolveMappingRouteRequest } from "./_mappingHandlerOps";

export default function createProjector (router: PrefixRouter, route: Route) {
  return {
    requiredRules: ["routeRoot", "mappingName"],
    valueAssertedRules: ["resource", "target"],

    prepare () {
      this.runtime = router.createProjectorRuntime(this, route);
      _createToMapping(router, route, this.runtime);
      this.toResponseContent = router.appendSchemaSteps(
          this.runtime, route.schema.response[200], { expandProperties: true });
    },

    preload () {
      return router.preloadRuntimeResources(this, this.runtime);
    },

    handler (request, reply) {
      router.infoEvent(1, () => [`${this.name}:`,
        "\n\trequest.params:", ...dumpObject(request.params),
        "\n\trequest.query:", ...dumpObject(request.query),
        "\n\trequest.cookies:", ...dumpObject(Object.keys(request.cookies || {})),
      ]);
      const valkOptions = router.buildRuntimeVALKOptions(this, this.runtime, request, reply);
      const scope = valkOptions.scope;
      if (!_presolveMappingRouteRequest(router, this.runtime, valkOptions)) {
        return true;
      }

      router.infoEvent(2, () => [`${this.name}:`,
        "\n\tresource:", ...dumpObject(scope.resource),
        `\n\t${scope.mappingName}:`, ...dumpObject(scope.mapping),
        `\n\ttarget:`, ...dumpObject(scope.target),
      ]);
      if (scope.mapping === undefined) {
        scope.reply.code(404);
        scope.reply.send(`No mapping '${route.config.relation.name}' found from ${
          scope.resource.getRawId()} to ${scope.target.getRawId()}`);
        return true;
      }

      const { fields } = request.query;
      return thenChainEagerly(scope.mapping, [
        vMapping => vMapping.step(this.toResponseContent, valkOptions),
        responseContent => ((!fields || !responseContent)
            ? responseContent
            : router.pickResultFields(
                valkOptions, responseContent, fields, route.schema.response[200])),
        responseContent => {
          if (!responseContent) {
            reply.code(404);
            reply.send(`No mapping '${route.config.relation.name}' found from route resource ${
              scope.resource.getRawId()} to ${scope.target.getRawId()}`);
            return true;
          }
          return router.fillReplyFromResponse(responseContent, this.runtime, valkOptions);
        },
      ]);
    },
  };
}
