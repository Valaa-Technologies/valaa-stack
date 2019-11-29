// @flow

import type { PrefixRouter, Route } from "~/rest-api-spindle/MapperService";
import { dumpObject, thenChainEagerly } from "~/tools";

import { _createToMapping, _presolveMappingRouteRequest } from "./_mappingHandlerOps";

export default function createProjector (router: PrefixRouter, route: Route) {
  return {
    requiredRules: ["routeRoot", "resource", "target", "mappingName", "doDestroyMapping"],

    prepare () {
      this.runtime = router.createProjectorRuntime(this);
      this.toMapping = _createToMapping(router, route, this.runtime);
    },

    preload () {
      return router.preloadRuntimeResources(this, this.runtime);
    },

    handler (request, reply) {
      const valkOptions = router.buildRuntimeVALKOptions(this, this.runtime, request, reply);
      if (_presolveMappingRouteRequest(router, route, this.runtime, valkOptions, this.toMapping)) {
        return true;
      }
      const scope = valkOptions.scope;
      router.infoEvent(1, () => [
        `${this.name}:`, ...dumpObject(scope.resource),
        `\n\t${scope.mappingName}:`, ...dumpObject(scope.mapping),
        `\n\ttarget:`, ...dumpObject(scope.target),
        "\n\trequest.query:", request.query,
      ]);
      if (scope.mapping === undefined) {
        scope.reply.code(404);
        scope.reply.send(`No mapping '${scope.mappingName}' found from ${
          scope.resource.getRawId()} to ${scope.target.getRawId()}`);
        return true;
      }

      const wrap = new Error(this.name);
      valkOptions.discourse = router.getDiscourse().acquireFabricator();
      return thenChainEagerly(scope.mapping, [
        vMapping => (scope.doDestroyMapping
            ? vMapping.do(scope.doDestroyMapping, valkOptions)
            : vMapping.destroy(valkOptions)),
        () => valkOptions.discourse.releaseFabricator(),
        eventResult => eventResult.getPersistedEvent(),
        () => {
          reply.code(204);
          reply.send();
          router.infoEvent(2, () => [`${this.name}`]);
          return true;
        },
      ], (error) => {
        valkOptions.discourse.releaseFabricator({ abort: error });
        throw router.wrapErrorEvent(error, wrap,
          "\n\trequest.query:", ...dumpObject(request.query),
          "\n\tscope.mapping:", ...dumpObject(scope.mapping),
          "\n\tscope.resource:", ...dumpObject(scope.resource),
          "\n\tprojectorRuntime:", ...dumpObject(this.runtime),
        );
      });
    }
  };
}
