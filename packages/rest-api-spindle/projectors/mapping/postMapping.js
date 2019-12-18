// @flow

import type { PrefixRouter, Route } from "~/rest-api-spindle/MapperService";
import { dumpObject, thenChainEagerly } from "~/tools";

import { _createToMapping, _presolveMappingRouteRequest } from "./_mappingHandlerOps";

export default function createProjector (router: PrefixRouter, route: Route) {
  return {
    requiredRules: ["routeRoot", "mappingName", "doCreateMappingAndTarget"],
    requiredRuntimeRules: ["resource"],

    prepare () {
      this.runtime = router.createProjectorRuntime(this);
      _createToMapping(router, route, this.runtime);

      this.toMappingPatchTarget = ["§->", false, "target"];
      router.appendSchemaSteps(this.runtime, route.config.target.schema,
          { targetVAKON: this.toMappingPatchTarget });
    },

    preload () {
      return router.preloadRuntimeResources(this, this.runtime);
    },

    handler (request, reply) {
      router.infoEvent(1, () => [`${this.name}:`,
        "\n\trequest.query:", ...dumpObject(request.query),
        "\n\trequest.cookies:", ...dumpObject(Object.keys(request.cookies || {})),
        "\n\trequest.body:", ...dumpObject(request.body),
      ]);
      const valkOptions = router.buildRuntimeVALKOptions(this, this.runtime, request, reply);
      if (_presolveMappingRouteRequest(router, route, this.runtime, valkOptions)) {
        return true;
      }
      const scope = valkOptions.scope;
      if (!scope.doCreateMappingAndTarget) {
        reply.code(405);
        reply.send(`${this.name} is disabled: no 'doCreateMappingAndTarget' rule`);
        return true;
      }
      const targetName = ((request.body.$V || {}).target || {}).name;
      router.infoEvent(2, () => [`${this.name}:`,
        "\n\tresource:", ...dumpObject(scope.resource),
        "\n\ttoMappingSource:", ...dumpObject(this.runtime.toMappingSource),
        "\n\tsource:", ...dumpObject(scope.source),
        `\n\ttarget:`, ...dumpObject(scope.target),
      ]);
      if (typeof targetName !== "string") {
        reply.code(400);
        reply.send(`Required body.$V.target.name field is missing or is not a string`);
        return true;
      }

      const wrap = new Error(`mapping POST ${route.url}`);
      valkOptions.route = route;
      valkOptions.discourse = router.getDiscourse().acquireFabricator();
      return thenChainEagerly(scope.source, [
        vResource => vResource.do(scope.doCreateMappingAndTarget, valkOptions),
        vMapping => {
          if (!vMapping) throw new Error("doCreateMappingAndTarget didn't return anything");
          return scope.mapping = vMapping;
        },
        () => valkOptions.discourse && valkOptions.discourse.releaseFabricator(),
        eventResult => eventResult && eventResult.getPersistedEvent(),

        () => (valkOptions.discourse = router.getDiscourse().acquireFabricator()),
        () => router.updateResource(scope.mapping, request.body,
              { ...valkOptions, patchValosFields: false }),
        () => router.updateResource(scope.mapping, request.body.$V.target,
              { ...valkOptions, toPatchTarget: this.toMappingPatchTarget }),
        () => valkOptions.discourse && valkOptions.discourse.releaseFabricator(),
        eventResult => eventResult && eventResult.getPersistedEvent(),

        (/* persistedEvent */) => {
          const targetId = scope.mapping.get("target").getRawId();
          const results = {
            $V: {
              href: `${router.getResourceHRefPrefix(route.config.resource.schema)
                }${scope.resource.getRawId()}/${scope.mappingName}/${targetId}`,
              rel: "self",
              target: { $V: {
                href: `${router.getResourceHRefPrefix(route.config.target.schema)}${targetId}`,
                rel: "self",
              } },
            }
          };
          reply.code(201);
          router.replySendJSON(reply, results);
          router.infoEvent(2, () => [
            `${this.name}:`,
            "\n\tresults:", ...dumpObject(results),
          ]);
          return true;
        },
      ], (error) => {
        if (valkOptions.discourse) valkOptions.discourse.releaseFabricator({ abort: error });
        throw router.wrapErrorEvent(error, wrap,
            "\n\trequest.query:", ...dumpObject(request.query),
            "\n\trequest.body:", ...dumpObject(request.body),
            "\n\tscope.resource:", ...dumpObject(scope.resource),
            "\n\tscope.mapping:", ...dumpObject(scope.mapping),
            "\n\tthis.toMappingPatchTarget:", ...dumpObject(scope.toMappingPatchTarget),
            "\n\tprojectorRuntime:", ...dumpObject(this.runtime),
        );
      });
    },
  };
}
