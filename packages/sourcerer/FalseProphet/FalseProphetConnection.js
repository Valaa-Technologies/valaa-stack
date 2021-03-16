// @flow

import { EventBase, sealed, isFrozenLike } from "~/raem/events";
import VRL from "~/raem/VRL";

import Connection from "~/sourcerer/api/Connection";
import { ProclaimOptions, Proclamation, ProclaimEventResult, NarrateOptions }
    from "~/sourcerer/api/types";
import { initializeAspects, tryAspect } from "~/sourcerer/tools/EventAspects";
import SOURCERER_EVENT_VERSION from "~/sourcerer/EVENT_VERSION";
import IdentityMediator from "~/sourcerer/FalseProphet/IdentityMediator";

import { dumpObject, mapEagerly, thisChainRedirect } from "~/tools";

import { _resolveProclaimAspectParams, _addLogAspect, _addAuthorAspect } from "./_aspectOps";
import { Prophecy, _reviewRecomposedSchism } from "./_prophecyOps";
import {
  _confirmLeadingTruthsToFollowers, _confirmRecitalStories, _elaborateRecital,
} from "./_recitalOps";

/**
 * @export
 * @class FalseProphetConnection
 * @extends {Connection}
 */
export default class FalseProphetConnection extends Connection {
  // _headEventId is the aspects.log.index of the first unconfirmed truth.
  // penndingTruths and unconfirmedCommands are based on this, ie.
  // their 0th entry aspects.log.index is always equal to this.
  _headEventId: number = 0;
  // Discontinuous, unreduced truths. If defined, the first entry is
  // always immediately reduced. This means that first entry is always
  // undefined.
  _pendingTruths: EventBase[] = [];
  // Continuous, reduced but unconfirmed commands. Whenever
  // _pendingTruths contains a truth at an equivalent position with
  // equivalent aspects.command.id, then all commands with
  // aspects.log.index equal or less to that are confirmed as truths
  // and transferred to _pendingTruths.
  _unconfirmedCommands: EventBase[] = [];
  _firstUnconfirmedEventId = 0;
  _isFrozen: ?boolean;
  _referencePrototype: VRL;
  _originatingIdentity: IdentityMediator;

  constructor (options) {
    super(options);
    const existingRef = this.getFalseProphet()._absentChronicleVRLPrototypes[this._chronicleURI];
    if (existingRef) {
      this._referencePrototype = existingRef;
      delete this.getFalseProphet()._absentChronicleVRLPrototypes[this._chronicleURI];
    } else {
      this._referencePrototype = new VRL()
          .initResolverComponent({ absent: true, partition: this._chronicleURI });
    }
    if ((options.sourceryOptions || {}).newChronicle) {
      this._referencePrototype.setAbsent(false);
    }
    this._rootStem = this._chronicleURI.match(/\?id=(.*)@@$/)[1];
  }

  getFalseProphet () { return this._parent; }

  static sourceryOpsName = "falseSourcery";
  static falseSourcery = [
    function _prepareIdentity (...forward) {
      this._originatingIdentity = forward[0].discourse
          && forward[0].discourse.getIdentityMediator();
      return forward;
    },
    Connection.prototype._sourcerUpstream,
    Connection.prototype._narrateEventLog,
    FalseProphetConnection.prototype._finalizeSourcery,
  ]

  _finalizeSourcery (...rest) {
    this._referencePrototype.setAbsent(false);
    return super._finalizeSourcery(...rest);
  }

  isLocallyRecorded () {
    return this._isLocallyPersisted !== undefined ? this._isLocallyPersisted
        : (this._isLocallyPersisted = this._upstreamConnection.isLocallyRecorded());
  }
  isPrimaryAuthority () {
    return this._isPrimaryAuthority !== undefined ? this._isPrimaryAuthority
        : (this._isPrimaryAuthority = this._upstreamConnection.isPrimaryAuthority());
  }
  isRemoteAuthority () {
    return this._isRemoteAuthority !== undefined ? this._isRemoteAuthority
        : (this._isRemoteAuthority = this._upstreamConnection.isRemoteAuthority());
  }
  getEventVersion () {
    return this._eventVersion !== undefined ? this._eventVersion
        : (this._eventVersion = this._upstreamConnection.getEventVersion());
  }
  getMostRecentError () {
    return (this._mostRecentError || {}).message;
  }

