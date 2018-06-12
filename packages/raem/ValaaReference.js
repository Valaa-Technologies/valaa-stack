// @flow
import URL from "url-parse";

import GhostPath, { JSONGhostPath, ghostPathFromJSON }
    from "~/raem/tools/denormalized/GhostPath";
import { PartitionURI, createValaaURI, createPartitionURI, getPartitionRawIdFrom }
    from "~/raem/tools/PartitionURI";

import dumpify from "~/tools/dumpify";
import wrapError, { dumpObject } from "~/tools/wrapError";
import invariantify, { invariantifyString, invariantifyObject } from "~/tools/invariantify";

export type RawId = string;

const VRefValueOf = Symbol("VRef.valueOf");
/**
 * ValaaReference is a value data object which contains all necessary runtime information to
 * reference a valaa object, possibly as part of a coupling.
 *
 * rawId            is an id string which identifies the target
 * ghostPath        is a GhostPath object which specifies the ghost instantiation path, for locating
 *                  the actual ghost content: the ghost itself might not be materialized.
 * coupledField     the coupled field name on the target Resource which contains a backreference
 *                  to a referring Resource, if this reference is part of a coupling.
 * partitionURI     for cross-partition Valaa references partitionURI denotes the fully specified
 *                  universal location of the target partition.
 *
 * Because many use cases only need the rawId there is a collection type:
 * type IdData = VRef | string
 *
 * IdData allows passing in a plain id string in most places where an object reference is required.
 * This usage has limitations, however. Because rawId only specifies the identity of an object it
 * cannot be reliably used to locate the object content in isolation. The most notable examples of
 * this are immaterial ghosts and cross-partition references:
 * Immaterial ghosts inherit their properties from a prototype but don't data have any data entries
 * themselves (this is by design). The ghostPath is required to locate the prototypes.
 * For a cross-partition reference the target partition might not necessarily be loaded:
 * partitionURI (which the Valaa infrastructure guarantees to be locateable) is needed in this case.
 *
 * @export
 * @class VRef
 */
export default class ValaaReference {
  _vref: [RawId, ?string, ?GhostPath];

  _isInactive: ?boolean;
  _partitionURI: ?PartitionURI;
  _mostInheritedMaterializedTransient: Object;

  constructor (vref: [RawId, ?string, ?GhostPath], partitionURI: ?PartitionURI) {
    this._vref = vref;
    if (partitionURI) this.setPartitionURI(partitionURI);
    if (this._vref[2]) this.connectGhostPath(this._vref[2]);
  }

  debugId (): string { return this.toString(); }

  rawId (): RawId { return this._vref[0]; }

  typeof (): string { return "Resource"; }

  getCoupledField (): ?string { return this._vref[1]; }

  coupleWith (coupledField: string, partitionURI: PartitionURI = this._partitionURI): VRef {
    if (typeof coupledField === "undefined") return this;
    return new this.constructor([this._vref[0], coupledField, this._vref[2]], partitionURI);
  }

  getGhostPath (): GhostPath {
    return this._vref[2] || (this._vref[2] = new GhostPath(this.rawId()));
  }
  tryGhostPath (): ?GhostPath { return this._vref[2]; }

  connectGhostPath (connectedGhostPath: GhostPath) {
    if (this._vref[0] !== connectedGhostPath.headRawId()) {
      throw new Error(`Inconsistent ValaaReference: this.rawId !== connectedGhostPath.headRawId, ${
          ""} with rawId: '${this._vref[0]}' and ghostPath.headRawId: '${
          connectedGhostPath.headRawId()}'`);
    }
    this._vref[2] = connectedGhostPath;
  }
  previousGhostStep (): ?GhostPath { return this._vref[2] && this._vref[2].previousStep(); }

  isInherited (): ?boolean { return this._vref[2] ? this._vref[2].isInherited() : false; }
  isGhost (): ?boolean { return this._vref[2] ? this._vref[2].isGhost() : false; }
  isInstance (): ?boolean { return this._vref[2] ? this._vref[2].isInstance() : false; }

  isInactive (): ?boolean { return this._isInactive || false; }
  setInactive (value: boolean = true): ?boolean { this._isInactive = value; }

