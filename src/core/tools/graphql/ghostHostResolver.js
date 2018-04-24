// @flow
// import { getNullableType } from "graphql/type";
import dumpify from "~/tools/dumpify";

import { tryGhostHostIdFrom } from "~/core/tools/denormalized/ghost";
import type { Transient } from "~/core/tools/denormalized/Transient";

// context { rootValue, returnType, parentType, fieldName, operation, fragments, fieldASTs, schema }
export default function ghostHostResolver (source: Transient, args, context) {
  try {
    // console.log(`Resolving link ${context.parentType.name}.${context.fieldName}: ${
    //    returnType.name}`);
    const ghostHostId = tryGhostHostIdFrom(source.get("id"));
    if (!ghostHostId) return null;
    const resolver = context.rootValue.resolver.fork();
    // resolver.setTypeName(getNullableType(context.returnType));
    return resolver.goToTransientOfId(ghostHostId, "Resource");
  } catch (error) {
    const suggestion = error.message.slice(0, 10) !== "source.get" ? "" : `
  Is this a mutation resolver? If so, remember to wrap resolver in mutationResolver.`;
    context.rootValue.resolver.error(`During ghostHostResolver
  from source: ${dumpify(source, 1000, "...}")}
  forwarding exception: ${error.message.slice(0, 140)}...${suggestion}`);
    throw error;
  }
}