  getStatus () {
    return {
      truths: this._headEventId,
      commands: this._unconfirmedCommands.length,
      frozen: this.isFrozenConnection(),
      ...(this.getMostRecentError() ? { error: this.getMostRecentError() } : {}),
      ...super.getStatus(),
    };
  }

  setIsFrozen (value: boolean = true) { this._isFrozen = value; }
  isFrozenConnection (): boolean { return !!this._isFrozen; }

  setInvalidated (invalidation: ?string, event) {
    this._invalidation = invalidation && [invalidation, event];
  }
  isInvalidated (): ?string { return this._invalidation; }

  narrateEventLog (options: ?NarrateOptions = {}): Promise<Object> {
    if (!options) return undefined;
    this._setOptionsIdentity(options);
    if (options.reproclaimOptions !== false) {
      if (!options.reproclaimOptions) options.reproclaimOptions = {};
      options.reproclaimOptions.discourse = options.discourse;
      options.reproclaimOptions.identity = options.identity;
    }
    return super.narrateEventLog(options);
  }

  _setOptionsIdentity (options) {
    if (options.identity !== undefined) return options.identity;
    const identity = options.discourse && options.discourse.getIdentityMediator();
    return (options.identity = identity || this._originatingIdentity);
  }

  proclaimEvents (events: EventBase[], options: ProclaimOptions = {}): Proclamation {
    if (!events || !events.length) return { eventResults: events };
    const resultBase = new ProclaimEventResult(this);
    resultBase._events = events;
    const op = {
      events, options, resultBase,
      plog: this.opLog(2, options, "proclaim", `Proclaiming ${events.length} events`),
    };
    resultBase.onGetEventError = error =>
        this._errorOnFalseProphetProclaimOps(error, null, [op]);
    resultBase._truthForwardResults = this.opChain(
        "_falseProclaim", [op], "_errorOnFalseProphetProclaimOps", op.plog);
    op.eventResults = events.map((event, index) => {
      const result = Object.create(resultBase);
      result.event = event;
      result.index = index;
      return result;
    });
    return { eventResults: op.eventResults };
  }

  static _falseProclaim = [
    FalseProphetConnection.prototype._prepareProclaim,
    FalseProphetConnection.prototype._awaitProclamation,
    FalseProphetConnection.prototype._awaitUpstreamTruths,
    FalseProphetConnection.prototype._awaitPossibleRenarration,
    FalseProphetConnection.prototype._receiveTruthsLocally,
    FalseProphetConnection.prototype._finalizeProclaimResults,
  ]

  _errorOnFalseProphetProclaimOps (error, index, [op]) {
    if (error === op.reproclaimError) {
      op.leadingTruths = undefined;
      op.renarration = undefined;
      op.events = this._unconfirmedCommands; // eslint-disable-line no-param-reassign
      op.options.isLocallyRecorded = false;
      op.proclamation = this._upstreamConnection.proclaimEvents(op.events, op.options);
      return thisChainRedirect("_awaitProclamation", op);
    }
    throw this.wrapErrorEvent(error, 1, new Error("proclaimEvents"),
        "\n\toptions:", ...dumpObject(op.options),
        "\n\tevents:", ...dumpObject(this._dumpEventIds(op.events)),
        "\n\top:", ...dumpObject(op));
  }

