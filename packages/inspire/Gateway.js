// @flow

import "@babel/polyfill";
import path from "path";

import { Map as ImmutableMap } from "immutable";

import * as valosEngine from "~/engine";
import * as valosInspire from "~/inspire";
import * as valosRaem from "~/raem";
import * as valosScript from "~/script";
import * as valosSourcerer from "~/sourcerer";
import * as valosTools from "~/tools";

import { naiveURI } from "~/raem/ValaaURI";
import createRootReducer from "~/raem/tools/createRootReducer";
import createValidateEventMiddleware from "~/raem/redux/middleware/validateEvent";
import createProcessCommandIdMiddleware from "~/raem/redux/middleware/processCommandId";
import { createBardMiddleware } from "~/raem/redux/Bard";
import Corpus from "~/raem/Corpus";
import { qualifiedNamesOf } from "~/tools/namespace";

import upgradeEventTo0Dot2 from "~/sourcerer/tools/event-version-0.2/upgradeEventTo0Dot2";
import { SOURCERER_EVENT_VERSION } from "~/sourcerer";
import IdentityMediator from "~/sourcerer/FalseProphet/IdentityMediator";

import Engine from "~/engine/Engine";
import EngineContentAPI from "~/engine/EngineContentAPI";
import extendValosheathWithEngine from "~/engine/valosheath";

import InspireView from "~/inspire/InspireView";

// import { registerVidgets } from "~/inspire/ui";
import { Revelation, reveal, expose } from "~/inspire/Revelation";
import extendValosheathWithInspire from "~/inspire/valosheath";

import getGlobal from "~/gateway-api/getGlobal";
import { byteArrayFromBase64URL } from "~/gateway-api/base64";

const fetchJSON = require("@valos/tools/fetchJSON").default;
const patchWith = require("@valos/tools/patchWith").default;

const { AuthorityNexus, FalseProphet, Oracle, Sourcerer, Scribe } = valosSourcerer;
const {
  dumpObject, inBrowser, invariantify, isSymbol, isPromise, FabricEventTarget, mapEagerly,
  thenChainEagerly,
} = valosTools;

const posixPath = path.posix || path;

function _excludeFilename (pathString) {
  return pathString.endsWith(path.sep) ? pathString : path.dirname(pathString);
}

export default class Gateway extends FabricEventTarget {
  constructor (options: Object) {
    super(options.parent, options.verbosity, options.name);

    if (options.siteRoot === undefined) {
      throw new Error("Required gateway.options.siteRoot is undefined");
    }
    if (options.revelationRoot === undefined) {
      throw new Error("Required gateway.options.revelationRoot is undefined");
    }
    this.siteRoot = options.siteRoot;
    this.revelationRoot = _excludeFilename(options.revelationRoot);
    this.domainRoot = options.domainRoot;
    this._pendingViews = [];
    this._valospaceRequirables = {
      "@valos/engine": { "": valosEngine },
      "@valos/inspire": { "": valosInspire },
      "@valos/raem": { "": valosRaem },
      "@valos/script": { "": valosScript },
      "@valos/sourcerer": { "": valosSourcerer },
      "@valos/tools": { "": valosTools },
    };
  }

  getAuthorityNexus () { return this.authorityNexus; }
  getOracle () { return this.oracle; }
  getScribe () { return this.scribe; }
  getFalseProphet () { return this.falseProphet; }
  getIdentityMediator () { return this.identity; }
  getIdentityManager () { return this.identity; }

  getRootDiscourse () { return this.discourse; }
  getRootConnection () { return this._rootConnection; }
  getRootChronicleURI () { return this._rootConnection.getChronicleURI(); }
  getRootFocusURI () { return this._rootFocusURI || this.getRootChronicleURI(); }

  callRevelation (Type: Function | any) {
    if (typeof Type !== "function") return Type;
    return new Type({ parent: this, gateway: this });
  }

  reveal (reference, options = {}) {
    let source = this.resolveRevealReference(reference, options.currentDir);
    let ret;
    if (!inBrowser() && !options.fetch && !source.match(/^[^/]*:/)) {
      ret = this.valosRequire(source, options);
      source = options.modulePath;
    }
    const sourceDir = path.dirname(source);

    options.revealedDir = !sourceDir || (sourceDir.slice(-1) === "/") ? sourceDir : `${sourceDir}/`;
    if (ret === undefined) {
      const basename = path.basename(source);
      const suffix = (basename === "") ? "index.json" : (basename === "index") ? ".json" : "";
      ret = (suffix || (basename.slice(-5) === ".json") || (basename.slice(-3) === ".js"))
          ? this.fetchJSON(`${source}${suffix}`, options.fetch) // fetch with no fallback
          : this.fetchJSON(`${source}.json`, options.fetch)
              .catch(() => this.fetchJSON(`${source}/index.json`, options.fetch)
                  .then(directoryRevelation => {
                    options.revealedDir = `${options.revealedDir}${basename}/`;
                    return directoryRevelation;
                  }));
    }
    return ret;
  }

  resolveRevealReference (reference, currentDir) {
    if (reference[0] === ".") {
      return posixPath.join(_excludeFilename(currentDir || this.revelationRoot), reference);
    }
    if (reference[0] === "/") return posixPath.join((this.siteRoot || ""), reference);
    if ((reference[0] !== "<") || (reference[reference.length - 1] !== ">")) return reference;
    const uri = reference.slice(1, -1);
    if (uri[0] === "/") {
      if (inBrowser()) return uri;
      return posixPath.join(this.domainRoot || this.siteRoot, uri.slice(1));
    }
    if (uri.match(/^[^/]*:/)) return uri; // absolute-ref uri: global reference
    // relative-path URI ref - revelation root relative ref
    return posixPath.join(this.revelationRoot, uri);
  }

  static _moduleMatcherString = "^(((@[^@/]+)\\/)?([^/]+))(\\/(.*))?$";
  static _moduleMatcher = new RegExp(Gateway._moduleMatcherString);