  partitionURI (): ?PartitionURI { return this._partitionURI; }
  partitionRawId (): ?string {
    try {
      return getPartitionRawIdFrom(this._partitionURI);
    } catch (error) {
      throw wrapError(error, `During ${this.debugId()}\n .partitionRawId(), with:`,
          "\n\tpartitionURI:", this._partitionURI);
    }
  }
  setPartitionURI (partitionURI: PartitionURI) {
    try {
      if (this._partitionURI) {
        throw new Error(`partitionURI already exists when trying to assign '${
            partitionURI}' into ${this.toString()}`);
      }
      invariantifyObject(partitionURI, "setPartitionURI.partitionURI",
          { instanceof: URL, allowEmpty: true });
      this._partitionURI = partitionURI;
    } catch (error) {
      throw wrapError(error, `During ${this.debugId()}\n .setPartitionURI(), with:`,
          "\n\tpartitionURI:", partitionURI,
          "\n\tthis:", ...dumpObject(this));
    }
  }
  clearPartitionURI () { this._partitionURI = undefined; }
  immutatePartitionURI (partitionURI: PartitionURI) {
    return new this.constructor(this._vref, partitionURI);
  }

  toString (nest: number = 1): string {
    const ghostPath = this.tryGhostPath();
    let ghostPathText = "";
    if (ghostPath && ghostPath.previousStep()) {
      ghostPathText = nest ? (ghostPath.toString()) || ""
        : (`[${ghostPath.toJSON().length}]`) || "";
    }
    const partitionText = !this._partitionURI ? "" : this._partitionURI.toString();
    return `VRef${this.isInactive() ? "-inactive" : ""}(${this.rawId()},${
        this.getCoupledField() || ""},${ghostPathText},${partitionText})`;
  }
  toJSON (): any[] {
    const ret: any[] = this._vref.slice(0, 3);
    if (ret[2]) ret[2] = ret[2].previousStep() ? ret[2].toJSON() : null;
    if (this._partitionURI) ret[3] = this._partitionURI.toString();
    let i = ret.length;
    while (!ret[i - 1]) i -= 1;
    return ret.slice(0, i);
  }
  valueOf (): string {
    let ret = this[VRefValueOf];
    if (typeof ret === "undefined") {
      ret = `VRef(${this.rawId()},'${this.getCoupledField() || ""}')`;
      // this[VRefValueOf] = ret; // JEST doesn't deal well with temporary values like this
    }
    return ret;
  }

  equals (other: any): boolean {
    const ret = (this === other)
        || ((this.rawId() === getRawIdFrom(other))
            && (other instanceof VRef
                ? this.getCoupledField() === other.getCoupledField()
                : !this.getCoupledField()));
    return ret;
  }
  hashCode (): number {
    if (this._hashCode) return this._hashCode;
    const id = this.rawId();
    const len = Math.min(id.length, 8);
    let ret = 0;
    for (let i = 0; i < len; ++i) {
      ret += id.charCodeAt(i) << (8 * i); // eslint-disable-line no-bitwise
    }
    this._hashCode = ret;
    return ret;
  }
}

export const VRef = ValaaReference;

export class ValaaResourceReference extends ValaaReference {}
export class ValaaDataReference extends ValaaReference { typeof (): string { return "Data"; } }
export class ValaaBlobReference extends ValaaReference { typeof (): string { return "Blob"; } }

export const RRef = ValaaResourceReference;
export const DRef = ValaaDataReference;
export const BRef = ValaaBlobReference;

export type JSONVRef = [RawId, ?string, ?JSONGhostPath, ?string];

export type IdData = string | VRef;
export type JSONIdData = string | JSONVRef;

export function isIdData (value: any): boolean {
  return (typeof value === "string") || (value instanceof VRef);
}

export function isJSONIdData (value: any): boolean {
  return Array.isArray(value) && (typeof value[0] === "string");
}

export function invariantifyId (candidate: any, name: string = "id",
    { value, valueInvariant, allowNull, allowUndefined, suffix = "", parent }: Object = {},
    ...additionalContextInformation: any) {
  if (((isIdData(candidate) || isJSONIdData(candidate))
          && (typeof value === "undefined" || (candidate === value))
          && (!valueInvariant || valueInvariant(candidate)))
      || ((typeof candidate === "undefined") && allowUndefined)
      || (candidate === null && allowNull)) return true;

  return invariantify(false,
      `'${name}' must be a valid id-data${
          typeof value !== "undefined" ? ` with exact value '${value}'` : ""}${
          valueInvariant ? " obeying given value invariant" : ""}${
          allowNull ? ", or null" : ""}${allowUndefined ? ", or undefined" : ""}${
          suffix}`,
      `\n\t'${name}' candidate:`, candidate,
      ...(valueInvariant ? [`\n\tvalue invariant:`, valueInvariant] : []),
      ...additionalContextInformation);
}

