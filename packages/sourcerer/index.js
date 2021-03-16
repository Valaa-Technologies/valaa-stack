// @flow

/* eslint-disable */

import ContentAPI from "./SourcererContentAPI";
import schemeModules from "./schemeModules";

export const valosheath = require("~/gateway-api/valosheath").default;

export default valosheath.exportSpindle({ name: "@valos/sourcerer", ContentAPI, schemeModules });

export {
                           default as SOURCERER_EVENT_VERSION,
} from "./tools/event-version-0.2/EVENT_VERSION";
export {
                           default as FUTURE_EVENT_VERSION,
} from "./tools/event-version-0.3/EVENT_VERSION";

export {
                                      ContentAPI,
                        ContentAPI as EngineContentAPI,
};
export {                   default as Discourse } from "./api/Discourse";
export {                   default as Follower } from "./api/Follower";
export {                   default as Connection } from "./api/Connection";
export {                   default as Sourcerer } from "./api/Sourcerer";
export                           type Transactor = Object;

export {
                           default as FalseProphet,
                                      deserializeVRL,
} from "./FalseProphet";
export {
                           default as FalseProphetDiscourse
} from "./FalseProphet/FalseProphetDiscourse";

export {                   default as Oracle } from "./Oracle";
export {                   default as DecoderArray } from "./Oracle/DecoderArray";

export {                   default as Scribe } from "./Scribe";

export {                   default as Authority } from "./Authority";
export {
                           default as AuthorityConnection,
                                      AuthorityEventResult,
} from "./Authority/AuthorityConnection";
export {                   default as AuthorityNexus } from "./Authority/AuthorityNexus";
export type {
                                      AuthorityConfig,
                                      AuthorityOptions,
                                      SchemeModule,
} from "./AuthorityNexus";