  require (module: string | symbol, options: Object) {
    console.debug(`valos.gateway.require("${module
        }") is DEPRECATED in favor of require("${module}") or valos.gateway.valosRequire`);
    return this.valosRequire(module, options);
  }

  /**
   * valos.require is the entry point for ValOS fabric library
   * imports from inside spindles.
   *
   * @param {string} module
   * @returns
   * @memberof Gateway
   */
  valosRequire (module: string | symbol, options: Object) {
    // TODO(iridian, 2018-12): fabric library version semver
    //   compatibility checking against spindle package.json dependencies
    // TODO(iridian, 2018-12): correlate require semantics with import
    //   semantics

    // TODO(iridian): This issues a webpack warning but is not an
    // actual fault; require will never be called in webpack context
    // where inBrowser always returns true.
    // Webpack unfortunately doesn't offer a convenient way to suppress
    // individual lines to silence warnings. Although it probably would
    // be the correct solution would be to have this structurally
    // abstracted in a @valos/platform-dependent-tools or similar
    // (also contain the inBrowser code) with inherently different
    // paths for various platform-specific functionalities like the
    // require here.
    try {
      let moduleName = module, namespace, library, subPath, parts;
      if (isSymbol(module)) {
        const qualifiedName = qualifiedNamesOf(module);
        if (!qualifiedName) {
          throw new Error(`Unrecognized valos.require module: symbol '${
                String(module)}' is not a namespace symbol`);
        }
        namespace = `@${qualifiedName[0]}`;
        library = qualifiedName[1];
        subPath = "";
        moduleName = `${namespace}/${library}`;
      } else if ((parts = Gateway._moduleMatcher.exec(moduleName))) { // eslint-disable-line
        namespace = parts[3] || "";
        library = parts[4];
        subPath = parts[5] || "";
      } else if (inBrowser()) {
          throw new Error(`Invalid valos.require module: "${
            moduleName}" doesn't match regex /${Gateway._moduleMatcherString}/)`);
      }
      if (!inBrowser()) {
        return require(!options ? moduleName : (options.modulePath = require.resolve(moduleName)));
      }
      moduleName = !namespace ? library : `${namespace}/${library}`;
      const requiredModule = this._valospaceRequirables[moduleName];
      if (!requiredModule) {
        throw new Error(`Unrecognized valos.require module: '${moduleName}'`);
      }
      if (!requiredModule.hasOwnProperty(subPath || "")) {
        throw new Error(`Unavailable valos.require module '${moduleName}' ${
            !subPath ? `top-level entry path` : `sub-path: '${subPath}'`}`);
      }
      return requiredModule[subPath || ""];
    } catch (error) {
      throw this.wrapErrorEvent(error, new Error(`valos.require("${String(module)}")`),
          "\n\toptions:", ...dumpObject(options));
    }
  }

  fetchJSON (...rest) { return fetchJSON(...rest); }

  async initialize (revelation: Revelation, parentPlog) {
    try {
      const plog1 = this.opLog(1, parentPlog, "init",
          "Initializing gateway", { revelation });
/*
 * Process the initially served landing page and extract the initial
 * ValOS configuration ('revelation') from it. The revelation might be
 * device/locality specific. The revelation might contain initial event
 * log snapshots for select chronicles. These event logs might be
 * provided by the landing page provider and might contain relevant
 * chronicle for showing the front page; alternatively the revelation
 * might be served by the local service worker which intercepted the
 * landing page network request and might contain full snapshots of all
 * chronicles that were active during previous session, allowing full
 * offline functionality. Alternatively the service worker can provide
 * the event logs through indexeddb and keep the landing page
 * revelation minimal; whatever is most efficient.
 */
      this.revelation = await reveal(this._interpretRevelation(revelation, plog1));
      this.gatewayRevelation = await expose(this.revelation.gateway);
      if (this.gatewayRevelation.name) this.setName(this.gatewayRevelation.name);

      this.setVerbosity(this.gatewayRevelation.verbosity || 0);

      this.authorityNexus = await this._establishAuthorityNexus(this.gatewayRevelation, plog1);

      // Create the stream router ('oracle') which uses scribe as its direct upstream, but which
      // manages the remote authority connections.
      this.oracle = await this._summonOracle(this.gatewayRevelation, this.authorityNexus, plog1);

      // Create a connector (the 'scribe') to the locally backed event log / bvob indexeddb cache
      // ('scriptures') based on the revelation.
      this.scribe = await this._proselytizeScribe(this.gatewayRevelation, this.oracle, plog1);

      this.corpus = await this._incorporateCorpus(this.gatewayRevelation, plog1);

      // Create the the main in-memory false prophet using the stream router as its upstream.
      this.falseProphet = await this._proselytizeFalseProphet(
          this.gatewayRevelation, this.corpus, this.scribe, plog1);

      this.identity = await this._establishIdentity(
          this.gatewayRevelation, this.falseProphet, plog1);

      // Create a connection and an identity for the gateway towards false prophet
      this.discourse = await this._initiateDiscourse(
          this.gatewayRevelation, this.falseProphet, plog1);

      this.spindleRevelations = (await expose(this.revelation.spindles)) || {};
      await this.attachSpindles(this.gatewayRevelation.spindlePrototypes);

      // Attach so-far unattached spindles which have revelation configurations
      await this.attachSpindles(Object.keys(this.spindleRevelations),
          { skipIfAlreadyAttached: true });

      this.prologue = await reveal(this.revelation.prologue);

      // Locate entry point event log (prologue), make it optimally available through scribe,
      // narrate it with false prophet and get the false prophet connection for it.
      ({ connections: this.prologueConnections, rootConnection: this._rootConnection }
          = await this._sourcerPrologueChronicles(this.prologue));

      plog1 && plog1.opEvent("vidgets",
          "Registering builtin Inspire vidgets");
      // registerVidgets();
      const spindleNames = Object.keys(this._attachedSpindles);
      plog1 && plog1.opEvent("initialized",
          "Gateway initialized");
      this._isInitialized = true;

      this.viewRevelations = (await expose(this.revelation.views)) || {};

      plog1 && plog1.opEvent("notify_spindles",
          `Notifying ${spindleNames.length} spindles of gateway initialization:`,
          spindleNames.join(", "));
      for (const spindle of Object.values(this._attachedSpindles)) {
        await this._notifySpindle(spindle, "onGatewayInitialized", this, spindle.revelation);
      }
    } catch (error) {
      throw this.wrapErrorEvent(error, 1, "initialize", "\n\tthis:", ...dumpObject(this));
    }
  }