/**
 * Create a Valaa reference.
 *
 * @export
 * @param {string} idData
 * @param {string} coupledField
 * @param {GhostPath} ghostPath
 * @param {PartitionURI} partitionURI
 * @returns {VRef}
 */
export function vRef (rawId: RawId, coupledField: ?string = null, ghostPath: ?GhostPath = null,
    partitionURI: ?PartitionURI = null, RefType: Function = ValaaResourceReference): VRef {
  try {
    invariantifyString(rawId, "vRef.rawId");
    invariantifyString(coupledField, "vRef.coupledField", { allowNull: true });
    invariantifyObject(ghostPath, "vRef.ghostPath", { allowNull: true, instanceof: GhostPath });
    invariantifyObject(partitionURI, "vRef.partitionURI",
        { allowNull: true, allowEmpty: true, instanceof: URL });
    return new RefType([rawId, coupledField, ghostPath], partitionURI);
  } catch (error) {
    throw wrapError(error, `During vRef('${rawId}', '${coupledField}', ghostPath, ${
        partitionURI}), with:`,
        "\n\tghostPath:", ghostPath);
  }
}

export function dRef (rawId: RawId, coupledField: ?string, ghostPath: ?GhostPath,
    partitionURI: ?PartitionURI) {
  return vRef(rawId, coupledField, ghostPath, partitionURI, ValaaDataReference);
}

export function vRefFromJSON (json: JSONIdData, RefType: Object = VRef): VRef {
  const ret = new RefType(json);
  if ((typeof ret._vref[2] === "string") || (ret._vref[1] && typeof ret._vref[1] === "object")) {
    // Flip obsolete coupledField / ghostPath order.
    console.warn("Encounted obsolete ValaaReference field order, expected " +
        "[rawId, coupledField, ghostPath], got [rawId, ghostPath, coupledField]");
    const temp = ret._vref[1];
    ret._vref[1] = ret._vref[2];
    ret._vref[2] = temp;
  }
  if (ret._vref[2] && !(ret._vref[2] instanceof GhostPath)) {
    ret._vref[2] = ghostPathFromJSON(ret._vref[2]);
  }
  if (ret._vref[3] && !(ret._vref[3] instanceof PartitionURI)) {
    ret._vref[3] = createPartitionURI(ret._vref[3]);
  }
  return ret;
}

export function vRefFromURI (uri: URL | string): VRef {
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
    else throw new Error(`ValaaReference option '${key}' not implemented yet`);
  }
  return vRef(rawId, coupling, undefined, createValaaURI(partitionURI));
}

/**
 * Returns a new VRef object copied or deserialized from given idData, with its fields overridden
 * with given coupledField, ghostPath and/or partitionURI. If any of the overrides is null the
 * original value is kept.
 *
 * @export
 * @param {IdData} idData
 * @param {string=tryCoupledFieldFrom(idData)} coupledField
 * @param {GhostPath=tryGhostPathFrom(idData)} ghostPath
 * @param {PartitionURI=tryPartitionURIFrom(idData)} partitionURI
 * @returns {VRef}
 */
export function obtainVRef (idData: IdData | JSONIdData,
    coupledField: ?string = tryCoupledFieldFrom(idData) || null,
    ghostPath: ?GhostPath = tryGhostPathFrom(idData) || null,
    partitionURI: ?PartitionURI = tryPartitionURIFrom(idData) || null,
    RefType: Function = ValaaResourceReference): VRef {
  return new RefType([getRawIdFrom(idData), coupledField, ghostPath], partitionURI);
}

export function obtainRRef (idData: IdData | JSONIdData, coupledField: ?string,
    ghostPath: ?GhostPath, partitionURI: ?PartitionURI): RRef {
  return obtainVRef(idData, coupledField, ghostPath, partitionURI, ValaaResourceReference);
}

export function obtainDRef (idData: IdData | JSONIdData, coupledField: ?string,
    ghostPath: ?GhostPath, partitionURI: ?PartitionURI): DRef {
  return obtainVRef(idData, coupledField, ghostPath, partitionURI, ValaaDataReference);
}