  _prepareProclaim (op) {
    if (op.options.isProphecy) {
      const aspectParams = _resolveProclaimAspectParams(this, op);
      // console.log("assigning ids:", this.getName(), this._headEventId,
      //     this._unconfirmedCommands.length, "\n\tevents:", ...dumpObject(events));
      for (const event of op.events) {
        if (!event.aspects || !event.aspects.version) {
          initializeAspects(event, { version: SOURCERER_EVENT_VERSION });
        }
        if (aspectParams.publicIdentity) _addAuthorAspect(this, op, aspectParams, event);
        _addLogAspect(this, op, aspectParams, event);
        ++aspectParams.index;
        this._unconfirmedCommands.push(event);
      }
      this._checkForFreezeAndNotify(op.plog);
    } else if (typeof op.events[0].aspects.log.index !== "number") {
      throw new Error(`Can't chronicle events without aspects.log.index ${
          ""}(while options.isProphecy is not set)`);
    }
    op.receiveTruths = !op.options.isTruth
        && this.getReceiveTruths(op.options.receiveTruths);
    if (op.receiveTruths) op.options.receiveTruths = op.receiveTruths;
    op.options.receiveCommands = op.options.isProphecy ? null
        : this.getReceiveCommands(op.options.receiveCommands);
    op.plog && op.plog.v2 && op.plog.opEvent("to-upstream",
        `upstream.proclaimEvents(${op.events.length})`, op);
    op.proclamation = this._upstreamConnection.proclaimEvents(op.events, op.options);
    return [op];
  }

  _awaitProclamation (op) {
    return [op, (op.resultBase._forwardResults = op.proclamation.eventResults)];
  }

  _awaitUpstreamTruths (op, upstreamEventResults) {
    op.upstreamResults = upstreamEventResults || op.events;
    const canonicalRecital = this.getFalseProphet()._canonicalRecital;
    return [op, mapEagerly(op.upstreamResults,
        result => result.getTruthEvent(),
        (error, head, index, truthResults, entries, callback, onRejected) => {
          if (!op.leadingTruths) op.leadingTruths = truthResults.slice(0, index);
          const command = op.events[index];
          const prophecy = command && canonicalRecital.getStoryBy(command.aspects.command.id);
          if (error) this._mostRecentError = op.eventResults[index].error = error;
          if (((error.proceed || {}).when === "narrated") && (op.renarration === undefined)) {
            op.renarration = this.narrateEventLog({
              eventIdBegin: this._headEventId,
              receiveTruths: null,
            });
          }
          if (prophecy) {
            const chronicleURI = this.getChronicleURI();
            const chronicle = (prophecy.meta.chronicles || {})[chronicleURI];
            if (chronicle) chronicle.proclamationError = error;
            const proclaimError = new Error(`Sub-command proclamation error to <${
                chronicleURI}>: ${error.message}`);
            proclaimError.chronicleURI = chronicleURI;
            proclaimError.proclamationError = error;
            const errorEvent = prophecy.meta.operation
                .getProgressErrorEvent("profess", proclaimError, {}, {
                  isSchismatic: error.isSchismatic !== false,
                  isRevisable: error.isRevisable === true,
                  isReformable: error.isReformable === true,
                  isRefabricateable: error.isRefabricateable === true,
                  instigatorConnection: this,
                });
            if (op.options.discourse) {
              op.options.discourse.dispatchAndDefaultActEvent(errorEvent);
            }
            const progress = prophecy.meta.operation.getProgressEvent();
            if (op.renarration) {
              progress.proceedAfterAll(op.renarration);
            }
            if (progress.isSchismatic !== false) {
              if (op.initialSchism === undefined) op.initialSchism = op.events[index];
              progress.type = "schism";
              progress.schismaticCommand = op.events[index];
              progress.message = `a ${
                progress.isRevisable ? "reviseable"
                : progress.isReformable ? "reformable"
                : progress.isRefabricateable ? "refabricateable"
                : "heretic"
              } schism resulting from proclaimEvents error: ${error.message}`;
            }
          }
          // Process the remaining entries so that fully
          // rejected commands will not be needlessly revised
          return mapEagerly(entries, callback, onRejected, index + 1, truthResults);
        }),
    ];
  }

