import { GraphQLObjectType } from "graphql/type";

import { IdData, VRef } from "~/raem/ValaaReference";

import { FieldInfo, elevateFieldReference, elevateFieldRawSequence }
    from "~/raem/tools/denormalized/FieldInfo";
import Resolver from "~/raem/tools/denormalized/Resolver";
import type { State } from "~/raem/tools/denormalized/State";
import Transient, { tryTransientTypeName, createImmaterialTransient, PrototypeOfImmaterialTag }
    from "~/raem/tools/denormalized/Transient";
import denormalizedFromJS from "~/raem/tools/denormalized/denormalizedFromJS";
import fieldDefaultValue from "~/raem/tools/graphql/fieldDefaultValue";

import { wrapError, dumpObject } from "~/tools";

/**
 * Return the fully evaluated value of the field with given fieldName from given object transient,
 * using given resolver and its state.
 * Returned value is a native value (primitive, Array or an object) with any possible links as
 * fully elevated ValaaReference's.
 * In order to access link targets they must be converted into transients using getObjectTransient.
 *
 * @export
 * @param {any} state
 * @param {any} object
 * @param {any} fieldName
 * @param {any} objectFields
 * @param {any} fieldInfoOut
 * @returns {IdData | Transient}
 */
export default function getObjectField (resolver: Resolver, object: Transient, fieldName: string,
    fieldInfo: FieldInfo = {}):
    ?IdData | ?Transient {
  const rawField = getObjectRawField(resolver, object, fieldName, fieldInfo);
  if (!rawField || !fieldInfo.intro || !fieldInfo.intro.isComposite) return rawField;
  if (!fieldInfo.elevationInstanceId) fieldInfo.elevationInstanceId = object.get("id");
  if (!fieldInfo.intro.isSequence) {
    return elevateFieldReference(resolver, rawField, fieldInfo);
  }
  return elevateFieldRawSequence(resolver, rawField, fieldInfo, object).toJS();
}

/**
 * Returns the raw value of the most-instantiated materialized field with given fieldName of given
 * object transient in given stateOrresolver.
 *
 * objectTypeIntro must be provided for data objects.
 *
 * The raw value is the direct value stored inside the matching object transient. Primitive values
 * are trivial primitives, but composites will be returned in immutable structures, no elevation
 * is performed and partially materialized sequences are not completed.
 *
 * Book-keeping information necessary to finalize these operations is stored inside fieldInfoOut:
 *   sourceTransient       transient where the returned value was found
 *   name                  the field name where the value was resolved from (through aliasing)
 * Following fields are set if objectTypeIntro is specified or found from resolver schema:
 *   intro                 set to the field intro object
 *   coupledField          coupled field name on the remote end-point object of the coupling
 *   defaultCoupledField   default coupled field name on the remote end-point object of the coupling
 *
 * @export
 * @param {(State | Resolver)} stateOrResolver
 * @param {Transient} object
 * @param {string} fieldName
 * @param {GraphQLObjectType} objectTypeIntro
 * @param {FieldInfo} fieldInfoOut
 * @returns null
 */