  async terminate (options = {}) {
    const plog1 = this.opLog(1, "terminate");
    plog1 && plog1.opEvent("spindles",
        `Notifying spindles of gateway termination:`,
        Object.keys(this._attachedSpindles).join(" "));
    const ret = await Promise.all(Object.values(this._attachedSpindles).map(spindle =>
        this._notifySpindle(spindle, "onGatewayTerminating")));
    await Promise.all(Object.values(this._views).map(view =>
        view.detach && view.detach(options.views)));
    await this.authorityNexus.terminate(options.authorityNexus);
    await this.oracle.terminate(options.oracle);
    await this.scribe.terminate(options.scribe);
    await this.falseProphet.terminate(options.falseProphet);
    return ret;
  }

  setupHostComponents (components: Object) {
    this._hostComponents = {
      createView: components.createView || (options => new InspireView(options)),
      container: components.container,
      hostGlobal: components.hostGlobal || window,
      window: components.window || window,
    };
  }

  createAndConnectViewsToDOM (views: { [string]: {
    container: Object, hostGlobal: Object, window: Object,
    name: string, size: Object, viewRootId: string, focus: any, verbosity: ?number,
  } }) {
    if (this._views) {
      throw new Error("Gateway.createAndConnectViewsToDOM has already been called");
    }
    if (!this._views) this._views = {};
    if (!this._hostComponents) {
      this.setupHostComponents({});
      for (const [key, config] of Object.entries(views)) {
        const { container, hostGlobal, window } = (typeof config !== "function")
            ? config
            : (views[key] = config(this));
        this._hostComponents.container = this._hostComponents.container || container;
        this._hostComponents.hostGlobal = this._hostComponents.hostGlobal || hostGlobal;
        this._hostComponents.window = this._hostComponents.window || window;
      }
    }
    for (const [viewId, config, resolve, reject] of [
      ...Object.entries(views || {}),
      ...(this._pendingViews || []),
    ]) {
      thenChainEagerly(this.addView(viewId, config),
          view => resolve && resolve(view),
          errorOnCreateAndConnectViewsToDOM.bind(this, viewId, config, reject));
    }
    for (const [viewId, viewConfig] of Object.entries(this.viewRevelations)) {
      if (!this._views[viewId]
          && (viewConfig.focus !== undefined || viewConfig.lens !== undefined)) {
        this.addView(viewId, {});
      }
    }
    return this._views;
    function errorOnCreateAndConnectViewsToDOM (viewId, config, reject, error) {
      const wrappedError = this.wrapErrorEvent(error, 1,
          new Error(`createAndConnectViewsToDom(view: ${viewId}`),
              "\n\tviewConfig:", ...dumpObject(config));
      if (reject) reject(wrappedError);
      this.outputErrorEvent(wrappedError,
          `Exception caught during createAndConnectViewsToDOM():${
            ""}\n\n\n\tVIEW NOT ADDED: ${viewId}\n\n`);
    }
  }

  addView (viewId, viewConfig, parentPlog) {
    if ((this._views || {})[viewId]) throw new Error(`View ${viewId} already created`);
    if (!this._hostComponents) {
      return new Promise((resolve, reject) =>
          this._pendingViews.push([viewId, viewConfig, resolve, reject]));
    }
    const actualConfig = (typeof viewConfig === "function") ? viewConfig(this) : viewConfig;
    return this._createAndConnectViewToDOM(
            viewId, { ...this._hostComponents, ...actualConfig }, parentPlog);
  }

  getView (viewId) {
    return this._views[viewId];
  }

  _createAndConnectViewToDOM (viewId, {
    parent = this, verbosity,
    container, hostGlobal, createView,
    ...paramViewConfig
  }, parentPlog) {
    if (!this._views) throw new Error("createAndConnectViewsToDOM must be called first");
    if (this._views[viewId]) throw new Error(`View ${viewId} already exists`);
    const plog1 = this.opLog(1, parentPlog, "create_view",
        `Creating view "${viewId}"`, { verbosity, ...paramViewConfig });
    const view = createView({ parent, verbosity, name: viewId });
    const actualContainer = (typeof container !== "string")
        ? container
        : paramViewConfig.window.document.querySelector(`#${container}`);
    if (!actualContainer) {
      const reason = (typeof container !== "string")
          ? "no view config .container provided"
          : `cannot locate element with id "${container}"`;
      throw new Error(`Cannot locate container for view "${viewId}": ${reason}`);
    }
    const op = { viewId, container: actualContainer, hostGlobal, paramViewConfig, plog: plog1 };
    return (this._views[viewId] = this.opChain(
        "viewCreation", [op, view],
        "_errorOnCreateView", plog1, 2));
  }

  static viewCreation = [
    Gateway.prototype._createViewOptions,
    Gateway.prototype._createViewIdentity,
    Gateway.prototype._createViewEngine,
    Gateway.prototype._buildViewRootScope,
    Gateway.prototype._attachView,
    Gateway.prototype._finalizeViewAndNotifySpindles,
    Gateway.prototype._logSpindleReactions,
  ]

  _errorOnCreateView (error, index, [op]) {
    throw this.wrapErrorEvent(error, 1, new Error(`_createAndConnectViewToDOM(${op.viewId})`),
        "\n\tcontainer:", ...dumpObject(op.container),
        "\n\tviewConfig:", ...dumpObject(op.paramViewConfig));
  }

