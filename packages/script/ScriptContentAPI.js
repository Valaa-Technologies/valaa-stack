import createContentAPI from "~/raem/tools/graphql/createContentAPI";

import { RAEMContentAPI } from "~/raem";

import Expression from "~/script/schema/Expression";
import Identifier from "~/script/schema/Identifier";
import KueryExpression from "~/script/schema/KueryExpression";
import Literal from "~/script/schema/Literal";
import Property from "~/script/schema/Property";
import Relation from "~/script/schema/Relation";
import Relatable from "~/script/schema/Relatable";
import Scope from "~/script/schema/Scope";

export default createContentAPI({
  name: "ValaaScriptContentAPI",
  inherits: [RAEMContentAPI],
  exposes: [
    Expression, Identifier, KueryExpression, Literal, Property, Relation, Relatable, Scope,
  ],
});