  _awaitPossibleRenarration (op, truthResults) {
    if (!op.leadingTruths) op.leadingTruths = truthResults;
    return [op, op.renarration];
  }

  _receiveTruthsLocally (op, renarratedEvents = []) {
    let receivableTruths = (!op.leadingTruths.length && !renarratedEvents.length) ? []
        : !op.leadingTruths.length ? renarratedEvents
        : !renarratedEvents.length && op.leadingTruths;
    if (!receivableTruths) {
      // TODO(iridian): Check that the truths -> narratedLog
      // log.index transition is monotonous
      receivableTruths = op.leadingTruths.concat(renarratedEvents);
    }
    if (!receivableTruths.length && op.renarration && this._unconfirmedCommands.length) {
      if (!op.reproclaimError) {
        op.reproclaimError = new Error();
        op.reproclaimError.headIndex = op.events[0].aspects.log.index;
      }
      throw op.reproclaimError;
    }
    return [
      op,
      op.receiveTruths && (receivableTruths.length || op.initialSchism) && op.receiveTruths(
          receivableTruths, undefined, undefined, op.initialSchism, (op.plog || {}).chain),
    ];
  }

  _finalizeProclaimResults (op) {
    return (op.resultBase._truthForwardResults = !op.reproclaimError
        ? op.upstreamResults
        : op.upstreamResults.slice(
            op.reproclaimError.headIndex - op.upstreamResults[0].aspects.log.index));
  }

  receiveTruths (truths: EventBase[], unused1, unused2, schismaticCommand: EventBase, parentPlog) {
    let schismaticCommands, confirmCount = 0, confirmations, newTruthCount = 0, newTruths;
    try {
      const plog2 = this.opLog(2, parentPlog, "receive_truths");
      plog2 && plog2.opEvent("",
          `receiveTruths(${this._dumpEventIds(truths)},${this._dumpEventIds(schismaticCommand)})`,
          { truths, schismaticCommand });
      this._insertEventsToQueue(truths, this._pendingTruths, false,
          (truth, queueIndex, existingTruth) => {
            this.errorEvent(
                `receiveTruths aspects.command.id mismatch with existing truth, expected '${
                existingTruth.aspects.command.id}', got incoming truth with: '${
                truth.aspects.command.id}'`,
                "\n\tresolution: overwriting with incoming truth");
          });
      for (; this._unconfirmedCommands[confirmCount] && this._pendingTruths[confirmCount];
          ++confirmCount) {
        if (this._pendingTruths[confirmCount].aspects.command.id !==
            this._unconfirmedCommands[confirmCount].aspects.command.id) {
          schismaticCommands = this._unconfirmedCommands.slice(confirmCount);
          this._unconfirmedCommands = [];
          break;
        }
      }
      if (confirmCount) {
        confirmations = this._pendingTruths.splice(0, confirmCount);
        this._latestTruth = confirmations[confirmations.length - 1];
        if (!schismaticCommands) this._unconfirmedCommands.splice(0, confirmCount);
        // purge clears all unconfirmed commands
      }
      if (!schismaticCommands && schismaticCommand) {
        let index = this._unconfirmedCommands.indexOf(schismaticCommand);
        if (index < 0) {
          const schismaticCommandId = schismaticCommand.aspects.command.id;
          index = this._unconfirmedCommands.findIndex(unconfirmed =>
              (((unconfirmed || {}).aspects || {}).command || {}).id === schismaticCommandId);
        }
        if (index < 0) {
          this.errorEvent("incoming schismatic command not in unconfirmed queue of", this.debugId(),
              "\n\tschismaticCommand.aspects:", JSON.stringify(schismaticCommand.aspects, null, 2),
              "\n\tschismaticCommand:", JSON.stringify(schismaticCommand),
              "\n\tunconfirmed:", this._unconfirmedCommands.map(
                  unconfirmed => ({ aspects: JSON.stringify(unconfirmed.aspects) })));
        } else {
          schismaticCommands = this._unconfirmedCommands.splice(index);
        }
      }
      while (this._pendingTruths[newTruthCount]) ++newTruthCount;
      if (!this._headEventId) {
        this._referencePrototype.setAbsent(false);
      }
      this._headEventId += confirmCount + newTruthCount;
      newTruths = this._pendingTruths.splice(0, newTruthCount);
      const latestTruth = this._latestTruth;
      if (newTruthCount) this._latestTruth = newTruths[newTruths.length - 1];
      if (confirmations) {
        _confirmRecitalStories(this, confirmations);
        if (!newTruthCount && !(schismaticCommands || []).length) {
          this._checkForFreezeAndNotify(plog2);
          _confirmLeadingTruthsToFollowers(this.getFalseProphet());
          return truths;
        }
      }
      /*
      this.logEvent(1, () => ["receiveTruths.confirm&purge",
        "\n\tconfirmedCommands:", ...dumpObject(confirmedCommands),
        "\n\tschismaticCommands:", ...dumpObject(schismaticCommands),
        "\n\tnewTruths:", ...dumpObject(newTruths)
      ]);
      */
      _elaborateRecital(this, newTruths, "receive_truth", schismaticCommands, latestTruth);
      return truths;
    } catch (error) {
      throw this.wrapErrorEvent(error, 1, `receiveTruths(${this._dumpEventIds(truths)})`,
          "\n\treceived truths:", ...dumpObject(truths),
          "\n\tpendingTruths:", ...dumpObject([...this._pendingTruths]),
          "\n\tunconfirmedCommands:", ...dumpObject([...this._unconfirmedCommands]),
          "\n\tinternal:", ...dumpObject({
            this: this, schismaticCommands, confirmCount, confirmations, newTruthCount, newTruths,
          }),
      );
    }
  }