export function getObjectRawField (stateOrResolver: State | Resolver, object: Transient,
    fieldName: string, fieldInfoOut: FieldInfo, objectTypeIntro?: GraphQLObjectType):
    ?IdData | ?Transient {
  let fieldInfo = fieldInfoOut;
  let resolver;
  try {
    // Direct access section. A value which matches the requested fieldName is always directly
    // returned without further pre/post-processing.
    let ret = object.get(fieldName);
    if ((typeof ret !== "undefined") && !fieldInfoOut) return ret;

    let actualTypeIntro = objectTypeIntro;
    if (!actualTypeIntro && stateOrResolver.schema) {
      const typeName = tryTransientTypeName(object);
      actualTypeIntro = typeName && stateOrResolver.schema.getType(typeName);
    }

    if (typeof ret !== "undefined") {
      fieldInfoOut.name = fieldName;
      if (actualTypeIntro) {
        fillFieldInfoAndResolveAliases(object, actualTypeIntro.getFields(), fieldInfoOut);
      }
      return ret;
    }

    resolver = stateOrResolver instanceof Resolver
        ? stateOrResolver
        : new Resolver({ state: stateOrResolver, logger: console });

    // Alias and generated field resolution section
    if (!fieldInfo) fieldInfo = {};
    fieldInfo.name = fieldName;

    if (actualTypeIntro) {
      fillFieldInfoAndResolveAliases(object, actualTypeIntro.getFields(), fieldInfo);
      if (fieldInfo.intro && fieldInfo.intro.isGenerated) {
        ret = fieldInfo.intro.resolve(object, undefined, {
          // TODO(iridian): Complete context variable fields
          rootValue: { resolver },
          returnType: fieldInfo.intro.type,
          parentType: actualTypeIntro,
          fieldName: fieldInfo.name,
          // operation,
          // fragments,
          // fieldASTs,
          // schema,
        });
        if (typeof ret !== "undefined") return ret;
      }
      if (fieldInfo.name !== fieldName) {
        ret = object.get(fieldInfo.name);
        if (typeof ret !== "undefined") return _postProcessAlias(ret, fieldInfo);
      }
    }


    let typeName = object.get("typeName");
    let skipFirstPrototypeStep;
    if (!typeName) {
      // Immaterial transient access. Treat the transient as a prototype, except for
      // 'prototype' field access which requires special treatment.
      const transientId: VRef = object.get("id");
      resolver.objectTransient = object[PrototypeOfImmaterialTag];
      if (!resolver.objectTransient) {
        // an immaterial ghost which has its prototype nulled via Resource.ownFields
        return undefined;
      }
      resolver.objectId = resolver.objectTransient.get("id");
      // Prototype access means we're asking for a prototype of an immaterialized ghost.
      // Fetch it from the ghost path, not from the transient.
      if (fieldName === "prototype") {
        if (fieldInfoOut) fieldInfoOut.sourceTransient = null;
        const prototypeGhostPath = transientId.previousGhostStep();
        if (prototypeGhostPath === resolver.objectId.getGhostPath()) {
          return resolver.objectTransient;
        }
        return createImmaterialTransient(
            prototypeGhostPath.headRawId(), prototypeGhostPath, resolver.objectTransient);
      }
      typeName = resolver.objectTransient.get("typeName");
      resolver.objectTransient = resolver.goToTransientOfId(resolver.objectId, typeName);
      skipFirstPrototypeStep = true;
    } else {
      // Regular object
      resolver.objectTransient = object;
    }

    if (fieldInfo.intro && fieldInfo.intro.hasOwnProperty("immediateDefaultValue")) {
      return denormalizedFromJS(fieldInfo.intro.immediateDefaultValue);
    }

    // Prototype access section
    for (;;) {
      if (skipFirstPrototypeStep) {
        skipFirstPrototypeStep = false;
      } else {
        const prototype = resolver.objectTransient.get("prototype");
        // If prototype is null, we're on Resource.ownFields: don't generate default values.
        if (prototype === null) return undefined;
        if (!resolver.tryGoToNonGhostTransientOfId(prototype, typeName)) break;
      }

      ret = resolver.objectTransient.get(fieldInfo.name);
      if (typeof ret !== "undefined") {
        if (fieldInfoOut) fieldInfoOut.sourceTransient = resolver.objectTransient;
        return fieldInfo.name === fieldName
            ? ret
            : _postProcessAlias(ret, fieldInfo);
      }
    }

    // Default value section
    if (fieldInfo.intro) {
      if (fieldInfo.intro.hasOwnProperty("defaultValue")) {
        return denormalizedFromJS(fieldInfo.intro.defaultValue);
      }
      ret = fieldDefaultValue(fieldInfo.intro);
      if (typeof ret !== "undefined") return ret;
    }
    return ret;
  } catch (error) {
    throw wrapError(error, `During ${resolver && resolver.debugId()}\n .getObjectField(${
            fieldName}/${(fieldInfo && fieldInfo.name) || fieldName}), with:`,
        "\n\tobject", ...dumpObject(object),
        "\n\tfieldGhostPath:", fieldInfo && fieldInfo.fieldGhostPath,
    );
  }
}

export function fillFieldInfoAndResolveAliases (object: Transient, objectFields: Object,
    fieldInfo: FieldInfo) {
  try {
    fieldInfo.intro = objectFields[fieldInfo.name];
    if (!fieldInfo.intro) {
      throw new Error(`Schema introspection missing for field '${
          tryTransientTypeName(object)}.${fieldInfo.name}'`);
    }
    const coupling = fieldInfo.intro.coupling;
    if (coupling && coupling.defaultCoupledField && !fieldInfo.defaultCoupledField) {
      fieldInfo.defaultCoupledField = coupling.defaultCoupledField;
    }
    if (!fieldInfo.intro.alias) {
      if (!fieldInfo.sourceTransient && object) {
        fieldInfo.sourceTransient = object;
      }
      return;
    }
    if (coupling && coupling.coupledField) {
      // TODO(iridian): This invariant check is in a wrong place. But we're missing static
      // schema invariant validation step altogether which would perform these, so this is
      // a stop-gap solution. Although it probably makes sense to keep this even with static
      // schema checking, to catch possible runtime issues.
      if (fieldInfo.coupledField) {
        throw new Error(`Schema invariant error: conflicting specification ${
            ""} between field '${fieldInfo.name}' alias target '${
            fieldInfo.intro.alias}' coupledField '${
            coupling.coupledField}' and already specified alias coupledField '${
            fieldInfo.coupledField}'`);
      }
      if (fieldInfo.defaultCoupledField) {
        throw new Error(`Schema invariant error: conflicting specification ${
            ""} between field '${fieldInfo.name}' alias target '${
            fieldInfo.intro.alias}' coupledField '${
            coupling.coupledField}' and already specified alias defaultCoupledField '${
            fieldInfo.defaultCoupledField}'`);
      }
      fieldInfo.coupledField = coupling.coupledField;
    }
    fieldInfo.name = fieldInfo.intro.alias;
    fillFieldInfoAndResolveAliases(object, objectFields, fieldInfo);
  } catch (error) {
    throw wrapError(error, `During fillFieldInfoAndResolveAliases, with:`,
        "\n\tobject:", object,
        "\n\tobjectFields:", objectFields,
        "\n\tfieldInfo:", fieldInfo,
    );
  }
}

function _postProcessAlias (ret: any, fieldInfo: FieldInfo) {
  if (!fieldInfo.coupledField || !(ret instanceof VRef) || fieldInfo.skipAliasPostProcess
      || (ret.getCoupledField() === fieldInfo.coupledField)) {
    return ret;
  }
  return undefined;
}
