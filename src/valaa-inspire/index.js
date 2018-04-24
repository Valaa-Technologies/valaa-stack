// @flow

// TODO(iridian): valaa-inspire entry is possibly not the appropriate place for babel-polyfill:
// at the moment it still is the top level entry point, but this might change.
import "babel-polyfill";
import injectTapEventPlugin from "react-tap-event-plugin";

import { getURIQueryField } from "~/valaa-core/tools/PartitionURI";

import InspireGateway from "~/valaa-inspire/InspireGateway";
import { combineRevelationsLazily } from "~/valaa-inspire/Revelation";

import revelationTemplate from "~/valaa-inspire/revelation.template";

import { exportValaaPlugin, getGlobal, Logger, LogEventGenerator, outputError }
    from "~/valaa-tools";

import * as mediaDecoders from "./mediaDecoders";

injectTapEventPlugin();

const logger = new Logger();

const Valaa = getGlobal().Valaa || (getGlobal().Valaa = {});

Valaa.getURIQueryField = getURIQueryField;

Valaa.createInspireGateway = function createInspireGateway (...revelations: any[]) {
  const gatewayPromise = Valaa.createGateway(...revelations);
  return new Promise(resolve =>
      document.addEventListener("DOMContentLoaded", () => { resolve(gatewayPromise); }));
};

export default (Valaa.createGateway = async function createGateway (...revelations: any) {
  let ret;
  let combinedRevelation;
  const delayedPlugins = [];
  try {
    exportValaaPlugin({ name: "valaa-inspire", mediaDecoders });
    if (Valaa.gateway) {
      throw new Error(`Valaa.gateway already exists (${
          Valaa.gateway.debugId()}). There can be only one.`);
    }

    const gatewayPluginsRevelation = { gateway: { plugins: Valaa.plugins } };
    Valaa.plugins = { push (plugin) { delayedPlugins.push(plugin); } };

    ret = new InspireGateway({ name: "Uninitialized InspireGateway", logger });
    ret.warnEvent(`Initializing in environment (${
        String(process.env.NODE_ENV)}) by combining`, ...revelations, gatewayPluginsRevelation);

    combinedRevelation = await combineRevelationsLazily(
        ret,
        revelationTemplate,
        ...revelations,
        gatewayPluginsRevelation);
    ret.warnEvent(`  revelation combined as`, combinedRevelation);

    await ret.initialize(combinedRevelation);
    Valaa.gateway = ret;
    ret.warnEvent(`InspireGateway set to window.Valaa.gateway as`, ret);

    while (delayedPlugins.length) await ret.attachPlugin(delayedPlugins.shift());
    Valaa.plugins = { push (plugin) { ret.attachPlugin(plugin); } };

    return ret;
  } catch (error) {
    outputError((ret || new LogEventGenerator(logger)).wrapErrorEvent(error,
        `createInspireGateway(), with`,
            "\n\trevelation components:", revelations,
            "\n\tcombined revelation:", combinedRevelation));
    throw new Error("Failed to initialize Inspire Client. See message log for more details.");
  }
});