  async _createViewOptions (op, view) {
    const viewRevelations = (await expose(this.revelation.views)) || {};
// TODO(iridian, 2020-01): Streamline the view parameterization hodgepodge
// monstrosity to use this revelationConfig as much as possible.
    const revelationConfig = viewRevelations[op.viewId] || {};
    op.viewConfig = patchWith(
        { verbosity: op.verbosity, name: op.viewId,
          viewRootId: `valos-gateway--${op.viewId}--view-root`
        },
        ["...", revelationConfig, op.paramViewConfig],
        { spreaderKey: "...", complexToAny: "onlySetIfUndefined" });
    view.setRawName(op.viewId);
    view.setName(`${op.viewConfig.name}-View`);
    view.setVerbosity(op.viewConfig.verbosity);
    return [op, view];
  }

  _createViewIdentity (op, view) {
    op.identity = new IdentityMediator({
      ...(op.viewConfig.identity || {}),
      parent: view,
      sourcerer: this.falseProphet,
    });
    return [op, view];
  }

  _createViewEngine (op, view) {
    const engineOptions = {
      name: `${op.viewConfig.name} Engine`,
      discourse: {},
      ...(op.viewConfig.engine || {}),
      parent: view,
      sourcerer: this.falseProphet,
      revelation: this.revelation,
    };
    Object.assign(engineOptions.discourse, op.viewConfig.discourse || {});
    const engine = op.engine = new Engine(engineOptions);
    (op.plog || {}).chain && op.plog.chain.opEvent(engine, "engine",
        `Created Engine ${engine.debugId()}`, { engineOptions, engine });
    view.setEngine(engine);
    return [op, view];
  }

  _buildViewRootScope (op, view) {
    const rootScope = op.rootScope = op.engine.getRootScope();
    const hostDescriptors = op.engine.getHostDescriptors();
    extendValosheathWithEngine(
        rootScope, hostDescriptors, op.engine.discourse.getRootDiscourse());
    if (!op.viewConfig.defaultAuthorityURI) {
      extendValosheathWithInspire(rootScope, hostDescriptors, op.hostGlobal || getGlobal());
    } else {
      // FIXME(iridian): Implement this.schemes - still missing.
      const defaultAuthorityConfig = gateway.schemes[op.viewConfig.defaultAuthorityURI];
      invariantify(defaultAuthorityConfig,
          `defaultAuthorityConfig missing when looking for default authority ${
                String(op.viewConfig.defaultAuthorityURI)}`);
      extendValosheathWithInspire(rootScope, hostDescriptors, op.hostGlobal || getGlobal(),
          defaultAuthorityConfig, op.engine);
    }
    const gateway = rootScope.valos.gateway = this;
    rootScope.valos.identity = op.identity;
    rootScope.valos.view = {};
    rootScope.console = Object.assign(Object.create(op.engine), {
      debug: function verboseDebugEvent (...rest) {
        gateway.debugEvent(0, ...[].concat(...rest.map(_trimObjects)));
      },
      info: function verboseInfoEvent (...rest) {
        gateway.infoEvent(0, ...[].concat(...rest.map(_trimObjects)));
      },
      log: function verboseLogEvent (...rest) {
        gateway.logEvent(0, ...[].concat(...rest.map(_trimObjects)));
      },
      warn: function verboseWarnEvent (...rest) {
        gateway.warnEvent(0, ...[].concat(...rest.map(_trimObjects)));
      },
      error: function verboseErrorEvent (...rest) {
        gateway.errorEvent(0, ...[].concat(...rest.map(_trimObjects)));
      },
    });
    function _trimObjects (entry) {
      if (entry && (typeof entry === "object") && !inBrowser()) return dumpObject(entry);
      return entry;
    }
    return [op, view];
  }

  _attachView (op, view) {
    return [op, view.attach(op.container, op.viewConfig)];
  }

  _finalizeViewAndNotifySpindles (op, view) {
    this._views[op.viewId] = op.rootScope.valos.view = view;
    view.setRootScope(op.rootScope);

    const attachedViewAwareSpindles = Object.values(this._attachedSpindles)
        .filter(spindle => spindle.onViewAttached);
    (op.plog || {}).chain && op.plog.chain.opEvent(view, "notify_spindles",
        `Notifying ${attachedViewAwareSpindles.length} attached view-aware spindles`);
    return [op, view,
      mapEagerly(attachedViewAwareSpindles,
          spindle => this._notifySpindle(spindle, "onViewAttached", view, op.viewId)),
    ];
  }

  _logSpindleReactions (op, view, spindleReactions) {
    (op.plog || {}).chain && op.plog.chain.opEvent(view, "spindle_reactions",
        "\n\tspindle reactions:", spindleReactions);
    return view;
  }

  /**
   * Processes the landing page and extracts the revelation from it.
   *
   * @param {Object} rawRevelation
   * @returns
   *
   * @memberof Gateway
   */
  async _interpretRevelation (revelation: Revelation, plog): Object {
    try {
      plog && plog.v1 && plog.opEvent("revelation",
          `Interpreted revelation`, revelation);
      return revelation;
    } catch (error) {
      throw this.wrapErrorEvent(error, 1, new Error(`interpretRevelation`),
          "\n\trevelation:", ...dumpObject(revelation));
    }
  }

  async _establishAuthorityNexus (gatewayRevelation: Object, parentPlog) {
    let nexusOptions;
    try {
      nexusOptions = {
        name: "Inspire AuthorityNexus",
        authorityConfigs: gatewayRevelation.authorityConfigs,
        ...(gatewayRevelation.nexus || {}),
        parent: this,
      };
      const plog1 = this.opLog(1, parentPlog, "create_authority-nexus",
          "new AuthorityNexus", nexusOptions);
      const nexus = new AuthorityNexus(nexusOptions);
      plog1 && plog1.opEvent("done",
          "Linked AuthorityNexus:", { nexusOptions, nexus });
      return nexus;
    } catch (error) {
      throw this.wrapErrorEvent(error, 1, new Error(`establishAuthorityNexus`),
          "\n\tnexusOptions:", ...dumpObject(nexusOptions));
    }
  }

