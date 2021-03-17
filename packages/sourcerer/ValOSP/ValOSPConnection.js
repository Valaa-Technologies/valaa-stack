// @flow

import type { EventBase } from "~/raem";
import { AuthorityConnection } from "~/sourcerer";
import type {
  ProclaimOptions, SourceryOptions, EventCallback, EventData, MediaInfo, NarrateOptions,
} from "~/sourcerer";

import { dumpObject, thenChainEagerly } from "~/tools";

type CommandResponse = { chronicleId: string, eventId: number, event: Object }
type EventEnvelope = { chronicleId: string, eventId: number, event: EventData }

export const proclaimFailureFlags = {
  unconnected: { isSchismatic: false, proceed: { when: "connected" } },

  // Information responses
  // Ignore the response
  section100: { isSchismatic: false },

  // Successful responses
  // Non-schismatic, persisted truth by default
  section200: { isSchismatic: false, isPersisted: true, isTruth: true },
  // chronicle request was successfully persisted but not confirmed as truth
  202: { isTruth: false },

  // Redirection messages
  // Not implemented.
  section300: {
    isSchismatic: true, isRevisable: false, isReformable: false, isRefabricateable: false,
  },

  // Client error responses
  section400: {
    isSchismatic: true, isRevisable: false, isReformable: false, isRefabricateable: false,
  },
  // bad request, gateway can't recover
  400: { proceed: { when: "narrated" } },
  // not authenticated
  401: { isSchismatic: false, proceed: { when: "authenticated" } },
  // not authorized, gateway can't recover
  403: {},
  // method not available, slim chance of recovery by hammering
  404: { isRevisable: true, proceed: { when: "staggered", times: 3, backoff: 10000 } },
  // method not allowed, gateway can't recover
  405: {},
  // log index conflict
  409: { isRevisable: true, proceed: { when: "narrated" } },
  // precondition not met
  412: { isReformable: true },

  // Server error responses
  // Limited retries
  section500: {
    isSchismatic: true, isRevisable: false,
    // proceed: { when: "staggered", times: 3, backoff: 1000 },
  }
};

export default class ValOSPConnection extends AuthorityConnection {
  _config: Object;
  _lastEventId = 0;
  _firstPendingDownstreamLogIndex = undefined;
  _pendingDownstreamEvents = [];
  _eventsAPI: Object;

  constructor (options: Object) {
    super(options);
    if (!this._pushTruthsDownstream) {
      this.warnEvent(0, "ValOSPConnection created without a pushTruths callback.");
      this._pushTruthsDownstream = (events: Object[]) => {
        this.warnEvent(0, "Events received to a no-op _pushTruthsDownstream",
            "\n\tevents:", ...dumpObject(events));
      };
    }
  }

  isConnected () {
    return this._isConnected;
  }

  setConnected (value = true) {
    this._isConnected = value;
    if (!value) this._eventSubscription = null;
  }

  disconnect () {
    if (this._eventSubscription) this._eventSubscription.unsubscribe();
    this._isConnected = false;
    super.disconnect();
  }

  static sourceryOpsName = "valospSourcery";
  static valospSourcery = [
    ValOSPConnection.prototype._finalizeAuthorityConfig,
    ValOSPConnection.prototype._sourcerUpstream,
    AuthorityConnection.prototype._narrateEventLog,
    AuthorityConnection.prototype._finalizeSourcery,
  ];

  _finalizeAuthorityConfig (options: SourceryOptions) {
    return [options, this.getSourcerer().getAuthorityConfig()];
  }

  _sourcerUpstream (options: SourceryOptions = {}, authorityConfig) {
    if (!authorityConfig) {
      throw new Error(`Cannot sourcer from unavailable authority ${
          this.getSourcerer().getAuthorityURI()}`);
    }
    this._config = authorityConfig;
    if (options.newChronicle) {
      this._firstPendingDownstreamLogIndex = 0;
    }
    if (options.narrateOptions !== false) {
      (options.narrateOptions || (options.narrateOptions = {})).isConnecting = true;
    }
    return super._sourcerUpstream(options);
  }