  receiveCommands (commands: EventBase[]) {
    // This is not called by chronicle, but either by command recall on
    // startup or to update a conflicting command read from another tab.
    let schismaticCommands;
    try {
      const plog2 = this.opLog(2, "receive_commands");
      plog2 && plog2.opEvent("",
          `receiveTruths(${commands.length})`, { commands });
      const newCommands = this._insertEventsToQueue(commands, this._unconfirmedCommands, true,
          (command, queueIndex) => {
            schismaticCommands = this._unconfirmedCommands.splice(queueIndex);
          });
      _elaborateRecital(this, newCommands || [], "receive_command", schismaticCommands);
      return commands;
    } catch (error) {
      throw this.wrapErrorEvent(error, 1, `receiveCommand(${this._dumpEventIds(commands)})`,
          "\n\treceived commands:", ...dumpObject(commands),
          "\n\tpendingTruths:", ...dumpObject([...this._pendingTruths]),
          "\n\tunconfirmedCommands:", ...dumpObject([...this._unconfirmedCommands]),
          "\n\tthis:", ...dumpObject(this),
      );
    }
  }

  _insertEventsToQueue (events: EventBase[], targetQueue: EventBase[], isCommand: boolean,
      onMismatch: Function) {
    for (let index = 0; index !== events.length; ++index) {
      const event = events[index];
      const queueIndex = !event ? -1 : (event.aspects.log.index - this._headEventId);
      try {
        if (queueIndex < 0) continue;
        if (isCommand && queueIndex && !targetQueue[queueIndex - 1]) {
          // TODO(iridian): non-continuousity support can be added in principle.
          // But maybe it makes sense to put this functionality to scribe? Or to Oracle?
          throw new Error(`Non-continuous aspects.log.index ${event.aspects.log.index
              } detected when inserting commands to queue`);
        }
        const existingEvent = targetQueue[queueIndex];
        if (existingEvent) {
          if (event.aspects.command.id === existingEvent.aspects.command.id) continue;
          onMismatch(event, queueIndex, existingEvent);
        }
        if (isCommand) {
          const newCommands = events.slice(index);
          targetQueue.push(...newCommands);
          return newCommands;
        }
        targetQueue[queueIndex] = event;
      } catch (error) {
        throw this.wrapErrorEvent(error, 2, isCommand
                ? `_insertUnconfirmedCommandsToQueue().events[${index}]`
                : `_insertPendingTruthsToQueue().events[${index}]`,
            "\n\tevents:", ...dumpObject(events),
            `\n\tevents[${index}]:`, ...dumpObject(events[index]),
            "\n\ttargetQueue:", ...dumpObject(targetQueue),
            "\n\tqueueIndex:", queueIndex,
            "\n\tthis:", ...dumpObject(this));
      }
    }
    return undefined;
  }

