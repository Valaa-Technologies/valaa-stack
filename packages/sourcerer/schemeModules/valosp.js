// @flow

import { EventBase } from "~/raem/events";

import { Authority, AuthorityConnection, FUTURE_EVENT_VERSION } from "~/sourcerer";
import type { AuthorityConfig, AuthorityOptions, Sourcerer } from "~/sourcerer";
import { Proclamation, ProclaimOptions, ProclaimEventResult, MediaInfo, NarrateOptions }
    from "~/sourcerer/api/types";

import ValOSPAuthority from "~/sourcerer/ValOSP/ValOSPAuthority";

import { dumpObject, thenChainEagerly, fetchJSON } from "~/tools";
import { naiveURI } from "~/raem";
import type { ValaaURI } from "~/raem/ValaaURI";

export default function createValOSProtocolScheme ({ parent } = {}) {
  return {
    scheme: "valosp",

    getAuthorityURIFromChronicleURI (chronicleURI: string) {
      const parts = chronicleURI.match(naiveURI.regex);
      return `valosp://${parts[naiveURI.hostPart] || ""}${parts[naiveURI.pathPart] || ""}`;
    },

    obtainAuthorityConfig (authorityURI: ValaaURI, maybePreConfig: ?AuthorityConfig):
        AuthorityConfig {
      const httpsEndpointBase = `https${authorityURI.slice(6)}`;
      return thenChainEagerly(
          maybePreConfig || fetchJSON(
              `${httpsEndpointBase}/authorityConfig`,
              { method: "GET", mode: "cors" }),
          preConfig => {
            if (!preConfig) return null;
            const ret = {
              // valosp will start from 0.3 by default
              eventVersion: FUTURE_EVENT_VERSION,
              isLocallyRecorded: true,
              isPrimaryAuthority: true,
              isRemoteAuthority: true,
              ...preConfig,
            };
            if (ret.isRemoteAuthority && !ret.endpoint) {
              ret.endpoint = httpsEndpointBase;
            }
            return ret;
          },
          error => {
            console.log(
                "Error while fetching authorityConfig for", authorityURI, ":", { error });
            return null;
          });
    },

    createAuthority (options: AuthorityOptions): Sourcerer {
      const name = options.authorityConfig.name;
      if (options.nexus) {
        options.nexus.logEvent(
            `Connecting to authority "${name}" at <${options.authorityURI}>`);
      }
      const ret = new ValOSPAuthority({ name, parent, ...options });
      ret.logEvent(1, `Connected to authority "${name}" at <${options.authorityURI}>`);
      return ret;
    }
  };
}

export class TestConnection extends AuthorityConnection {
  _pendingNarrations = {};
  _preparations = {};
  _proclamations = [];

  // Test writer API

  addNarrateResults ({ eventIdBegin }, events) {
    const narration = this._pendingNarrations[eventIdBegin]
        || (this._pendingNarrations[eventIdBegin] = {});
    if (narration.resultEvents) {
      const error = new Error(`narration result events already exist for ${eventIdBegin}`);
      throw this.wrapErrorEvent(error, 1,
          new Error("addNarrateResults"));
    }
    narration.resultEvents = events;
    this._tryFulfillNarration(narration);
  }

  getNarration (eventIdBegin) {
    const ret = this._pendingNarrations[eventIdBegin];
    if (!ret) {
      throw new Error(`Cannot find an existing narration request beginning from "${eventIdBegin}"`);
    }
    return ret;
  }

  addPrepareBvobResult ({ contentHash }) {
    const preparation = this._preparations[contentHash] || (this._preparations[contentHash] = {});
    if (preparation.contentHash) {
      const error = new Error(`bvob preparation result already exists for ${contentHash}`);
      throw this.wrapErrorEvent(error, 1,
          new Error("addPrepareBvobResult"));
    }
    preparation.contentHash = contentHash;
    this._tryFulfillPreparation(preparation);
  }

  getPreparation (contentHash) {
    const ret = this._preparations[contentHash];
    if (!ret) throw new Error(`Cannot find an existing prepareBvob request for "${contentHash}"`);
    return ret;
  }