  // Fetches recent events from upstream chronicle and delivers them to
  // the EventEnvelope unpacker, then ultimately as Events to the
  // callback funcion.
  // Returns count of events.
  // Callback can also be overriden, if you need to get the events
  // (EventEnvelopes) directly for some reason. In that case the events
  // will be delivered directly and any internal processing
  // of the envelopes skipped.
  async narrateEventLog (options: NarrateOptions) {
    const config = this._config || (await this.getSourcerer().getAuthorityConfig());
    if (!config) {
      throw new Error(`Cannot narrate from unavailable authority ${
          this.getSourcerer().getAuthorityURI()}`);
    }
    let { // eslint-disable-next-line
      receiveTruths, eventIdBegin, isConnecting, subscribeEvents, remote, identity,
      /* , lastEventId, noSnapshots */
    } = options || {};
    let nextChunkIndex = 0;
    /* eslint-disable no-loop-func */
    try {
      if (!config.isRemoteAuthority) {
        return super.narrateEventLog(options);
      }
      if (!isConnecting && !this.isActive()) await this.sourcer({ narrateOptions: false });
      if (subscribeEvents === true) await this._subscribeToEventMessages(true);
      if ((subscribeEvents === false) && this.isConnected()) await this.disconnect();
      if (eventIdBegin === undefined) eventIdBegin = 0;
      if (this._firstPendingDownstreamLogIndex !== eventIdBegin) {
        this._firstPendingDownstreamLogIndex = eventIdBegin;
        this._pendingDownstreamEvents = [];
      }

      // fetches the events
      const ret = {};
      if (remote === false) return ret;

      const identities = this._createIdentities(identity);
      let delayedEnvelopes = [];
      for (;;) {
        let remoteNarrateProcess;
        if (eventIdBegin !== undefined) {
          remoteNarrateProcess = this._eventsAPI
              .narrateRemoteEventLog(this, eventIdBegin, undefined, identities);
        }

        if (delayedEnvelopes.length) {
          this._integrateReceivedEvents(delayedEnvelopes, "paginated narrate");
          ret[`remoteLogChunk${nextChunkIndex++}`] =
              this._pushAllLeadingEventsDownstream(receiveTruths);
          delayedEnvelopes = undefined;
          if (!remoteNarrateProcess) break; // This was the last chunk of a paginated narration.
        }

        const responseJSON = await remoteNarrateProcess;
        this.logEvent(2, () => ["\tGET success onwards from:", eventIdBegin]);

        delayedEnvelopes = responseJSON.Items || [];
        if (responseJSON.LastEvaluatedKey !== undefined) {
          // The result has been paginated, need to fetch more
          this.logEvent(3, () => [
            "Fetching more, last event was:", responseJSON.LastEvaluatedKey.eventId,
          ]);
          const nextEventIdBegin = responseJSON.LastEvaluatedKey.eventId + 1;
          if (nextEventIdBegin === eventIdBegin) {
            this.errorEvent("INTERNAL ERROR: pagination repeats event index:", eventIdBegin);
            throw new Error("Paginated event narration is repeating the same query.");
          }
          eventIdBegin = nextEventIdBegin;
        } else if (nextChunkIndex) {
          // Last chunk of a paginated narration. Loop once more
          // without fetching to receive the last events.
          eventIdBegin = undefined;
        } else {
           // Single-chunk request, receive and break.
          ret.remoteLog = [];
          if (delayedEnvelopes.length) {
            this._integrateReceivedEvents(delayedEnvelopes, "single-chunk narrate");
            ret.remoteLog = this._pushAllLeadingEventsDownstream(receiveTruths);
          }
          break;
        }
      }
      for (const [key, value] of Object.entries(ret)) {
        ret[key] = await value;
        if (!(ret[key] || []).length) delete ret[key];
      }
      return ret;
    } catch (error) {
      this.warnEvent(2, () => [
        "\tGET FAILURE:", (error.response || {}).status || error.message,
      ]);
      throw this.wrapErrorEvent(error,  new Error("narrateEventLog()"),
          "\n\tnextChunkIndex:", nextChunkIndex,
          "\n\teventIdBegin:", eventIdBegin,
          "\n\terror response:", error.response);
    }
  }

