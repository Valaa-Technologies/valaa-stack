import { IdData, obtainVRef } from "~/core/ValaaReference";

import { getTransientTypeName } from "~/core/tools/denormalized/Transient";
import getObjectTransient from "~/core/tools/denormalized/getObjectTransient";
import getObjectField from "~/core/tools/denormalized/getObjectField";
import dataFieldValue from "~/core/tools/denormalized/dataFieldValue";

import { unspecifiedPlural, unspecifiedSingular } from "~/core/tools/graphql/coupling";

import Bard from "~/core/redux/Bard";

import { dumpify, dumpObject, invariantify, wrapError } from "~/tools";

export function getCoupling (fieldIntro) {
  if (fieldIntro.coupling && typeof fieldIntro.coupling !== "string") {
    return fieldIntro.coupling;
  }
  if (!fieldIntro.namedType) {
    throw new Error(`No getNamedType found for field '${fieldIntro.name}'`);
  }
  return fieldIntro.isLeaf || !fieldIntro.isResource
      ? null
      : fieldIntro.isSequence ? unspecifiedPlural() : unspecifiedSingular();
}

export const COUPLE_COUPLING = "coupling";
export const UNCOUPLE_COUPLING = "uncoupling";
export const DESTROY_COUPLING = "destroying a coupling";

/**
 *  Adds coupling side effect sub-events to bard.passage.passages.
 *  These side effects primarily include updating coupled fields.
 *
 * @export
 * @returns
 */
export function addCoupleCouplingPassages (bard: Bard, fieldIntro,
    newEntry: IdData | Array<IdData>, entryIsSequence = fieldIntro.isSequence) {
  checkAndAddCouplingPassages(bard, fieldIntro, newEntry, entryIsSequence, COUPLE_COUPLING);
}

/**
 *  Adds uncoupling side effect sub-events to bard.passage.passages.
 *  These side effects primarily include updating coupled fields.
 *
 * @export
 * @returns
 */
export function addUncoupleCouplingPassages (bard: Bard, fieldIntro,
    currentEntry: IdData | Array<IdData>, entryIsSequence = fieldIntro.isSequence) {
  checkAndAddCouplingPassages(bard, fieldIntro, currentEntry, entryIsSequence, UNCOUPLE_COUPLING);
}

/**
 *  Adds destroy coupling side effect sub-events to bard.passage.passages.
 *  These side effects primarily include updating coupled fields.
 *  DestroyCoupling (unlike the regular uncouple) will throw an error if the fieldIntro coupling has
 *  'preventsDestroy' set.
 *
 * @export
 * @returns
 */
export function addDestroyCouplingPassages (bard: Bard, fieldIntro,
    currentEntry: IdData | Array<IdData>, entryIsSequence = fieldIntro.isSequence) {
  checkAndAddCouplingPassages(bard, fieldIntro, currentEntry, entryIsSequence, DESTROY_COUPLING);
}

function checkAndAddCouplingPassages (bard: Bard, fieldIntro,
    entryOrList: IdData | Array<IdData>, entryIsSequence, actionType) {
  try {
    // console.log(`checkAndAddCouplingPassages '${fieldIntro.name}', remote:`,
    //      dumpify(entryOrList, 100), entryIsSequence, actionType,
    //      dumpify(fieldIntro.coupling, 100));
    if (typeof fieldIntro.coupling === "string" || !entryOrList) return;
    const coupling = getCoupling(fieldIntro);
    if (!coupling) return;

    if (!entryIsSequence) {
      addCouplingPassages(bard, fieldIntro, entryOrList, coupling, actionType);
    } else {
      entryOrList.forEach(entry => {
        addCouplingPassages(bard, fieldIntro, entry, coupling, actionType, fieldIntro.namedType);
      });
    }
  } catch (error) {
    throw wrapError(error, `During ${bard.debugId()
            }\n.checkAndAddCouplingPassages(${actionType}, ${
            dataFieldValue(bard.objectTransient, "id")}.${fieldIntro.name}), with:`,
        "\n\tentryOrList:", entryOrList,
        "\n\tfieldIntro:", fieldIntro,
        "\n\tbard:", bard);
  }
}