  async _summonOracle (gatewayRevelation: Object, authorityNexus: AuthorityNexus, parentPlog):
      Promise<Sourcerer> {
    let oracleOptions;
    try {
      oracleOptions = {
        name: "Inspire Oracle",
        ...(gatewayRevelation.oracle || {}),
        parent: this,
        authorityNexus,
      };
      const plog1 = this.opLog(1, parentPlog, "create_oracle",
          "new Oracle", oracleOptions);
      const oracle = new Oracle(oracleOptions);
      plog1 && plog1.opEvent("done",
          `Proselytized Oracle ${oracle.debugId()}`,
          ", with:", { oracleOptions, oracle });
      return oracle;
    } catch (error) {
      throw this.wrapErrorEvent(error, 1, new Error(`summonOracle`),
          "\n\toracleOptions:", ...dumpObject(oracleOptions),
          "\n\tauthorityNexus:", ...dumpObject(authorityNexus));
    }
  }

  async _proselytizeScribe (gatewayRevelation: Object, oracle: Oracle, parentPlog): Scribe {
    let scribeOptions;
    try {
      scribeOptions = {
        name: "Inspire Scribe",
        databaseAPI: gatewayRevelation.scribe.getDatabaseAPI(),
        ...(gatewayRevelation.scribe || {}),
        parent: this,
        upstream: oracle,
      };
      const plog1 = this.opLog(1, parentPlog, "create_scribe",
        "new Scribe", scribeOptions);
      const scribe = new Scribe(scribeOptions);
      plog1 && plog1.opEvent("await_initiate",
          "Initiating scribe");
      await scribe.initiate();
      plog1 && plog1.opEvent("done",
          `Proselytized Scribe '${scribe.debugId()}'`, { scribeOptions, scribe });
      return scribe;
    } catch (error) {
      throw this.wrapErrorEvent(error, 1, new Error(`proselytizeScribe`),
          "\n\tscribeOptions:", ...dumpObject(scribeOptions));
    }
  }

  async _incorporateCorpus (gatewayRevelation: Object, parentPlog) {
    const name = "Inspire Corpus";
    const reducerOptions = {
      ...EngineContentAPI, // schema, validators, reducers
      ...(gatewayRevelation.reducer || {}),
      parent: this,
    };
    const { schema, validators, mainReduce, subReduce } = createRootReducer(reducerOptions);

    const middlewares = [
      _createProcessCommandVersionMiddleware(SOURCERER_EVENT_VERSION),
      createProcessCommandIdMiddleware(undefined, schema),
      createValidateEventMiddleware(validators, SOURCERER_EVENT_VERSION, SOURCERER_EVENT_VERSION),
      createBardMiddleware(),
    ];

    const corpusOptions = {
      parent: this, name,
      schema, middlewares,
      reduce: mainReduce, subReduce,
      initialState: new ImmutableMap(),
      ...(gatewayRevelation.corpus || {}),
    };
    const plog1 = this.opLog(1, parentPlog, "corpus",
        "new Corpus", corpusOptions);
    const corpus = new Corpus(corpusOptions);
    plog1 && plog1.opEvent("done",
        "Created canonical corpus", { corpusOptions, corpus });
    return corpus;

    function _createProcessCommandVersionMiddleware (version) {
      // Naive versioning which accepts versions given in or uses the supplied version as default
      return (/* store */) => next => (command, ...rest: any[]) => {
        const aspects = command.aspects || (command.aspects = { event: command });
        if (!aspects.version) aspects.version = version;
        else if (aspects.version !== version) {
          throw new Error(`Invalid command version '${aspects.version}', expected '${version}'`);
        }
        return next(command, ...rest);
      };
    }
  }

  async _proselytizeFalseProphet (
      gatewayRevelation: Object, corpus: Corpus, upstream: Sourcerer, parentPlog,
  ): Promise<Sourcerer> {
    let falseProphetOptions;
    try {
      this._commandCountListeners = new Map();
      falseProphetOptions = {
        name: "Inspire FalseProphet",
        corpus,
        upstream,
        schema: EngineContentAPI.schema,
        commandNotificationMinDelay: 500,
        onCommandCountUpdate: (totalCount: number, chronicleCommandCounts: Object) => {
          this._totalCommandCount = totalCount;
          this._chronicleCommandCounts = chronicleCommandCounts;
          this._commandCountListeners.forEach((listener, component) => {
            try {
              listener(totalCount, chronicleCommandCounts);
            } catch (error) {
              this.outputErrorEvent(
                  this.wrapErrorEvent(error, 1,
                      new Error("onCommandCountUpdate.listener()"),
                      "\n\tlistener key:", ...dumpObject(component),
                      "\n\ttotalCount:", totalCount,
                      "\n\tchronicleCommandcounts:", ...dumpObject(chronicleCommandCounts)),
                  "Exception caught during Gateway.onCommandCountUpdate.listener call");
            }
          });
        },
        ...(gatewayRevelation.falseProphet || {}),
        parent: this,
      };
      const plog1 = this.opLog(1, parentPlog, "create_false-prophet",
          "new FalseProphet", falseProphetOptions);
      const falseProphet = new FalseProphet(falseProphetOptions);
      plog1 && plog1.opEvent("done",
          `Proselytized FalseProphet ${falseProphet.debugId()}`,
          { falseProphetOptions, falseProphet });
      return falseProphet;
    } catch (error) {
      throw this.wrapErrorEvent(error, 1, new Error(`proselytizeFalseProphet`),
          "\n\tfalseProphetOptions:", ...dumpObject(falseProphetOptions),
          "\n\tupstream:", ...dumpObject(upstream));
    }
  }

  getTotalCommandCount () { return this._totalCommandCount || 0; }
  getChronicleStatuses (options: { listEmpty: boolean }) {
    if (!this._chronicleCommandCounts) return {};
    if (options && options.listEmpty) return this._chronicleCommandCounts;
    const ret = {};
    for (const [key, count] of Object.entries(this._chronicleCommandCounts)) {
      if (count) {
        try {
          const connection = this.falseProphet.sourcerChronicle(key, { newConnection: false });
          ret[key] = connection.getStatus();
        } catch (error) {
          ret[key] = { commands: count };
        }
      }
    }
    return ret;
  }

