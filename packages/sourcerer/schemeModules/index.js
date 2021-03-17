// @flow

import createValaaLocal from "./valaa-local";
import createValaaMemory from "./valaa-memory";
import createValaaTransient from "./valaa-transient";
import createValOSProtocol from "./valosp";

export default {
  "valaa-local": createValaaLocal,
  "valaa-memory": createValaaMemory,
  "valaa-transient": createValaaTransient,
  valosp: createValOSProtocol,
};
