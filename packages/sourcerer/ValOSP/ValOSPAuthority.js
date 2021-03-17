// @flow

import { Authority } from "~/sourcerer";
import type { Sourcerer } from "~/sourcerer/api/Sourcerer";

import { thenChainEagerly } from "~/tools";

import ValOSPConnection from "./ValOSPConnection";
import ValOSPRemoteEventsAPI from "./ValOSPRemoteEventsAPI";
import ValOSPRemoteStorageAPI from "./ValOSPRemoteStorageAPI";

type AuthorityConfig = {}

export default class ValOSPAuthority extends Authority {
  static ConnectionType = ValOSPConnection;
  static RemoteEventsAPIType = ValOSPRemoteEventsAPI;
  static RemoteStorageAPIType = ValOSPRemoteStorageAPI;

  _eventsAPI: ValOSPRemoteEventsAPI;
  _storageAPI: ValOSPRemoteStorageAPI;

  constructor (options:
      { name: string, upstream: Sourcerer, authorityConfig: AuthorityConfig, parent: Object }) {
    super({ upstream: null, ...options });
    this._authorityConfig = thenChainEagerly(options.authorityConfig, [
      authorityConfig => {
        this._authorityConfig = authorityConfig;
        return ((authorityConfig || {}).isRemoteAuthority)
            && this._initializeRemoteComponents(authorityConfig);
      },
      () => this._authorityConfig,
    ]);
  }

  getAuthorityConfig () { return this._authorityConfig; }

  getEventsAPI () { return this._eventsAPI; }
  getStorage () { return this._storageAPI; }

  _initializeRemoteComponents (authorityConfig) {
    this._eventsAPI = new this.constructor.RemoteEventsAPIType(this, authorityConfig);
    this._storageAPI = new this.constructor.RemoteStorageAPIType(this, authorityConfig);
  }
}