  setCommandCountListener (component: Object,
      callback: (totalCount: number, chronicleCommandCounts: Object) => void) {
    if (!callback) this._commandCountListeners.delete(component);
    else {
      this._commandCountListeners.set(component, callback);
      callback(this._totalCommandCount, this._chronicleCommandCounts);
    }
  }

  async _establishIdentity (gatewayRevelation: Object, falseProphet: FalseProphet, parentPlog) {
    let identityOptions, identity;
    try {
      identityOptions = {
        ...(gatewayRevelation.identity || {}),
        parent: this,
        sourcerer: falseProphet,
      };
      const plog1 = this.opLog(1, parentPlog, "create_identity",
          "new IdentityMediator", identityOptions);
      identity = new IdentityMediator({
        ...identityOptions,
      });
      plog1 && plog1.opEvent("done",
          `Established Gateway Identity ${identity.debugId()}`,
          { identityOptions, identity });
      return identity;
    } catch (error) {
      throw this.wrapErrorEvent(error, 1, new Error(`establishIdentity`),
          "\n\tdiscourseOptions:", ...dumpObject(identityOptions),
          "\n\tfalseProphet:", ...dumpObject(falseProphet),
          "\n\tidentity:", ...dumpObject(identity));
    }
  }

  async _initiateDiscourse (gatewayRevelation: Object, falseProphet: FalseProphet, parentPlog) {
    let discourseOptions, discourse;
    try {
      discourseOptions = {
        ...(gatewayRevelation.discourse || {}),
      };
      const plog1 = this.opLog(1, parentPlog, "create_discourse",
          "new FalseProphetDiscourse", discourseOptions);
      discourse = falseProphet.createDiscourse(this, discourseOptions);
      plog1 && plog1.opEvent("done",
          `Initiated FalseProphetDiscourse ${discourse.debugId()}`,
          { discourseOptions, discourse });
      return discourse;
    } catch (error) {
      throw this.wrapErrorEvent(error, 1, new Error(`initiateDiscourse`),
          "\n\tdiscourseOptions:", ...dumpObject(discourseOptions),
          "\n\tfalseProphet:", ...dumpObject(falseProphet),
          "\n\tdiscourse:", ...dumpObject(discourse));
    }
  }

  _attachedSpindles = {};

  getSpindles () {
    return Object.values(this._attachedSpindles);
  }

  getSpindle (name) {
    const ret = this._attachedSpindles[name];
    if (!ret) throw new Error(`No spindle found with name "${name}"`);
    return ret;
  }

  getAttachedSpindle (name) {
    this.warnEvent("Gateway.getAttachedSpindle DEPRECATED in favor of getSpindle");
    return this.getSpindle(name);
  }

  async attachSpindle (spindlePrototype: Promise<Object>) {
    return this.attachSpindles([spindlePrototype]);
  }

  async attachSpindles (spindleModules_: (Promise<Object> | Object)[],
      options: { skipIfAlreadyAttached: boolean } = {}, parentPlog) {
    const plog1 = this.opLog(1, parentPlog, "spindles",
        `Obtaining ${spindleModules_.length} spindle modules`);
    const spindleModules = await Promise.all(spindleModules_ || []);
    const newSpindleLookup = {};
    const spindleNames = [];
    await Promise.all((spindleModules || [])
        .map(module_ => {
          let module = module_;
          if (module.default) module = module.default;
          if ((module || "").hasOwnProperty("name")) return [module.name, module];
          if (options.skipIfAlreadyAttached && this._attachedSpindles[module]) return [module];
          const requiredModule = (this.valosRequire(module) || "").default;
          if (!requiredModule) {
            throw new Error(`Failed spindle module require("${String(module)
                }"): exports.default missing`);
          }
          if (!isSymbol(module) && (requiredModule.name !== module)) {
            throw new Error(`Failed spindle module require("${String(module)
                }"): exports.default.name ("${String(requiredModule.name)
                }") differs from the required module name`);
          }
          return [requiredModule.name, requiredModule];
        })
        .map(async ([spindleName, spindlePrototype]) => {
          if (!spindlePrototype) return null;
          if (newSpindleLookup[spindleName]) {
            this.errorEvent(`Spindle '${spindleName}' already being added:`,
                newSpindleLookup[spindleName],
                "\n\tskipping adding a new duplicate:", ...dumpObject(spindlePrototype));
          }
          if (this._attachedSpindles[spindleName]) {
            if (options.skipIfAlreadyAttached) return null;
            throw new Error(`Spindle '${spindleName}' already attached`);
          }
          spindleNames.push(spindleName);
          const spindleRevelation = this.spindleRevelations[spindleName];
          return (newSpindleLookup[spindleName] = spindlePrototype.attachSpawn
              ? spindlePrototype.attachSpawn(this, spindleRevelation)
              : Object.assign(Object.create(spindlePrototype),
                  { gateway: this, revelation: spindleRevelation }));
        }));
    plog1 && plog1.opEvent("attach",
        `Attaching ${spindleNames.length} spindles:`,
        { spindleNames });
    for (const name of spindleNames) await this._attachSpindle(name, newSpindleLookup[name]);
  }

