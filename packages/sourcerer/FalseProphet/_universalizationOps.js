// @flow

// import ValaaURI, { createValaaURI } from "~/raem/ValaaURI";
import VRL, { /* vRef, */ JSONIdData } from "~/raem/VRL";
import GhostPath, { ghostPathFromJSON } from "~/raem/state/GhostPath";

import { dumpObject, debugObjectType, wrapError } from "~/tools/wrapError";

import FalseProphet from "./FalseProphet";

/*
export function vRefFromURI (uri: ValaaURI | string): VRL {
  const [partitionURI, fragment] = String(uri).split("#");
  if (!fragment) return vRef("", null, null, createValaaURI(partitionURI));
  const [rawId, referenceOptions] = fragment.split("?");
  // TODO(iridian): validate rawId against [-_0-9a-zA-Z] and do base64 -> base64url conversion
  // which needs codebase wide changes.
  if (!referenceOptions) return vRef(rawId, null, null, createValaaURI(partitionURI));
  // const options = {};
  let coupling;
  for (const [key, value] of referenceOptions.split("&").map(pair => pair.split("="))) {
    if (key === "coupling") coupling = value;
    else throw new Error(`VRL option '${key}' not implemented yet`);
  }
  return vRef(rawId, coupling, undefined, createValaaURI(partitionURI));
}
*/

/*
export function vRefFromJSON (json: JSONIdData, RefType: Object = VRL): VRL {
  const ret = new RefType(json);
  if ((typeof ret[PackedHostValue][2] === "string")
      || (ret[PackedHostValue][1] && typeof ret[PackedHostValue][1] === "object")) {
    // Flip obsolete coupledField / ghostPath order.
    console.warn("Encounted obsolete VRL field order, expected " +
        "[rawId, coupledField, ghostPath], got [rawId, ghostPath, coupledField]");
    const temp = ret[PackedHostValue][1];
    ret[PackedHostValue][1] = ret[PackedHostValue][2];
    ret[PackedHostValue][2] = temp;
  }
  if (ret[PackedHostValue][2] && !(ret[PackedHostValue][2] instanceof GhostPath)) {
    ret[PackedHostValue][2] = ghostPathFromJSON(ret[PackedHostValue][2]);
  }
  if (ret[PackedHostValue][3] && !(ret[PackedHostValue][3] instanceof ValaaURI)) {
    ret[PackedHostValue][3] = naiveURI.createPartitionURI(ret[PackedHostValue][3]);
  }
  return ret;
}
*/

// rfc3986 uri regex for reference: ^(([^:/?#]+):)?(//([^/?#]*))?([^?#]*)(\?([^#]*))?(#(.*))?

const urnValOSRegExpString = "^(urn:valos:)(([^#?]*)(\\?\\+([^#]*))?(\\?=([^#]*))?(#(.*))?)?$";
const valOSURIRegExpString = "^([^:/?#]+:[^#]*)(#([^#?]*)(\\?\\+([^#]*))?(\\?=([^#]*))?)?$";
const urnValOSRegExp = new RegExp(urnValOSRegExpString);
const valOSURIRegExp = new RegExp(valOSURIRegExpString);

const oldRawIdRegExpString = "^([a-zA-Z0-9+/_-]*)$";
const oldRawIdRegExp = new RegExp(oldRawIdRegExpString);

