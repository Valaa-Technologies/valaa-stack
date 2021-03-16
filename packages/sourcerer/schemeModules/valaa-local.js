// @flow

import { Authority, SOURCERER_EVENT_VERSION } from "~/sourcerer";
import type { SchemeModule } from "~/sourcerer";

export default function createValaaLocalScheme (/* { parent } */): SchemeModule {
  return {
    scheme: "valaa-local",

    getAuthorityURIFromChronicleURI: () => `valaa-local:`,

    obtainAuthorityConfig: (/* chronicleURI: string, authorityPreConfig: Object */) => ({
      eventVersion: SOURCERER_EVENT_VERSION,
      isLocallyRecorded: true,
      isPrimaryAuthority: true,
      isRemoteAuthority: false,
    }),

    createAuthority: (options: Object) => new Authority(options),
  };
}