  _attachSpindle (name: string, spindle: Object) {
    try {
      this._attachedSpindles[name] = spindle;
      for (let [moduleName, subPathLookup] of Object.entries(spindle.valospaceRequirables || {})) {
        if (!moduleName.endsWith("/")) {
          subPathLookup = { "": subPathLookup };
        } else {
          moduleName = moduleName.slice(0, -1);
        }
        if (this._valospaceRequirables[moduleName] !== undefined) {
          throw new Error(`valos requirable module '${
              moduleName}' already defined (when trying to attach spindle '${name}')`);
        }
        this._valospaceRequirables[moduleName] = subPathLookup;
      }
      for (const schemeModule of Object.values(spindle.schemeModules || {})) {
        const called = this.callRevelation(schemeModule);
        this.authorityNexus.addSchemeModule(called);
      }
      for (const authorityConfig of Object.values(spindle.authorityConfigs || {})) {
        this.authorityNexus.addAuthorityPreConfig(authorityConfig);
      }
      for (const MediaDecoderType: any of Object.values(spindle.mediaDecoders || {})) {
        this.oracle.getDecoderArray().addDecoder(this.callRevelation(MediaDecoderType));
      }
      return this._isInitialized && thenChainEagerly(null, [
        () => this._notifySpindle(spindle, "onGatewayInitialized", this, spindle.revelation),
        ...Object.keys(this._views || {}).map(viewName =>
        // Do not block for views to init
            () => !isPromise(this._views[viewName])
        // Do wait for spindle itself
                && this._notifySpindle(spindle, "onViewAttached", this._views[viewName], viewName))
      ]);
    } catch (error) {
      throw this.wrapErrorEvent(error, 1, new Error(`attachSpindle(${name})`),
          "\n\tspindle:", ...dumpObject(spindle),
          "\n\tspindle proto:", ...dumpObject(Object.getPrototypeOf(spindle)),
      );
    }
  }

  _notifySpindle (spindle, notifyMethodName, ...notifyParameters) {
    if (!spindle[notifyMethodName]) return;
    thenChainEagerly(
        spindle[notifyMethodName](...notifyParameters),
        result => this.infoEvent(1, () => [
          `Notify '${notifyMethodName}' complete to spindle`, spindle.name,
          "\n\tresult:", ...dumpObject(result),
        ]),
        error => this.outputErrorEvent(error,
            `Exception caught during notify '${notifyMethodName}' to spindle ${spindle.name}`));
  }

  async _sourcerPrologueChronicles (prologue: Object, parentPlog) {
    let chronicles;
    try {
      const rootFocusURI = await reveal(prologue.root) || await reveal(prologue.rootFocusURI);
      let rootChronicleURI = await reveal(prologue.rootChronicleURI);
      if (!rootChronicleURI && rootFocusURI) {
        rootChronicleURI = rootFocusURI.split("#")[0];
      }
      if (rootChronicleURI) {
        rootChronicleURI = naiveURI.validateChronicleURI(rootChronicleURI);
      }
      const plog1 = this.opLog(1, parentPlog, "prologue");
      if (!rootChronicleURI && prologue.rootPartitionURI) {
        this.errorEvent("DEPRECATED: prologue.rootPartitionURI used to override rootChronicleURI",
            "\n\tthis is probably due to ?partition= query param; use ?chronicle= instead.");
        rootChronicleURI = naiveURI.createPartitionURI(prologue.rootPartitionURI);
      }
      if (!rootChronicleURI) {
        throw new Error("gateway.rootChronicleURI and gateway.rootFocusURI are missing");
      }
      plog1 && plog1.opEvent("determine",
          `Determining prologues and the root chronicle <${rootChronicleURI}>`);
      this._rootFocusURI = rootFocusURI;
      chronicles = await this._determinePrologueChronicles(prologue, rootChronicleURI);
      plog1 && plog1.opEvent("extraction",
          `Extracted ${chronicles.length} chronicles from the prologue`, {
            rootChronicleURI,
            prologueChronicleURIs: chronicles.map(({ chronicleURI }) => chronicleURI),
          });
      plog1 && plog1.opEvent("sourcery",
          `Sourcering ${chronicles.length} prologue and root chronicles`,
          { chronicles, rootChronicleURI });
      const connections = await Promise.all(chronicles.map(chronicleInfo =>
          this._sourcerPrologueChronicle(prologue, chronicleInfo, plog1)));
      plog1 && plog1.opEvent("done",
          `Acquired active connections for all prologue chronicles:`,
          ...[].concat(...connections.map(connection =>
              [`\n\t${connection.getName()}:`, ...dumpObject(connection.getStatus())]))
      );
      const rootConnection = connections.find(connection =>
          (connection.getChronicleURI() === rootChronicleURI));
      return { connections, rootConnection };
    } catch (error) {
      throw this.wrapErrorEvent(error, 1, new Error(`narratePrologue`),
          "\n\trevelation.prologue:", prologue,
          "\n\tprologue chronicles:", ...dumpObject(chronicles));
    }
  }

  async _determinePrologueChronicles (prologue: Object, rootChronicleURI: any) {
    const ret = [];
    let rootChronicleURISeen = false;
    try {
      const chronicleInfos = Object.assign({},
          await reveal(prologue.partitionInfos),
          await reveal(prologue.chronicleInfos));
      for (const [revelationChronicleURI, info] of Object.entries(chronicleInfos)) {
        const chronicleURI = info.authorityURI
            ? naiveURI.createChronicleURI(info.authorityURI, revelationChronicleURI)
            : naiveURI.createPartitionURI(revelationChronicleURI);
        ret.push({ chronicleURI, ...(await reveal(info)) });
        if (chronicleURI === rootChronicleURI) rootChronicleURISeen = true;
      }
      if (rootChronicleURI && !rootChronicleURISeen) {
        ret.push({ chronicleURI: rootChronicleURI, truthCount: 0, logs: { truthLog: [] } });
      }
      if (!ret.length) {
        throw new Error(`Revelation prologue is missing an entry point${
            ""} (last of the prologue.chronicleInfos or prologue.rootChronicleURI)`);
      }
      return ret;
    } catch (error) {
      throw this.wrapErrorEvent(error, 1, new Error(`determineRevelationPrologues`),
          "\n\tprologue revelation:", ...dumpObject(prologue),
      );
    }
  }

