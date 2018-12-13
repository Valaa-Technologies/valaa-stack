// @flow
import { GraphQLInterfaceType, GraphQLList } from "graphql/type";

import TransientFields from "~/raem/schema/TransientFields";

import { toMany } from "~/raem/tools/graphql/coupling";
import transientField from "~/raem/tools/graphql/transientField";

import { typeNameResolver } from "~/raem/tools/graphql/typeResolver";

import Relation from "~/script/schema/Relation";

// const INTERFACE_DESCRIPTION = "inactive prophet resource fields";

const TransientScriptFields = new GraphQLInterfaceType(transientScriptFields());

export default TransientScriptFields;

export function transientScriptFields (/* objectDescription: string = INTERFACE_DESCRIPTION */) {
  return {
    name: "TransientScriptFields",

    description: `Fields available for all prophet resources, even inactive ones.`,

    interfaces: () => [TransientFields],

    fields: () => ({
      ...transientField("incomingRelations", new GraphQLList(Relation),
          "List of relations that are targeting this relatable",
          { coupling: toMany({ coupledField: "target" }) },
      ),
    }),

    resolveType: typeNameResolver,
  };
}