import Bard from "~/valaa-core/redux/Bard";
import { VRef } from "~/valaa-core/ValaaReference";
import Transient from "~/valaa-core/tools/denormalized/Transient";

/**
 * Traverses all materialized ownlings recursively and calls the given *visitor* callback for each.
 * If the visitor returns false, the recursion stops. If the visitor returns a transient, that
 * transient is used as the subsequent iteration. Otherwise the transient for the current entry is
 * retrieved and its ownlings are traversed.
 *
 * @export
 * @param {Bard} bard
 * @param {Transient} transient
 * @param {Function} visitor
 */
export default function traverseMaterializedOwnlings (bard: Bard, transient: Transient,
    visitor: Function) {
  const typeIntro = bard.getTypeIntro(bard.typeName);
  const fieldIntros = typeIntro.getFields();
  for (const [fieldName, fieldValue] of transient.entries()) {
    const fieldIntro = fieldIntros[fieldName];
    if (fieldIntro && fieldIntro.isOwned && fieldValue) {
      for (const entryId of (fieldIntro.isSequence ? fieldValue : [fieldValue])) {
        if (!entryId) continue;
        let entryTransient = visitor(typeof entryId === "string" ? VRef([entryId]) : entryId);
        if (typeof entryTransient === "undefined") {
          entryTransient = bard.tryGoToTransientOfRawId(entryId.rawId(), "Resource");
        }
        if (entryTransient) traverseMaterializedOwnlings(bard, entryTransient, visitor);
      }
    }
  }
}