  // Sends a given command within a command envelope to the API endpoint
  proclaimEvents (events: EventBase[], options: ProclaimOptions = {}) {
    return thenChainEagerly(this.asSourceredConnection(), [
      () => this._config || this.getSourcerer().getAuthorityConfig(),
      config => {
        if (!config) {
          throw new Error(
              `Cannot proclaim to unavailable authority ${this.getSourcerer().getAuthorityURI()}`);
        }
        if (!config.isRemoteAuthority) {
          throw new Error(`Can't proclaim events to a non-remote chronicle.`);
        }
        if (config.rejectChronicleUpstream) {
          throw new Error(`Won't proclaim events due to authorityConfig.rejectChronicleEvents: ${
            config.rejectChronicleUpstream}`);
        }
        const identities = this._createIdentities(options.identity);
        return super.proclaimEvents(events, {
          ...options,
          remoteEventsProcess: this._enqueueUpstreamEvents(events, identities),
        });
      },
    ], function errorOnProclaimEvents (error) {
      throw this.wrapErrorEvent(error, new Error("proclaimEvents"));
    }.bind(this));
  }

  _createIdentities (identity: Object) {
    const ret = [];
    ((identity && identity.list()) || []).forEach(identityChronicleURI => {
      const candidate = identity.get(identityChronicleURI);
      if (candidate.authority === this.getSourcerer()) {
        const identityConfig = { ...candidate };
        delete identityConfig.authority;
        ret.push([identityChronicleURI, identityConfig]);
      }
    });
    return ret;
  }

  requestMediaContents (mediaInfos: MediaInfo[]): any {
    return this.getSourcerer()
        .getStorage()
        .downloadBvobContents(mediaInfos);
  }

  prepareBvob (content: ArrayBuffer | () => Promise<ArrayBuffer>, mediaInfo?: MediaInfo):
      { contentHash: string, persistProcess: string | ?Promise<string> } {
    const whileTrying = (mediaInfo && (typeof mediaInfo.name !== "string"))
        ? `while trying to prepare media '${mediaInfo.name}' content for persist`
        : "while trying to prepare unnamed media content for persist";
    try {
      if (!mediaInfo) throw new Error(`mediaInfo missing ${whileTrying}`);
      if (!mediaInfo.contentHash) {
        throw new Error(`mediaInfo.contentHash missing ${whileTrying}`);
      }
      return {
        contentHash: mediaInfo.contentHash,
        persistProcess: this.getSourcerer()
            .getStorage()
            .uploadBvobContent(content, mediaInfo),
      };
    } catch (error) {
      throw this.wrapErrorEvent(error, `prepareBvob(${whileTrying})`,
          "\n\tcontent:", ...dumpObject(content),
          "\n\tmediaInfo:", mediaInfo,
      );
    }
  }

  // Upstream events section

  _pendingProclaimCommands: Object[] = [];

  async _enqueueUpstreamEvents (events: Object[], identities: Object[]) {
    let responseJSON: Array<CommandResponse>;
    /* eslint-disable no-loop-func */
    try {
      const fixedResponse = this._config.blockChronicleUpstream
          ? { status: 100 }
          : this._config.fixedChronicleResponse;
      if (fixedResponse) {
        this.warnEvent(1, () => [
          `Blocking events #${queueEntry.envelope.command.aspects.log.index} with fixed response:`,
          fixedResponse,
        ]);
        const error = new Error(
            `valosp authority configuration fixed response: ${JSON.stringify(fixedResponse)}`);
        error.response = { ...fixedResponse };
        throw error;
      }
      const response = await this._eventsAPI
          .proclaimRemoteCommands(this, events, identities);
      this.logEvent(2, () => [
        `\tPUT command #${queueEntry.envelope.command.aspects.log.index} success`,
      ]);
      return ret;
    } catch (error) {
      const index = this._pendingProclaimCommands.indexOf(queueEntry);
      if ((index >= 0) && (index < this._pendingProclaimCommands.length)) {
        this._pendingProclaimCommands.length = index;
      }
      const actualError = (error instanceof Error) ? error : new Error(error.response);
      this._embedResolutionFlagsFromHTTPResponse(actualError, error.response, proclaimFailureFlags);
      if (actualError.isTruth) {
        return {};
      }
      this.warnEvent(1, () => [
        `\tPUT command #${queueEntry.envelope.command.aspects.log.index} FAILURE:`, actualError,
      ]);
      throw this.wrapErrorEvent(actualError, `persistCommandEnvelope`,
          "\n\tqueueEntry:", ...dumpObject(queueEntry),
          "\n\tenvelope:", ...dumpObject(queueEntry.envelope),
          "\n\tcommand:", ...dumpObject(queueEntry.envelope.command),
          "\n\tresponseJSON:", ...dumpObject(responseJSON),
          "\n\terror status:", ...dumpObject(error.status),
          "\n\terror response:", error.response,
      );
    }
  }