export function obtainBRef (idData: IdData | JSONIdData, coupledField: ?string,
    ghostPath: ?GhostPath, partitionURI: ?PartitionURI): BRef {
  return obtainVRef(idData, coupledField, ghostPath, partitionURI, ValaaBlobReference);
}

/**
 * Returns rawId from given idData or throws if the input does not have a valid rawId.
 * If idData is a string it is used as rawId candidate.
 * If idData is a VRef its .rawId() is called and used as rawId candidate.
 *
 * @export
 * @param {IdData} idData
 * @returns {string}
 */
export function getRawIdFrom (idData: IdData | JSONIdData): string {
  const ret = tryRawIdFrom(idData);
  if (ret) return ret;
  throw new Error(`getRawIdFrom.idData must be a string, VRef or serialized VRef JSON, got: ${
      idData}`);
}


/**
 * Returns rawId from given idData or undefined if the input does not have a valid rawId.
 * If idData is a string it is used as the rawId candidate.
 * If idData is a VRef its .rawId() is called and used as the rawId candidate.
 *
 * @export
 * @param {IdData} idData
 * @returns null
 */
export function tryRawIdFrom (idData: IdData | JSONIdData): ?string {
  if (typeof idData === "string") return idData;
  if (idData instanceof VRef) return idData.rawId();
  if (Array.isArray(idData)) return idData[0];
  return undefined;
}


/**
 * Returns active ghostPath from given idData or throws if the input does not have one.
 * If idData is a VRef its .getGhostPath() is called and used as the ghostPath candidate.
 *
 * @export
 * @param {IdData} idData
 * @returns {GhostPath}
 */
export function getGhostPathFrom (idData: IdData): GhostPath {
  const ret = tryGhostPathFrom(idData);
  if (ret) return ret;
  throw new Error(
      `getGhostPathFrom.idData.ghostPath must be a valid GhostPath, got idData: ${idData}`);
}

/**
 * Returns active ghostPath from given idData or undefined if the input does not have one.
 * If idData is a string the ghostPath is not valid.
 * If idData is a VRef its .getGhostPath() is called and used as the ghostPath candidate.
 *
 * @export
 * @param {IdData} idData
 * @returns null
 */
export function tryGhostPathFrom (idData: IdData): ?GhostPath {
  if (idData instanceof VRef) return idData.isGhost() ? idData.getGhostPath() : undefined;
  if (!Array.isArray(idData)) return undefined;
  if (Array.isArray(idData[2])) return ghostPathFromJSON(idData[2]);
  if (Array.isArray(idData[1])) {
    console.warn("Encounted obsolete ValaaReference serialized JSON array field order: " +
        "expected JSON-serialized ghost path as third entry but found it as second");
    return ghostPathFromJSON(idData[1]);
  }
  return undefined;
}

/**
 * Returns coupledField from given idData or undefined if no valid coupledField can be
 * found. If idData is a VRef its .getCoupledField() is called and used as the candidate.
 *
 * @export
 * @param {IdData} idData
 * @returns null
 */
export function tryCoupledFieldFrom (idData: IdData | JSONIdData): ?string {
  if (idData instanceof VRef) return idData.getCoupledField();
  if (!Array.isArray(idData)) return undefined;
  if (typeof idData[1] === "string") return idData[1];
  if (typeof idData[2] === "string") {
    console.warn("Encounted obsolete ValaaReference serialized JSON array field order: " +
        "expected string coupledField as second entry but found it in third entry");
    return idData[2];
  }
  return undefined;
}

/**
 * Returns partitionURI from given idData or undefined if no valid partitionURI can be
 * found. If idData is a VRef its .partitionURI() is called and used as the candidate.
 *
 * @export
 * @param {IdData} idData
 * @returns null
 */
export function tryPartitionURIFrom (idData: IdData | JSONIdData): ?PartitionURI {
  return idData instanceof VRef ? idData.partitionURI()
      : (Array.isArray(idData) && idData[3]) ? createPartitionURI(idData[3])
      : undefined;
}

export function expandIdDataFrom (idData: IdData): [RawId, ?string, ?GhostPath] {
  if (typeof idData === "string") return [idData];
  if (idData instanceof VRef) return idData._vref;
  throw new Error(`Invalid expandIdDataFrom.idData given, expected IdData (string or VRef), got ${
      dumpify(idData)}`);
}