  createCommandChronicleInfo (/* action: Object, command: Command , bard: Bard */) {
    if (this._isFrozen) {
      throw new Error(
          `Cannot chronicle a command to frozen chronicle: <${this.getChronicleURI()}>`);
    }
    return {};
  }

  _checkForFreezeAndNotify (plog, newEvents: ?EventBase[]) {
    const lastEvent = this._unconfirmedCommands[this._unconfirmedCommands.length - 1]
        || (newEvents && newEvents[newEvents.length - 1]);
    plog && plog.v2 && plog.opEvent(this, "update-post-conditions",
        `_checkForFreezeAndNotify(${this._unconfirmedCommands.length})`,
        { lastEvent, unconfirmedCommands: this._unconfirmedCommands });
    if (!this.isFrozenConnection()
        && ((lastEvent && isFrozenLike(lastEvent)) || this.isInvalidated())) {
      this._sealChronicleIfRequired(newEvents, lastEvent);
      this.setIsFrozen();
    }
    this.getFalseProphet().setConnectionCommandCount(
        this.getChronicleURI(), this._unconfirmedCommands.length);
  }

  _sealChronicleIfRequired (newEvents, lastEvent) {
    if ((lastEvent || {}).type === "SEALED") return;
    let invalidation = this.isInvalidated();
    if (!invalidation) {
      for (let i = 0; i !== (newEvents || []).length; ++i) {
        if (newEvents[i].type === "INVALIDATED") {
          invalidation = [newEvents[i].invalidationReason, newEvents[i].invalidEvent];
          break;
        }
      }
    }
    if (!invalidation) return;
    const state = this._parent.getState();
    Promise.resolve([...invalidation])
    .then(([invalidationReason, invalidatedEvent]) => {
      this.errorEvent("INVALIDATED event encountered on a non-SEALED chronicle; proclaiming SEALED",
          "\n\tinvalidationReason:", invalidationReason,
          "\n\tinvalidatedEvent:", ...dumpObject(invalidatedEvent));
      return this.proclaimEvents([
            sealed({
              actions: [],
              invalidAntecedentIndex: invalidatedEvent.aspects.log.index,
              invalidationReason,
              frozenPartitions: [this.getChronicleId()], // deprecated
              aspects: { command: { id: "" } },
            }),
          ],
          { isProphecy: true, prophecy: { state, previousState: state } });
    })
    .catch(error => {
      if (!error.message.match(/No public identity found/)) {
        this.outputErrorEvent(error, 0, "Exception caught during SEALED proclamation");
      }
    });
  }

  _reviewRecomposedSchism (purged: Prophecy, newProphecy: Prophecy) {
    try {
      return _reviewRecomposedSchism(this, purged, newProphecy);
    } catch (error) {
      throw this.wrapErrorEvent(error, 2,
          new Error(`_reviewRecomposedSchism(${tryAspect(purged, "command").id} -> ${
              tryAspect(newProphecy, "command").id})`),
          "\n\tpurged prophecy:", ...dumpObject(purged),
          "\n\tnew prophecy:", ...dumpObject(newProphecy));
    }
  }
}