  async _sourcerPrologueChronicle (prologue: Object, info: {
    chronicleURI: string,
    commandId: ?number, commandCount: ?number,
    eventId: ?number, truthCount: ?number, logs: ?Object,
  }, parentPlog) {
    const chronicleURI = await reveal(info.chronicleURI);
    // Acquire connection without remote narration to determine the current last authorized event
    // so that we can narrate any content in the prologue before any remote activity.
    const connectionOptions = await reveal(info.connection || {});
    const plog2 = this.opLog(2, parentPlog, "chronicle",
        `Sourcering chronicle <${chronicleURI}>`, connectionOptions);
    const connection = this.discourse
        .sourcerChronicle(naiveURI.validateChronicleURI(chronicleURI), {
          ...connectionOptions,
          subscribeEvents: false,
          narrateOptions: { remote: false },
        });
    plog2 && plog2.opEvent(connection, "activate",
        "Activating connection");
    await connection.asSourceredConnection();
    let prologueTruthCount = await reveal(info.truthCount);
    if (!Number.isInteger(prologueTruthCount)) {
      // Migration code for eventId deprecation.
      const lastEventId = await reveal(info.eventId);
      prologueTruthCount = lastEventId !== undefined ? lastEventId + 1 : 0;
    }
    const eventIdEnd = connection.getFirstUnusedTruthEventId() || 0;
    const shouldChroniclePrologue = ((prologueTruthCount || 0) > eventIdEnd);
    if (shouldChroniclePrologue) {
      plog2 && plog2.opEvent(connection, "proclaim",
          `Proclaiming truths, medias and bvobs from revelation`);
      // If no event logs are replayed, we don't need to precache the bvobs either, so we delay
      // loading them up to this point.
      await (reveal(this.bvobInfos) || (this.bvobInfos = this._getBvobInfos()));
      let logs = await reveal(info.logs);
      const chronicleId = connection.getChronicleId();
      if (!logs || !Object.keys(logs).length) {
        logs = (await reveal(((await reveal(prologue.chronicleVLogs)) || {})[chronicleId])) || {};
      }
      let truthLog = await reveal(logs.truthLog);
      if (!truthLog || !truthLog.length) {
        truthLog = (await reveal(logs.eventLog)) || []; // Migration code for eventLog deprecation.
      }
      let mediaInfos = await reveal(logs.latestMediaInfos); // only used for validation
      if (!mediaInfos || !Object.keys(mediaInfos).length) {
        mediaInfos = (await reveal(((await reveal(
            prologue.chronicleMediaInfos)) || {})[chronicleId])) || {};
      }
      for (let i = 0; i !== truthLog.length; ++i) {
        const upgradedEvent = upgradeEventTo0Dot2(connection, truthLog[i]);
        if (upgradedEvent !== truthLog[i]) truthLog[i] = upgradedEvent;
      }
      const proclamation = connection.proclaimEvents(truthLog, {
        name: `prologue truths for '${connection.getName()}'`,
        isTruth: true,
        eventIdBegin: eventIdEnd,
        retrieveMediaBuffer (mediaInfo: Object) {
          const latestInfo = mediaInfo.mediaVRL && mediaInfos[mediaInfo.mediaVRL.rawId()];
          if (!latestInfo || (mediaInfo.contentHash !== latestInfo.mediaInfo.contentHash)) {
            // Bvob wasn't found in cache (as retrieveMediaBuffer was called)
            // and the contentHash doesn't match the latest known contentHash
            // for the requested media. This is a Media content bvob
            // request for old content; return undefined to silently
            // ignore this request.
            return undefined;
          }
          // Bvob content wasn't found in cache (retrieveMediaBuffer was called)
          // but as the content in matches the last known media content
          // this is a validation error.
          throw new Error(`Cannot find the latest bvob of media "${mediaInfo.name
              }" during prologue narration, with bvob id "${mediaInfo.contentHash}" `);
        }
      });
      plog2 && plog2.opEvent(connection, "await_proclamation",
          `Waiting for the proclaimed events to resolve locally`);
      for (const result of proclamation.eventResults) await result.getComposedEvent();
    }
    // Initiate remote narration.
    let remoteNarration;
    if (connectionOptions.remote !== false) {
      plog2 && plog2.opEvent(connection, "narrate",
          `Starting full remote narration and subscribing for events`);
      remoteNarration = (connectionOptions.remote !== false) && connection.narrateEventLog({
        subscribeEvents: true,
        eventIdBegin: eventIdEnd,
      });
    }
    if (!shouldChroniclePrologue && !(eventIdEnd > 0)) {
      if (!remoteNarration) {
        throw new Error(`No truths found in prologue for non-remote chronicle <${chronicleURI}>`);
      }
      plog2 && plog2.opEvent(connection, "await_narration",
          `Waiting for remote narration`);
      await remoteNarration;
    }
    plog2 && plog2.opEvent("done");
    return connection;
  }

  // Permanently precache revelation bvobs by setting its refcount to 1.
  static revelationBvobInitialPersistRefCount = 1;

  async _getBvobInfos () {
    const readRevelationBvobContent = async (contentHash: string) => {
      const bvobBuffers = {
        ...await reveal(this.prologue.bvobBuffers),
        ...await reveal(this.prologue.blobBuffers), // deprecated
      };
      let entry = bvobBuffers[contentHash];
      if ((entry === undefined) && (contentHash[0] !== "@")) {
        entry = bvobBuffers[`@$~bvob.${contentHash}@@`];
      }
      if (entry === undefined) {
        this.errorEvent("Could not locate precached content for bvob", contentHash,
            "from revelation bvobBuffers", ...dumpObject(bvobBuffers));
        return undefined;
      }
      const container = await reveal(entry);
      if (container.base64 !== undefined) return byteArrayFromBase64URL(container.base64).buffer;
      return container;
    };
    const bvobInfos = {
      ...((await reveal(this.prologue.bvobInfos)) || {}),
      ...((await reveal(this.prologue.blobInfos)) || {}), // deprecated
    };
    for (const [contentIdOrHash, bvobInfoMaybe] of Object.entries(bvobInfos || {})) {
      const bvobInfo = await reveal(bvobInfoMaybe);
      if (bvobInfo.persistRefCount !== 0 || (await bvobInfo.mediaPaths || []).length) {
        const contentHash = (contentIdOrHash[0] === "@")
            ? contentIdOrHash.slice(8, -2)
            : contentIdOrHash;
        await this.scribe.preCacheBvob(contentHash, bvobInfo, readRevelationBvobContent,
            Gateway.revelationBvobInitialPersistRefCount);
      }
    }
    return (this.bvobInfos = bvobInfos);
  }
}