  // Connection implementation

  narrateEventLog (options: ?NarrateOptions = {}): Promise<any> {
    if (!this.isRemoteAuthority()) return super.narrateEventLog(options);
    if (!options.receiveTruths) throw new Error("Missing narrateEventLog:options.receiveTruths");
    const narration = this._pendingNarrations[options.eventIdBegin || 0]
        || (this._pendingNarrations[options.eventIdBegin || 0] = {});
    narration.options = options;
    return this._tryFulfillNarration(narration) || new Promise((resolve, reject) => {
      narration.resolve = resolve;
      narration.reject = reject;
    });
  }

  proclaimEvents (events: EventBase[], options: ProclaimOptions): Proclamation {
    if (!this.isRemoteAuthority()) return super.proclaimEvents(events, options);
    this._mostRecentChronicleOptions = options;
    const resultBase = new TestEventResult(this, options.verbosity);
    resultBase._events = events;
    resultBase.isPrimary = this.isPrimaryAuthority();
    const eventResults = events.map((event, index) => {
      const ret = Object.create(resultBase); ret.event = event; ret.index = index; return ret;
    });
    this._proclamations.push(...eventResults);
    return { eventResults };
  }

  prepareBvob (content: any, mediaInfo: MediaInfo): Object | Promise<Object> {
    if (!this.isRemoteAuthority()) return super.prepareBvob(content, mediaInfo);
    const contentHash = mediaInfo && mediaInfo.contentHash;
    if (!contentHash) throw new Error("mediaInfo.contentHash not defined");
    const preparation = this._preparations[contentHash] || (this._preparations[contentHash] = {});
    preparation.content = content;
    preparation.mediaInfo = mediaInfo;
    return {
      contentHash,
      persistProcess: this._tryFulfillPreparation(preparation) || new Promise((resolve, reject) => {
        preparation.resolve = resolve;
        preparation.reject = reject;
      }),
    };
  }

  // Detail

  _tryFulfillNarration (narration: Object) {
    if (!narration.options || !narration.resultEvents) return undefined;
    const ret = {};
    try {
      ret.testAuthorityTruths = !narration.resultEvents.length ? []
          : narration.options.receiveTruths(narration.resultEvents);
      if (narration.resolve) narration.resolve(ret);
      return ret;
    } catch (error) {
      const wrapped = this.wrapErrorEvent(error, 1, new Error("tryFulfillNarration()"),
          "\n\tnarration:", ...dumpObject(narration));
      if (!narration.reject) throw wrapped;
      narration.reject(wrapped);
    }
    return undefined;
  }

  _tryFulfillPreparation (preparation: Object) {
    if (!preparation.mediaInfo || !preparation.contentHash) return undefined;
    try {
      if (preparation.resolve) preparation.resolve(preparation.contentHash);
      return preparation.contentHash;
    } catch (error) {
      const wrapped = this.wrapErrorEvent(error, 1, new Error("_tryFulfillPreparation()"),
          "\n\tnarration:", ...dumpObject(preparation));
      if (!preparation.reject) throw wrapped;
      preparation.reject(wrapped);
    }
    return undefined;
  }
}

class TestEventResult extends ProclaimEventResult {
  getComposedEvent () { return undefined; }
  getRecordedEvent () { return undefined; }
  getTruthEvent () {
    if (!this.isPrimary) {
      return Promise.reject(new Error("Non-primary authority cannot chronicle events"));
    }
    return this.truthEventProcess
        || (this.truthEventProcess = new Promise((resolve, reject) => {
          this.resolveTruthEvent = resolve;
          this.rejectTruthEvent = reject;
        }));
  }
}

export class TestSourcerer extends Authority {
  static ConnectionType = TestConnection;

  addFollower (/* falseProphet */) {
    const connectors = {};
    return connectors;
  }

  obtainAuthorityOfChronicle (chronicleURI) {
    return chronicleURI.startsWith(this.getAuthorityURI()) && this;
  }
}
