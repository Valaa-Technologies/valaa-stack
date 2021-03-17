// @flow

import { FabricEventTarget, fetchJSON } from "@valos/tools";

export default class ValOSPRemoteEventsAPI extends FabricEventTarget {
  _authorityConfig: Object;

  constructor (authority, authorityConfig) {
    super(authority, undefined, authorityConfig.name);
    this._authorityConfig = authorityConfig;
  }

  isConnected () {
    // Push event subscription not specified and thus not implemented
    return false;
  }

  narrateRemoteEventLog (connection, startIndex, endIndex, identities) {
    const narrateRoute = `${this._authorityConfig.endpoint
        }/${connection.getChronicleId()}/${startIndex}/${endIndex}`;
    this.logEvent(2, () => [
      `GET events from chronicle ${connection.getName()} via <${narrateRoute}>`,
    ]);
    return fetchJSON(narrateRoute, {
      method: "GET", mode: "cors",
    });
  }

  proclaimRemoteCommands (connection, startIndex, endIndex, commands, identities) {
    const proclaimRoute = `${this._authorityConfig.endpoint
        }/${connection.getChronicleId()}/${startIndex}/${endIndex}`;
    this.logEvent(2, () => [
      `PUT command to chronicle ${connection.getName()} via <${proclaimRoute}>`,
    ]);
    return fetchJSON(proclaimRoute, {
      method: "PUT", mode: "cors",
      headers: { "Content-Type": "application/json" },
      body: commands,
    });
  }

  subscribeToEventMessages (/* connection */) {
    return undefined;
  }
}