  _embedResolutionFlagsFromHTTPResponse (error, response, resolutionFlagLookup) {
    let status = (response || {}).status;
    if (!status) return;
    if (typeof status === "string") status = parseInt(status, 10);
    if (typeof status !== "number" || isNaN(status)) status = "unconnected";
    const resolutionFlags = Object.assign({},
        ((typeof status === "number")
            && resolutionFlagLookup[`section${Math.floor(status / 100)}00`]) || {},
        resolutionFlagLookup[status] || {});
    Object.assign(error, resolutionFlags);
  }

  // Downstream events section

  // subscribe to topics, and set up the callbacks for receiving events
  _subscribeToEventMessages (require) {
    if (this._config.subscribeEvents === false) {
      return undefined;
    }
    if (require && !this._config.isRemoteAuthority) {
      throw new Error(`Can't subscribe for events on a non-remote chronicle connection.`);
    }
    return (async () => (this._eventSubscription = await this._eventsAPI
        .subscribeToEventMessages(this)))();
  }

  // return value: accepted or not (note: not accepted can be normal operation)
  receiveEventMessage (message: string) {
    this.logEvent(2, () => ["Received event message:", { message }]);
    this._integrateReceivedEvents(
        [].concat((typeof message !== "string" ? message : JSON.parse(message)) || []),
        "received push event");
    const downstreamFlushing = this._pushAllLeadingEventsDownstream();
    if (downstreamFlushing) {
      thenChainEagerly(downstreamFlushing, [], e =>
          this.outputErrorEvent(e, "Exception caught during push event downstream flush"));
      if (!this._pendingDownstreamEvents.length) {
        // Received events; all of them were handled. No renarration necessary.
        return;
      }
    }
    this._renarrateMissingEvents();
  }

  // return value: accepted or not (note: not accepted can be normal operation)
  _integrateReceivedEvents (events: EventEnvelope[]) {
    for (const event of events) {
      if (event == null) continue;
      const eventIndex = event.eventId;
      if (eventIndex === undefined) {
        this.warnEvent(1, `Ignoring an incoming event which is missing eventIndex:`,
            ...dumpObject(event));
        continue;
      }
      const pendingIndex = eventIndex - this._firstPendingDownstreamLogIndex;
      const duplicateReason = !(pendingIndex >= 0) ? "already narrated"
          : (this._pendingDownstreamEvents[pendingIndex] !== undefined) ? "already pending in queue"
          : undefined;
      if (!duplicateReason) {
        this._pendingDownstreamEvents[pendingIndex] = event;
      } else {
        this.warnEvent(1, () => [
          `Ignoring an event with index ${eventIndex}: ${duplicateReason}.`,
          ...dumpObject(event),
        ]);
      }
    }
  }

  _pushAllLeadingEventsDownstream (pushTruths: EventCallback = this._pushTruthsDownstream) {
    let count = 0;
    while (this._pendingDownstreamEvents[count]) ++count;
    if (!count) return false;
    const truths = this._pendingDownstreamEvents.splice(0, count);
    this._firstPendingDownstreamLogIndex += count;
    return pushTruths(truths);
  }

  _renarrateMissingEvents () {
    if (!this._config.isRemoteAuthority || this._missingEventsRenarration) {
      return;
    }
    const narrateOptions = { eventIdBegin: this._firstPendingDownstreamLogIndex };
    const firstNonMissingIndex = this._pendingDownstreamEvents.findIndex(v => (v != null));
    if (firstNonMissingIndex > 0) {
      narrateOptions.eventIdEnd = this._firstPendingDownstreamLogIndex + firstNonMissingIndex;
    }
    const renarration = this._missingEventsRenarration = this
        .narrateEventLog(narrateOptions)
        .finally(() => {
          if (this._missingEventsRenarration === renarration) {
            this._missingEventsRenarration = undefined;
          }
        })
        .then(result => Object.keys(result).length
            && this._renarrateMissingEvents())
        .catch(error =>
            this.outputErrorEvent(error, "Exception caught during renarrateMissingQueueEvents"));
  }
}