export function addCouplingPassages (bard: Bard, fieldIntro, remote: IdData, coupling,
    actionType, remoteType = fieldIntro.namedType) {
  /*
  console.log("addCouplingPassages", actionType, `'${fieldIntro.name}', remote:`,
      dumpify(remote, 100), "coupling", dumpify(coupling, 100));
  */
  if (!remote || remote.isInactive()) return;
  const remoteVRef = obtainVRef(remote);
  let coupledField = remoteVRef.getCoupledField();
  let remoteTypeName = remoteType.name;
  let remoteFieldIntro = remoteType.getFields()[coupledField];
  let reverseCoupling;
  let remoteTransient;
  try {
    if (coupling.coupledField) {
      invariantify(!coupledField,
          `remote.coupledField must be falsy because coupling has coupledField specified`);
      coupledField = coupling.coupledField;
    } else if (!coupledField) {
      coupledField = coupling.defaultCoupledField;
    }
    if (typeof remoteType.getFields !== "function") {
      bard.error("Invalid fieldType when looking for", dumpify(fieldIntro), ":",
          dumpify(remoteType));
      return;
    }
    if (!remoteFieldIntro) {
      remoteTransient = getObjectTransient(bard.state, remote, remoteType.name);
      remoteTypeName = getTransientTypeName(remoteTransient);
      remoteFieldIntro = bard.schema.getType(remoteTypeName).getFields()[coupledField];
      if (!remoteFieldIntro) {
        throw new Error(`No introspection found for remote field ${remoteType.name}/${
            remoteTypeName}.${coupledField} when ${actionType} '${remote}' to near field ${
                bard.objectId}:${bard.objectTypeIntro.name}.${fieldIntro.name}`);
      }
    }
    reverseCoupling = remoteFieldIntro.coupling
        || (coupling.whenUnmatched && coupling.whenUnmatched(remoteFieldIntro.isSequence));
    if (!reverseCoupling) {
      throw new Error(`No 'coupling' descriptor found for remote field '${coupledField}`);
    }
    if (actionType === COUPLE_COUPLING) {
      bard.addPassage(
          reverseCoupling.createCoupleToRemoteCommand(
              remoteVRef, remoteTypeName, coupledField, bard.objectId, fieldIntro.name));
    } else {
      if (coupling.preventsDestroy && (actionType === DESTROY_COUPLING)) {
        // Check if remote is in other partition as they can't prevent destroy, otherwise throw.
        const partitionURI = remoteVRef.partitionURI();
        // Missing partitionURI means local partition reference, so throw.
        if (!partitionURI || (partitionURI.toString() === bard.destroyedResourcePartition)) {
          const nameBard = Object.create(bard);
          const name = bard.objectTypeIntro.getFields().name
              ? `'${getObjectField(nameBard, bard.objectTransient, "name")}' `
              : bard.objectId.rawId();
          remoteTransient = getObjectTransient(bard.state, remote, remoteType.name);
          const remoteName = bard.schema.getType(getTransientTypeName(remoteTransient))
                  .getFields().name
              ? `'${getObjectField(nameBard, remoteTransient, "name")}' `
              : remoteVRef.rawId();
          const remoteChapter = bard.obtainResourceChapter(remoteVRef.rawId());
          (remoteChapter.preventsDestroys || (remoteChapter.preventsDestroys = [])).push({
            // Flips the perspective: from the perspective of remote side, this side is the remote.
            name: remoteName,
            typeName: remoteTypeName,
            remoteName: name,
            remoteTypeName: bard.objectTypeIntro.name,
            remoteFieldName: fieldIntro.name,
          });
        }
      }
      bard.addPassage(
          reverseCoupling.createUncoupleFromRemoteCommand(
              remoteVRef, remoteTypeName, coupledField, bard.objectId, fieldIntro.name));
    }
  } catch (error) {
    throw bard.wrapErrorEvent(error,
        `addCouplingPassages(when ${actionType} through field '${fieldIntro.name
            }' to reverse field '${remoteType && remoteType.name}.${coupledField}')`,
        "\n\tcoupling:", coupling,
        "\n\ttarget:", ...dumpObject(remote),
        "\n\treverse coupling:", ...dumpObject(reverseCoupling),
        "\n\tbard:", ...dumpObject(bard),
    );
  }
}
