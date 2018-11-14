#!/usr/bin/env vlm

const path = require("path");

exports.command = "perspire [revelationPaths..]";
exports.describe = "headless server-side environment";

exports.disabled = (yargs) => !yargs.vlm.packageConfig;
exports.builder = (yargs) => yargs.option({
  output: {
    type: "string",
    default: "",
    description: "Outputs rendered output as a HTML string to a file",
  },
  keepalive: {
    default: false,
    description: `Keeps server alive after initial run. If a number then the output will be ${
        ""}rendered every 'keepalive' seconds.`,
  },
  plugin: {
    type: "string",
    array: true,
    default: [],
    description: "List of plugin paths to load at start",
  },
  cacheRoot: {
    type: "string",
    default: "dist/perspire/cache/",
    description: "Cache root path for indexeddb sqlite shim and other cache storages",
  },
  revelation: {
    description: "Direct revelation object applied after all other revelations",
  },
  revelationRoot: {
    type: "string",
    description: `Explicit gateway.options.revelationRoot path ${
        ""}(by default the first revelationPaths dirname)`,
  },
});

exports.handler = async (yargv) => {
  const JSDOM = require("jsdom").JSDOM;
  const WebSocket = require("ws"); // For networking in Node environments

  const PerspireServer = require("@valos/inspire/PerspireServer").default;

  const container = new JSDOM(`
  <div id="valaa-inspire--main-container"></div>
  `, { pretendToBeVisual: true });
  const meta = container.window.document.createElement("meta");
  meta.httpEquiv = "refresh";
  meta.content = "1";
  container.window.document.getElementsByTagName("head")[0].appendChild(meta);

  // for jsdom.
  global.self = global;
  global.name = "Perspire window";
  global.WebSocket = WebSocket;

  // reset of window after jsdom is set
  global.window = container.window;
  global.document = container.window.document;
  global.navigator = container.window.navigator;
  global.requestAnimationFrame = (callback) => { setTimeout(callback, 0); };
  global.cancelAnimationFrame = (callback) => { setTimeout(callback, 0); };

  // revelationPaths parsing
  const vlm = yargv.vlm;
  const revelationPaths = (yargv.revelationPaths || []).length
      ? yargv.revelationPaths : ["./revela.json"];
  yargv.plugin.forEach(element => {
    require(path.join(process.cwd(), element));
  });
  vlm.shell.mkdir("-p", yargv.cacheRoot);

  const serverOptions = {
    revelationRoot: (yargv.revelationRoot !== undefined)
        ? yargv.revelationRoot
        : vlm.path.dirname(revelationPaths[0]),
    revelations: [
      { gateway: {
          scribe: {
            databaseConfig: {
              // See https://github.com/axemclion/IndexedDBShim for config options
              databaseBasePath: yargv.cacheRoot,
              checkOrigin: false,
      } } } },
      ...revelationPaths.map(p => {
        if (!vlm.shell.test("-f", p)) throw new Error(`Cannot open file '${p}' for reading`);
        return { "...": p };
      }),
      yargv.revelation || {},
    ],
    pluginPaths: yargv.plugin,
    outputPath: yargv.output,
    container: container,
  };

  const server = new PerspireServer(serverOptions);
  await server.start();

  // Creating perspire specific objects and variables.
  // Please use server.Valaa.Perspire for external packages
  server.Valaa.Perspire = {};
  server.Valaa.isServer = true;

  const interval = (typeof yargv.keepalive === "number") ? yargv.keepalive : (yargv.keepalive && 1);
  if (interval) {
    console.warn("Setting up keepalive render every", interval, "seconds");
    await server.run(interval);
  } else {
    console.warn("No keepalive enabled");
  }
  return "Exiting perspire handler";
};