export function deserializeVRL (serializedRef: string | JSONIdData,
    currentPartitionURI?: string, falseProphet: ?FalseProphet, isInRefClause: ?boolean) {
  let nss, resolver, query, fragment;
  try {
    if (typeof serializedRef === "string") {
      let parts = serializedRef.match(urnValOSRegExp) || serializedRef.match(valOSURIRegExp);
      if (!parts && isInRefClause) {
        parts = [true, "urn:valos:", serializedRef];
      } else if (!parts) {
        parts = serializedRef.match(oldRawIdRegExp);
        if (parts) {
          console.warn(`Deprecated old-style valos raw id reference encountered: ${
              serializedRef}`,
              "\n\tat stack:", new Error().stack);
          parts.unshift(null, null);
          parts[1] = "urn:valos:";
        } else {
          throw new Error(`Malformed urn:valos reference "${serializedRef
              }": doesn't match either urn:valos regex /${urnValOSRegExpString}/${
              ""} nor valos URI regex /${valOSURIRegExpString}/`);
        }
      }
      if (parts[1] !== "urn:valos:") (resolver || (resolver = {})).partition = parts[1];
      nss = parts[3];
      if (parts[5]) {
        if (!resolver) resolver = {};
        // explicit resolver.partition overrides the generic ValOS URI
        // authority part.
        parts[5].split("&").map(param => param.split("="))
            .forEach(([key, value]) => { resolver[key] = value; });
      }
      if (parts[7]) {
        if (!query) query = {};
        parts[7].split("&").map(param => param.split("="))
            .forEach(([key, value]) => { query[key] = value; });
      }
      if (parts[9]) fragment = parts[9];
    } else if (!Array.isArray(serializedRef)) {
      throw new Error(`Malformed urn:valos reference ${debugObjectType(serializedRef)
          }, expected URI string or an array expansion`);
    } else if ((serializedRef[0] === "§vrl") || (serializedRef[0] === "§ref")) {
      return deserializeVRL(serializedRef[1], currentPartitionURI, falseProphet, true);
    } else if ((serializedRef.length === 1)
        || (serializedRef[1] && (typeof serializedRef[1] === "object"))) {
      // new-style array expansion: [nss, resolverComponent, queryComponent, fragmentComponent]
      ([nss, resolver, query, fragment] = serializedRef);
      if (resolver) resolver = { ...resolver };
      if (query) query = { ...query };
    } else {
      // old-style array expansion: [rawId, coupling, ghostPath, partitionURI]
      nss = serializedRef[0];
      resolver = { ghostPath: serializedRef[2], partition: serializedRef[3] };
      query = { coupling: serializedRef[1] };
      /*
      if (falseProphet) {
        falseProphet.warnEvent(1, () => [
          "deserializeVRL encountered an old-style reference which will be deprecated:",
          ...dumpObject(serializedRef),
        ]);
      }
      */
    }

    let partitionURIString = resolver && resolver.partition;
    if (!partitionURIString && currentPartitionURI) {
      (resolver || (resolver = {})).partition = currentPartitionURI;
      partitionURIString = String(currentPartitionURI);
    }

    if (!falseProphet || ((currentPartitionURI === null) && !partitionURIString)) {
      return new VRL(nss)
          .initResolverComponent(resolver)
          .initQueryComponent(query)
          .initFragmentComponent(fragment);
    }
    if (!partitionURIString) {
      throw new Error(`Cannot deserialize urn:valos reference, no current partition provided${
          ""} (and isn't explicitly disabled as 'null') and${
          ""} reference is missing partition URI part: "${serializedRef}"`);
    }
    let referencePrototype;
    const connection = falseProphet._connections[partitionURIString];
    referencePrototype = connection
        ? connection._referencePrototype
        : falseProphet._inactivePartitionVRLPrototypes[partitionURIString];
    const ghostPath = resolver.ghostPath;
    if (!referencePrototype) {
      resolver.inactive = true;
      delete resolver.ghostPath;
      referencePrototype = falseProphet._inactivePartitionVRLPrototypes[partitionURIString] =
          new VRL().initResolverComponent(resolver);
    }
    const ret = Object.create(referencePrototype)
        .initNSS(nss)
        .initQueryComponent(query)
        .initFragmentComponent(fragment);
    ret._nss = nss;
    if (ghostPath) {
      ret.obtainOwnResolverComponent().ghostPath = (ghostPath instanceof GhostPath)
          ? ghostPath : ghostPathFromJSON(ghostPath);
    }
    return ret;
  } catch (error) {
    throw (falseProphet ? falseProphet.wrapErrorEvent.bind(falseProphet) : wrapError)(error,
        new Error("deserializeVRL()"),
            "\n\tserializedReference:", serializedRef,
            "\n\tcurrentPartitionURI:", currentPartitionURI,
            "\n\tnss:", nss,
            "\n\tresolver:", ...dumpObject(resolver),
            "\n\tquery:", ...dumpObject(query),
            "\n\tfragment:", fragment);
  }
}
/*
_initializeHostValue (vref: [RawId, ?string, ?GhostPath]) {
  this[PackedHostValue] = vref;
  if (this[PackedHostValue][2]) this.connectGhostPath(this[PackedHostValue][2]);
}
*/